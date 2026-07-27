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
//   shelf: "owned" | "tbr" | "completed" | "wishlist",
//   owned: true|false,        // tbr/completed books can also be owned copies
//   medium: "print" | "ebook" | "audio",  // missing = print (pre-feature)
//   content: "kids"|"teen"|"mature"|"explicit" | null,  // audience tag (opt-in UI)
//   spice: 1-5 | null,        // 🌶️ scale (opt-in UI)
//   profile: name | null,     // whose list entry this is (null = shared)
//   ratings: { profileName: 1-5 },
//   reviews: { profileName: { text, updatedAt } },
//   rating: 1-5 | null,       // legacy pre-profile rating
//   series: { name, position } | null,
//   addedAt: ISO string
// }

import * as sync from "./sync.js";

const STORAGE_KEY = "shelfie.library.v1";

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
    rating: clamp(book.rating, 1, 5),
    profile: str(book.profile),
  };
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

export function getBooksOnShelf(shelf) {
  return load().filter((b) => b.shelf === shelf);
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
