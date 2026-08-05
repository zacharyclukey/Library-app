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

// The last character of an ISBN is a check digit derived from the others, so
// a mistyped one can be caught here rather than becoming a lookup that comes
// back empty — and "no book found for 9780593135203" reads like the book
// doesn't exist, when really a digit got fumbled.
export function isbnChecksumOk(raw) {
  const s = normalizeIsbn(raw);
  if (!s) return false;
  if (s.length === 13) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === Number(s[12]);
  }
  // ISBN-10 is mod 11, and its check digit may be X for ten.
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(s[i]) * (10 - i);
  sum += s[9] === "X" ? 10 : Number(s[9]);
  return sum % 11 === 0;
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

// `cachedOnly` answers from the month-long cache or not at all. The taste
// builder (js/taste.js) runs on app open over every book on the shelves, so it
// asks this way first and tops up only a handful of misses per session —
// otherwise a 300-book library would fire 300 requests at a rate-limited API
// the moment someone opened the app.
export async function fetchWorkSubjects(workKey, { cachedOnly = false } = {}) {
  if (!workKey) return [];
  const cache = loadSubjCache();
  if (cache[workKey]) return cache[workKey].s;
  if (cachedOnly) return null;
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
// Open Library rate-limits bursts on /search.json. Discover builds a picture
// of your taste from a dozen separate queries — every author you rate highly,
// every genre on your shelves — and firing them all at once comes back
// refused across the board, which the app can only report as "Open Library
// isn't answering". Scanning keeps working throughout, because an ISBN lookup
// is a different, cheaper endpoint; that mismatch is the tell.
//
// So ranked searches go through a single queue with a gap between them, and a
// refusal is given one second chance. Discover takes a few seconds longer and
// actually returns something.
let queue = Promise.resolve();
const QUERY_GAP = 220;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function queued(run) {
  const result = queue.then(run, run);
  // The queue advances whether or not the query worked — one failure must not
  // strand everything behind it.
  queue = result.then(() => pause(QUERY_GAP), () => pause(QUERY_GAP));
  return result;
}

// 429 is the explicit refusal; 503 is what a struggling Open Library returns
// under load. Both are worth one more try. A 404 or a 400 is an answer.
const worthRetrying = (status) => status === 429 || status === 503 || status === 502;

async function fetchRanked(url) {
  const res = await queued(() => fetch(url));
  if (!worthRetrying(res.status)) return res;
  await pause(1200);
  return queued(() => fetch(url));
}

export async function searchRanked(query, { limit = 20, sort = "rating" } = {}) {
  const fields =
    "key,title,author_name,first_publish_year,cover_i,ratings_average,ratings_count," +
    "number_of_pages_median,edition_count";
  const url =
    `${OL}/search.json?q=${encodeURIComponent(query)}` +
    (sort ? `&sort=${sort}` : "") +
    `&fields=${fields}&limit=${limit}`;
  const res = await fetchRanked(url);
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

  // Google Books: many volumes encode the series in the title or subtitle.
  // Indie and self-published books — where Open Library usually has nothing —
  // are often the ones that do, since they carry their storefront titles.
  try {
    const q = book.isbn13 ? `isbn:${book.isbn13}` : `intitle:"${book.title}"`;
    const res = await fetch(`${GBOOKS}/volumes?q=${encodeURIComponent(q)}&country=US`);
    if (res.ok) {
      const data = await res.json();
      for (const item of (data.items ?? []).slice(0, 10)) {
        const info = item.volumeInfo ?? {};
        const s = parseSeriesFromText(`${info.title ?? ""} ${info.subtitle ?? ""}`);
        if (s) return s;
      }
    }
  } catch { /* best effort */ }

  return null;
}

// Pull a series out of a title/subtitle. Deliberately demands a book number
// somewhere: parentheses in book titles are far more often "(A Novel)" or
// "(A Dark Romance)" than a series, and a wrong series is worse than none —
// it would file the book under a heading that doesn't exist.
const NUM_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const COUNTER = String.raw`(?:Book|Bk\.?|Volume|Vol\.?|Part|#)`;
const NUMBER = String.raw`(\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)`;

export function parseSeriesFromText(text) {
  const patterns = [
    // "(The Hunger Games, Book 2)" · "(L.O.R.D.S. Book 1)" · "(Crave #3)"
    new RegExp(String.raw`\(([^)]+?)[,:]?\s*${COUNTER}\s*${NUMBER}\s*\)`, "i"),
    // "(Book 2 of The Hunger Games)" · "(Book 1 in the L.O.R.D.S. Series)"
    new RegExp(String.raw`\(\s*${COUNTER}\s*${NUMBER}\s*(?:of|in)\s+(?:the\s+)?([^)]+?)\s*\)`, "i"),
    // Same again outside brackets: "…: The Hunger Games, Book 2"
    new RegExp(String.raw`(?:^|[:–—-])\s*([^:–—()]+?)[,:]?\s*${COUNTER}\s*${NUMBER}\s*$`, "i"),
  ];
  for (const [i, re] of patterns.entries()) {
    const m = text.match(re);
    if (!m) continue;
    // The middle pattern captures the number first, the others the name.
    const [rawName, rawNum] = i === 1 ? [m[2], m[1]] : [m[1], m[2]];
    const name = cleanSeriesName(rawName);
    if (!name) continue;
    const n = /^\d+$/.test(rawNum) ? Number(rawNum) : NUM_WORDS[rawNum.toLowerCase()];
    return { name, position: Number.isFinite(n) ? n : null };
  }
  return null;
}

function cleanSeriesName(raw) {
  // The leading article is kept — "The Stormlight Archive" is the series'
  // real name. Matching across spellings is the grouper's job (seriesKey).
  const name = String(raw ?? "")
    .replace(/\s*(?:series|saga|trilogy|duet|cycle)\s*$/i, "")
    .replace(/[\s,:;–—-]+$/, "")
    .trim();
  // Guard against catching a genre blurb ("A Dark College Romance") rather
  // than a series name.
  if (name.length < 2 || name.length > 60) return null;
  if (/^(novel|a novel|unabridged|complete|boxed set|box set|omnibus)$/i.test(name)) return null;
  return name;
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
