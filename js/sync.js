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
const DEVICE_KEY = "shelfie.deviceId.v1";
const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const META_ID = "_meta";
// Members live as reserved docs inside the books collection (rather than a
// sibling collection) so the Firestore rules from SETUP-SYNC.md keep working
// unchanged, and so they arrive on the same snapshot as the books — no extra
// reads. Everything "_"-prefixed is filtered out of the book list.
const MEMBER_PREFIX = "_member:";

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

// A stable per-device id, so one person's phone and tablet show as separate
// members and a device can update its own entry.
export function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
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
      const books = [];
      const members = [];
      for (const d of snap.docs) {
        if (d.id.startsWith(MEMBER_PREFIX)) members.push(d.data());
        else if (!d.id.startsWith("_")) books.push(d.data());
      }
      members.sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? ""));
      opts.onMembers?.(members);

      if (firstSnapshot) {
        firstSnapshot = false;
        // Announce this device once the roster is known, so joinedAt is
        // preserved for a device that was already a member.
        const mine = members.find((x) => x.deviceId === deviceId());
        announceMember(opts.profileName, mine?.joinedAt).catch(() => {});

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

// Record (or refresh) this device's entry in the member list.
export async function announceMember(profileName, joinedAt) {
  const libId = currentHousehold();
  if (!libId || !m) return;
  const now = new Date().toISOString();
  await m.setDoc(
    bookDoc(libId, MEMBER_PREFIX + deviceId()),
    {
      _member: true,
      deviceId: deviceId(),
      name: (profileName ?? "").trim() || "Someone",
      joinedAt: joinedAt ?? now,
      lastSeen: now,
    },
    { merge: true }
  );
}

// Drop a member entry — this device on leaving, or a stale one the user
// clears out from the member list.
export function removeMember(id = deviceId()) {
  const libId = currentHousehold();
  if (!libId || !m) return Promise.resolve();
  return m.deleteDoc(bookDoc(libId, MEMBER_PREFIX + id)).catch(() => {});
}

export function stop() {
  unsubscribe?.();
  unsubscribe = null;
}

// Create or join a named, password-protected library. Joining uploads the
// device's existing books first so libraries merge instead of losing
// anyone's shelves. Throws Error with .code = "not-found" when joining a
// library that doesn't exist (typo'd name or wrong password).
export async function openNamed(opts) {
  const { name, password, create, localBooks, onRemote, onError, onMembers, profileName } = opts;
  const displayName = normalizeLibraryName(name);
  if (!displayName) throw new Error("Enter a library name.");
  if (!password) throw new Error("Enter a password.");
  if (create) {
    const problem = passwordProblem(displayName, password);
    if (problem) throw new Error(problem);
  }

  await ensureFirebase();
  const libId = await deriveLibraryId(displayName, password);
  const metaRef = bookDoc(libId, META_ID);
  const meta = await m.getDoc(metaRef);

  if (meta.exists() && create) {
    // The name + password pair is what locates a library, so creating onto an
    // existing one would silently merge two households. Make it a choice.
    const err = new Error(
      `A library called “${displayName}” with this exact password already exists. ` +
      "If it's yours, tap Join library instead. If not, pick a different password " +
      "(or a more distinctive name) so you get a library of your own."
    );
    err.code = "exists";
    throw err;
  }

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
  return start(onRemote, onError, { localBooks, onMembers, profileName });
}

// The name + password pair is the only key to a library, so a weak password
// is the one thing that could let two unrelated households collide. Reject
// the passwords that would realistically be picked twice.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwertyui", "iloveyou", "letmein1", "welcome1", "abc12345", "books123",
  "library1", "library123", "changeme", "trustno1", "sunshine", "princess",
  "football", "baseball", "starwars", "superman", "shelfie1", "shelfie123",
]);

export function passwordProblem(libraryName, password) {
  const pw = String(password ?? "");
  if (pw.length < 8) return "Use a password of at least 8 characters.";
  const lower = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return "That password is too common — two different households could pick it. Choose something more personal.";
  }
  if (lower === normalizeLibraryName(libraryName).toLowerCase()) {
    return "The password can't be the same as the library name.";
  }
  if (/^(.)\1+$/.test(pw)) return "Choose a password with more variety.";
  return null;
}

// Legacy: join an existing code-based household directly by its code.
export async function join(code, localBooks, onRemote, onError, opts = {}) {
  code = code.trim().toLowerCase();
  if (!code) throw new Error("Enter a household code.");
  await ensureFirebase();
  localStorage.setItem(HOUSEHOLD_KEY, code);
  localStorage.removeItem(HOUSEHOLD_NAME_KEY);
  await uploadBooks(code, localBooks);
  return start(onRemote, onError, { localBooks, ...opts });
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
  removeMember();               // best effort; fire-and-forget
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
