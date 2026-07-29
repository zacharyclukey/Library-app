// Round 5 — two phones on one shared library, with the new repair() pass now
// sitting on the path that applies remote data. Nothing may be dropped,
// duplicated, or mangled in transit.
import { chromium } from "playwright-core";

const APP_MOCK = "export function initializeApp() { return {}; }";
const FS_MOCK = `
async function rpc(op, args) { return await window.__cloud(op, args); }
let listeners = [];
export function getFirestore() { return {}; }
export function doc(db, ...p) { return { path: p.join("/") }; }
export function collection(db, ...p) { return { path: p.join("/") }; }
export async function setDoc(ref, data) { await rpc("set", [ref.path, data]); await pump(); }
export async function getDoc(ref) { const d = await rpc("get", [ref.path]); return { exists: () => d !== null, data: () => d }; }
export async function getDocs(colRef) {
  const rows = await rpc("list", [colRef.path]);
  return { docs: rows.map(([id, data]) => ({ id, data: () => data })) };
}
export async function deleteDoc(ref) { await rpc("del", [ref.path]); await pump(); }
export function onSnapshot(colRef, next) {
  const l = { path: colRef.path, next };
  listeners.push(l);
  pump();
  return () => { listeners = listeners.filter((x) => x !== l); };
}
async function pump() {
  for (const l of listeners) {
    const rows = await rpc("list", [l.path]);
    l.next({ docs: rows.map(([id, data]) => ({ id, data: () => data })) });
  }
}
setInterval(pump, 400);`;

const cloud = new Map();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

async function phone(label, books, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.exposeFunction("__cloud", (op, [path, data]) => {
    if (op === "set") { cloud.set(path, data); return null; }
    if (op === "get") return cloud.get(path) ?? null;
    if (op === "del") { cloud.delete(path); return null; }
    return [...cloud.entries()]
      .filter(([p]) => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/"))
      .map(([p, d]) => [p.slice(path.length + 1), d]);
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) errors.push(`${label} console: ${m.text()}`);
  });
  await page.route(/openlibrary|googleapis|covers/, (r) => r.abort());
  await page.route(/gstatic.*firebase-auth/, (r) => r.fulfill({
    body: "export function getAuth() { return { currentUser: null }; }\nexport async function signInAnonymously() { return { user: { uid: \"test-uid\" } }; }",
    contentType: "application/javascript" }));
  await page.route(/gstatic.*firebase-app/, (r) => r.fulfill({ body: APP_MOCK, contentType: "application/javascript" }));
  await page.route(/gstatic.*firebase-firestore/, (r) => r.fulfill({ body: FS_MOCK, contentType: "application/javascript" }));
  await page.addInitScript(([name, b, x]) => {
    localStorage.setItem("shelfie.profile.v1", name);
    localStorage.setItem("shelfie.library.v1", JSON.stringify(b));
    localStorage.setItem("shelfie.household.v1", "nl_testlibrary");
    localStorage.setItem("shelfie.householdName.v1", "Test House");
    localStorage.setItem("shelfie.firebase.v1", JSON.stringify({ projectId: "test", apiKey: "k", appId: "a" }));
    for (const [k, v] of Object.entries(x)) localStorage.setItem(k, v);
  }, [label, books, extra]);
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(1200);
  return { ctx, page };
}

const titles = (page) => page.$$eval(".grid-title", (e) => e.map((x) => x.textContent).sort());

// Zach starts with clean books; Kelsey's phone holds a couple of MALFORMED
// records — the kind a bad import or an old app version would leave behind.
const zachBooks = [
  { id: "z1", title: "Zach Book One", authors: ["A"], shelf: "owned", owned: true,
    coverUrl: null, pageCount: 300, addedAt: "2026-01-01T00:00:00Z" },
  { id: "z2", title: "Zach Book Two", authors: ["B"], shelf: "owned", owned: true,
    coverUrl: null, pageCount: 200, addedAt: "2026-01-02T00:00:00Z" },
];

const zach = await phone("Zach", zachBooks);
console.log("1. Zach's shelf:", await titles(zach.page));
console.log("2. cloud seeded from the phone:",
  [...cloud.keys()].filter((k) => k.includes("/books/")).length, "docs");

const kelsey = await phone("Kelsey", []);
await kelsey.page.waitForTimeout(1500);
console.log("3. Kelsey receives Zach's library:", await titles(kelsey.page));

// Kelsey adds a book with an id Firestore would reject as a doc path.
await kelsey.page.evaluate(async () => {
  const db = await import("/js/db.js");
  db.addBook({ id: "weird/id:with slash", title: "Slashy Title", authors: ["K"],
    shelf: "owned", owned: true, coverUrl: null, addedAt: "2026-02-01T00:00:00Z" });
});
await kelsey.page.waitForTimeout(1800);
await zach.page.waitForTimeout(1200);
console.log("4. awkward id synced to Zach:", await titles(zach.page));

// Kelsey's phone gets a malformed record locally, then syncs it up.
await kelsey.page.evaluate(async () => {
  const db = await import("/js/db.js");
  db.addBook({ id: "k-bad", title: 777, authors: "Just A String", shelf: "nonsense",
    pageCount: "lots", series: { name: 12, position: "1" }, coverUrl: null });
});
await kelsey.page.waitForTimeout(1800);
await zach.page.waitForTimeout(1200);
console.log("5. malformed record arrives repaired on Zach:", await titles(zach.page));
console.log("   Zach's copy of it:", await zach.page.evaluate(() =>
  JSON.stringify(JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "k-bad"))));

// Zach rates a book; Kelsey should see it without losing her own rating.
await zach.page.click('.grid-book[data-id="z1"] [data-flip]');
await zach.page.waitForTimeout(400);
await zach.page.click('.grid-book[data-id="z1"] [data-qa-rate="5"]');
await zach.page.waitForTimeout(1800);
await kelsey.page.waitForTimeout(1200);
console.log("6. Zach's rating reached Kelsey:", await kelsey.page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "z1")?.ratings));

// Kelsey deletes a book; it must disappear on Zach's phone, not come back.
await kelsey.page.click('.grid-book[data-id="z2"]');
await kelsey.page.waitForTimeout(600);
await kelsey.page.click("[data-delete]");
await kelsey.page.waitForTimeout(2000);
await zach.page.waitForTimeout(1500);
console.log("7. delete propagated:", await titles(zach.page));

// Neither phone should have grown duplicates through all of that.
for (const [name, p] of [["Zach", zach.page], ["Kelsey", kelsey.page]]) {
  const dupes = await p.evaluate(() => {
    const ids = JSON.parse(localStorage.getItem("shelfie.library.v1")).map((b) => b.id);
    return ids.length - new Set(ids).size;
  });
  console.log(`8. ${name}: duplicate records =`, dupes);
}
console.log("9. cloud book docs:", [...cloud.keys()].filter((k) => k.includes("/books/")).length,
  [...cloud.keys()].filter((k) => k.includes("/books/")).map((k) => k.split("/books/")[1]));

// Sort choice is per device — it must not have leaked through sync.
await zach.page.click("#filter-toggle");
await zach.page.click('#filter-panel [data-sort="series"]');
await zach.page.waitForTimeout(600);
await kelsey.page.waitForTimeout(1200);
console.log("10. Kelsey's sort unaffected by Zach's:", await kelsey.page.evaluate(() =>
  localStorage.getItem("shelfie.shelfSort.v1")), "| Zach:", await zach.page.evaluate(() =>
  localStorage.getItem("shelfie.shelfSort.v1")));

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
