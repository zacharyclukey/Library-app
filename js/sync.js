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
// Join requests are docs too: written by the joining device, flipped to
// approved/denied by an existing member, watched by the joiner.
const JOIN_PREFIX = "_join:";
const PENDING_KEY = "shelfie.pendingJoin.v1";

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

// Signed-in user id, once anonymous sign-in has completed. Every document
// this app writes carries it, so the security rules can tell "the person who
// wrote this" from "anyone else on the internet" — see SETUP-SYNC.md.
let authUid = null;
let authApi = null; // { mod, auth } once firebase-auth has loaded

export function uid() {
  return authUid;
}

// ---------- the account (optional, and additive) ----------
//
// Everything above works with no account at all: the anonymous uid is the
// identity, and it lives in this browser's storage. The trap is that "this
// browser's storage" is fragile — on a phone, deleting the home-screen app
// deletes the whole container, uid included, and with it this device's
// membership and the ownership of everything it ever wrote.
//
// Linking an email + password to the anonymous account fixes exactly that,
// and nothing else. linkWithCredential attaches the credential to the
// EXISTING user, so the uid — the thing every rule and every document keys
// on — does not change. A fresh install then signs in with the email and
// gets the SAME uid back, and requestJoin below recognises it as an
// already-approved member and lets it straight in, no approval tap needed.
//
// The one wrong way to do this is signInWithEmailAndPassword on a device
// that already owns data: that REPLACES the anonymous user with a different
// uid and silently orphans everything the old one wrote. So: LINK on the
// device that has your library; SIGN IN on the device that has nothing.
// The UI enforces this by only offering each form in the right place.

// Turn Firebase's error codes into sentences a person can act on.
function friendlyAuthError(err) {
  const code = err?.code ?? "";
  const msg =
    {
      "auth/operation-not-allowed":
        "Email sign-in isn't switched on in your Firebase project yet — enable the Email/Password provider (SETUP-SYNC.md, step 2c).",
      "auth/invalid-email": "That doesn't look like an email address.",
      "auth/weak-password": "The account password needs at least 6 characters.",
      "auth/email-already-in-use":
        "That email is already linked to a sign-in. If it's yours, use Sign in on the NEW device — linking here would create a second identity.",
      "auth/credential-already-in-use":
        "That email is already linked to a sign-in. If it's yours, use Sign in on the NEW device — linking here would create a second identity.",
      "auth/user-not-found": "No sign-in matches that email and password.",
      "auth/wrong-password": "No sign-in matches that email and password.",
      "auth/invalid-credential": "No sign-in matches that email and password.",
      "auth/network-request-failed": "Couldn't reach the sign-in service — check your connection.",
    }[code] ?? (err?.message || "Sign-in failed.");
  const out = new Error(msg);
  out.code = code;
  return out;
}

export function accountAvailable() {
  return !!authApi;
}

// The SDK loads lazily, so on a fresh device nothing has loaded it by the
// time the join screen renders — and the sign-in form would never appear.
// The screen calls this to load it, then re-renders. A no-op when already
// loaded or when no Firebase config exists.
export async function warmup() {
  if (!firebaseConfig || fsdb) return;
  await ensureFirebase();
}

// The linked email, or null while the account is still anonymous-only.
export function accountEmail() {
  return authApi?.auth?.currentUser?.email ?? null;
}

// On the device that already has the library: attach an email + password to
// the existing anonymous user. The uid is unchanged, which is the point.
export async function linkAccount(email, password) {
  await ensureFirebase();
  if (!authApi?.auth?.currentUser) {
    throw new Error("Sign-in isn't available right now — check your connection and try again.");
  }
  try {
    const cred = authApi.mod.EmailAuthProvider.credential(email.trim(), password);
    await authApi.mod.linkWithCredential(authApi.auth.currentUser, cred);
  } catch (err) {
    throw friendlyAuthError(err);
  }
  authUid = authApi.auth.currentUser.uid;
  rememberAccount();
  return accountEmail();
}

// On a fresh device with nothing on it: become the linked account. This
// replaces the fresh anonymous user, which is safe precisely because the
// device is fresh — it owns nothing yet for a uid change to orphan.
export async function signInAccount(email, password) {
  await ensureFirebase();
  if (!authApi) {
    throw new Error("Sign-in isn't available right now — check your connection and try again.");
  }
  let user;
  try {
    ({ user } = await authApi.mod.signInWithEmailAndPassword(
      authApi.auth, email.trim(), password
    ));
  } catch (err) {
    throw friendlyAuthError(err);
  }
  authUid = user?.uid ?? null;
  rememberAccount();
  return accountEmail();
}

// ---------- your account as the identity, not just a rescue ----------
//
// On a phone, the home-screen app and the browser are two separate storage
// containers, each quietly inventing its own anonymous identity — the same
// person shows up as two different people depending on which icon they
// tapped. The account is how those contexts (and any new device) converge on
// one "you": a users/{uid} doc carries your profile name and which shared
// library you're in, and users/{uid}/books carries your own library, so any
// context that signs in becomes the same person with the same books.

// Signed in with a real credential — as opposed to the throwaway anonymous
// user every context gets for the security rules.
export function isAccounted() {
  return !!authApi?.auth?.currentUser?.email;
}

// Firebase persists sessions per-context in IndexedDB, which this module
// can't see without loading the whole SDK. A one-byte hint in localStorage
// lets the app know at boot whether loading it is worth the bytes.
const ACCOUNT_HINT_KEY = "shelfie.account.v1";

export function accountHint() {
  return localStorage.getItem(ACCOUNT_HINT_KEY);
}

function rememberAccount() {
  const email = accountEmail();
  if (email) localStorage.setItem(ACCOUNT_HINT_KEY, email);
}

export async function signOutAccount() {
  stopPersonal();
  localStorage.removeItem(ACCOUNT_HINT_KEY);
  if (authApi?.auth) {
    try {
      await authApi.mod.signOut(authApi.auth);
      // Back to a throwaway identity so the rules still see a signed-in user
      // (a shared library this device stays in keeps syncing).
      const cred = (await authApi.mod.signInAnonymously(authApi.auth)).user;
      authUid = cred?.uid ?? null;
    } catch {
      authUid = null;
    }
  }
}

function accountDoc() {
  return m.doc(fsdb, "users", authUid);
}

// Merge a patch into the account's profile doc: { profileName, libId,
// libName }. Fire-and-forget from callers; nothing user-visible fails when
// the write does, it just means one fewer thing restored on the next device.
export async function saveAccountProfile(patch) {
  if (!isAccounted()) return;
  await m.setDoc(
    accountDoc(),
    { ...patch, email: accountEmail(), updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

export async function loadAccountProfile() {
  if (!isAccounted()) return null;
  const snap = await m.getDoc(accountDoc());
  return snap.exists() ? snap.data() : null;
}

// Boot-time restore. Loads the SDK only when something suggests it will pay
// off (a stored account hint), waits for the persisted session, and hands
// the app what the account knows: who you are and where your library lives.
// Returns null when there's no signed-in account.
export async function accountBootstrap() {
  if (!firebaseConfig) return null;
  if (!accountHint() && !currentHousehold()) return null;
  await ensureFirebase();
  if (!isAccounted()) {
    // The hint outlived the session (revoked, or cleared server-side).
    localStorage.removeItem(ACCOUNT_HINT_KEY);
    return null;
  }
  rememberAccount();
  const profile = (await loadAccountProfile().catch(() => null)) ?? {};
  return { email: accountEmail(), ...profile };
}

// ---------- your own library, synced to your account ----------
//
// The personal channel is the solo counterpart of the household one: the
// same upload-then-listen engine pointed at users/{uid}/books. It runs when
// you're signed in and NOT in a shared library — a shared library is the
// louder truth while you're in one, and the account doc remembers your
// membership so other contexts join it instead of needing this copy.

let unsubPersonal = null;

export function isPersonalActive() {
  return !!unsubPersonal;
}

function personalBookDoc(id) {
  const raw = String(id ?? "");
  const usable =
    raw && raw !== "." && raw !== ".." && !raw.includes("/") && !/^__.*__$/.test(raw);
  return m.doc(
    fsdb, "users", authUid, "books",
    usable ? raw : "enc_" + encodeURIComponent(raw).replace(/\./g, "%2E")
  );
}

export async function startPersonal(onRemote, onError, opts = {}) {
  if (!firebaseConfig) return false;
  await ensureFirebase();
  if (!isAccounted()) return false;
  stopPersonal();
  // Local books go up first, so signing in merges the shelves rather than
  // letting whichever copy loaded last win. The snapshot then delivers the
  // union back.
  const local = (opts.localBooks ?? []).filter(
    (b) => b?.id && !String(b.id).startsWith("_")
  );
  await Promise.all(
    local.map((b) => m.setDoc(personalBookDoc(b.id), sanitize(b), { merge: true }))
  );
  unsubPersonal = m.onSnapshot(
    m.collection(fsdb, "users", authUid, "books"),
    (snap) => {
      const books = snap.docs
        .filter((d) => !d.id.startsWith("_"))
        .map((d) => d.data());
      onRemote(books);
    },
    (err) => onError?.(err)
  );
  return true;
}

export function stopPersonal() {
  unsubPersonal?.();
  unsubPersonal = null;
}

async function ensureFirebase() {
  if (!fsdb) {
    const [appMod, fsMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    m = fsMod;
    fsdb = fsMod.getFirestore(app);

    // Anonymous sign-in: free, silent, and no account to create. It exists so
    // the rules can require *some* signed-in user rather than allowing the
    // whole internet.
    //
    // Deliberately separate from the imports above, and deliberately allowed
    // to fail: if the auth module can't load — blocked network, ad blocker,
    // a project without the Anonymous provider enabled — sync should still
    // work exactly as it did before this existed. Writes will then be refused
    // by the rules and the sync screen says so, which is a far better failure
    // than the whole feature going dark.
    try {
      const authMod = await import(`${SDK}/firebase-auth.js`);
      const auth = authMod.getAuth(app);
      // Wait for the SDK to restore any persisted session BEFORE deciding to
      // sign in anonymously. currentUser is null for a beat on every boot
      // even when a user is saved; racing past that here would replace a
      // signed-in account with a brand-new anonymous identity — the exact
      // "different me" bug accounts exist to end.
      await auth.authStateReady?.();
      const cred = auth.currentUser ?? (await authMod.signInAnonymously(auth)).user;
      authUid = cred?.uid ?? null;
      authApi = { mod: authMod, auth };
    } catch (err) {
      console.warn("anonymous sign-in unavailable:", err?.message ?? err);
    }
  }
}

// Shared Firestore handle for other modules (the community layer), so the
// SDK is loaded once and only on demand.
export async function firestore() {
  if (!firebaseConfig) return null;
  await ensureFirebase();
  return { m, db: fsdb };
}

function bookDoc(libId, id) {
  // Our own ids ("isbn:…", "ol:…", "manual:…") are always safe and must stay
  // byte-identical — a library already in the cloud is addressed by them.
  // Only the ids Firestore would reject (empty, containing "/", "." or "..",
  // or the reserved "__…__" form) get encoded. The book keeps its real id in
  // its own `id` field either way.
  const raw = String(id ?? "");
  const usable =
    raw && raw !== "." && raw !== ".." && !raw.includes("/") && !/^__.*__$/.test(raw);
  return m.doc(
    fsdb, "households", libId, "books",
    usable ? raw : "enc_" + encodeURIComponent(raw).replace(/\./g, "%2E")
  );
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
  // While you're in a shared library it is the louder truth; the account
  // doc remembers the membership, so other devices follow you here rather
  // than to the solo copy.
  stopPersonal();
  saveAccountProfile({ libId, libName: currentLibraryName() ?? null }).catch(() => {});
  let firstSnapshot = true;
  unsubscribe = m.onSnapshot(
    m.collection(fsdb, "households", libId, "books"),
    (snap) => {
      const books = [];
      const members = [];
      const requests = [];
      for (const d of snap.docs) {
        if (d.id.startsWith(MEMBER_PREFIX)) members.push(d.data());
        else if (d.id.startsWith(JOIN_PREFIX)) {
          const r = d.data();
          if (r.status === "pending") requests.push(r);
        } else if (!d.id.startsWith("_")) books.push(d.data());
      }
      members.sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? ""));
      requests.sort((a, b) => (a.requestedAt ?? "").localeCompare(b.requestedAt ?? ""));
      opts.onMembers?.(members, requests);

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
      // The signed-in identity behind this device, so a reinstall that signs
      // back in can be recognised as an existing member (see requestJoin).
      // Spread-guarded: merge:true means writing uid:null here would erase a
      // good stamp on a launch where anonymous sign-in happened to fail.
      ...(authUid ? { uid: authUid } : {}),
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

// ---------- join approval ----------

export function pendingJoin() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY));
  } catch {
    return null;
  }
}

let pendingTimer = null;

// Ask to join a named library. If the library has members, this files a
// request that an existing member must approve (the joiner neither uploads
// nor sees any books until then) and begins watching for the verdict. A
// library with no members yet has nobody to ask, so the join completes
// directly. Returns { pending, libName }.
export async function requestJoin(opts) {
  const { name, password, profileName } = opts;
  const displayName = normalizeLibraryName(name);
  if (!displayName) throw new Error("Enter a library name.");
  if (!password) throw new Error("Enter a password.");

  await ensureFirebase();
  const libId = await deriveLibraryId(displayName, password);
  const meta = await m.getDoc(bookDoc(libId, META_ID));
  if (!meta.exists()) {
    const err = new Error(
      `No library called “${displayName}” with that password was found. ` +
      "Check both for typos — or create it if this is a new library."
    );
    err.code = "not-found";
    throw err;
  }
  const libName = meta.data().name ?? displayName;

  const snap = await m.getDocs(m.collection(fsdb, "households", libId, "books"));
  const memberDocs = snap.docs.filter((d) => d.id.startsWith(MEMBER_PREFIX));

  // A returning member doesn't knock — they have a key. If this signed-in
  // uid is already stamped on a member entry, this is the same person on a
  // fresh install (or in Safari instead of the installed app), and making
  // them wait for someone to tap Approve would lock out anyone whose
  // approver was the very device they just wiped.
  const recognised =
    authUid && memberDocs.some((d) => d.data().uid === authUid);

  if (recognised || memberDocs.length === 0) {
    await finalizeJoin(libId, libName, opts);
    opts.onResolved?.(true, libName);
    return { pending: false, libName, recognised: !!recognised };
  }

  await m.setDoc(bookDoc(libId, JOIN_PREFIX + deviceId()), {
    _join: true,
    deviceId: deviceId(),
    name: (profileName ?? "").trim() || "Someone",
    requestedAt: new Date().toISOString(),
    status: "pending",
  });
  localStorage.setItem(PENDING_KEY, JSON.stringify({ libId, libName }));
  watchPending(opts);
  return { pending: true, libName };
}

async function finalizeJoin(libId, libName, opts) {
  localStorage.setItem(HOUSEHOLD_KEY, libId);
  localStorage.setItem(HOUSEHOLD_NAME_KEY, libName);
  localStorage.removeItem(PENDING_KEY);
  const localBooks =
    typeof opts.localBooks === "function" ? opts.localBooks() : opts.localBooks ?? [];
  await uploadBooks(libId, localBooks);
  await start(opts.onRemote, opts.onError, {
    localBooks,
    onMembers: opts.onMembers,
    profileName: opts.profileName,
  });
}

// Watch our pending request until a member approves or denies it. Polling
// (rather than a snapshot listener) keeps this trivially resumable across
// app restarts; it only runs while a request is outstanding.
export function watchPending(opts) {
  const pending = pendingJoin();
  if (!pending) return false;
  stopWatchingPending();

  const check = async () => {
    try {
      await ensureFirebase();
      const reqRef = bookDoc(pending.libId, JOIN_PREFIX + deviceId());
      const snap = await m.getDoc(reqRef);
      const status = snap.exists() ? snap.data().status : "denied";
      if (status === "pending") return;

      stopWatchingPending();
      await m.deleteDoc(reqRef).catch(() => {});
      if (status === "approved") {
        await finalizeJoin(pending.libId, pending.libName, opts);
        opts.onResolved?.(true, pending.libName);
      } else {
        localStorage.removeItem(PENDING_KEY);
        opts.onResolved?.(false, pending.libName);
      }
    } catch {
      /* offline or transient — try again on the next tick */
    }
  };
  check();
  pendingTimer = setInterval(check, 3000);
  return true;
}

function stopWatchingPending() {
  if (pendingTimer) {
    clearInterval(pendingTimer);
    pendingTimer = null;
  }
}

export async function cancelPending() {
  const pending = pendingJoin();
  stopWatchingPending();
  localStorage.removeItem(PENDING_KEY);
  if (pending && m) {
    await m.deleteDoc(bookDoc(pending.libId, JOIN_PREFIX + deviceId())).catch(() => {});
  }
}

// Called by an existing member from the join-requests list.
export function approveJoin(devId) {
  return m.setDoc(
    bookDoc(currentHousehold(), JOIN_PREFIX + devId),
    { status: "approved" },
    { merge: true }
  );
}

export function denyJoin(devId) {
  return m.setDoc(
    bookDoc(currentHousehold(), JOIN_PREFIX + devId),
    { status: "denied" },
    { merge: true }
  );
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

// Take up a membership the account already holds. No password needed and no
// approval asked: the account doc recording this library IS the proof, and it
// could only have been written by a device that was already inside. Callers
// follow this with start(), which announces the device and syncs the books.
export function adoptLibrary(libId, libName) {
  if (!libId) return false;
  localStorage.setItem(HOUSEHOLD_KEY, libId);
  if (libName) localStorage.setItem(HOUSEHOLD_NAME_KEY, libName);
  localStorage.removeItem(PENDING_KEY);
  return true;
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
// untouched, and a local copy of the books is kept. The account doc forgets
// the membership too — otherwise every other signed-in context would march
// straight back into the library this one just left.
export function leave() {
  removeMember();               // best effort; fire-and-forget
  stop();
  localStorage.removeItem(HOUSEHOLD_KEY);
  localStorage.removeItem(HOUSEHOLD_NAME_KEY);
  saveAccountProfile({ libId: null, libName: null }).catch(() => {});
}

// Write-through hooks called by db.js after local mutations. Fire-and-forget:
// Firestore queues writes while offline and retries itself. Whichever
// channel is live gets the write — the household when you're sharing, your
// account library when you're solo.
export function upsertRemote(book) {
  if (String(book.id).startsWith("_")) return;
  if (isActive()) {
    m.setDoc(bookDoc(currentHousehold(), book.id), sanitize(book)).catch((err) =>
      console.warn("sync upsert failed:", err.message)
    );
  }
  if (isPersonalActive()) {
    m.setDoc(personalBookDoc(book.id), sanitize(book)).catch((err) =>
      console.warn("account sync upsert failed:", err.message)
    );
  }
}

// A refused delete is the one sync failure the reader sees on their own: the
// book is gone locally, then the next snapshot hands it straight back. That
// looks like the app ignoring them, so it says what happened rather than
// warning to a console nobody has open. (It happened: the security rules
// allowed `write` in one line, and on a delete there is no incoming document
// for the size check to measure, so every deletion was denied.)
export function removeRemote(id) {
  if (isActive()) {
    m.deleteDoc(bookDoc(currentHousehold(), id)).catch((err) => {
      console.warn("sync delete failed:", err.message);
      window.dispatchEvent(
        new CustomEvent("shelfie:sync-delete-refused", { detail: err?.code ?? err?.message })
      );
    });
  }
  if (isPersonalActive()) {
    m.deleteDoc(personalBookDoc(id)).catch((err) =>
      console.warn("account sync delete failed:", err.message)
    );
  }
}

// Firestore rejects `undefined` field values; strip them defensively.
function sanitize(book) {
  return JSON.parse(JSON.stringify(book));
}
