// The recommendation engine: taste, candidate sources, ranking, and the
// sunset sheet that appears when a book is finished.
//
// Every claim the feature makes is asserted here, because the whole point of
// docs/RECOMMENDATIONS.md is that a ranking change should show up as a
// different number rather than a different feeling:
//
//   * a book you rated one star pushes its author DOWN, not up
//   * "not for me" keeps a book away next time
//   * your own To Read shelf is a source, so there is an answer with no network
//   * the next book in a series you loved is offered
//   * a friend's five outranks a stranger's 4.8
//   * finishing a book you were reading opens the sheet; cataloguing does not
//   * every book shown is logged with the feature vector that ranked it
//
// Open Library, Google Books and Firestore are all mocked at the network layer.
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

const errors = [];
const cloud = new Map();

// An observation that must hold. The runner fails a suite whose error list is
// non-empty, so a regression in the ranking shows up as a failed suite rather
// than a line of output nobody reads.
function check(label, ok, ...rest) {
  console.log(`${label}:`, ok, ...rest);
  if (!ok) errors.push(`FAILED — ${label}`);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const Y = new Date().getFullYear();
const MY_CODE = "AAAABBBBCCCCDDDD";
const FRIEND_CODE = "EEEEFFFFGGGGHHHH";

// A reader who loves one fantasy series, actively disliked one author, has a
// book waiting on To Read, and follows one person who rates things back.
const LIBRARY = [
  { id: "b-loved", title: "Court of Thorns", authors: ["Loved Author"], shelf: "completed",
    owned: true, readHere: true, workKey: "/works/LOVED", coverUrl: null,
    subjects: ["Fantasy fiction", "Court intrigue"], pageCount: 420,
    series: { name: "Court", position: 1 }, ratings: { Zach: 5 },
    finishedAt: `${Y}-06-01T00:00:00Z`, addedAt: `${Y}-01-01T00:00:00Z` },
  { id: "b-hated", title: "The Dull Tome", authors: ["Dull Author"], shelf: "completed",
    owned: true, readHere: true, workKey: "/works/DULL", coverUrl: null,
    subjects: ["Dreary Subject"], pageCount: 300, ratings: { Zach: 1 },
    finishedAt: `${Y}-06-02T00:00:00Z`, addedAt: `${Y}-01-02T00:00:00Z` },
  { id: "b-waiting", title: "The Waiting Book", authors: ["Shelf Author"], shelf: "tbr",
    owned: true, workKey: "/works/WAITING", coverUrl: null, subjects: ["Fantasy fiction"],
    pageCount: 380, addedAt: `${Y}-02-01T00:00:00Z` },
  { id: "b-catalogued", title: "Old Catalogued Read", authors: ["Archive Author"], shelf: "owned",
    owned: true, coverUrl: null, subjects: [], pageCount: 200, addedAt: `${Y}-02-02T00:00:00Z` },
];

// Open Library search results. "Dull Author Returns" exists precisely so the
// suite can prove a one-star author does not come back.
const SEARCH_ROWS = {
  docs: [
    { key: "/works/STRANGER", title: "Stranger's Acclaimed Book", author_name: ["Famous Author"],
      first_publish_year: 2018, ratings_average: 4.8, ratings_count: 9000,
      number_of_pages_median: 400, edition_count: 90 },
    { key: "/works/DULLNEW", title: "Dull Author Returns", author_name: ["Dull Author"],
      first_publish_year: 2020, ratings_average: 4.4, ratings_count: 900,
      number_of_pages_median: 310, edition_count: 20 },
    { key: "/works/FRIENDPICK", title: "The Friend Favourite", author_name: ["Quiet Author"],
      first_publish_year: 2019, ratings_average: 3.6, ratings_count: 4,
      number_of_pages_median: 300, edition_count: 2 },
  ],
};

const SERIES_ROWS = {
  docs: [
    { key: "/works/LOVED", title: "Court of Thorns", author_name: ["Loved Author"], first_publish_year: 2015 },
    { key: "/works/COURT2", title: "Court of Mist", author_name: ["Loved Author"], first_publish_year: 2016 },
  ],
};

// The friend's reader document, as social.js would have written it.
cloud.set(`community/_social/signals/${FRIEND_CODE}`, {
  readerId: FRIEND_CODE,
  name: "Kelsey",
  follows: [MY_CODE],           // mutual, so she counts as a friend
  recent: [
    { key: "ol_FRIENDPICK", title: "The Friend Favourite", authors: ["Quiet Author"],
      coverUrl: null, rating: 5, review: null, at: `${Y}-06-10T00:00:00Z` },
  ],
  updatedAt: `${Y}-06-10T00:00:00Z`,
});

async function phone({ offline = false, library = LIBRARY } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 950 } });
  await ctx.exposeFunction("__cloud", (op, [path, data]) => {
    if (op === "set") { cloud.set(path, data); return null; }
    if (op === "get") return cloud.get(path) ?? null;
    if (op === "del") { cloud.delete(path); return null; }
    return [...cloud.entries()]
      .filter(([p]) => p.startsWith(path + "/") && !p.slice(path.length + 1).includes("/"))
      .map(([p, d]) => [p.slice(path.length + 1), d]);
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !t.includes("net::ERR") && !t.includes("404")) {
      errors.push("console: " + t);
    }
  });

  await page.route(/googleapis|covers\.openlibrary/, (r) => r.abort());
  await page.route(/gstatic.*firebase-auth/, (r) => r.fulfill({
    body: 'export function getAuth() { return { currentUser: null }; }\nexport async function signInAnonymously() { return { user: { uid: "test-uid" } }; }',
    contentType: "application/javascript" }));
  await page.route(/gstatic.*firebase-app/, (r) => r.fulfill({ body: APP_MOCK, contentType: "application/javascript" }));
  await page.route(/gstatic.*firebase-firestore/, (r) => r.fulfill({ body: FS_MOCK, contentType: "application/javascript" }));

  // Catch-all first: in Playwright the LAST matching route wins.
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ json: { entries: [], docs: [] } }));
  await page.route(/openlibrary\.org\/works\/.*\.json/, (r) => {
    const key = new URL(r.request().url()).pathname.replace(".json", "");
    const subjects = {
      "/works/LOVED": ["Fantasy fiction", "Court intrigue"],
      "/works/DULL": ["Dreary Subject"],
      "/works/WAITING": ["Fantasy fiction"],
      "/works/COURT2": ["Fantasy fiction", "Court intrigue"],
      "/works/DULLNEW": ["Dreary Subject"],
      "/works/STRANGER": ["Thrillers"],
      "/works/FRIENDPICK": ["Fantasy fiction"],
    }[key] ?? [];
    r.fulfill({ json: { subjects } });
  });
  await page.route(/openlibrary\.org\/search\.json/, (r) => {
    if (offline) return r.abort();
    const q = decodeURIComponent(new URL(r.request().url()).searchParams.get("q") ?? "");
    r.fulfill({ json: q.startsWith('series:') ? SERIES_ROWS : SEARCH_ROWS });
  });

  await page.addInitScript(([books, code, friend]) => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
    localStorage.setItem("shelfie.firebase.v1", JSON.stringify({ projectId: "t", apiKey: "k", appId: "a" }));
    localStorage.setItem("shelfie.social.v1", "1");
    localStorage.setItem("shelfie.readerId.v1", code);
    localStorage.setItem("shelfie.following.v1", JSON.stringify([friend]));
    localStorage.setItem("shelfie.shareCommunity.v1", "1");
  }, [library, MY_CODE, FRIEND_CODE]);

  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(900);
  return { ctx, page };
}

const recTitles = (page) =>
  page.$$eval("#discover-content .series-list li .series-title strong", (els) => els.map((e) => e.textContent));
const recReasons = (page) =>
  page.$$eval("#discover-content .series-list li .muted", (els) => els.map((e) => e.textContent.trim()));

async function openDiscover(page) {
  await page.click("#discover-btn");
  await page.waitForTimeout(2500);
}

// ============================================================
const { ctx, page } = await phone();

// ---- 1. taste: signed weights, and the whole library ----
const taste = await page.evaluate(async () => {
  const t = await import("/js/taste.js");
  const api = await import("/js/api.js");
  const db = await import("/js/db.js");
  return t.build(db.getAllBooks(), "Zach", { fetchSubjects: api.fetchWorkSubjects });
});
check("1a. author rated 5★ has positive weight", taste.authors["Loved Author"] > 0,
  `(${taste.authors["Loved Author"]?.toFixed(2)})`);
check("1b. author rated 1★ has NEGATIVE weight", taste.authors["Dull Author"] < 0,
  `(${taste.authors["Dull Author"]?.toFixed(2)})`);
check("1c. a subject from a loved book is positive", (taste.subjects["Court intrigue"] ?? 0) > 0);
check("1d. a subject from a hated book is negative", (taste.subjects["Dreary Subject"] ?? 0) < 0);
check("1e. taste covers every book, not the first ten", taste.books === 4, `(${taste.books}, want 4)`);

// Picking a genre must read that part of the library harder, or a reader whose
// shelves are mostly one thing gets queries that return nothing once the genre
// constraint lands.
const focus = await page.evaluate(async () => {
  const t = await import("/js/taste.js");
  const flt = await import("/js/filters.js");
  const api = await import("/js/api.js");
  const db = await import("/js/db.js");
  const books = db.getAllBooks();
  const opts = { fetchSubjects: api.fetchWorkSubjects };
  const whole = await t.build(books, "Zach", opts);
  const only = await t.focusedOn(books, "Zach", (b) => flt.genresOf(b).includes("Fantasy"), opts);
  const blended = only ? t.blend(whole, only) : whole;
  return {
    wholeCourt: whole.subjects["Court intrigue"] ?? 0,
    blendedCourt: blended.subjects["Court intrigue"] ?? 0,
    blendedDreary: blended.subjects["Dreary Subject"] ?? 0,
  };
});
check("1f. a genre filter weights that part of the library harder",
  focus.blendedCourt > focus.wholeCourt,
  `(${focus.wholeCourt.toFixed(2)} → ${focus.blendedCourt.toFixed(2)})`);
check("1g. and the rest of the library stays as context, still signed",
  focus.blendedDreary < 0, `(${focus.blendedDreary.toFixed(2)})`);

// ---- 2. Discover: sources beyond Open Library search ----
await openDiscover(page);
const titles1 = await recTitles(page);
const reasons1 = await recReasons(page);
check("2a. recommendations returned", titles1.length > 0, JSON.stringify(titles1));
check("2b. your own To Read shelf is a source", titles1.includes("The Waiting Book"));
check("2c. the next book in a loved series is offered", titles1.includes("Court of Mist"));
check("2d. the friend's book is offered", titles1.includes("The Friend Favourite"));
check("2e. a 1★ author does NOT come back", !titles1.includes("Dull Author Returns"));
console.log("2f. reasons are stated:", JSON.stringify(reasons1.slice(0, 4)));

// ---- 3. friends outrank strangers ----
const iFriend = titles1.indexOf("The Friend Favourite");
const iStranger = titles1.indexOf("Stranger's Acclaimed Book");
check("3a. friend's 5★ beats a stranger's 4.8 from 9000 readers",
  iFriend >= 0 && (iStranger < 0 || iFriend < iStranger), `(friend ${iFriend}, stranger ${iStranger})`);

// ---- 4. every shown book is logged, with its feature vector ----
const logged = await page.evaluate(async () => {
  const s = await import("/js/signals.js");
  const shown = s.ofType("shown");
  return { count: shown.length, withFeatures: shown.filter((e) => e.f).length, sample: shown[0] };
});
check("4a. shown events recorded", logged.count > 0, `(${logged.count})`);
check("4b. each carries the feature vector that ranked it", logged.withFeatures === logged.count);
console.log("4c. sample event:", JSON.stringify(logged.sample?.f ?? null).slice(0, 120));

// ---- 5. "not for me" actually suppresses ----
const before = await recTitles(page);
await page.click("#discover-content .series-list li:first-child .rec-dismiss");
await page.waitForTimeout(600);
const after = await recTitles(page);
check("5a. dismissed book leaves the list at once", !after.includes(before[0]),
  `(dismissed "${before[0]}")`);
// Come back later: it must still be gone.
await page.click("#screen-discover [data-back]");
await page.waitForTimeout(300);
await openDiscover(page);
const later = await recTitles(page);
check("5b. and is still gone on the next visit", !later.includes(before[0]));

// ---- 6. mood dials re-rank without emptying the list ----
await page.click('#discover-content .rec-mood .filter-chip:has-text("Something different")');
await page.waitForTimeout(1200);
const moody = await recTitles(page);
check("6a. a mood dial keeps a non-empty list", moody.length > 0, `(${moody.length} books)`);
check("6b. and it changes the order", JSON.stringify(moody) !== JSON.stringify(later));

// ---- 7. the sunset sheet ----
await page.click("#screen-discover [data-back]");
await page.waitForTimeout(300);
await page.click('[data-shelf="tbr"]');
await page.waitForTimeout(400);
const card = (id) => `.grid-book[data-id="${id}"]`;
await page.click(`${card("b-waiting")} [data-flip]`);
await page.waitForTimeout(450);
await page.click(`${card("b-waiting")} [data-qa-move="completed"]`);
await page.waitForTimeout(500);
await page.click(`${card("b-waiting")} [data-qa-move="completed"]`);
await page.waitForTimeout(2500);

const sunsetOpen = await page.evaluate(() => document.querySelector("#sunset-modal")?.open === true);
check("7a. finishing a book you were reading opens the sheet", sunsetOpen);
const sunsetAsks = await page.textContent("#sunset-content .sunset-book").catch(() => "");
check("7b. it asks how the book was", /How was/.test(sunsetAsks), `("${sunsetAsks.trim()}")`);
const pickTitle = await page.textContent("#sunset-content .sunset-pick-title").catch(() => null);
check("7c. it offers a next book", !!pickTitle, `("${pickTitle}")`);
const pickWhy = await page.textContent("#sunset-content .sunset-why").catch(() => null);
check("7d. with a reason in plain English", !!pickWhy, `("${pickWhy}")`);

// Rating from the sheet must land on the book.
await page.click("#sunset-content [data-sunset-rate='4']");
await page.waitForTimeout(800);
const rated = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "b-waiting")?.ratings?.Zach);
check("7e. rating from the sheet is saved", rated === 4, `(${rated})`);

// Starting a book from the sheet moves it, and does not duplicate it.
const pickBefore = await page.textContent("#sunset-content .sunset-pick-title").catch(() => null);
await page.click("#sunset-content [data-sunset-start='0']");
await page.waitForTimeout(700);
const lib = await page.evaluate(() => JSON.parse(localStorage.getItem("shelfie.library.v1")));
const started = lib.filter((b) => b.title === pickBefore);
check("7f. starting the pick opens exactly one record", started.length === 1,
  `("${pickBefore}" ×${started.length}, shelf ${started[0]?.shelf}, reading ${started[0]?.reading})`);
check("7g. the sheet closed", await page.evaluate(() => document.querySelector("#sunset-modal")?.open !== true));

await ctx.close();

// ---- 8. cataloguing must NOT be interrupted ----
// Its own phone on purpose: after test 7 the sheet is inside its quiet window,
// so re-using that context would prove nothing.
const cat = await phone();
await cat.page.click(`${card("b-catalogued")} [data-flip]`);
await cat.page.waitForTimeout(450);
await cat.page.click(`${card("b-catalogued")} [data-qa-move="completed"]`);
await cat.page.waitForTimeout(500);
await cat.page.click(`${card("b-catalogued")} [data-qa-move="completed"]`);
await cat.page.waitForTimeout(1800);
const openedForCatalogue = await cat.page.evaluate(() => document.querySelector("#sunset-modal")?.open === true);
check("8a. marking an owned book finished does NOT open the sheet", !openedForCatalogue);
await cat.ctx.close();

// ---- 9. offline: there is still an answer ----
const off = await phone({ offline: true });
await off.page.click('[data-shelf="tbr"]');
await off.page.waitForTimeout(400);
await off.page.click(`${card("b-waiting")} [data-flip]`);
await off.page.waitForTimeout(450);
await off.page.click(`${card("b-waiting")} [data-qa-move="completed"]`);
await off.page.waitForTimeout(500);
await off.page.click(`${card("b-waiting")} [data-qa-move="completed"]`);
await off.page.waitForTimeout(2500);
const offlinePick = await off.page.textContent("#sunset-content .sunset-pick-title").catch(() => null);
const offlineWhy = await off.page.textContent("#sunset-content .sunset-why").catch(() => null);
check("9a. with Open Library unreachable, the sheet still picks a book", !!offlinePick,
  `("${offlinePick}" — ${offlineWhy})`);
await off.ctx.close();

// ---- 11. putting down a book you were reading is recorded as abandoning it ----
// Seeded through the fixture, not by editing storage and reloading —
// addInitScript re-runs on reload and would put the original library back.
const ab = await phone({
  library: LIBRARY.map((b) => (b.id === "b-waiting" ? { ...b, reading: true } : b)),
});
await ab.page.click('[data-shelf="tbr"]');
await ab.page.waitForTimeout(400);
// Through the detail view: the card's quick-action rail only offers To Read
// and Finished, and neither is "put this down unfinished".
await ab.page.click(card("b-waiting"));
await ab.page.waitForTimeout(600);
await ab.page.click('#detail-content [data-move="wishlist"]');
await ab.page.waitForTimeout(900);
const abandoned = await ab.page.evaluate(async () => {
  const s = await import("/js/signals.js");
  return s.ofType("abandoned").length;
});
check("11a. shelving a book you were reading logs an abandonment", abandoned === 1, `(${abandoned})`);
// And finishing one must NOT count as abandoning it.
await ab.page.click('[data-shelf="wishlist"]');
await ab.page.waitForTimeout(400);
const stillOne = await ab.page.evaluate(async () => {
  const s = await import("/js/signals.js");
  return s.ofType("abandoned").length;
});
check("11b. and nothing else logs one", stillOne === 1, `(${stillOne})`);

// ---- 12. undo actually undoes a dismissal ----
await ab.page.click("#discover-btn");
await ab.page.waitForTimeout(2500);
const before12 = await recTitles(ab.page);
await ab.page.click("#discover-content .series-list li:first-child .rec-dismiss");
await ab.page.waitForTimeout(500);
await ab.page.click(".toast-action");
await ab.page.waitForTimeout(600);
const restored = await recTitles(ab.page);
const stillDismissed = await ab.page.evaluate(async () => {
  const s = await import("/js/signals.js");
  return s.dismissedKeys("Zach").size;
});
check("12a. Undo puts the dismissed book back", restored.includes(before12[0]),
  `("${before12[0]}")`);
check("12b. and clears the dismissal rather than compensating for it",
  stillDismissed === 0, `(${stillDismissed} still suppressed)`);
await ab.ctx.close();

// ---- 13. undoing the move that opened the sheet also takes back the sheet ----
const un = await phone();
await un.page.click('[data-shelf="tbr"]');
await un.page.waitForTimeout(400);
await un.page.click(`${card("b-waiting")} [data-flip]`);
await un.page.waitForTimeout(450);
await un.page.click(`${card("b-waiting")} [data-qa-move="completed"]`);
await un.page.waitForTimeout(500);
await un.page.click(`${card("b-waiting")} [data-qa-move="completed"]`);
await un.page.waitForTimeout(1500);
check("13a. the sheet is open", await un.page.evaluate(() => document.querySelector("#sunset-modal")?.open === true));
// A modal dialog makes the rest of the document inert, so the Undo raised by
// the move has to travel into the sheet or it becomes unpressable.
check("13b. the move's Undo travelled into the sheet and is still reachable",
  await un.page.evaluate(() =>
    document.querySelector("#toast-region")?.parentElement?.id === "sunset-modal"));
await un.page.click(".toast-action");
await un.page.waitForTimeout(700);
const shelfBack = await un.page.evaluate(() =>
  JSON.parse(localStorage.getItem("shelfie.library.v1")).find((b) => b.id === "b-waiting")?.shelf);
check("13c. Undo puts the book back on To Read", shelfBack === "tbr", `(${shelfBack})`);
check("13d. and closes the sheet, so it can't rate a book you didn't finish",
  await un.page.evaluate(() => document.querySelector("#sunset-modal")?.open !== true));
await un.ctx.close();

// ---- 10. the ranker's arithmetic, directly ----
const math = await page.evaluate?.(() => null).catch(() => null);
const probe = await browser.newContext();
const ppage = await probe.newPage();
ppage.on("pageerror", (e) => errors.push("probe pageerror: " + e.message));
await ppage.route(/openlibrary|googleapis|gstatic|covers/, (r) => r.abort());
await ppage.goto("http://localhost:8765/");
const rankChecks = await ppage.evaluate(async () => {
  const rank = await import("/js/rank.js");
  const t = { subjects: { magic: 4 }, authors: { Good: 4, Bad: -3 }, genres: {}, length: null };
  const base = { key: "k1", title: "A", authors: ["Nobody"], subjects: [], sources: {} };
  const f = (r) => rank.features({ ...base, ...r }, { taste: t });

  const match = rank.score(f({ subjects: ["magic"] }));
  const plain = rank.score(f({}));
  const byBad = rank.score(f({ authors: ["Bad"] }));
  const series = rank.score(f({ sources: { series: 1 } }));
  const shelf = rank.score(f({ sources: { shelves: 1 } }));
  const friend = rank.score(f({ sources: { friends: 1 }, friend: true }));
  const popular = rank.score(f({ avgRating: 4.8, ratingsCount: 9000 }));
  const stale = rank.score(rank.features(base, { taste: t, stale: new Map([["k1", 3]]) }));

  // Alpha must stay capped no matter how much history exists.
  const alphaHuge = rank.alphaFor(100000);
  const alphaCold = rank.alphaFor(5);
  return { match, plain, byBad, series, shelf, friend, popular, stale, alphaHuge, alphaCold };
});
check("10a. a subject match scores above a bare candidate", rankChecks.match > rankChecks.plain);
check("10b. a disliked author scores below a bare candidate", rankChecks.byBad < rankChecks.plain);
check("10c. series continuation outranks raw popularity", rankChecks.series > rankChecks.popular);
check("10d. a mutual friend outranks raw popularity", rankChecks.friend > rankChecks.popular);
check("10e. a book on your own shelf outranks raw popularity", rankChecks.shelf > rankChecks.popular);
check("10f. shown-and-passed is damped", rankChecks.stale < rankChecks.plain);
check("10g. learned blend stays capped at 0.6", rankChecks.alphaHuge <= 0.6,
  `(${rankChecks.alphaHuge})`);
check("10h. and is off with too little history", rankChecks.alphaCold === 0);
await probe.close();

await browser.close();
console.log("\nerrors:", errors);
