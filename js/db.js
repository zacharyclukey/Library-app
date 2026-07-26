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
//   shelf: "owned" | "tbr" | "completed",
//   owned: true|false,        // tbr/completed books can also be owned copies
//   series: { name, position } | null,
//   addedAt: ISO string
// }

const STORAGE_KEY = "shelfie.library.v1";

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function save(books) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
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
}

export function updateBook(id, patch) {
  const books = load();
  const i = books.findIndex((b) => b.id === id);
  if (i >= 0) {
    books[i] = { ...books[i], ...patch };
    save(books);
  }
}

export function removeBook(id) {
  save(load().filter((b) => b.id !== id));
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
}
