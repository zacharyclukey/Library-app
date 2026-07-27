// Shared-library sync via Firebase Firestore.
//
// Model: a shared library lives at households/{id}/books/{bookId}; all
// members read/write the same collection and changes stream to everyone in
// real time. Two kinds of id exist:
//
//  - Named libraries (current): the user picks a library name + password.
//    The id is derived on-device with PBKDF2(password, salt=name) — so the
//    same name+password always lands on the same library, but the location
//    can't be computed without the password. The password itself is never
//    sent or stored anywhere; knowing name+password IS the access control,
//    which suits Firestore's open per-household rules. A reserved "_meta"
//    doc in the books collection stores the display name.
//
//  - Legacy code households: an unguessable generated code (e.g.
//    "cedar-otter-4821") used directly as the id. Still supported so
//    existing households keep syncing.
//
// This module is inert until js/firebase-config.js has a real config AND
// the user has created/joined a library. The Firebase SDK is loaded on
// demand from Google's CDN only when both are true.

import { firebaseConfig } from "./firebase-config.js";

const HOUSEHOLD_KEY = "shelfie.household.v1";       // library id (nl_… or legacy code)
const HOUSEHOLD_NAME_KEY = "shelfie.householdName.v1"; // display name (named libraries)
const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const META_ID = "_meta";

let fsdb = null; // Firestore instance
let m = null;    // firestore module namespace
let unsubscribe = null;

export function isConfigured() {
  return !!firebaseConfig;
}

export function currentHousehold() {
  return localStorage.getItem(HOUSEHOLD_KEY);
}

export function currentLibraryName() {
  return localStorage.getItem(HOUSEHOLD_NAME_KEY);
}

export function isNamed() {
  return (currentHousehold() ?? "").startsWith("nl_");
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

function bookDoc(libId, id) {
  // Firestore doc ids can't contain "/"; our ids ("isbn:...", "ol:...") don't.
  return m.doc(fsdb, "households", libId, "books", id);
}

export function normalizeLibraryName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

// Derive the library's storage id from name + password. PBKDF2 (150k
// iterations) makes guessing slow; the name acts as the salt so the same
// password on different library names still yields unrelated ids. Runs
// entirely on-device via Web Crypto.
export async function deriveLibraryId(name, password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: enc.encode("shelfie::" + normalizeLibraryName(name).toLowerCase()),
      iterations: 150000,
    },
    key,
    256
  );
  const hex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return "nl_" + hex.slice(0, 40);
}

// Subscribe to the current library. onRemote(books[]) fires with the full
// cloud collection on every change (including our own writes echoing back).
//
// opts.localBooks guards the first snapshot: if the cloud library is empty
// but this phone has books, seed the library from the phone instead of
// letting the empty snapshot wipe it.
export async function start(onRemote, onError, opts = {}) {
  const libId = currentHousehold();
  if (!firebaseConfig || !libId) return false;
  await ensureFirebase();
  stop();
  let firstSnapshot = true;
  unsubscribe = m.onSnapshot(
    m.collection(fsdb, "households", libId, "books"),
    (snap) => {
      const books = snap.docs.filter((d) => !d.id.startsWith("_")).map((d) => d.data());
      if (firstSnapshot) {
        firstSnapshot = false;
        const local = opts.localBooks ?? [];
        if (books.length === 0 && local.length > 0) {
          uploadBooks(libId, local).catch((err) => onError?.(err));
          return; // the resulting snapshot delivers them back
        }
      }
      onRemote(books);
    },
    (err) => onError?.(err)
  );
  return true;
}

export function stop() {
  unsubscribe?.();
  unsubscribe = null;
}

// Create or join a named, password-protected library. Joining uploads the
// device's existing books first so libraries merge instead of losing
// anyone's shelves. Throws Error with .code = "not-found" when joining a
// library that doesn't exist (typo'd name or wrong password).
export async function openNamed({ name, password, create, localBooks, onRemote, onError }) {
  const displayName = normalizeLibraryName(name);
  if (!displayName) throw new Error("Enter a library name.");
  if (!password) throw new Error("Enter a password.");
  if (create && password.length < 6) {
    throw new Error("Use a password of at least 6 characters.");
  }

  await ensureFirebase();
  const libId = await deriveLibraryId(displayName, password);
  const metaRef = bookDoc(libId, META_ID);
  const meta = await m.getDoc(metaRef);

  if (!meta.exists()) {
    if (!create) {
      const err = new Error(
        `No library called “${displayName}” with that password was found. ` +
        "Check both for typos — or create it if this is a new library."
      );
      err.code = "not-found";
      throw err;
    }
    await m.setDoc(metaRef, {
      _meta: true,
      name: displayName,
      createdAt: new Date().toISOString(),
    });
  }

  localStorage.setItem(HOUSEHOLD_KEY, libId);
  localStorage.setItem(
    HOUSEHOLD_NAME_KEY,
    meta.exists() ? meta.data().name ?? displayName : displayName
  );
  await uploadBooks(libId, localBooks);
  return start(onRemote, onError, { localBooks });
}

// Legacy: join an existing code-based household directly by its code.
export async function join(code, localBooks, onRemote, onError) {
  code = code.trim().toLowerCase();
  if (!code) throw new Error("Enter a household code.");
  await ensureFirebase();
  localStorage.setItem(HOUSEHOLD_KEY, code);
  localStorage.removeItem(HOUSEHOLD_NAME_KEY);
  await uploadBooks(code, localBooks);
  return start(onRemote, onError, { localBooks });
}

async function uploadBooks(libId, localBooks) {
  await Promise.all(
    (localBooks ?? [])
      .filter((b) => b?.id && !String(b.id).startsWith("_"))
      .map((b) => m.setDoc(bookDoc(libId, b.id), sanitize(b), { merge: true }))
  );
}

// Leave the library on this device only; cloud data and other members are
// untouched, and a local copy of the books is kept.
export function leave() {
  stop();
  localStorage.removeItem(HOUSEHOLD_KEY);
  localStorage.removeItem(HOUSEHOLD_NAME_KEY);
}

// Write-through hooks called by db.js after local mutations. Fire-and-forget:
// Firestore queues writes while offline and retries itself.
export function upsertRemote(book) {
  if (!isActive() || String(book.id).startsWith("_")) return;
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
