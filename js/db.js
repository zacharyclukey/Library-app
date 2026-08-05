// Simple localStorage-backed store for the user's library.
//
// A book record looks like:
// {
//   id: "isbn:9780545010221" | "ol:OL123M" | "manual:<uuid>",
//   title, subtitle, authors: [..],
//   isbn13, isbn10,
//   publisher, publishDate, pageCount, format,   // edition-specific fields
//   editionKey,      // Open Library edition key, e.g. "OL22856696M"
//   workKey,         // Open Library work key, e.g. "/works/OL82563W"
//   coverUrl,
//   shelf: "owned" | "tbr" | "completed" | "wishlist",   // see below
//   shelves: { profileName: { shelf, reading, finishedAt } },
//   owned: true|false,        // tbr/completed books can also be owned copies
//   medium: "print" | "ebook" | "audio",  // missing = print (pre-feature)
//   content: "kids"|"teen"|"mature"|"explicit" | null,  // audience tag (opt-in UI)
//   spice: 1-5 | null,        // spice scale (opt-in UI)
//   profile: name | null,     // whose COPY this is (null = the household's)
//   ratings: { profileName: 1-5 },
//   reviews: { profileName: { text, updatedAt } },
//   rating: 1-5 | null,       // legacy pre-profile rating
//   series: { name, position } | null,
//   addedAt: ISO string
// }

// ---------- one book, two people, two answers ----------
//
// Owning a book is a fact about the household: there is one copy on one
// physical shelf, and `owned`/`profile` describe it. Wanting to read one is a
// fact about a person, and two people in a shared library can hold different
// ones about the same book at the same time — she's finished it, he hasn't
// started. A single `shelf` field can only remember one of those, so putting
// a book on your To Read used to take it off hers.
//
// So the three personal shelves live per-person in `shelves`, keyed by profile
// name, exactly as `ratings` and `reviews` already were. `shelf` stays as the
// household's answer (and as what every pre-existing record has): it is the
// fallback for anyone without their own entry, which is what keeps a library
// written before this change looking untouched. A book unassigned to anybody
// reads as everyone's, matching how the old member filter treated it.

import * as sync from "./sync.js";

const STORAGE_KEY = "shelfie.library.v1";

export const PERSONAL_SHELVES = ["tbr", "completed", "wishlist"];

// Which shelf `who` has this book on — their own answer if they've given one,
// otherwise the record's original single shelf.
export function shelfFor(book, who) {
  const mine = who && book?.shelves?.[who];
  if (mine) return mine.shelf ?? null;
  if (!PERSONAL_SHELVES.includes(book?.shelf)) return null;
  // Legacy record: it belongs to whoever it was assigned to, or to everyone
  // when it was never assigned.
  return !book.profile || book.profile === who ? book.shelf : null;
}

export function readingFor(book, who) {
  const mine = who && book?.shelves?.[who];
  if (mine) return mine.reading === true;
  return book?.reading === true && (!book.profile || book.profile === who);
}

export function finishedAtFor(book, who) {
  const mine = who && book?.shelves?.[who];
  if (mine) return mine.finishedAt ?? null;
  return book?.finishedAt ?? null;
}

// Everyone who has an opinion about this book — used to decide whether a
// household still wants it at all.
export function peopleOn(book) {
  return Object.keys(book?.shelves ?? {});
}

// Put a book on one person's shelf without touching anybody else's. Owned is
// deliberately not routed through here: it's the household's fact, so it stays
// on the record itself.
export function setShelfFor(id, who, patch) {
  const books = load();
  const i = books.findIndex((b) => b.id === id);
  if (i < 0) return;
  const b = books[i];
  const shelves = { ...(b.shelves ?? {}) };
  // First time this person touches a legacy record, seed their entry from the
  // household answer so a move doesn't silently clear the rest of their state.
  const base = shelves[who] ?? {
    shelf: shelfFor(b, who),
    reading: readingFor(b, who),
    finishedAt: finishedAtFor(b, who),
  };
  shelves[who] = { ...base, ...patch };
  books[i] = { ...b, shelves };
  save(books);
  sync.upsertRemote(books[i]);
}

// ---------- shape guarantees ----------
//
// Records reach this store from four directions: our own writers, a JSON
// import, another household member's phone, and whatever the Open Library or
// Google Books shape happened to be the day a book was added. One record with
// `authors` as a bare string used to throw mid-render and leave the whole
// shelf blank, which reads to the user as "my books are gone". So nothing
// leaves this module until it matches the documented schema — every consumer
// can then treat the fields as trustworthy.

const SHELVES = ["owned", "tbr", "completed", "wishlist"];
const MEDIA = ["print", "ebook", "audio"];
const CONTENT = ["kids", "teen", "general", "mature", "explicit"];

// Only strings and numbers become text; an object would stringify to the
// useless "[object Object]" and then show up as a book title or a series
// heading, so it's treated as absent instead.
const str = (v) =>
  typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => (num(v) == null ? null : Math.min(hi, Math.max(lo, Math.round(v))));
const oneOf = (v, allowed) => (allowed.includes(v) ? v : null);

function strList(v) {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  const s = str(v);
  return s ? [s] : [];
}

function ratingMap(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  for (const [who, r] of Object.entries(v)) {
    const n = clamp(r, 1, 5);
    if (n != null) out[who] = n;
  }
  return out;
}

function reviewMap(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  for (const [who, r] of Object.entries(v)) {
    const text = str(r && typeof r === "object" ? r.text : r);
    if (text) out[who] = { text, updatedAt: str(r?.updatedAt) ?? null };
  }
  return out;
}

function seriesOf(v) {
  if (!v) return null;
  const name = str(typeof v === "object" ? v.name : v);
  if (!name) return null;
  return { name, position: num(typeof v === "object" ? v.position : null) };
}

// The common case is a record we wrote ourselves, so check first and skip the
// rebuild — this runs on every read of the library.
function looksClean(b) {
  return (
    typeof b.id === "string" &&
    typeof b.title === "string" &&
    Array.isArray(b.authors) &&
    SHELVES.includes(b.shelf) &&
    (b.shelves == null || typeof b.shelves === "object") &&
    (b.pageCount == null || typeof b.pageCount === "number") &&
    (b.series == null || typeof b.series === "object")
  );
}

function normalize(book, i) {
  if (!book || typeof book !== "object" || Array.isArray(book)) return null;
  if (looksClean(book)) return book;
  // An unrecognised shelf falls back to Owned, so `owned` has to be derived
  // from the shelf we settled on, not the one that came in.
  const shelf = oneOf(book.shelf, SHELVES) ?? "owned";
  return {
    ...book,
    id: str(book.id) || `repaired:${i}`,
    title: str(book.title) || "Untitled",
    subtitle: str(book.subtitle),
    authors: strList(book.authors),
    subjects: strList(book.subjects),
    shelf,
    owned: book.owned === true || shelf === "owned",
    reading: book.reading === true,
    medium: oneOf(book.medium, MEDIA),
    content: oneOf(book.content, CONTENT),
    spice: clamp(book.spice, 1, 5),
    pageCount: num(book.pageCount),
    series: seriesOf(book.series),
    ratings: ratingMap(book.ratings),
    reviews: reviewMap(book.reviews),
    shelves: shelfMap(book.shelves),
    rating: clamp(book.rating, 1, 5),
    profile: str(book.profile),
  };
}

// Per-person shelf entries, from a phone that may be running an older build or
// a hand-edited import. An entry naming a shelf nobody has is dropped rather
// than defaulted: guessing "owned" here would put someone else's book on the
// household shelf behind their back.
function shelfMap(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  for (const [who, entry] of Object.entries(v)) {
    if (!who || !entry || typeof entry !== "object") continue;
    // A null shelf is meaningful and must survive: it says "I have explicitly
    // taken this off my shelves", which is different from "I never said". Drop
    // the entry instead and the record's original shelf would come back.
    out[who] = {
      shelf: oneOf(entry.shelf, PERSONAL_SHELVES),
      reading: entry.reading === true,
      finishedAt: str(entry.finishedAt) || null,
    };
  }
  return out;
}

function repair(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach((b, i) => {
    const book = normalize(b, i);
    // Two records under one id would fight over every edit; keep the first.
    if (!book || seen.has(book.id)) return;
    seen.add(book.id);
    out.push(book);
  });
  return out;
}

function load() {
  try {
    return repair(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return [];
  }
}

// A full disk must never look like a successful save. iOS in particular caps
// per-origin storage and evicts under pressure, so the app is told when a
// write is refused and can say so instead of silently dropping the change.
function save(books) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(repair(books)));
    return true;
  } catch (err) {
    window.dispatchEvent(new CustomEvent("shelfie:storage-full", { detail: err?.name }));
    return false;
  }
}

export function getAllBooks() {
  return load();
}

// A personal shelf is read through one person's eyes; `who` of null means
// "anybody's", which is what the Everyone filter wants.
export function getBooksOnShelf(shelf, who) {
  if (!PERSONAL_SHELVES.includes(shelf)) return load().filter((b) => b.shelf === shelf);
  if (who) return load().filter((b) => shelfFor(b, who) === shelf);
  // Everyone's. Ask on behalf of each person with an entry — and of whoever
  // the record was assigned to, who may have no entry at all: her answer is
  // still the original single shelf, and she'd vanish from "Everyone" if only
  // the explicit entries counted.
  return load().filter((b) => {
    if (shelfFor(b, null) === shelf) return true;
    const people = new Set(peopleOn(b));
    if (b.profile) people.add(b.profile);
    return [...people].some((p) => shelfFor(b, p) === shelf);
  });
}

export function getBook(id) {
  return load().find((b) => b.id === id) ?? null;
}

export function hasBook(id) {
  return load().some((b) => b.id === id);
}

export function addBook(book) {
  const books = load();
  const existing = books.findIndex((b) => b.id === book.id);
  if (existing >= 0) {
    books[existing] = { ...books[existing], ...book };
  } else {
    books.push({ ...book, addedAt: new Date().toISOString() });
  }
  save(books);
  sync.upsertRemote(books[existing >= 0 ? existing : books.length - 1]);
}

// Wholesale overwrite, unlike addBook's merge — needed for Undo, where a
// merge would leave newly-added keys (a first-ever rating, say) in place.
export function replaceBook(book) {
  const books = load();
  const i = books.findIndex((b) => b.id === book.id);
  if (i >= 0) books[i] = { ...book };
  else books.push({ ...book });
  save(books);
  sync.upsertRemote(book);
}

export function updateBook(id, patch) {
  const books = load();
  const i = books.findIndex((b) => b.id === id);
  if (i >= 0) {
    books[i] = { ...books[i], ...patch };
    save(books);
    sync.upsertRemote(books[i]);
  }
}

export function removeBook(id) {
  save(load().filter((b) => b.id !== id));
  sync.removeRemote(id);
}

// Replace the local library with the household's cloud state. Called by the
// sync layer only — must not write back through the sync hooks.
export function applyRemote(books) {
  save(books);
}

// Every book the user owns a copy of: the Owned shelf plus any
// TBR/Completed book flagged as an owned copy.
export function getOwnedBooks() {
  return load().filter((b) => b.shelf === "owned" || b.owned);
}

export function exportJson() {
  return JSON.stringify(load(), null, 2);
}

export function importJson(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("Invalid library file");
  save(data);
  data.forEach((b) => sync.upsertRemote(b));
}
