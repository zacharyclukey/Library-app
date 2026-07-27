// Shelf/recommendation filtering: genre mapping from Open Library subject
// tags, plus length / age / series / format predicates and sort orders.

const CURRENT_YEAR = new Date().getFullYear();

// Curated genres with the subject-tag patterns that imply them. A book can
// match several. Order matters only for display.
export const GENRES = [
  ["Fantasy", /fantas|magic|wizard|dragon|fairy tales|mytholog/i],
  ["Science Fiction", /science fiction|sci-?fi|space opera|time travel|extraterrestrial/i],
  ["Mystery & Thriller", /mystery|thriller|detective|crime|suspense|spy/i],
  ["Romance", /romance|love stor/i],
  ["Horror", /horror|ghost stories|vampires|occult/i],
  ["Historical Fiction", /historical fiction/i],
  ["Young Adult", /young adult|teen fiction|juvenile fiction/i],
  ["Children's", /children's|picture books|juvenile literature/i],
  ["Biography & Memoir", /biograph|memoir|autobiograph/i],
  ["History", /^history\b|world war|civilization|historical events/i],
  ["Science & Nature", /popular science|physics|biology|astronomy|natural history|nature|mathematics/i],
  ["Self-Help", /self-help|personal development|success|motivat/i],
  ["Business", /business|economics|management|finance/i],
  ["Classics", /classic literature|classics|literary classics/i],
  ["Poetry", /poetry|poems/i],
  ["Comics & Graphic Novels", /comic|graphic novel|manga/i],
];

// Subject term used when querying Open Library for a genre.
const GENRE_QUERY = {
  "Fantasy": "fantasy",
  "Science Fiction": "science fiction",
  "Mystery & Thriller": "mystery",
  "Romance": "romance",
  "Horror": "horror",
  "Historical Fiction": "historical fiction",
  "Young Adult": "young adult fiction",
  "Children's": "juvenile fiction",
  "Biography & Memoir": "biography",
  "History": "history",
  "Science & Nature": "science",
  "Self-Help": "self-help",
  "Business": "business",
  "Classics": "classic literature",
  "Poetry": "poetry",
  "Comics & Graphic Novels": "graphic novels",
};

export function genreQueryTerm(genre) {
  return GENRE_QUERY[genre] ?? genre.toLowerCase();
}

export function genresOf(book) {
  const haystack = [...(book.subjects ?? []), book.title ?? ""].join(" | ");
  return GENRES.filter(([, re]) => re.test(haystack)).map(([name]) => name);
}

export function yearOf(book) {
  const m = String(book.publishDate ?? "").match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

// ---------- filter predicates ----------
// A filter object: { genre, pages, series, age, format, rated }. Null chip
// fields and a full page range are inactive. Books missing the data a filter
// needs don't match.

// Page-count range for the length slider. The top of the scale means "and
// up", so a book of 1,400 pages still matches a range ending at the cap.
export const PAGE_RANGE = { min: 0, max: 1200, step: 25 };

export function fullPageRange() {
  return { min: PAGE_RANGE.min, max: PAGE_RANGE.max };
}

export function isFullPageRange(r) {
  return !r || (r.min <= PAGE_RANGE.min && r.max >= PAGE_RANGE.max);
}

export function pageRangeLabel(r) {
  if (isFullPageRange(r)) return "Any length";
  const top = r.max >= PAGE_RANGE.max ? "any" : `${r.max}`;
  if (r.min <= PAGE_RANGE.min) return `Under ${r.max} pages`;
  if (top === "any") return `${r.min}+ pages`;
  return `${r.min}–${r.max} pages`;
}

export function pagesMatch(pages, r) {
  if (isFullPageRange(r)) return true;
  if (pages == null) return false; // unknown length can't be judged
  if (pages < r.min) return false;
  if (r.max < PAGE_RANGE.max && pages > r.max) return false;
  return true;
}

export const SERIES_OPTIONS = [
  ["series", "In a series"],
  ["standalone", "Standalone"],
];
export const AGE_OPTIONS = [
  ["new", "New (≤2 yrs)"],
  ["recent", "Last 10 yrs"],
  ["classic", "20+ yrs old"],
];
export const FORMAT_OPTIONS = [
  ["hardcover", "Hardcover"],
  ["paperback", "Paperback"],
  ["ebook", "E-book"],
  ["audio", "Audiobook"],
];
export const STATUS_OPTIONS = [
  ["reading", "📖 Currently reading"],
];
// Content/audience tags. "SFW" as a filter means "not marked mature or
// explicit" — untagged books pass, since most of a library is never tagged.
export const CONTENT_OPTIONS = [
  ["kids", "🧸 Kids"],
  ["teen", "🌱 Teen"],
  ["sfw", "✅ SFW"],
  ["mature", "🔞 Mature"],
  ["explicit", "🌶️ Explicit"],
];
export const CONTENT_LABEL = {
  kids: "🧸 Kids", teen: "🌱 Teen", general: "✅ SFW",
  mature: "🔞 Mature", explicit: "🌶️ Explicit",
};
export const SPICE_OPTIONS = [
  ["any", "🌶️ Spicy (any)"],
  ["3plus", "🌶️🌶️🌶️ 3+"],
  ["none", "No spice"],
];

// Best-effort auto-tag from subject tags and Google Books' maturity flag.
// Coarse by design — no free source rates spice level, so these are
// suggestions the user can override, not verdicts.
export function suggestContent(book) {
  const hay = [...(book.subjects ?? []), book.title ?? ""].join(" | ");
  if (/erotic|erotica/i.test(hay)) return { content: "explicit", spice: 4 };
  if (book.maturity === "MATURE") return { content: "mature" };
  if (/juvenile literature|juvenile fiction|children's|picture book/i.test(hay)) {
    return { content: "kids" };
  }
  if (/young adult|teen fiction/i.test(hay)) return { content: "teen" };
  return {};
}
// Language codes arrive in two shapes (OL 3-letter, Google 2-letter);
// canonicalize to OL's for comparison and display.
const LANG_ALIAS = {
  en: "eng", es: "spa", fr: "fre", de: "ger", it: "ita",
  pt: "por", ja: "jpn", zh: "chi", ru: "rus", ko: "kor",
};
const LANG_NAMES = {
  eng: "English", spa: "Spanish", fre: "French", ger: "German", ita: "Italian",
  por: "Portuguese", jpn: "Japanese", chi: "Chinese", rus: "Russian", kor: "Korean",
};
export const SEARCH_LANGS = [
  ["eng", "English"], ["spa", "Spanish"], ["fre", "French"], ["ger", "German"],
  ["ita", "Italian"], ["por", "Portuguese"], ["jpn", "Japanese"], ["any", "Any language"],
];
export function canonLang(code) {
  if (!code) return null;
  const c = String(code).toLowerCase();
  return LANG_ALIAS[c] ?? c;
}
export function langLabel(code) {
  const c = canonLang(code);
  return LANG_NAMES[c] ?? (c ?? "").toUpperCase();
}

export const RATED_OPTIONS = [
  ["4plus", "Rated 4★+"],
  ["unrated", "Unrated"],
];

export function ageMatches(year, want) {
  if (year == null) return false;
  if (want === "new") return year >= CURRENT_YEAR - 2;
  if (want === "recent") return year >= CURRENT_YEAR - 10;
  if (want === "classic") return year <= CURRENT_YEAR - 20;
  return true;
}

// opts.myRating: the current profile's rating for the book (for `rated`).
export function matchesFilter(book, f, opts = {}) {
  if (f.genre && !genresOf(book).includes(f.genre)) return false;
  if (!pagesMatch(book.pageCount, f.pages)) return false;
  if (f.series === "series" && !book.series?.name) return false;
  if (f.series === "standalone" && book.series?.name) return false;
  if (f.age && !ageMatches(yearOf(book), f.age)) return false;
  if (f.format === "hardcover" && !/hard/i.test(book.format ?? "")) return false;
  if (f.format === "paperback" && !/paper|soft|mass market/i.test(book.format ?? "")) return false;
  if (f.format === "ebook" && book.medium !== "ebook") return false;
  if (f.format === "audio" && book.medium !== "audio") return false;
  if (f.status === "reading" && !book.reading) return false;
  if (f.language && canonLang(book.language) !== f.language) return false;
  if (f.content === "sfw" && ["mature", "explicit"].includes(book.content)) return false;
  if (f.content && f.content !== "sfw" && book.content !== f.content) return false;
  if (f.spice === "any" && !((book.spice ?? 0) > 0)) return false;
  if (f.spice === "3plus" && !((book.spice ?? 0) >= 3)) return false;
  if (f.spice === "none" && (book.spice ?? 0) > 0) return false;
  if (f.rated === "4plus" && !((opts.myRating ?? 0) >= 4)) return false;
  if (f.rated === "unrated" && opts.myRating) return false;
  return true;
}

export function activeFilterCount(f) {
  const chips = ["genre", "series", "age", "format", "rated", "status", "content", "spice", "language"]
    .filter((k) => f[k]).length;
  return chips + (isFullPageRange(f.pages) ? 0 : 1);
}

// ---------- sort orders ----------

export const SORT_OPTIONS = [
  ["added", "Recently added"],
  ["series", "📚 Series, grouped"],
  ["title", "Title A–Z"],
  ["author", "Author A–Z"],
  ["newest", "Newest published"],
  ["oldest", "Oldest published"],
  ["longest", "Longest"],
  ["shortest", "Shortest"],
  ["rating", "My rating"],
];

export function sortBooks(books, sort, opts = {}) {
  const rating = (b) => opts.ratingOf?.(b) ?? 0;
  const year = (b) => yearOf(b);
  const cmp = {
    added: (a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""),
    title: (a, b) => a.title.localeCompare(b.title),
    author: (a, b) => (a.authors?.[0] ?? "~").localeCompare(b.authors?.[0] ?? "~"),
    newest: (a, b) => (year(b) ?? -1) - (year(a) ?? -1),
    oldest: (a, b) => (year(a) ?? 9999) - (year(b) ?? 9999),
    longest: (a, b) => (b.pageCount ?? -1) - (a.pageCount ?? -1),
    shortest: (a, b) => (a.pageCount ?? 1e9) - (b.pageCount ?? 1e9),
    rating: (a, b) => rating(b) - rating(a),
    // Series order is finished off by the grouping pass, which puts each
    // series under its own heading; this just gets the books adjacent.
    series: (a, b) =>
      (a.series?.name ?? "~~").localeCompare(b.series?.name ?? "~~") ||
      (a.series?.position ?? 99) - (b.series?.position ?? 99) ||
      a.title.localeCompare(b.title),
  }[sort];
  return cmp ? [...books].sort(cmp) : books;
}
