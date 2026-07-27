// Book metadata lookups against Open Library (primary, edition-accurate)
// and Google Books (fallback + series hints). All endpoints are free and
// need no API key.

const OL = "https://openlibrary.org";
const GBOOKS = "https://www.googleapis.com/books/v1";

// Search results are third-party data: fields go missing, arrive as the wrong
// type, or turn up null. These keep a malformed row from poisoning a whole
// result set — the app's own records are guaranteed clean by js/db.js.
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const number = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---------- ISBN helpers ----------

export function normalizeIsbn(raw) {
  const digits = (raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
  if (digits.length === 10 || digits.length === 13) return digits;
  return null;
}

export function isbn10to13(isbn10) {
  const core = "978" + isbn10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 ? 3 : 1) * Number(core[i]);
  return core + ((10 - (sum % 10)) % 10);
}

// ---------- Edition lookup ----------

// Returns a normalized book record (without shelf fields) or null.
export async function lookupByIsbn(isbn) {
  isbn = normalizeIsbn(isbn);
  if (!isbn) return null;

  const [ol, gb] = await Promise.allSettled([
    fetchOpenLibraryEdition(isbn),
    fetchGoogleBooksByIsbn(isbn),
  ]);
  const olBook = ol.status === "fulfilled" ? ol.value : null;
  const gbBook = gb.status === "fulfilled" ? gb.value : null;

  if (!olBook && !gbBook) return null;

  // Prefer Open Library for edition specifics, fill gaps from Google Books.
  const merged = { ...(gbBook ?? {}), ...(olBook ?? {}) };
  for (const key of ["publisher", "publishDate", "pageCount", "format", "coverUrl", "subtitle"]) {
    if (!merged[key] && gbBook?.[key]) merged[key] = gbBook[key];
  }
  if ((!merged.authors || merged.authors.length === 0) && gbBook?.authors?.length) {
    merged.authors = gbBook.authors;
  }
  if (!merged.series && gbBook?.series) merged.series = gbBook.series;
  if (!merged.subjects?.length && gbBook?.subjects?.length) merged.subjects = gbBook.subjects;

  merged.id = "isbn:" + (merged.isbn13 || merged.isbn10 || isbn);
  return merged;
}

async function fetchOpenLibraryEdition(isbn) {
  const res = await fetch(`${OL}/isbn/${isbn}.json`);
  if (!res.ok) return null;
  const ed = await res.json();

  const isbn13 = ed.isbn_13?.[0] ?? (isbn.length === 13 ? isbn : isbn10to13(isbn));
  const isbn10 = ed.isbn_10?.[0] ?? (isbn.length === 10 ? isbn : null);

  const authors = await resolveOlAuthors(ed.authors ?? []);
  const workKey = ed.works?.[0]?.key ?? null;

  // If the edition has no author list, borrow it from the work.
  let workAuthors = [];
  if (authors.length === 0 && workKey) {
    try {
      const work = await (await fetch(`${OL}${workKey}.json`)).json();
      workAuthors = await resolveOlAuthors(
        (work.authors ?? []).map((a) => ({ key: a.author?.key })).filter((a) => a.key)
      );
    } catch { /* best effort */ }
  }

  return {
    title: ed.title ?? "Unknown title",
    subtitle: ed.subtitle ?? null,
    authors: authors.length ? authors : workAuthors,
    isbn13,
    isbn10,
    publisher: ed.publishers?.[0] ?? null,
    publishDate: ed.publish_date ?? null,
    pageCount: ed.number_of_pages ?? null,
    format: ed.physical_format ?? null,
    editionKey: ed.key?.replace("/books/", "") ?? null,
    workKey,
    coverUrl: ed.covers?.[0]
      ? `https://covers.openlibrary.org/b/id/${ed.covers[0]}-M.jpg`
      : `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
    series: parseOlSeries(ed.series),
    // Edition-level subject tags feed genre filters and content auto-tagging.
    subjects: (ed.subjects ?? []).filter((x) => typeof x === "string"),
    language: ed.languages?.[0]?.key?.replace("/languages/", "") ?? null,
  };
}

async function resolveOlAuthors(authorRefs) {
  const names = await Promise.all(
    authorRefs.slice(0, 4).map(async (a) => {
      try {
        const res = await fetch(`${OL}${a.key}.json`);
        if (!res.ok) return null;
        return (await res.json()).name ?? null;
      } catch {
        return null;
      }
    })
  );
  return names.filter(Boolean);
}

// Open Library edition "series" entries look like "Harry Potter (1)" or
// "The Stormlight Archive ;, bk. 2".
function parseOlSeries(seriesArr) {
  if (!seriesArr?.length) return null;
  const raw = seriesArr[0];
  const posMatch = raw.match(/(?:\(|#|bk\.?\s*|book\s*)(\d+)\)?/i);
  const name = raw
    .replace(/(?:\(|#|,?\s*bk\.?\s*|,?\s*book\s*)\d+\)?/i, "")
    .replace(/[;,]+\s*$/, "")
    .trim();
  if (!name) return null;
  return { name, position: posMatch ? Number(posMatch[1]) : null };
}

async function fetchGoogleBooksByIsbn(isbn) {
  const res = await fetch(`${GBOOKS}/volumes?q=isbn:${isbn}&country=US`);
  if (!res.ok) return null;
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) return null;
  return googleVolumeToBook(item, isbn);
}

function googleVolumeToBook(item, fallbackIsbn) {
  const v = item.volumeInfo ?? {};
  const ids = v.industryIdentifiers ?? [];
  const isbn13 = ids.find((i) => i.type === "ISBN_13")?.identifier ?? null;
  const isbn10 = ids.find((i) => i.type === "ISBN_10")?.identifier ?? null;

  // Some Google Books responses carry explicit series info.
  let series = null;
  const si = item.seriesInfo ?? v.seriesInfo;
  if (si?.bookDisplayNumber || si?.volumeSeries?.length) {
    series = {
      name: si.volumeSeries?.[0]?.seriesId ?? null,
      position: si.bookDisplayNumber ? Number(si.bookDisplayNumber) : null,
    };
    if (!series.name) series = null;
  }

  return {
    title: v.title ?? "Unknown title",
    subtitle: v.subtitle ?? null,
    authors: v.authors ?? [],
    isbn13: isbn13 ?? (fallbackIsbn?.length === 13 ? fallbackIsbn : null),
    isbn10: isbn10 ?? (fallbackIsbn?.length === 10 ? fallbackIsbn : null),
    publisher: v.publisher ?? null,
    publishDate: v.publishedDate ?? null,
    pageCount: v.pageCount ?? null,
    format: v.printType === "BOOK" ? null : v.printType,
    editionKey: null,
    workKey: null,
    coverUrl: v.imageLinks?.thumbnail?.replace("http://", "https://") ?? null,
    series,
    subjects: v.categories ?? [],
    language: v.language ?? null, // 2-letter; normalized by filters.canonLang
    // Google's coarse content flag ("MATURE" / "NOT_MATURE") — the only
    // free audience-rating signal any book API provides.
    maturity: v.maturityRating ?? null,
  };
}

// ---------- Title search (manual fallback) ----------

// Maps OL's 3-letter language codes to the 2-letter form its `lang`
// relevance parameter expects.
const LANG2 = { eng: "en", spa: "es", fre: "fr", ger: "de", ita: "it", por: "pt", jpn: "ja" };

export async function searchByTitle(query, { limit = 40, language = "eng" } = {}) {
  // `language:` constrains to works with an edition in that language, and
  // `lang=` makes OL surface that edition (title, ISBNs, cover) as the
  // preferred one — so an English search stops returning Spanish editions.
  const restrict = language && language !== "any";
  const q = restrict ? `${query} language:${language}` : query;
  const fields =
    "key,title,author_name,first_publish_year,cover_i,isbn,language," +
    "editions,editions.key,editions.title,editions.isbn,editions.language,editions.cover_i";
  const url =
    `${OL}/search.json?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}` +
    `&limit=${limit}` + (restrict ? `&lang=${LANG2[language] ?? "en"}` : "");
  const res = await fetch(url);
  // A failed request is not "no such book" — throw so the caller can say
  // what actually happened instead of telling the user their book isn't
  // in the catalogue.
  if (!res.ok) throw new Error(`Open Library search failed (${res.status})`);
  const data = await res.json();
  return (data.docs ?? [])
    .filter((d) => d && typeof d.key === "string")
    .map((d) => {
      const ed = d.editions?.docs?.[0]; // OL's best edition for the requested language
      const cover = ed?.cover_i ?? d.cover_i;
      const title = [ed?.title, d.title].find((t) => typeof t === "string");
      return {
        workKey: d.key,
        title: title ?? "Untitled",
        authors: strings(d.author_name),
        year: number(d.first_publish_year),
        coverUrl: cover ? `https://covers.openlibrary.org/b/id/${cover}-S.jpg` : null,
        isbns: strings(ed?.isbn ?? d.isbn),
        language: strings(ed?.language ?? d.language)[0] ?? null,
      };
    });
}

// ---------- Recommendations ----------

const GENERIC_SUBJECTS =
  /^fiction$|^literature$|accessible|protected daisy|in library|overdrive|large type|reading level|bestseller|translations|collections|open library|staff picks|^nyt:|^award:|textbooks/i;

// Subjects tagged on a work, filtered down to ones that say something
// about taste (drops catalog noise like "Accessible book"). Cached in
// localStorage for a month: recommendations compare subjects across many
// candidate books, which would otherwise mean a request per book, per run.
const SUBJ_CACHE_KEY = "shelfie.subjectCache.v1";
const SUBJ_TTL_MS = 30 * 24 * 3600 * 1000;
let subjCache = null;

function loadSubjCache() {
  if (subjCache) return subjCache;
  try {
    const raw = JSON.parse(localStorage.getItem(SUBJ_CACHE_KEY)) ?? {};
    const now = Date.now();
    subjCache = {};
    for (const [k, v] of Object.entries(raw)) {
      if (now - (v.at ?? 0) < SUBJ_TTL_MS) subjCache[k] = v;
    }
  } catch {
    subjCache = {};
  }
  return subjCache;
}

let subjSaveTimer = null;
function saveSubjCache() {
  clearTimeout(subjSaveTimer);
  subjSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SUBJ_CACHE_KEY, JSON.stringify(subjCache));
    } catch { /* full — stays in memory */ }
  }, 500);
}

export async function fetchWorkSubjects(workKey) {
  if (!workKey) return [];
  const cache = loadSubjCache();
  if (cache[workKey]) return cache[workKey].s;
  try {
    const res = await fetch(`${OL}${workKey}.json`);
    if (!res.ok) return [];
    const work = await res.json();
    const subjects = (work.subjects ?? [])
      .filter((s) => typeof s === "string" && s.length < 40 && !GENERIC_SUBJECTS.test(s))
      .slice(0, 12);
    cache[workKey] = { s: subjects, at: Date.now() };
    saveSubjCache();
    return subjects;
  } catch {
    return [];
  }
}

// Candidate books for recommendations. Open Library's rating data is sparse,
// so this deliberately does NOT require a rating — callers score results
// instead, which keeps the candidate pool from collapsing to the handful of
// heavily-rated titles (manga volumes, mostly).
export async function searchRanked(query, { limit = 20, sort = "rating" } = {}) {
  const fields =
    "key,title,author_name,first_publish_year,cover_i,ratings_average,ratings_count," +
    "number_of_pages_median,edition_count";
  const url =
    `${OL}/search.json?q=${encodeURIComponent(query)}` +
    (sort ? `&sort=${sort}` : "") +
    `&fields=${fields}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  noteSearchReachable();
  // One unusable row must not cost the whole list: a null in `docs` used to
  // throw here and leave Discover looking empty rather than imperfect.
  return ((await res.json()).docs ?? [])
    .filter((d) => d && typeof d.title === "string" && typeof d.key === "string")
    .map((d) => ({
      workKey: d.key,
      title: d.title,
      authors: strings(d.author_name),
      year: number(d.first_publish_year),
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      avgRating: number(d.ratings_average),
      ratingsCount: number(d.ratings_count) ?? 0,
      pages: number(d.number_of_pages_median),
      editions: number(d.edition_count) ?? 0,
    }));
}

// Solr range clause so a publication-age filter narrows the query itself.
// Filtering only client-side threw away nearly every result, since ranked
// candidates skew old and few of them land in a 2-year window.
export function yearClause(age) {
  const y = new Date().getFullYear();
  if (age === "new") return ` AND first_publish_year:[${y - 2} TO ${y + 1}]`;
  if (age === "recent") return ` AND first_publish_year:[${y - 10} TO ${y + 1}]`;
  if (age === "classic") return ` AND first_publish_year:[* TO ${y - 20}]`;
  return "";
}

// Run a query, and if the extra clauses wipe out the results (or the Solr
// syntax isn't accepted), fall back to the bare query so Discover still has
// something to show — the caller re-checks constraints client-side anyway.
export async function searchRankedWithFallback(baseQuery, clauses, opts) {
  const full = baseQuery + clauses;
  let rows = await searchRanked(full, opts);
  if (rows.length === 0 && clauses) rows = await searchRanked(baseQuery, opts);
  return rows;
}

// Whether the last batch of ranked searches could reach Open Library at all.
// An outage and a genuinely empty result set look identical to the caller
// otherwise, and telling someone "nothing matches your filters" during an
// outage sends them fiddling with filters that were never the problem.
let reachedOpenLibrary = true;
export function lastSearchReachedServer() {
  return reachedOpenLibrary;
}
export function resetSearchReachability() {
  reachedOpenLibrary = false;
}
export function noteSearchReachable() {
  reachedOpenLibrary = true;
}

// ---------- Series detection & listing ----------

// Figure out what series (if any) a book belongs to. Tries, in order:
//  1. series info already on the record (from the edition lookup)
//  2. other Open Library editions of the same work that carry a series tag
//  3. Google Books title heuristics
export async function detectSeries(book) {
  if (book.series?.name) return book.series;

  if (book.workKey) {
    try {
      const res = await fetch(`${OL}${book.workKey}/editions.json?limit=50`);
      if (res.ok) {
        const data = await res.json();
        for (const ed of data.entries ?? []) {
          const s = parseOlSeries(ed.series);
          if (s) return s;
        }
      }
    } catch { /* best effort */ }
  }

  // Google Books: many volumes encode series in the title, e.g.
  // "Catching Fire (The Hunger Games, Book 2)".
  try {
    const q = book.isbn13 ? `isbn:${book.isbn13}` : `intitle:"${book.title}"`;
    const res = await fetch(`${GBOOKS}/volumes?q=${encodeURIComponent(q)}&country=US`);
    if (res.ok) {
      const data = await res.json();
      for (const item of (data.items ?? []).slice(0, 5)) {
        const t = item.volumeInfo?.title ?? "";
        const sub = item.volumeInfo?.subtitle ?? "";
        const m = (t + " " + sub).match(/\(([^)]+?)(?:,?\s*(?:Book|Bk\.?|#|Volume|Vol\.?)\s*(\d+))\)/i);
        if (m) return { name: m[1].trim(), position: Number(m[2]) };
      }
    }
  } catch { /* best effort */ }

  return null;
}

// List the books in a named series, best-effort, ordered by first
// publication year. Returns [{ title, authors, year, coverUrl, workKey }].
export async function listSeriesBooks(seriesName, authorHint) {
  const url =
    `${OL}/search.json?q=${encodeURIComponent(`series:"${seriesName}"`)}` +
    `&fields=key,title,author_name,first_publish_year,cover_i&limit=40`;
  const res = await fetch(url);
  if (!res.ok) return [];
  let docs = (await res.json()).docs ?? [];

  // The series index mixes in box sets and unrelated matches; if we know
  // the author, keep entries that share them.
  if (authorHint?.length) {
    const wanted = authorHint.map((a) => a.toLowerCase());
    const filtered = docs.filter((d) =>
      (d.author_name ?? []).some((a) => wanted.includes(a.toLowerCase()))
    );
    if (filtered.length) docs = filtered;
  }

  // Dedupe near-identical titles (different editions of the same work).
  const seen = new Map();
  for (const d of docs) {
    const norm = d.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!seen.has(norm)) {
      seen.set(norm, {
        workKey: d.key,
        title: d.title,
        authors: d.author_name ?? [],
        year: d.first_publish_year ?? null,
        coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : null,
      });
    }
  }

  return [...seen.values()].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
}
