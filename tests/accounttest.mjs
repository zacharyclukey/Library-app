// The account layer: linking an email to a membership, and a fresh install
// signing back in and being recognised without anyone tapping Approve.
//
// The scenario this exists to prevent: one phone is the only approved member
// of a shared library. The phone's home-screen app is deleted (which on iOS
// deletes its whole storage container, anonymous uid included). The reinstall
// asks to join and lands in "waiting for approval" — but the only device that
// could approve is the one that was just wiped. Locked out of your own
// library.
//
// Three phones against one mocked Firestore + auth registry:
//   A — creates the library, links an email. Its member doc gains a uid.
//   B — a "reinstall": fresh storage, signs in with the email, joins with the
//       library name + password, and must be let straight in. No approval.
//   C — a stranger with the name + password but no account: must still land
//       in the normal approval queue. Recognition must not weaken the door.

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
// One snapshot, delivered async with whatever the collection holds. Enough
// for start() to announce the device as a member, which is what stamps the
// uid this suite is all about.
export function onSnapshot(colRef, cb, onErr) {
  let cancelled = false;
  (async () => {
    try {
      const rows = await rpc("list", [colRef.path]);
      if (!cancelled) cb({ docs: rows.map(([id, data]) => ({ id, data: () => data })) });
    } catch (e) { onErr?.(e); }
  })();
  return () => { cancelled = true; };
}`;

// Auth with a shared account registry. linkWithCredential keeps the uid —
// that's the property the whole feature rests on — and signInWithEmailAndPassword
// returns whatever uid the email was linked to.
const AUTH_MOCK = `
async function rpc(op, args) { return await window.__auth(op, args); }
let current = null;
export function getAuth() { return { get currentUser() { return current; } }; }
export async function signInAnonymously() {
  // Real Firebase persists the anonymous user in IndexedDB, so a reload gets
  // the SAME uid back. The mock must match, or it invents a fresh identity
  // on every boot and understates what reality guarantees.
  let uid = localStorage.getItem("__mockAnonUid");
  if (!uid) { uid = await rpc("anon", []); localStorage.setItem("__mockAnonUid", uid); }
  current = { uid, email: null };
  return { user: current };
}
export const EmailAuthProvider = { credential: (email, password) => ({ email, password }) };
export async function linkWithCredential(user, cred) {
  const out = await rpc("link", [user.uid, cred.email, cred.password]);
  if (out.error) { const e = new Error(out.error); e.code = out.error; throw e; }
  current = { uid: user.uid, email: cred.email };
  return { user: current };
}
export async function signInWithEmailAndPassword(auth, email, password) {
  const out = await rpc("signin", [email, password]);
  if (out.error) { const e = new Error(out.error); e.code = out.error; throw e; }
  current = { uid: out.uid, email };
  return { user: current };
}`;

const cloud = new Map();
const accounts = new Map(); // email -> { password, uid }
let anonCount = 0;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
const problems = [];

async function phone(name, books = []) {
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
    if (op === "anon") return `anon-${name}-${++anonCount}`;
    if (op === "link") {
      const [, email, password] = args;
      if (accounts.has(email)) return { error: "auth/email-already-in-use" };
      accounts.set(email, { password, uid: args[0] });
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
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("net::ERR") && !msg.text().includes("404")) {
      errors.push(`${name} console: ${msg.text()}`);
    }
  });
  await page.route(/googleapis|covers\.openlibrary/, (r) => r.abort());
  await page.route(/gstatic.*firebase-auth/, (r) => r.fulfill({ body: AUTH_MOCK, contentType: "application/javascript" }));
  await page.route(/gstatic.*firebase-app/, (r) => r.fulfill({ body: APP_MOCK, contentType: "application/javascript" }));
  await page.route(/gstatic.*firebase-firestore/, (r) => r.fulfill({ body: FS_MOCK, contentType: "application/javascript" }));
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));
  await page.addInitScript(({ who, seed }) => {
    localStorage.setItem("shelfie.profile.v1", who);
    localStorage.setItem("shelfie.library.v1", JSON.stringify(seed));
  }, { who: name, seed: books });
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(700);
  return { ctx, page };
}

async function openSyncScreen(page) {
  await page.click("#settings-btn");
  await page.waitForTimeout(400);
  await page.click('.settings-row[data-go="sync"]');
  await page.waitForTimeout(700);
}

// ---------- Phone A: create the library, link an email ----------
const A = await phone("Zach", [
  { id: "b1", title: "Piranesi", authors: ["Susanna Clarke"], shelf: "owned",
    owned: true, addedAt: "2025-01-01T00:00:00Z" },
]);
await openSyncScreen(A.page);
await A.page.fill("#library-name", "Lukey Library");
await A.page.fill("#library-password", "swordfish99");
await A.page.click('[data-intent="create"]');
await A.page.waitForTimeout(900);

const activeA = await A.page.locator("#sync-content").textContent();
console.log("1. A created the library:", /Sharing is/.test(activeA));
if (!/Sharing is/.test(activeA)) problems.push("phone A did not end up in an active library");

console.log("2. A is offered the link form:", await A.page.locator("#link-account-form").count() === 1);
if (await A.page.locator("#link-account-form").count() !== 1) {
  problems.push("no link-account form on the active sync screen");
}

await A.page.fill("#link-email", "zach@example.com");
await A.page.fill("#link-password", "hunter22");
await A.page.click("#link-account-form button[type=submit]");
await A.page.waitForTimeout(600);
const linkedText = await A.page.locator("#sync-content").textContent();
console.log("3. linked state shown:", /zach@example\.com/.test(linkedText));
if (!/zach@example\.com/.test(linkedText)) problems.push("linking did not stick in the UI");

const memberDocs = [...cloud.entries()].filter(([p]) => p.includes("/_member:"));
const stamped = memberDocs.filter(([, d]) => d.uid);
console.log("4. member docs:", memberDocs.length, "| carrying a uid:", stamped.length);
if (!stamped.length) problems.push("member doc was never stamped with a uid");
const zachUid = stamped[0]?.[1]?.uid;
console.log("   A's uid on record:", zachUid);
if (accounts.get("zach@example.com")?.uid !== zachUid) {
  problems.push("linking changed the uid — the one bug this feature must never have");
}

// ---------- Phone B: the reinstall. Fresh storage, same person ----------
const B = await phone("Zach");
await openSyncScreen(B.page);
await B.page.waitForTimeout(600); // warmup() → re-render with the sign-in form
console.log("5. fresh device is offered sign-in:", await B.page.locator("#signin-form").count() === 1);
if (await B.page.locator("#signin-form").count() !== 1) {
  problems.push("no sign-in form on a fresh device's join screen");
}

await B.page.fill("#signin-email", "zach@example.com");
await B.page.fill("#signin-password", "hunter22");
await B.page.click("#signin-form button[type=submit]");
await B.page.waitForTimeout(600);

await B.page.fill("#library-name", "Lukey Library");
await B.page.fill("#library-password", "swordfish99");
await B.page.click('[data-intent="join"]');
await B.page.waitForTimeout(1000);

const bState = await B.page.evaluate(() => ({
  household: localStorage.getItem("shelfie.household.v1"),
  pending: localStorage.getItem("shelfie.pendingJoin.v1"),
}));
console.log("6. B joined instantly:", !!bState.household, "| stuck pending:", !!bState.pending);
if (!bState.household) problems.push("signed-in reinstall was not let into the library");
if (bState.pending) problems.push("signed-in reinstall was parked in the approval queue");
const joinDocsAfterB = [...cloud.keys()].filter((p) => p.includes("/_join:"));
console.log("7. join-request docs after B:", joinDocsAfterB.length);
if (joinDocsAfterB.length) problems.push("recognised member still wrote a join request");

// ---------- Phone C: a stranger with the password but no account ----------
const C = await phone("Mallory");
await openSyncScreen(C.page);
await C.page.waitForTimeout(600);
await C.page.fill("#library-name", "Lukey Library");
await C.page.fill("#library-password", "swordfish99");
await C.page.click('[data-intent="join"]');
await C.page.waitForTimeout(1000);

const cState = await C.page.evaluate(() => ({
  household: localStorage.getItem("shelfie.household.v1"),
  pending: localStorage.getItem("shelfie.pendingJoin.v1"),
}));
const waiting = await C.page.locator("#sync-content").textContent();
console.log("8. stranger still queues for approval:", !!cState.pending && !cState.household,
  "| waiting screen:", /Waiting for approval/.test(waiting));
if (cState.household) problems.push("a device with no account skipped the approval queue");
if (!cState.pending) problems.push("stranger's join produced neither membership nor a pending request");

// ---------- wrong password on sign-in fails politely ----------
const D = await phone("Zach2");
await openSyncScreen(D.page);
await D.page.waitForTimeout(600);
await D.page.fill("#signin-email", "zach@example.com");
await D.page.fill("#signin-password", "wrong");
await D.page.click("#signin-form button[type=submit]");
await D.page.waitForTimeout(500);
const toast = await D.page.locator("#toast-region").textContent();
console.log("9. wrong password says so:", /No sign-in matches/.test(toast));
if (!/No sign-in matches/.test(toast)) problems.push("wrong password did not produce the friendly error");

// ---------- The migration case: a household that predates accounts ----------
// Existing users' member docs were written before the uid field existed. The
// fix must reach them with no ceremony: opening the updated app once re-stamps
// the doc (announceMember runs on every boot), and only then do they link.
// Simulated here by creating a library, then stripping the uid stamps out of
// the cloud — the exact shape an old household is in on upgrade day.

const E = await phone("Existing", [
  { id: "e1", title: "The Fifth Season", authors: ["N. K. Jemisin"], shelf: "owned",
    owned: true, addedAt: "2024-06-01T00:00:00Z" },
  { id: "e2", title: "Circe", authors: ["Madeline Miller"], shelf: "owned",
    owned: true, addedAt: "2024-06-02T00:00:00Z" },
]);
await openSyncScreen(E.page);
await E.page.fill("#library-name", "Old Household");
await E.page.fill("#library-password", "longmarriage");
await E.page.click('[data-intent="create"]');
await E.page.waitForTimeout(900);
const oldLibId = await E.page.evaluate(() => localStorage.getItem("shelfie.household.v1"));

// Rewind THIS household's cloud docs to the pre-account format: no uid on
// any member doc, and a partner device that has never seen the new code.
// (Scoped to oldLibId — the cloud Map is shared with the earlier scenarios,
// and rewriting their library under them would test nothing but confusion.)
for (const [path, data] of cloud.entries()) {
  if (path.startsWith(`households/${oldLibId}/`) && path.includes("/_member:") && data.uid) {
    const { uid: _dropped, ...old } = data;
    cloud.set(path, old);
  }
}
cloud.set(`households/${oldLibId}/books/_member:kelsey-dev`, {
  _member: true, deviceId: "kelsey-dev", name: "Kelsey",
  joinedAt: "2024-06-01T00:00:00Z", lastSeen: "2025-08-01T00:00:00Z",
});
cloud.set(`households/${oldLibId}/books/k1`, {
  id: "k1", title: "Book Lovers", authors: ["Emily Henry"], shelf: "owned",
  owned: true, addedAt: "2024-07-01T00:00:00Z",
});

// Upgrade day: the existing phone just opens the app. No taps.
await E.page.reload();
await E.page.waitForTimeout(1200);
const eDoc = [...cloud.entries()].find(([p]) =>
  p.startsWith(`households/${oldLibId}/`) && p.includes("/_member:") && !p.endsWith("kelsey-dev"))?.[1];
console.log("10. old member doc healed on boot:", !!eDoc?.uid);
if (!eDoc?.uid) problems.push("existing member's doc was not re-stamped with a uid on boot");

// Now they link, as an existing user would.
await openSyncScreen(E.page);
await E.page.fill("#link-email", "existing@example.com");
await E.page.fill("#link-password", "hunter22");
await E.page.click("#link-account-form button[type=submit]");
await E.page.waitForTimeout(600);
console.log("11. existing user linked, uid unchanged:",
  accounts.get("existing@example.com")?.uid === eDoc.uid);
if (accounts.get("existing@example.com")?.uid !== eDoc.uid) {
  problems.push("linking on an existing account changed the uid");
}

// The reinstall: fresh storage, sign in, join — should walk straight in and
// see the WHOLE shared shelf, the partner's book included.
const F = await phone("Existing");
await openSyncScreen(F.page);
await F.page.waitForTimeout(600);
await F.page.fill("#signin-email", "existing@example.com");
await F.page.fill("#signin-password", "hunter22");
await F.page.click("#signin-form button[type=submit]");
await F.page.waitForTimeout(600);
await F.page.fill("#library-name", "Old Household");
await F.page.fill("#library-password", "longmarriage");
await F.page.click('[data-intent="join"]');
await F.page.waitForTimeout(1000);
const fState = await F.page.evaluate(() => ({
  household: localStorage.getItem("shelfie.household.v1"),
  pending: localStorage.getItem("shelfie.pendingJoin.v1"),
}));
console.log("12. reinstall recognised in old household:", !!fState.household && !fState.pending);
if (!fState.household || fState.pending) {
  problems.push("reinstall into a pre-account household was not recognised");
}
await F.page.click("#nav-shelves");
await F.page.waitForTimeout(800);
const fBooks = await F.page.locator(".grid-book").count();
console.log("13. reinstall sees the shared shelf:", fBooks, "books (want 3)");
if (fBooks !== 3) problems.push(`reinstall shows ${fBooks} books, expected 3 (both partners')`);

// And the partner who never touched any of this is undisturbed.
const kelseyDoc = cloud.get(`households/${oldLibId}/books/_member:kelsey-dev`);
const kelseyBook = cloud.get(`households/${oldLibId}/books/k1`);
console.log("14. partner untouched:", !!kelseyDoc && !!kelseyBook);
if (!kelseyDoc || !kelseyBook) problems.push("the partner's membership or books were disturbed");

await A.ctx.close(); await B.ctx.close(); await C.ctx.close(); await D.ctx.close();
await E.ctx.close(); await F.ctx.close();
await browser.close();

if (problems.length) console.log("\nPROBLEMS:\n- " + problems.join("\n- "));
console.log("\nERRORS:", errors.length || problems.length ? [...errors, ...problems] : "none");
