// One person, two windows: the identity bug.
//
// On a phone, the home-screen app and Safari are separate storage containers.
// Each was quietly minting its own anonymous Firebase user and keeping its own
// profile name, so the same human showed up as two different people depending
// on which icon they tapped — different "me", different shelf, and in a shared
// library two member entries for one person.
//
// An account is the fix: sign in from either container and both resolve to one
// uid, one profile name, and one library. This suite proves it end to end
// against a mocked Firestore + auth, using two browser contexts (which really
// do have separate localStorage) as the two windows.
//
// It also pins the regression that makes the whole thing worthless if it slips:
// a signed-in session MUST survive a reload. Firebase restores a persisted user
// asynchronously — currentUser is null for a beat on every boot — so any code
// that decides "no user, sign in anonymously" without waiting throws the
// account away and reintroduces the very bug this file exists to prevent.

import { chromium } from "playwright-core";

const APP_MOCK = "export function initializeApp() { return {}; }";
const FS_MOCK = `
async function rpc(op, args) { return await window.__cloud(op, args); }
export function getFirestore() { return {}; }
export function doc(db, ...p) { return { path: p.join("/") }; }
export function collection(db, ...p) { return { path: p.join("/") }; }
export async function setDoc(ref, data, opts) {
  if (opts?.merge) {
    const prev = await rpc("get", [ref.path]);
    data = { ...(prev ?? {}), ...data };
  }
  await rpc("set", [ref.path, data]);
}
export async function getDoc(ref) { const d = await rpc("get", [ref.path]); return { exists: () => d !== null, data: () => d }; }
export async function getDocs(colRef) {
  const rows = await rpc("list", [colRef.path]);
  return { docs: rows.map(([id, data]) => ({ id, data: () => data })) };
}
export async function deleteDoc(ref) { await rpc("del", [ref.path]); }
// Re-polls, so a write made by the other window shows up here the way a real
// snapshot listener would deliver it.
export function onSnapshot(colRef, cb, onErr) {
  let cancelled = false;
  const tick = async () => {
    try {
      const rows = await rpc("list", [colRef.path]);
      if (!cancelled) cb({ docs: rows.map(([id, data]) => ({ id, data: () => data })) });
    } catch (e) { onErr?.(e); }
  };
  tick();
  const iv = setInterval(tick, 400);
  return () => { cancelled = true; clearInterval(iv); };
}`;

// Auth that persists like the real thing: Firebase keeps the signed-in user in
// IndexedDB per storage container, and restores it asynchronously on boot.
// localStorage stands in for that here — per-context, exactly like the real
// persistence, which is the whole point of the bug being tested.
const AUTH_MOCK = `
async function rpc(op, args) { return await window.__auth(op, args); }
const SAVED = "__mockUser";
function save(u) { u ? localStorage.setItem(SAVED, JSON.stringify(u)) : localStorage.removeItem(SAVED); }
function restore() { try { return JSON.parse(localStorage.getItem(SAVED)); } catch { return null; } }
let current = null;
export function getAuth() {
  return {
    get currentUser() { return current; },
    // Deliberately not synchronous: real Firebase resolves this after reading
    // its store, and code that doesn't await it is the bug.
    authStateReady: () => new Promise((r) => setTimeout(() => { current = restore(); r(); }, 30)),
  };
}
export async function signInAnonymously() {
  let uid = localStorage.getItem("__mockAnonUid");
  if (!uid) { uid = await rpc("anon", []); localStorage.setItem("__mockAnonUid", uid); }
  current = { uid, email: null };
  save(current);
  return { user: current };
}
export const EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
export async function linkWithCredential(user, cred) {
  const out = await rpc("link", [user.uid, cred.email, cred.password]);
  if (out.error) { const e = new Error(out.error); e.code = out.error; throw e; }
  current = { uid: user.uid, email: cred.email };
  save(current);
  return { user: current };
}
export async function signInWithEmailAndPassword(auth, email, password) {
  const out = await rpc("signin", [email, password]);
  if (out.error) { const e = new Error(out.error); e.code = out.error; throw e; }
  current = { uid: out.uid, email };
  save(current);
  return { user: current };
}
export async function signOut() { current = null; save(null); }`;

const cloud = new Map();
const accounts = new Map(); // email -> { password, uid }
let anonCount = 0;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
const problems = [];

// Each call is a separate storage container — which is precisely what the
// home-screen app and Safari are to each other on a real phone.
async function window_(label, books = [], profile = null) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.exposeFunction("__cloud", (op, [path, data]) => {
    if (op === "set") { cloud.set(path, data); return null; }
    if (op === "get") return cloud.get(path) ?? null;
    if (op === "del") { cloud.delete(path); return null; }
    return [...cloud.entries()]
      .filter(([p]) => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/"))
      .map(([p, d]) => [p.slice(path.length + 1), d]);
  });
  await ctx.exposeFunction("__auth", (op, args) => {
    if (op === "anon") return `anon-${label}-${++anonCount}`;
    if (op === "link") {
      const [uid, email, password] = args;
      if (accounts.has(email)) return { error: "auth/email-already-in-use" };
      accounts.set(email, { password, uid });
      return { ok: true };
    }
    if (op === "signin") {
      const [email, password] = args;
      const acct = accounts.get(email);
      if (!acct || acct.password !== password) return { error: "auth/invalid-credential" };
      return { uid: acct.uid };
    }
    return null;
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("net::ERR") && !msg.text().includes("404")) {
      errors.push(`${label} console: ${msg.text()}`);
    }
  });
  await page.route(/googleapis|covers\.openlibrary/, (r) => r.abort());
  await page.route(/gstatic.*firebase-auth/, (r) => r.fulfill({ body: AUTH_MOCK, contentType: "application/javascript" }));
  await page.route(/gstatic.*firebase-app/, (r) => r.fulfill({ body: APP_MOCK, contentType: "application/javascript" }));
  await page.route(/gstatic.*firebase-firestore/, (r) => r.fulfill({ body: FS_MOCK, contentType: "application/javascript" }));
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));
  await page.addInitScript(({ who, seed }) => {
    if (who) localStorage.setItem("shelfie.profile.v1", who);
    localStorage.setItem("shelfie.library.v1", JSON.stringify(seed));
  }, { who: profile, seed: books });
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(700);
  return { ctx, page, label };
}

const openAccount = async (page) => {
  await page.click("#settings-btn");
  await page.waitForTimeout(400);
  await page.click('.settings-row[data-go="account"]');
  await page.waitForTimeout(900);
};

const uidOf = (page) =>
  page.evaluate(() => { try { return JSON.parse(localStorage.getItem("__mockUser"))?.uid ?? null; } catch { return null; } });

// ---------- 1. the home-screen app: books, a name, and a new account ----------
const APP = await window_("app", [
  { id: "b1", title: "Piranesi", authors: ["Susanna Clarke"], shelf: "owned",
    owned: true, addedAt: "2025-01-01T00:00:00Z" },
  { id: "b2", title: "Circe", authors: ["Madeline Miller"], shelf: "completed",
    owned: true, addedAt: "2025-01-02T00:00:00Z" },
], "Zach");

await openAccount(APP.page);
console.log("1. account screen offers sign-in:", await APP.page.locator("#account-form").count() === 1);
if (await APP.page.locator("#account-form").count() !== 1) {
  problems.push("no account form on the account screen");
}

const anonUid = await uidOf(APP.page);
await APP.page.fill("#account-email", "zach@example.com");
await APP.page.fill("#account-password", "hunter22");
await APP.page.click('#account-form [data-intent="create"]');
await APP.page.waitForTimeout(1200);

const appUid = await uidOf(APP.page);
console.log("2. creating an account kept the uid:", anonUid === appUid, `(${anonUid} → ${appUid})`);
if (anonUid !== appUid) {
  problems.push("creating an account changed the uid — this device's existing data is orphaned");
}
const signedInText = await APP.page.locator("#account-content").textContent();
console.log("3. shows signed in:", /zach@example\.com/.test(signedInText));
if (!/zach@example\.com/.test(signedInText)) problems.push("account screen did not show the signed-in state");

// The account carries the name and the books.
const profileDoc = cloud.get(`users/${appUid}`);
console.log("4. profile name saved to the account:", profileDoc?.profileName);
if (profileDoc?.profileName !== "Zach") problems.push("profile name was not saved to the account");
const appBooks = [...cloud.keys()].filter((p) => p.startsWith(`users/${appUid}/books/`));
console.log("5. own library backed up:", appBooks.length, "books (want 2)");
if (appBooks.length !== 2) problems.push(`account library has ${appBooks.length} books, expected 2`);

// ---------- 2. Safari: the same person, a different container ----------
// No profile, no books, no shared library — exactly how the other window looks
// today, which is why it used to be a stranger.
const SAFARI = await window_("safari");
const safariAnon = await uidOf(SAFARI.page);
console.log("6. safari starts as a different anonymous user:", safariAnon !== appUid);
if (safariAnon === appUid) problems.push("test is not modelling separate containers");

await openAccount(SAFARI.page);
await SAFARI.page.fill("#account-email", "zach@example.com");
await SAFARI.page.fill("#account-password", "hunter22");
await SAFARI.page.click('#account-form [data-intent="signin"]');
await SAFARI.page.waitForTimeout(1500);

const safariUid = await uidOf(SAFARI.page);
console.log("7. after signing in, safari IS the same person:", safariUid === appUid,
  `(${safariUid} vs ${appUid})`);
if (safariUid !== appUid) problems.push("signing in did not converge the two windows on one identity");

const safariProfile = await SAFARI.page.evaluate(() => localStorage.getItem("shelfie.profile.v1"));
console.log("8. the profile name came with it:", safariProfile);
if (safariProfile !== "Zach") problems.push(`safari's profile is "${safariProfile}", expected "Zach"`);

await SAFARI.page.click("#nav-shelves");
await SAFARI.page.waitForTimeout(1200);
const safariBooks = await SAFARI.page.locator(".grid-book").count();
console.log("9. and so did the books:", safariBooks, "(want 2)");
if (safariBooks !== 2) problems.push(`safari shows ${safariBooks} books, expected 2`);

// ---------- 3. an edit in one window reaches the other ----------
// Through the app's real write path — rating a book on its turned card — so
// this exercises the sync hooks rather than a hand-written localStorage poke.
await SAFARI.page.click('.grid-book[data-id="b1"] .page-edge');
await SAFARI.page.waitForTimeout(700);
await SAFARI.page.click('.grid-book[data-id="b1"] [data-qa-rate="4"]');
await SAFARI.page.waitForTimeout(1200);

const ratedDoc = cloud.get(`users/${appUid}/books/b1`);
console.log("10. the rating reached the account:", JSON.stringify(ratedDoc?.ratings ?? null));
if (ratedDoc?.ratings?.Zach !== 4) {
  problems.push(`rating did not reach the account (got ${JSON.stringify(ratedDoc?.ratings ?? null)})`);
}

await APP.page.reload();
await APP.page.waitForTimeout(1800);
const appRating = await APP.page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "b1")?.ratings?.Zach ?? null);
console.log("11. and came back down to the app window:", appRating, "(want 4)");
if (appRating !== 4) problems.push(`app window sees rating ${appRating}, expected 4`);

// ---------- 4. the regression that would undo all of it ----------
// A reload must not silently demote a signed-in account to a fresh anonymous
// user. This is the async-restore race, and it is invisible until someone's
// shelf empties.
const afterReloadUid = await uidOf(APP.page);
const afterReloadEmail = await APP.page.evaluate(() =>
  localStorage.getItem("shelfie.account.v1"));
console.log("12. still signed in after a reload:", afterReloadUid === appUid,
  "| hint kept:", afterReloadEmail);
if (afterReloadUid !== appUid) {
  problems.push("a reload replaced the signed-in account with a new anonymous user");
}
if (afterReloadEmail !== "zach@example.com") {
  problems.push("the account hint did not survive a reload");
}

// ---------- 5. signing out is local, and doesn't take the books ----------
await openAccount(APP.page);
APP.page.once("dialog", (d) => d.accept());
await APP.page.click("#sign-out-btn");
await APP.page.waitForTimeout(900);
const outText = await APP.page.locator("#account-content").textContent();
console.log("13. signed out shows the form again:", /Sign in/.test(outText));
if (!/Sign in/.test(outText)) problems.push("sign-out did not return to the signed-out state");
await APP.page.click("#nav-shelves");
await APP.page.waitForTimeout(700);
const keptBooks = await APP.page.locator(".grid-book").count();
console.log("14. books stayed on the device:", keptBooks, "(want 2)");
if (keptBooks !== 2) problems.push(`sign-out left ${keptBooks} books, expected 2 to remain locally`);
const cloudStillThere = [...cloud.keys()].filter((p) => p.startsWith(`users/${appUid}/books/`));
console.log("15. and the account still holds them:", cloudStillThere.length, "(want 2)");
if (cloudStillThere.length !== 2) problems.push("signing out deleted books from the account");

// ---------- 6. the upgrade: an anonymous member adopts an account ----------
// The case almost every existing user is in — months of books, a shared
// library, ratings — and has never had an account. Adding one must cost them
// nothing: same uid, same membership, same shelf, and the ratings they wrote
// as an anonymous user still theirs to edit.
const OLD = await window_("longtime", [
  { id: "o1", title: "The Fifth Season", authors: ["N. K. Jemisin"], shelf: "owned",
    owned: true, ratings: { Kelsey: 5 }, addedAt: "2024-06-01T00:00:00Z" },
  { id: "o2", title: "Book Lovers", authors: ["Emily Henry"], shelf: "completed",
    owned: true, addedAt: "2024-06-02T00:00:00Z" },
], "Kelsey");

// They're in a shared library, the way they have been for months.
await OLD.page.click("#settings-btn");
await OLD.page.waitForTimeout(400);
await OLD.page.click('.settings-row[data-go="sync"]');
await OLD.page.waitForTimeout(700);
await OLD.page.fill("#library-name", "Kelsey House");
await OLD.page.fill("#library-password", "longmarriage");
await OLD.page.click('[data-intent="create"]');
await OLD.page.waitForTimeout(1200);

const beforeUid = await uidOf(OLD.page);
const beforeLib = await OLD.page.evaluate(() => localStorage.getItem("shelfie.household.v1"));
console.log("16. anonymous member set up:", !!beforeLib, "| uid:", beforeUid);
if (!beforeLib) problems.push("could not put the long-time user in a shared library");

// The screen must lead with the safe move, not offer both as equals.
await openAccount(OLD.page);
const upgradeText = await OLD.page.locator("#account-content").textContent();
const primaryLabel = await OLD.page.locator("#account-form .primary-btn").textContent();
console.log("17. leads with the lossless option:", primaryLabel.trim(),
  "| promises to keep things:", /keeps everything you already have/.test(upgradeText));
if (!/Add an account/.test(primaryLabel)) {
  problems.push(`a device with data leads with "${primaryLabel.trim()}", expected "Add an account"`);
}
if (!/2 books/.test(upgradeText)) problems.push("the upgrade copy did not count the books at stake");
if (!/place in the shared library/.test(upgradeText)) {
  problems.push("the upgrade copy did not mention the library membership at stake");
}

await OLD.page.fill("#account-email", "kelsey@example.com");
await OLD.page.fill("#account-password", "hunter22");
await OLD.page.click('#account-form [data-intent="create"]');
await OLD.page.waitForTimeout(1400);

const afterUid = await uidOf(OLD.page);
console.log("18. upgrading kept the identity:", beforeUid === afterUid, `(${beforeUid} → ${afterUid})`);
if (beforeUid !== afterUid) {
  problems.push("adding an account changed the uid — everything written anonymously is orphaned");
}

const afterLib = await OLD.page.evaluate(() => localStorage.getItem("shelfie.household.v1"));
console.log("19. still in the shared library:", afterLib === beforeLib);
if (afterLib !== beforeLib) problems.push("adding an account dropped the shared-library membership");

// The member doc is the thing a reinstall is recognised by; it must still be
// this person's, and the account must now remember the library.
const memberDoc = [...cloud.entries()]
  .find(([p, d]) => p.startsWith(`households/${afterLib}/`) && p.includes("/_member:") && d.uid === afterUid);
console.log("20. member entry still theirs:", !!memberDoc);
if (!memberDoc) problems.push("the member entry no longer carries this user's uid after upgrading");

const acctDoc = cloud.get(`users/${afterUid}`);
console.log("21. account remembers the library:", acctDoc?.libId === afterLib,
  "| and the name:", acctDoc?.profileName);
if (acctDoc?.libId !== afterLib) problems.push("the account did not record the shared library");
if (acctDoc?.profileName !== "Kelsey") problems.push("the account did not record the profile name");

await OLD.page.click("#nav-shelves");
await OLD.page.waitForTimeout(800);
const oldBooks = await OLD.page.locator(".grid-book").count();
console.log("22. books all still there:", oldBooks, "(want 2)");
if (oldBooks !== 2) problems.push(`upgrading left ${oldBooks} books, expected 2`);

// And the payoff: a brand-new device signs in and lands in the library
// without anyone approving anything.
const NEWDEV = await window_("newphone");
await openAccount(NEWDEV.page);
await NEWDEV.page.fill("#account-email", "kelsey@example.com");
await NEWDEV.page.fill("#account-password", "hunter22");
await NEWDEV.page.click('#account-form [data-intent="signin"]');
await NEWDEV.page.waitForTimeout(1800);
const newState = await NEWDEV.page.evaluate(() => ({
  lib: localStorage.getItem("shelfie.household.v1"),
  pending: localStorage.getItem("shelfie.pendingJoin.v1"),
  profile: localStorage.getItem("shelfie.profile.v1"),
}));
console.log("23. new device walked into the library:", newState.lib === afterLib,
  "| queued for approval:", !!newState.pending, "| as:", newState.profile);
if (newState.lib !== afterLib) problems.push("signing in on a new device did not restore the shared library");
if (newState.pending) problems.push("a signed-in member was parked in the approval queue");
if (newState.profile !== "Kelsey") problems.push("the new device did not pick up the profile name");

await OLD.ctx.close();
await NEWDEV.ctx.close();
await APP.ctx.close();
await SAFARI.ctx.close();
await browser.close();

if (problems.length) console.log("\nPROBLEMS:\n- " + problems.join("\n- "));
console.log("\nERRORS:", errors.length || problems.length ? [...errors, ...problems] : "none");
