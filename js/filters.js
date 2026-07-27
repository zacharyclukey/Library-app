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
// A filter object: { genre, length, series, age, format, rated } — null
// fields are inactive. Books missing the data a filter needs don't match.

export const LENGTH_OPTIONS = [
  ["short", "Short (<300 pp)"],
  ["medium", "Medium (300–500 pp)"],
  ["long", "Long (500+ pp)"],
];
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
export const RATED_OPTIONS = [
  ["4plus", "Rated 4★+"],
  ["unrated", "Unrated"],
];

export function lengthMatches(pages, want) {
  if (pages == null) return false;
  if (want === "short") return pages < 300;
  if (want === "medium") return pages >= 300 && pages <= 500;
  if (want === "long") return pages > 500;
  return true;
}

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
  if (f.length && !lengthMatches(book.pageCount, f.length)) return false;
  if (f.series === "series" && !book.series?.name) return false;
  if (f.series === "standalone" && book.series?.name) return false;
  if (f.age && !ageMatches(yearOf(book), f.age)) return false;
  if (f.format === "hardcover" && !/hard/i.test(book.format ?? "")) return false;
  if (f.format === "paperback" && !/paper|soft|mass market/i.test(book.format ?? "")) return false;
  if (f.format === "ebook" && book.medium !== "ebook") return false;
  if (f.format === "audio" && book.medium !== "audio") return false;
  if (f.rated === "4plus" && !((opts.myRating ?? 0) >= 4)) return false;
  if (f.rated === "unrated" && opts.myRating) return false;
  return true;
}

export function activeFilterCount(f) {
  return ["genre", "length", "series", "age", "format", "rated"].filter((k) => f[k]).length;
}

// ---------- sort orders ----------

export const SORT_OPTIONS = [
  ["added", "Recently added"],
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
  }[sort];
  return cmp ? [...books].sort(cmp) : books;
}
