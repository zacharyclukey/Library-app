// Shared-library sync via Firebase Firestore.
//
// Model: a "household" is a shared library identified by an unguessable
// code (e.g. "cedar-otter-4821"). Every book lives at
// households/{code}/books/{bookId}. All members read/write the same
// collection and changes stream to everyone in real time.
//
// This module is inert until js/firebase-config.js has a real config AND
// the user has created/joined a household. The Firebase SDK is loaded on
// demand from Google's CDN only when both are true.

import { firebaseConfig } from "./firebase-config.js";

const HOUSEHOLD_KEY = "shelfie.household.v1";
const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

let fsdb = null; // Firestore instance
let m = null;    // firestore module namespace
let unsubscribe = null;

export function isConfigured() {
  return !!firebaseConfig;
}

export function currentHousehold() {
  return localStorage.getItem(HOUSEHOLD_KEY);
}

export function isActive() {
  return !!unsubscribe;
}

async function ensureFirebase() {
  if (!fsdb) {
    const [appMod, fsMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    m = fsMod;
    fsdb = fsMod.getFirestore(appMod.initializeApp(firebaseConfig));
  }
}

function bookDoc(code, id) {
  // Firestore doc ids can't contain "/"; our ids ("isbn:...", "ol:...") don't.
  return m.doc(fsdb, "households", code, "books", id);
}

// Subscribe to the current household. onRemote(books[]) fires with the full
// cloud library on every change (including our own writes echoing back).
export async function start(onRemote, onError) {
  const code = currentHousehold();
  if (!firebaseConfig || !code) return false;
  await ensureFirebase();
  stop();
  unsubscribe = m.onSnapshot(
    m.collection(fsdb, "households", code, "books"),
    (snap) => onRemote(snap.docs.map((d) => d.data())),
    (err) => onError?.(err)
  );
  return true;
}

export function stop() {
  unsubscribe?.();
  unsubscribe = null;
}

// Create-or-join: upload the device's existing books first so joining a
// household merges libraries instead of losing anyone's shelves.
export async function join(code, localBooks, onRemote, onError) {
  code = code.trim().toLowerCase();
  if (!code) throw new Error("Enter a household code.");
  await ensureFirebase();
  localStorage.setItem(HOUSEHOLD_KEY, code);
  await Promise.all(
    (localBooks ?? []).map((b) =>
      m.setDoc(bookDoc(code, b.id), sanitize(b), { merge: true })
    )
  );
  return start(onRemote, onError);
}

// Leave the household on this device only; cloud data and other members
// are untouched, and a local copy of the library is kept.
export function leave() {
  stop();
  localStorage.removeItem(HOUSEHOLD_KEY);
}

export function generateCode() {
  const words = [
    "amber", "birch", "cedar", "delta", "ember", "fable", "grove", "harbor",
    "indigo", "juniper", "koala", "lumen", "maple", "nutmeg", "otter", "pebble",
    "quill", "raven", "sable", "tulip", "umber", "violet", "willow", "zephyr",
  ];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${pick()}-${pick()}-${num}`;
}

// Write-through hooks called by db.js after local mutations. Fire-and-forget:
// Firestore queues writes while offline and retries itself.
export function upsertRemote(book) {
  if (!isActive()) return;
  m.setDoc(bookDoc(currentHousehold(), book.id), sanitize(book)).catch((err) =>
    console.warn("sync upsert failed:", err.message)
  );
}

export function removeRemote(id) {
  if (!isActive()) return;
  m.deleteDoc(bookDoc(currentHousehold(), id)).catch((err) =>
    console.warn("sync delete failed:", err.message)
  );
}

// Firestore rejects `undefined` field values; strip them defensively.
function sanitize(book) {
  return JSON.parse(JSON.stringify(book));
}
