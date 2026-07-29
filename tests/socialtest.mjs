// Following, mutual friendship, the feed, and friends carrying weight in
// Discover. Two phones sharing one mocked Firestore.
import { chromium } from "playwright-core";

const APP_MOCK = "export function initializeApp() { return {}; }";
const FS_MOCK = `
async function rpc(op, args) { return await window.__cloud(op, args); }
export function getFirestore() { return {}; }
export function doc(db, ...p) { return { path: p.join("/") }; }
export function collection(db, ...p) { return { path: p.join("/") }; }
export async function setDoc(ref, data) { await rpc("set", [ref.path, data]); }
export async function getDoc(ref) { const d = await rpc("get", [ref.path]); return { exists: () => d !== null, data: () => d }; }
export async function getDocs(colRef) {
  const rows = await rpc("list", [colRef.path]);
  return { docs: rows.map(([id, data]) => ({ id, data: () => data })) };
}
export async function deleteDoc(ref) { await rpc("del", [ref.path]); }
export function onSnapshot() { return () => {}; }`;

const cloud = new Map();
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

const REC = {
  docs: [
    { key: "/works/FRIENDPICK", title: "The Friend Favourite", author_name: ["Quiet Author"],
      first_publish_year: 2019, ratings_average: 3.6, ratings_count: 4,
      number_of_pages_median: 300, edition_count: 2 },
    { key: "/works/POPULAR", title: "Wildly Popular Stranger Book", author_name: ["Famous Author"],
      first_publish_year: 2018, ratings_average: 4.7, ratings_count: 9000,
      number_of_pages_median: 320, edition_count: 90 },
  ],
};

async function phone(name, books) {
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
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("net::ERR") && !m.text().includes("404")) {
      errors.push(`${name} console: ${m.text()}`);
    }
  });
  await page.route(/googleapis|covers\.openlibrary/, (r) => r.abort());
  await page.route(/gstatic.*firebase-auth/, (r) => r.fulfill({
    body: "export function getAuth() { return { currentUser: null }; }\nexport async function signInAnonymously() { return { user: { uid: \"test-uid\" } }; }",
    contentType: "application/javascript" }));
  await page.route(/gstatic.*firebase-app/, (r) => r.fulfill({ body: APP_MOCK, contentType: "application/javascript" }));
  await page.route(/gstatic.*firebase-firestore/, (r) => r.fulfill({ body: FS_MOCK, contentType: "application/javascript" }));
  // Catch-all first: the last matching route registered is the one that wins.
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));
  await page.route(/openlibrary\.org\/works\/.*\.json/, (r) => r.fulfill({ json: { subjects: ["Fiction"] } }));
  await page.route(/openlibrary\.org\/search\.json/, (r) => r.fulfill({ json: REC }));
  await page.addInitScript(([n, b]) => {
    localStorage.setItem("shelfie.profile.v1", n);
    localStorage.setItem("shelfie.library.v1", JSON.stringify(b));
    localStorage.setItem("shelfie.firebase.v1", JSON.stringify({ projectId: "t", apiKey: "k", appId: "a" }));
  }, [name, books]);
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(900);
  return { ctx, page };
}

const Y = new Date().getFullYear();
const zachBooks = [
  { id: "z1", title: "Shared Taste", authors: ["A"], shelf: "completed", owned: true, coverUrl: null,
    workKey: "/works/SHARED", ratings: { Zach: 5 }, finishedAt: `${Y}-05-01T00:00:00Z`, addedAt: `${Y}-01-01T00:00:00Z` },
  { id: "z2", title: "Another Read", authors: ["B"], shelf: "completed", owned: true, coverUrl: null,
    workKey: "/works/OTHER", ratings: { Zach: 4 }, finishedAt: `${Y}-05-02T00:00:00Z`, addedAt: `${Y}-01-02T00:00:00Z` },
];
const kelseyBooks = [
  { id: "k1", title: "The Friend Favourite", authors: ["Quiet Author"], shelf: "completed", owned: true,
    coverUrl: null, workKey: "/works/FRIENDPICK", ratings: { Kelsey: 5 },
    reviews: { Kelsey: { text: "Absolutely wrecked me. Read it in one sitting.", updatedAt: `${Y}-06-02T00:00:00Z` } },
    finishedAt: `${Y}-06-01T00:00:00Z`, addedAt: `${Y}-01-01T00:00:00Z` },
];

const goFriends = async (page) => {
  await page.click("#settings-btn");
  await page.waitForTimeout(500);
  await page.click('[data-go="friends"]');
  await page.waitForTimeout(700);
};

const zach = await phone("Zach", zachBooks);
const kelsey = await phone("Kelsey", kelseyBooks);

// ---- turning it on ----
await goFriends(zach.page);
console.log("1. Friends starts off, with an explanation:",
  (await zach.page.textContent("#friends-content")).replace(/\s+/g, " ").trim().slice(0, 90));
await zach.page.click("#social-on");
await zach.page.waitForTimeout(900);
const zachCode = (await zach.page.textContent("#my-code")).trim();
console.log("2. Zach gets a code:", zachCode, "| shaped 4×4:", /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(zachCode));

await goFriends(kelsey.page);
await kelsey.page.click("#social-on");
await kelsey.page.waitForTimeout(900);
const kelseyCode = (await kelsey.page.textContent("#my-code")).trim();
console.log("3. Kelsey gets a different code:", kelseyCode !== zachCode);

// ---- one-way follow ----
await zach.page.fill("#follow-code", kelseyCode);
await zach.page.click("#follow-form button");
await zach.page.waitForTimeout(1200);
console.log("4. Zach follows Kelsey:",
  (await zach.page.textContent("#following-list")).replace(/\s+/g, " ").trim().slice(0, 80));

// ---- her reading shows up straight away ----
console.log("5. her reading is in his feed:",
  (await zach.page.textContent("#feed-list")).replace(/\s+/g, " ").trim().slice(0, 150));

// ---- mutual = friends ----
await kelsey.page.fill("#follow-code", zachCode);
await kelsey.page.click("#follow-form button");
await kelsey.page.waitForTimeout(1200);
console.log("6. Kelsey follows back — she sees:",
  (await kelsey.page.$$eval(".friend-list .badge", (e) => e.map((x) => x.textContent.trim()))).join(","));
await goFriends(zach.page);
await zach.page.waitForTimeout(1200);
console.log("7. and so does Zach:",
  (await zach.page.$$eval(".friend-list .badge", (e) => e.map((x) => x.textContent.trim()))).join(","));

// ---- friends outweigh strangers in Discover ----
await zach.page.click("#nav-shelves");
await zach.page.waitForTimeout(400);
await zach.page.click("#discover-btn");
await zach.page.waitForTimeout(3000);
const titles = await zach.page.$$eval("#discover-content .series-title strong", (e) => e.map((x) => x.textContent));
const reasons = await zach.page.$$eval("#discover-content .series-title .muted", (e) => e.map((x) => x.textContent.trim()));
console.log("8. Discover order:", titles);
console.log("9. the friend's book beats the far more popular one:",
  titles.indexOf("The Friend Favourite") < titles.indexOf("Wildly Popular Stranger Book"));
console.log("10. and it says why:", reasons.find((r) => /read this/i.test(r)) ?? "(no name given)");

// ---- new reading reaches the feed ----
await zach.page.click("#nav-shelves");
await kelsey.page.click("#nav-shelves");
await kelsey.page.waitForTimeout(400);
await kelsey.page.click('[data-shelf="owned"]');
await kelsey.page.waitForTimeout(400);
await kelsey.page.evaluate(async (y) => {
  const db = await import("/js/db.js");
  db.addBook({ id: "k2", title: "Just Finished This", authors: ["New Author"], shelf: "completed",
    owned: true, coverUrl: null, workKey: "/works/NEW", ratings: { Kelsey: 4 },
    finishedAt: `${y}-07-01T00:00:00Z` });
  const social = await import("/js/social.js");
  await social.publishMe("Kelsey");
}, Y);
await kelsey.page.waitForTimeout(600);
await goFriends(zach.page);
await zach.page.waitForTimeout(1400);
const feed = (await zach.page.textContent("#feed-list")).replace(/\s+/g, " ").trim();
console.log("11. her new book reached his feed:", feed.includes("Just Finished This"));
console.log("12. newest first:", (await zach.page.$$eval(".feed-book", (e) => e.map((x) => x.textContent.split(" ·")[0]))).join(" | "));

// ---- unfollowing, and turning it off ----
await zach.page.click("[data-unfollow]");
await zach.page.waitForTimeout(1200);
console.log("13. after unfollowing:",
  (await zach.page.textContent("#following-list")).replace(/\s+/g, " ").trim().slice(0, 60));
await zach.page.click("#social-off");
await zach.page.waitForTimeout(700);
console.log("14. switching off returns to the intro:",
  await zach.page.isVisible("#social-on"));

// ---- a mistyped code is handled ----
await zach.page.click("#social-on");
await zach.page.waitForTimeout(800);
await zach.page.fill("#follow-code", "ABCD-EFGH-JKLM-NPQR");
await zach.page.click("#follow-form button");
await zach.page.waitForTimeout(1200);
console.log("15. unknown code says so:", (await zach.page.textContent("#follow-msg")).trim());
await zach.page.fill("#follow-code", "TOOSHORT");
await zach.page.click("#follow-form button");
await zach.page.waitForTimeout(500);
console.log("16. short code says so:", (await zach.page.textContent("#follow-msg")).trim());
await zach.page.fill("#follow-code", zachCode);
await zach.page.click("#follow-form button");
await zach.page.waitForTimeout(500);
console.log("17. own code refused:", (await zach.page.textContent("#follow-msg")).trim());

// ---- nothing leaks when it's off ----
const kelseyDoc = [...cloud.entries()].find(([k]) => k.includes("_social/signals"));
console.log("18. what a reader doc holds:", Object.keys(kelseyDoc[1]).sort().join(", "));
console.log("19. no shelf contents beyond finished/rated:",
  kelseyDoc[1].recent.every((r) => r.title && "rating" in r));

await goFriends(kelsey.page);
await kelsey.page.waitForTimeout(1400);
await kelsey.page.screenshot({ path: "friends.png", fullPage: true });

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
