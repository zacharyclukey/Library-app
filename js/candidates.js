// Where a recommendation can come from.
//
// Discover used to have exactly one source: Open Library searches built out of
// your own authors and subjects. Everything else in the app — friends, readers
// with shelves like yours, the community's ratings — could only *reweight* a
// book that one of those searches had already returned. So a book your closest
// friend loved was invisible unless Open Library happened to surface it, and
// the signal the feature leads with was wired as a tiebreaker.
//
// There are five sources here, and two of them need no network at all:
//
//   shelves    your own To Read and Wishlist — you already chose these
//   series     the next book in a series you're enjoying
//   friends    what people you follow finished and rated well
//   taste      the Open Library searches (the old path, better driven)
//   community  books held by readers whose shelves resemble yours
//
// The offline pair is what makes a "what next" that appears the moment you
// finish a book possible at all: it can answer instantly, on a phone with no
// signal, for someone who has three books and no Firebase project. The rest
// enrich it. See docs/RECOMMENDATIONS.md.

import * as api from "./api.js";
import * as db from "./db.js";
import * as flt from "./filters.js";
import * as social from "./social.js";
import * as community from "./community.js";
import * as taste from "./taste.js";

// A candidate is deliberately shaped like an Open Library search row, because
// that is what the ranker and the card renderer already understand:
//
//   { key, workKey, title, authors, year, pages, coverUrl,
//     avgRating, ratingsCount, subjects, source, sourceScore, reason, book }
//
// `book` is set only when the candidate is already in the library (the shelves
// source), so the caller can move it rather than add a second copy of it.

const norm = (t) =>
  (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Volume numbering collapsed, so a long serial contributes one entry rather
// than flooding the list. Mirrors seriesKey() in app.js.
export function titleKey(title) {
  return norm(
    String(title ?? "").replace(/[,:]?\s*(vol\.?|volume|bk\.?|book|part|no\.?|#)\s*\d+.*$/i, "")
  );
}

const BOXSET = /box(ed)? set|omnibus|\bbundle\b|complete collection/i;

// ---------- source: your own shelves ----------
//
// The best next book is very often one you already picked. This costs nothing,
// works offline, needs no other users, and on most evenings it should win.
// A recommender that only ever sends you shopping is the wrong product.
// Shelves are per-person: db.shelfFor answers through this reader's eyes and
// falls back to the household's `shelf` for anyone who hasn't given their own.
// Reading `b.shelf` directly would offer you your partner's To Read pile.
export function fromShelves(books, profile) {
  return books
    .filter((b) => ["tbr", "wishlist"].includes(db.shelfFor(b, profile)))
    .map((b) => ({
      key: community.bookKey(b),
      workKey: b.workKey ?? null,
      title: b.title,
      authors: b.authors ?? [],
      year: flt.yearOf(b),
      pages: b.pageCount ?? null,
      coverUrl: b.coverUrl ?? null,
      avgRating: null,
      ratingsCount: 0,
      subjects: b.subjects ?? [],
      // Currently-reading books float to the top of a shelf; here they'd be
      // odd advice ("read the book you're reading"), so they sit lower.
      sourceScore: db.readingFor(b, profile) ? 0.5 : db.shelfFor(b, profile) === "tbr" ? 1 : 0.8,
      source: "shelves",
      reason:
        db.shelfFor(b, profile) === "tbr"
          ? "Waiting on your To Read shelf"
          : "On your wishlist",
      book: b,
    }));
}

// ---------- source: the next book in a series ----------
//
// The highest-precision recommendation a reading app can make, and until now
// it appeared only as a badge on a card — never in Discover, and never at the
// moment someone finished book two.
export async function fromSeries(books, profile, { limit = 3 } = {}) {
  const have = new Set(books.map((b) => norm(b.title)));
  const haveWorks = new Set(books.map((b) => b.workKey).filter(Boolean));

  // Series worth continuing: ones this reader liked, most recently read first.
  const bySeries = new Map();
  for (const b of books) {
    const name = b.series?.name;
    if (!name) continue;
    const rating = b.ratings?.[profile] ?? b.rating ?? null;
    const liked = rating != null ? rating >= 4 : db.shelfFor(b, profile) === "completed";
    if (!liked) continue;
    const row = bySeries.get(name) ?? { name, at: "", authors: [], best: 0, from: b };
    const at = db.finishedAtFor(b, profile) ?? b.addedAt ?? "";
    if (at > row.at) {
      row.at = at;
      row.from = b;
    }
    row.best = Math.max(row.best, rating ?? 4);
    row.authors = [...new Set([...row.authors, ...(b.authors ?? [])])];
    bySeries.set(name, row);
  }

  const wanted = [...bySeries.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  const out = [];

  await Promise.allSettled(
    wanted.map(async (s) => {
      let list = [];
      try {
        list = await api.listSeriesBooks(s.name, s.authors);
      } catch {
        return; // no signal, no failure — the other sources still answer
      }
      for (const item of list) {
        if (BOXSET.test(item.title)) continue;
        if (haveWorks.has(item.workKey) || have.has(norm(item.title))) continue;
        out.push({
          key: item.workKey ? "ol_" + item.workKey.replace("/works/", "") : "t_" + norm(item.title),
          workKey: item.workKey,
          title: item.title,
          authors: item.authors ?? [],
          year: item.year ?? null,
          pages: null,
          coverUrl: item.coverUrl ?? null,
          avgRating: null,
          ratingsCount: 0,
          subjects: [],
          sourceScore: 1,
          source: "series",
          reason:
            s.best >= 5
              ? `More of ${s.name} — you gave “${s.from.title}” five stars`
              : `The rest of ${s.name}`,
        });
      }
    })
  );
  return out;
}

// ---------- source: people you follow ----------
//
// social.fetchFollowing() already returns each reader's recent activity with
// titles, covers and the rating they gave. It was only ever consulted as a
// lookup table; here it introduces books on its own.
export async function fromFriends(books, profile) {
  const have = new Set(books.map((b) => norm(b.title)));
  const haveKeys = new Set(books.map((b) => community.bookKey(b)));
  let readers = [];
  try {
    readers = await social.fetchFollowing();
  } catch {
    return [];
  }

  const byKey = new Map();
  for (const reader of readers) {
    if (reader.missing) continue;
    for (const item of reader.recent ?? []) {
      if (!item.key || haveKeys.has(item.key) || have.has(norm(item.title))) continue;
      // Only what they actually liked. A book someone merely finished is a
      // weaker claim than one they rated, and a 2★ from a friend is a warning.
      if (item.rating != null && item.rating < 4) continue;
      const weight = (reader.friend ? 1 : 0.55) * (item.rating ? item.rating / 5 : 0.7);
      const row = byKey.get(item.key) ?? {
        key: item.key,
        workKey: item.key.startsWith("ol_") ? "/works/" + item.key.slice(3) : null,
        title: item.title,
        authors: item.authors ?? [],
        year: null,
        pages: null,
        coverUrl: item.coverUrl ?? null,
        avgRating: null,
        ratingsCount: 0,
        subjects: [],
        sourceScore: 0,
        source: "friends",
        who: [],
        friend: false,
        bestRating: null,
      };
      row.sourceScore += weight;
      if (!row.who.includes(reader.name)) row.who.push(reader.name);
      row.friend = row.friend || reader.friend;
      if (item.rating != null) row.bestRating = Math.max(row.bestRating ?? 0, item.rating);
      byKey.set(item.key, row);
    }
  }

  const rows = [...byKey.values()];
  const max = Math.max(...rows.map((r) => r.sourceScore), 1);
  for (const r of rows) {
    r.sourceScore /= max;
    const names = r.who.slice(0, 2).join(" and ");
    const more = r.who.length > 2 ? ` +${r.who.length - 2}` : "";
    r.reason = r.bestRating
      ? `${names}${more} rated it ${"★".repeat(Math.round(r.bestRating))}`
      : `${names}${more} read this`;
  }
  return rows;
}

// ---------- source: readers with shelves like yours ----------
//
// coReadScores returns keys, not books, so the community summaries supply the
// titles. Bounded hard: this is the one source whose cost grows with the
// number of users, and until the batch model lands (see the plan) it is a
// client-side scan.
export async function fromCommunity(books, profile, { limit = 12 } = {}) {
  const myKeys = books.map((b) => community.bookKey(b));
  const mine = new Set(myKeys);
  let scores;
  try {
    scores = await community.coReadScores(myKeys);
  } catch {
    return { rows: [], scores: new Map() };
  }
  const wanted = [...scores.entries()]
    .filter(([k]) => !mine.has(k))
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit);
  if (!wanted.length) return { rows: [], scores };

  const summaries = await community.fetchSummaries(wanted.map(([k]) => k));
  const out = [];
  for (const [key, { score, readers }] of wanted) {
    const s = summaries.get(key);
    if (!s?.title) continue; // no metadata, nothing to show
    out.push({
      key,
      workKey: key.startsWith("ol_") ? "/works/" + key.slice(3) : null,
      title: s.title,
      authors: s.authors ?? [],
      year: null,
      pages: null,
      coverUrl: null,
      avgRating: s.ratingAvg ?? null,
      ratingsCount: s.ratingCount ?? 0,
      subjects: [],
      sourceScore: score,
      source: "community",
      reason:
        readers > 1
          ? "Readers with shelves like yours have this"
          : "A reader with shelves like yours has this",
    });
  }
  // The score map goes back too, so the ranker can credit a book that another
  // source found without paying for a second collection scan.
  return { rows: out, scores };
}

// ---------- source: taste queries against Open Library ----------
//
// The original path. What's changed is what drives it: a stored, signed,
// decayed taste object rather than the first ten books in the library, and
// authors this reader has voted *against* are never queried for.
export async function fromTaste(books, t, filter = {}, { perQuery = 25 } = {}) {
  const authors = taste.top(t.authors, 5);
  const subjects = taste.top(t.subjects, 5);
  const genres = taste.top(t.genres, 3);

  const genreTerm = filter.genre ? flt.genreQueryTerm(filter.genre) : null;
  const withGenre = (q) => (genreTerm ? `${q} AND subject:"${genreTerm}"` : q);
  const clauses = api.yearClause(filter.age);
  // New releases have few ratings, so ranking them by rating buries them.
  const sort = filter.age === "new" ? "new" : "rating";

  const queries = [
    ...authors.map((a) => ({ q: withGenre(`author:"${a}"`), reason: `More by ${a}` })),
    ...subjects
      .filter((s) => s.toLowerCase() !== genreTerm)
      .map((s) => ({ q: withGenre(`subject:"${s}"`), reason: s })),
  ];
  if (genreTerm) {
    queries.push({ q: `subject:"${genreTerm}"`, reason: `Top-rated ${filter.genre}` });
  } else {
    genres.forEach((g) =>
      queries.push({ q: `subject:"${flt.genreQueryTerm(g)}"`, reason: `${g} you might like` })
    );
  }
  if (!queries.length) return { rows: [], reached: true };

  const have = new Set(books.map((b) => norm(b.title)));
  const haveWorks = new Set(books.map((b) => b.workKey).filter(Boolean));
  const found = new Map();
  api.resetSearchReachability();

  await Promise.allSettled(
    queries.map(async ({ q, reason }) => {
      const rows = await api.searchRankedWithFallback(q, clauses, { limit: perQuery, sort });
      for (const r of rows) {
        if (haveWorks.has(r.workKey)) continue;
        if (BOXSET.test(r.title)) continue;
        const key = titleKey(r.title);
        if (have.has(norm(r.title)) || have.has(key)) continue;
        const existing = found.get(key);
        if (existing) {
          existing.hits++; // corroborated by another query — a better signal
        } else {
          found.set(key, {
            ...r,
            key: r.workKey ? "ol_" + r.workKey.replace("/works/", "") : "t_" + key,
            subjects: [],
            source: "taste",
            sourceScore: 0.6,
            reason,
            hits: 1,
          });
        }
      }
    })
  );

  return { rows: [...found.values()], reached: api.lastSearchReachedServer() };
}

// ---------- assembly ----------

// Merge sources into one list, best claim per book. Order matters: a book that
// is both on your wishlist and a friend's favourite should say so as a shelf
// book you can start tonight, not as a stranger's suggestion.
const SOURCE_RANK = { shelves: 5, series: 4, friends: 3, community: 2, taste: 1 };

export function merge(lists) {
  const byKey = new Map();
  const byTitle = new Map();
  for (const row of lists.flat()) {
    if (!row?.title) continue;
    const tk = titleKey(row.title);
    const existing = byKey.get(row.key) ?? byTitle.get(tk);
    if (!existing) {
      const copy = { ...row, sources: { [row.source]: row.sourceScore ?? 0 } };
      byKey.set(row.key, copy);
      byTitle.set(tk, copy);
      continue;
    }
    // Keep every source's claim — the ranker scores all of them — but present
    // the book as whichever source has the strongest claim to it.
    existing.sources[row.source] = Math.max(existing.sources[row.source] ?? 0, row.sourceScore ?? 0);
    existing.hits = (existing.hits ?? 1) + (row.hits ?? 1);
    if ((SOURCE_RANK[row.source] ?? 0) > (SOURCE_RANK[existing.source] ?? 0)) {
      existing.source = row.source;
      existing.reason = row.reason;
      if (row.book) existing.book = row.book;
      if (row.who) existing.who = row.who;
      if (row.friend !== undefined) existing.friend = row.friend;
    }
    // Never lose metadata one source had and another didn't.
    for (const f of ["coverUrl", "workKey", "year", "pages", "avgRating", "ratingsCount"]) {
      if (existing[f] == null && row[f] != null) existing[f] = row[f];
    }
    if (!existing.subjects?.length && row.subjects?.length) existing.subjects = row.subjects;
  }
  return [...byKey.values()].filter((r, i, arr) => arr.indexOf(r) === i);
}

// Which filter axes a recommendation can honestly be judged on.
//
// Deliberately not the whole shelf vocabulary. Spice and audience tags exist
// only for books someone has tagged by hand — no free catalogue rates them
// (README says so, and js/filters.js's suggestContent is explicit that its
// guesses are suggestions, not verdicts). Offering "Spicy 3+" in Discover
// would therefore either drop every book outside the library, or quietly show
// untagged books as if they qualified. Both are lies; the honest move is not
// to offer the control. It becomes offerable when community pace/spice tags
// accumulate — the same route the mood dials take.
export const FILTERABLE = ["genre", "pages", "age", "series"];

// Constrain a merged list. A book whose length or year we don't know can't be
// judged against an explicit range, which is the same rule the shelves use.
export function applyFilter(rows, f = {}) {
  if (!f || (!f.genre && flt.isFullPageRange(f.pages) && !f.age && !f.series)) return rows;
  return rows.filter((r) => {
    if (!flt.pagesMatch(r.pages, f.pages)) return false;
    if (f.age && r.year != null && !flt.ageMatches(r.year, f.age)) return false;
    if (f.genre) {
      // A candidate with no subject tags yet can't be judged on genre, and the
      // query that found it was already genre-constrained — so keep it rather
      // than drop it for missing data we never fetched.
      const known = (r.subjects ?? []).length || (r.book?.subjects ?? []).length;
      const hay = { subjects: [...(r.subjects ?? []), ...(r.book?.subjects ?? [])], title: r.title };
      if (known && !flt.genresOf(hay).includes(f.genre)) return false;
    }
    const inSeries = !!r.book?.series?.name || r.source === "series";
    if (f.series === "series" && !inSeries) return false;
    if (f.series === "standalone" && inSeries) return false;
    return true;
  });
}

// Fill in real subject tags for the strongest candidates, so subject overlap is
// measured rather than assumed. Cached for a month in js/api.js, so this is
// nearly free after the first run.
export async function enrich(rows, { limit = 24 } = {}) {
  await Promise.allSettled(
    rows.slice(0, limit).map(async (r) => {
      if (r.subjects?.length || !r.workKey) return;
      r.subjects = (await api.fetchWorkSubjects(r.workKey)) ?? [];
    })
  );
  return rows;
}
