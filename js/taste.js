// One reader's taste, as a durable object rather than a guess rebuilt from
// scratch every time Discover opens.
//
// What this replaces, and why
// ---------------------------
// The old profile lived inside buildRecommendations and had three faults that
// no amount of ranking cleverness could compensate for:
//
//   1. Nothing you disliked counted. A book rated one star weighed the same as
//      one you own and never opened — and it weighed *positively*, so every
//      book you hated pulled the profile toward its author and its subjects.
//   2. The subject half was mined from `books.slice(0, 10)` — the ten oldest
//      books in the library, in insertion order. Two years of reading after
//      that could not move it.
//   3. It mixed every profile in the household into one blurred reader.
//
// So: weights are **signed**, every contribution **decays** with the age of
// the reading, and the whole thing is **per profile**.
//
// Rebuilt, not accumulated
// ------------------------
// Taste is a pure function of (library, signals, today). It is recomputed and
// cached against a fingerprint of those inputs rather than updated in place.
// An accumulator drifts — a book rerated 5→2 would need its old contribution
// unwound, and one missed unwind is permanent — whereas a rebuild is always
// exactly what the shelves say. The cost is bounded because the only expensive
// input, work subjects, is cached for a month by js/api.js.
//
// Subjects converge rather than block. A build folds in whatever subjects are
// already cached and fetches a small number of missing ones in the background,
// so the first run on a big library is merely thinner, never slower.

import * as db from "./db.js";
import * as flt from "./filters.js";
import * as signals from "./signals.js";

const KEY = "shelfie.taste.v1";
const VERSION = 1;

// Six-month half-life: this year's reading should outweigh a phase you grew
// out of, without erasing it. The floor matters as much as the rate — a book
// you loved five years ago still says something true about you.
const HALF_LIFE_WEEKS = 26;
const DECAY_FLOOR = 0.2;

// How much each way of engaging with a book says about taste. A rating is an
// opinion and outranks everything; a shelf is a weaker, unsigned hint.
const RATING_WEIGHT = { 5: 2, 4: 1, 3: 0, 2: -1, 1: -2 };
const SHELF_WEIGHT = { completed: 0.75, wishlist: 0.5, tbr: 0.4, owned: 0.25 };
const ABANDONED_WEIGHT = -1;
const DISMISSED_WEIGHT = -0.25;

// Missing work subjects fetched per build. Small on purpose: a build runs on
// app open, and Open Library rate-limits bursts (see the queue in js/api.js).
// A 300-book library converges over a handful of sessions instead of hammering
// the API once.
const FETCH_PER_BUILD = 12;

const weeksSince = (iso) => {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return 0; // undated: treat as current, not ancient
  return Math.max(0, (Date.now() - t) / (7 * 24 * 3600 * 1000));
};

export function decayFor(iso) {
  const d = 0.5 ** (weeksSince(iso) / HALF_LIFE_WEEKS);
  return Math.max(DECAY_FLOOR, d);
}

// ---------- the signed weight of one book ----------

// `keyOf` maps a book to the identity the signal log uses. It is injected
// rather than imported so this module keeps no dependency on the sync layer —
// community.bookKey pulls in Firebase, and taste has to work with none.
export function weightOf(book, profile, ctx = {}) {
  const rating = book.ratings?.[profile] ?? book.rating ?? null;
  let base;
  if (rating != null && RATING_WEIGHT[rating] !== undefined) {
    base = RATING_WEIGHT[rating];
  } else {
    base = SHELF_WEIGHT[db.shelfFor(book, profile)] ?? 0.25;
  }
  const key = ctx.keyOf?.(book);
  if (key && ctx.abandoned?.has(key)) base += ABANDONED_WEIGHT;
  // A book read and rated is dated by when *this reader* finished it; anything
  // else by when it arrived, which is the only date we have.
  const when = db.finishedAtFor(book, profile) ?? book.addedAt ?? null;
  return base * decayFor(when);
}

// ---------- building ----------

function bump(map, k, w) {
  if (!k || !w) return;
  map[k] = (map[k] ?? 0) + w;
}

// Subjects worth learning from: the work's tags where we have them, plus the
// edition tags already sitting on the record. Deduped, since the two overlap.
function subjectsOf(book, cachedSubjects) {
  const fromWork = book.workKey ? cachedSubjects.get(book.workKey) ?? [] : [];
  return [...new Set([...fromWork, ...(book.subjects ?? [])])];
}

// Books this reader's taste can be read from. Owning is the household's fact
// (see DECISIONS.md) so an owned copy counts for everyone; the three personal
// shelves are per-person, and db.shelfFor gives this reader's own answer —
// falling back to the household's for a book nobody has claimed.
export function booksFor(books, profile) {
  return books.filter(
    (b) => b.owned || !b.profile || b.profile === profile || db.shelfFor(b, profile)
  );
}

// A cheap fingerprint of everything a build depends on. Changes when a book is
// added, moved, rated or dismissed — and, crucially, when a rating changes,
// which the old `books.length` cache key could not see.
export function fingerprint(books, profile) {
  let h = 0;
  const mix = (s) => {
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  };
  mix(String(profile ?? ""));
  for (const b of booksFor(books, profile)) {
    mix(b.id ?? "");
    mix(db.shelfFor(b, profile) ?? "");
    mix(String(b.ratings?.[profile] ?? b.rating ?? ""));
  }
  mix(String(signals.count("dismissed")));
  mix(String(signals.count("abandoned")));
  return String(h);
}

// Build a taste profile. `fetchSubjects` is injected so this module stays
// testable without a network and so js/api.js's month-long cache does the
// heavy lifting.
export async function build(books, profile, { fetchSubjects, keyOf, budget = FETCH_PER_BUILD } = {}) {
  const mine = booksFor(books, profile);
  const abandoned = signals.abandonedKeys(profile);
  const dismissed = signals.dismissedKeys(profile);
  const identify = keyOf ?? (() => null);

  // Whatever subjects are already known, for free.
  const cached = new Map();
  const missing = [];
  for (const b of mine) {
    if (!b.workKey || cached.has(b.workKey)) continue;
    const hit = await fetchSubjects?.(b.workKey, { cachedOnly: true });
    if (hit?.length) cached.set(b.workKey, hit);
    else missing.push(b);
  }

  // Then a small, bounded top-up — the books that say the most about taste
  // first, so an unfinished build is still a useful one.
  const byInterest = missing
    .map((b) => ({ b, w: Math.abs(weightOf(b, profile, { abandoned, keyOf: identify })) }))
    .sort((x, y) => y.w - x.w)
    .slice(0, budget);
  await Promise.allSettled(
    byInterest.map(async ({ b }) => {
      const s = await fetchSubjects?.(b.workKey);
      if (s?.length) cached.set(b.workKey, s);
    })
  );

  const authors = {};
  const subjects = {};
  const genres = {};
  const lengths = [];
  let rated = 0;

  for (const b of mine) {
    const w = weightOf(b, profile, { abandoned, keyOf: identify });
    if (!w) continue;
    (b.authors ?? []).forEach((a) => bump(authors, a, w));
    subjectsOf(b, cached).forEach((s) => bump(subjects, s, w));
    flt.genresOf(b).forEach((g) => bump(genres, g, w));
    if (w > 0 && Number.isFinite(b.pageCount) && b.pageCount > 0) {
      lengths.push({ pages: b.pageCount, w });
    }
    if ((b.ratings?.[profile] ?? b.rating) != null) rated++;
  }

  // A dismissal is a small vote against whatever that book was, but we only
  // hold the key, not the book — so it lands on the author when the book is
  // one we know about.
  if (dismissed.size) {
    for (const b of mine) {
      const key = identify(b);
      if (!key || !dismissed.has(key)) continue;
      (b.authors ?? []).forEach((a) => bump(authors, a, DISMISSED_WEIGHT));
    }
  }

  return {
    v: VERSION,
    profile: profile ?? null,
    authors,
    subjects,
    genres,
    length: lengthBand(lengths),
    books: mine.length,
    rated,
    subjectsKnown: cached.size,
    subjectsPending: Math.max(0, missing.length - byInterest.length),
    sig: fingerprint(books, profile),
    updatedAt: new Date().toISOString(),
  };
}

// The length of book this reader actually gets on with — weighted by how much
// they liked it, so a 900-page book they rated five counts for more than one
// they own and never opened. Used as a gentle fit term, never a filter.
function lengthBand(rows) {
  const total = rows.reduce((n, r) => n + r.w, 0);
  if (rows.length < 3 || total <= 0) return null;
  const mean = rows.reduce((n, r) => n + r.pages * r.w, 0) / total;
  const varr = rows.reduce((n, r) => n + r.w * (r.pages - mean) ** 2, 0) / total;
  // A floor on the spread stops a reader with three similar books from being
  // told they may only ever read 320-page novels again.
  return { mean, sd: Math.max(80, Math.sqrt(varr)), n: rows.length };
}

// ---------- storage ----------

function loadAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw?.v === VERSION && raw.profiles ? raw.profiles : {};
  } catch {
    return {};
  }
}

export function stored(profile) {
  return loadAll()[profile ?? "_"] ?? null;
}

export function store(taste) {
  const all = loadAll();
  all[taste.profile ?? "_"] = taste;
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: VERSION, profiles: all }));
  } catch {
    // No room. Taste is derived data — it rebuilds from the shelves next time,
    // so dropping it costs a slow build, never anything the reader typed.
  }
  return taste;
}

// The normal entry point: return the stored profile if the shelves haven't
// moved under it, otherwise rebuild. `force` skips the fingerprint check.
export async function current(books, profile, opts = {}) {
  const have = stored(profile);
  if (!opts.force && have && have.sig === fingerprint(books, profile)) {
    // A profile still waiting on subjects keeps building in the background
    // until it has them, so the picture sharpens over the first few sessions.
    if (!have.subjectsPending) return have;
  }
  return store(await build(books, profile, opts));
}

// ---------- reading a profile ----------

export function top(map, n = 8) {
  return Object.entries(map ?? {})
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

// Authors and subjects this reader has actively voted against — never queried
// for, and penalised if they turn up anyway.
export function disliked(map, n = 8) {
  return Object.entries(map ?? {})
    .filter(([, w]) => w < -0.5)
    .sort((a, b) => a[1] - b[1])
    .slice(0, n)
    .map(([k]) => k);
}

// Positive mass, for turning a raw overlap into a 0..1 match.
export function mass(map) {
  return Object.values(map ?? {}).reduce((n, w) => n + Math.max(0, w), 0) || 1;
}

// Is there enough here to say anything? Below this, the recommender leans on
// its offline sources and public ratings rather than pretending to know you.
export function isWarm(taste) {
  return !!taste && taste.books >= 3 && (taste.rated >= 1 || taste.subjectsKnown >= 2);
}

// ---------- focusing on part of the shelves ----------
//
// Picking a genre in Discover should read the fantasy half of your library,
// not your library as a whole — otherwise a mostly-mystery reader asking for
// fantasy gets queries built from detective subjects, which return nothing
// once the genre constraint is applied.
//
// The stored profile stays whole and filter-independent (that's what makes it
// cacheable). This blends a small profile built from just the matching books
// on top of it, at a weight that reproduces what the old engine did with its
// 3× focus boost: matching books count triple, the rest stay as context.
export function blend(base, focus, weight = 2) {
  const out = { ...base };
  for (const field of ["authors", "subjects", "genres"]) {
    const merged = { ...(base[field] ?? {}) };
    for (const [k, w] of Object.entries(focus?.[field] ?? {})) {
      merged[k] = (merged[k] ?? 0) + weight * w;
    }
    out[field] = merged;
  }
  // Length preference should follow the focus when there is one: the books you
  // read in this genre are the relevant evidence about how long they run.
  if (focus?.length) out.length = focus.length;
  return out;
}

// Build a profile from a subset of the shelves. Cheap in practice because the
// subjects it needs are already in js/api.js's month-long cache after the
// whole-library build.
export async function focusedOn(books, profile, matches, opts = {}) {
  const subset = booksFor(books, profile).filter(matches);
  if (subset.length < 2) return null; // too thin to say anything
  return build(subset, profile, { ...opts, budget: 4 });
}
