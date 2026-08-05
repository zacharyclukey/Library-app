import * as db from "./db.js";
import * as api from "./api.js";
import * as sync from "./sync.js";
import * as flt from "./filters.js";
import * as xport from "./export.js";
import * as themes from "./themes.js";
import * as community from "./community.js";
import * as social from "./social.js";
import { icon, loadIconOverrides, refreshIconOverrides } from "./icons.js";
import { scanImageFile, startLiveScan, stopLiveScan } from "./scanner.js";
import { applyCustomAssets, refreshCustomAssets } from "./assets.js";

// ---------- element handles ----------
const $ = (sel) => document.querySelector(sel);
const bookList = $("#book-list");
const emptyState = $("#empty-state");
const addModal = $("#add-modal");
const confirmModal = $("#confirm-modal");
const detailModal = $("#detail-modal");
const scanStatus = $("#scan-status");
const scannerArea = $("#scanner-area");
const scannerVideo = $("#scanner-video");
const searchResults = $("#search-results");

let currentShelf = "owned";
let visibleBooks = []; // what the current shelf is showing, for exports
let pendingBooks = []; // queue of looked-up books waiting for shelf choice
// book.id -> { series, books, checkedAt } | null (null = check in flight).
// Persisted so shelves render complete instantly instead of re-asking Open
// Library every session; entries refresh after a week.
const seriesCache = new Map();
const SERIES_CACHE_KEY = "shelfie.seriesCache.v1";
const SERIES_TTL_MS = 7 * 24 * 3600 * 1000;

(function loadSeriesCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(SERIES_CACHE_KEY)) ?? {};
    const now = Date.now();
    for (const [id, v] of Object.entries(raw)) {
      if (v && now - (v.checkedAt ?? 0) < SERIES_TTL_MS) seriesCache.set(id, v);
    }
  } catch { /* corrupt cache — start clean */ }
})();

function persistSeriesCache() {
  const out = {};
  for (const [id, v] of seriesCache) if (v) out[id] = v;
  try {
    localStorage.setItem(SERIES_CACHE_KEY, JSON.stringify(out));
  } catch { /* storage full — cache stays in-memory */ }
}

// ---------- profiles ----------
// A profile is just a name. The Owned shelf is shared by the household;
// To Read / Completed / Wishlist entries belong to whoever added them
// (books with no profile are treated as shared and show up for everyone).

const PROFILE_KEY = "shelfie.profile.v1";
const PERSONAL_SHELVES = ["tbr", "completed", "wishlist"];
let memberFilter = "me"; // "me" | "all" | a profile name
let searchQuery = "";

const emptyFilter = () =>
  ({ genre: null, pages: null, series: null, age: null, format: null, rated: null,
     status: null, content: null, spice: null, language: null });
let shelfFilter = emptyFilter();
// Sort is remembered per device, and "series" doubles as the grouping mode:
// picking it is what puts the shelf under series headings.
const SORT_KEY = "shelfie.shelfSort.v1";
let shelfSort = localStorage.getItem(SORT_KEY) ?? "added";
const groupBySeries = () => shelfSort === "series";

function setSort(value) {
  shelfSort = value;
  localStorage.setItem(SORT_KEY, value);
}

function currentProfile() {
  return localStorage.getItem(PROFILE_KEY);
}

function allProfiles() {
  const names = new Set(db.getAllBooks().map((b) => b.profile).filter(Boolean));
  if (currentProfile()) names.add(currentProfile());
  return [...names].sort();
}

// A book's rating by the current profile (falling back to the pre-profile
// single rating for older records).
function myRating(b) {
  return b.ratings?.[currentProfile()] ?? b.rating ?? null;
}

const SHELF_LABEL = { owned: "Owned", tbr: "To Read", completed: "Finished", wishlist: "Wishlist" };
const SHELF_ICO = { owned: "books", tbr: "bookmark", completed: "check", wishlist: "gift" };
const SHELF_ICON = new Proxy({}, { get: (_, k) => icon(SHELF_ICO[k] ?? "books") });
const SHELVES = ["owned", "tbr", "completed", "wishlist"];

// How the copy exists: physical, Kindle/e-book, or Audible/audiobook.
// Older records have no medium; they're treated as print. The whole feature
// is opt-in (Settings → Track copy types) and invisible until enabled —
// ownership alone is already covered by the "I own this copy" checkbox.
const MEDIA = { print: "Print", ebook: "E-book", audio: "Audiobook" };
const MEDIUM_ICON = { print: "print", ebook: "tablet", audio: "headphones" };
const MEDIUM_KEY = "shelfie.trackMedium.v1";

function trackMedium() {
  return localStorage.getItem(MEDIUM_KEY) === "1";
}

// Ask the browser to shield this site's data from automatic eviction.
// Defaults to on (losing the library to cache cleanup is the worse
// surprise); the Settings toggle stops future requests. Browsers offer no
// API to revoke an already-granted protection, so the UI says so.
const CONTENT_KEY = "shelfie.trackContent.v1";

function trackContent() {
  return localStorage.getItem(CONTENT_KEY) === "1";
}

const PERSIST_KEY = "shelfie.persistStorage.v1";

function persistPref() {
  return localStorage.getItem(PERSIST_KEY) !== "0";
}

function requestPersistence() {
  if (persistPref()) navigator.storage?.persist?.().catch(() => {});
}

const VIEW_KEY = "shelfie.view.v1";
let viewMode = localStorage.getItem(VIEW_KEY) ?? "grid";

function starString(rating) {
  const n = Math.min(5, Math.max(0, Math.round(Number(rating) || 0)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

// A cover that always looks intentional: a spine-styled fallback sits
// underneath, and the real jacket covers it when one loads. The colour is
// one of eight cloths the current aesthetic stocks its shelves with —
// hueOf gives a stable number per title, so the same book always binds in
// the same cloth, but WHICH eight cloths is the skin's own choice
// (--spine-1..8 in css/styles.css, yours in css/custom.css).
function coverHtml(b) {
  const author = (b.authors ?? [])[0] ?? "";
  return `<div class="cover-wrap" style="--spine:var(--spine-${(xport.hueOf(b.title) % 8) + 1})">
      <div class="cover-fallback">
        <span class="fb-title">${esc(b.title)}</span>
        ${author ? `<span class="fb-author">${esc(author)}</span>` : ""}
      </div>
      ${b.coverUrl
        ? `<img class="cover" src="${esc(b.coverUrl)}" alt="" loading="lazy"
             onload="this.classList.add('loaded')"
             onerror="this.classList.add('missing')" />`
        : ""}
    </div>`;
}

// Outbound "find this book" links, built from the ISBN when we have one
// (which finds the exact edition) or a title+author search otherwise.
// ISBN-10 doubles as the ASIN for most print books, giving Amazon a
// direct product page.
function storeLinks(b) {
  const isbn = b.isbn13 ?? b.isbn10;
  const q = encodeURIComponent(isbn ?? `${b.title} ${b.authors?.[0] ?? ""}`);
  return [
    ["Amazon", b.isbn10
      ? `https://www.amazon.com/dp/${b.isbn10}`
      : `https://www.amazon.com/s?k=${q}`],
    ["Barnes & Noble", `https://www.barnesandnoble.com/s/${q}`],
    ["Bookshop.org", `https://bookshop.org/search?keywords=${q}`],
    ["ThriftBooks", `https://www.thriftbooks.com/browse/?b.search=${q}`],
    ["AbeBooks", isbn
      ? `https://www.abebooks.com/servlet/SearchResults?isbn=${isbn}`
      : `https://www.abebooks.com/servlet/SearchResults?kn=${q}`],
    ["Library (WorldCat)", `https://search.worldcat.org/search?q=${q}`],
    ["Goodreads", `https://www.goodreads.com/search?q=${q}`],
  ];
}

// Quietly say when edits are staying on the phone, so a dropped connection
// never looks like lost work.
function updateNetPill() {
  const pill = $("#net-pill");
  if (!navigator.onLine) {
    pill.textContent = "Offline — changes are saved here and will sync later";
    pill.className = "net-pill offline";
  } else if (syncError) {
    pill.textContent = "Sync paused — changes are safe on this phone";
    pill.className = "net-pill warn";
  } else {
    pill.className = "net-pill hidden";
  }
}
window.addEventListener("online", updateNetPill);
window.addEventListener("offline", updateNetPill);

// Fill in every declarative icon slot in the HTML shell.
function paintIcons(root = document) {
  root.querySelectorAll("[data-ico]").forEach((el) => {
    el.innerHTML = icon(el.dataset.ico);
  });
}

// ---------- the "no homework" nudge ----------
// A backlog of unrated books should never feel like a chore, so there is
// deliberately no "47 books need rating" counter anywhere. Instead: at most
// ONE finished-but-unrated book, offered occasionally, rateable in a single
// tap, and easy to wave off. Any interaction snoozes it for a day.

const NUDGE_SNOOZE_KEY = "shelfie.nudgeSnooze.v1";

function snoozeNudge(hours = 20) {
  localStorage.setItem(NUDGE_SNOOZE_KEY, String(Date.now() + hours * 3600 * 1000));
}

function renderNudge() {
  const el = $("#nudge-card");
  const snoozedUntil = Number(localStorage.getItem(NUDGE_SNOOZE_KEY) ?? 0);
  const candidates = db
    .getBooksOnShelf("completed", currentProfile())
    .filter((b) => !myRating(b));

  if (Date.now() < snoozedUntil || !candidates.length || !currentProfile()) {
    el.classList.add("hidden");
    return;
  }

  // Oldest unrated first — the one most likely already forgotten is the one
  // worth asking about while it's still a pleasant memory, not a chore.
  const b = candidates[0];
  el.innerHTML = `
    <div class="nudge-main">
      <span class="nudge-q">How was <strong>${esc(b.title)}</strong>?</span>
      <span class="nudge-stars">
        ${[1, 2, 3, 4, 5]
          .map((n) => `<button data-nudge-rate="${n}" aria-label="Rate ${n}">☆</button>`)
          .join("")}
      </span>
    </div>
    <button class="link-btn" data-nudge-dismiss>Not now</button>`;
  el.classList.remove("hidden");

  el.querySelectorAll("[data-nudge-rate]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const me = currentProfile() ?? "Me";
      const value = Number(btn.dataset.nudgeRate);
      db.updateBook(b.id, { ratings: { ...(b.ratings ?? {}), [me]: value }, rating: null });
      shareToCommunity(b.id);
      snoozeNudge();
      navigator.vibrate?.(12);
      toast(`${"★".repeat(value)} for “${b.title}” — thanks!`);
      renderShelf();
    })
  );
  el.querySelector("[data-nudge-dismiss]").addEventListener("click", () => {
    snoozeNudge(72); // waved off: stay quiet for three days
    el.classList.add("hidden");
  });
}

// ---------- reading stats ----------
// Everything here is derived from data already on the shelves — no new
// bookkeeping, just a look back at what's been read.

// A book counts toward "this year" only if the app actually watched you read
// it: it was waiting on To Read, or flagged as currently reading, and then
// moved to Finished. Logging a shelf of books you read years ago — whether
// added straight onto Finished or marked off in a batch from Owned — is
// cataloguing, not this year's reading, and shouldn't inflate the number.
// Nothing extra to tick: the two paths that count are ones you'd take anyway.
function countsAsReadHere(book) {
  return myShelf(book) === "tbr" || iAmReading(book);
}

// Only written when true, so a later move can never clear it.
function readHerePatch(book, toShelf) {
  return toShelf === "completed" && (book.readHere || countsAsReadHere(book))
    ? { readHere: true }
    : {};
}

// The one place a book changes shelves, so the personal/household split is
// decided once. Owning is the household's business and goes on the record;
// To Read, Finished and Wishlist are yours and go under your name, leaving
// everyone else's answer about the same book exactly where it was.
//
// Note what a personal move deliberately does NOT do: touch `owned`. Sending
// a book to your Wishlist used to mark the copy unowned, which in a shared
// library would quietly take away the copy your partner is holding.
function moveToShelf(b, to, who = currentProfile()) {
  if (to === "owned") {
    db.updateBook(b.id, { owned: true, ...readHerePatch(b, to) });
    // It's on the household shelf now, so it comes off the mover's own pile —
    // an explicit "none" rather than a deletion, or the record's original
    // shelf would drift back in underneath them.
    db.setShelfFor(b.id, who, { shelf: null, reading: false });
    return;
  }
  const finishing = to === "completed";
  db.setShelfFor(b.id, who, {
    shelf: to,
    reading: finishing ? false : db.readingFor(b, who),
    finishedAt: finishing
      ? db.finishedAtFor(b, who) ?? new Date().toISOString()
      : db.finishedAtFor(b, who),
  });
  const here = readHerePatch(b, to);
  if (here.readHere) db.updateBook(b.id, here);
}

function renderStatsScreen() {
  const el = $("#stats-content");
  const all = db.getAllBooks();
  if (!all.length) {
    el.innerHTML = `<p class="muted">Add a few books and this will fill in.</p>`;
    return;
  }

  const finished = db.getBooksOnShelf("completed", currentProfile());
  const year = new Date().getFullYear();
  const finishedThisYear = finished.filter(
    (b) => b.readHere && (db.finishedAtFor(b, currentProfile()) ?? "").startsWith(String(year))
  );
  const pagesThisYear = finishedThisYear.reduce((n, b) => n + (Number(b.pageCount) || 0), 0);
  const rated = all.map((b) => myRating(b)).filter(Boolean);
  const avg = rated.length ? (rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(1) : null;

  const tally = (list) => {
    const m = {};
    list.forEach((k) => (m[k] = (m[k] ?? 0) + 1));
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5);
  };
  const topAuthors = tally(all.flatMap((b) => b.authors ?? []));
  const topGenres = tally(all.flatMap((b) => flt.genresOf(b)));

  // Books finished per month this year, as a small bar row.
  const months = Array.from({ length: 12 }, () => 0);
  finishedThisYear.forEach((b) => {
    const m = new Date(db.finishedAtFor(b, currentProfile())).getMonth();
    if (!Number.isNaN(m)) months[m]++;
  });
  const peak = Math.max(...months, 1);
  const monthNames = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  const stat = (n, label) => `<div class="stat-tile"><b>${n}</b><span>${label}</span></div>`;
  const bars = (rows) =>
    rows.length
      ? `<ul class="bar-list">${rows
          .map(
            ([name, n]) => `<li>
              <span class="bar-label">${esc(name)}</span>
              <span class="bar"><i style="width:${(n / rows[0][1]) * 100}%"></i></span>
              <span class="bar-n">${n}</span>
            </li>`
          )
          .join("")}</ul>`
      : `<p class="muted">Not enough data yet.</p>`;

  el.innerHTML = `
    <div class="stat-grid">
      ${stat(all.length, "books")}
      ${stat(finished.length, "finished")}
      ${stat(db.getOwnedBooks().length, "owned")}
      ${stat(all.filter(iAmReading).length, "in progress")}
    </div>

    <div class="d-section" style="margin-top:1rem">
      <div class="d-body" style="padding-top:0.8rem">
        <span class="filter-label">${year} so far</span>
        <p class="stat-line">${finishedThisYear.length} book${finishedThisYear.length === 1 ? "" : "s"} finished${
          pagesThisYear ? ` · ${pagesThisYear.toLocaleString()} pages` : ""
        }</p>
        <div class="month-row">
          ${months
            .map(
              (n, i) => `<span class="month" title="${n} in ${monthNames[i]}">
                <i style="height:${Math.max((n / peak) * 100, 4)}%"></i>
                <em>${monthNames[i]}</em>
              </span>`
            )
            .join("")}
        </div>
      </div>
    </div>

    <div class="d-section"><div class="d-body" style="padding-top:0.8rem">
      <span class="filter-label">Most read authors</span>
      ${bars(topAuthors)}
    </div></div>

    <div class="d-section"><div class="d-body" style="padding-top:0.8rem">
      <span class="filter-label">Genres on your shelves</span>
      ${bars(topGenres)}
    </div></div>

    ${avg ? `<p class="muted" style="margin-top:0.9rem">You rate books ★ ${avg} on average across ${rated.length} rated.</p>` : ""}`;
}

// ---------- toasts & undo ----------
// Replaces browser confirm()/alert() popups: actions happen immediately and
// a themed toast offers Undo, which feels native and makes mistakes cheap.

let toastTimer = null;
let lastUndo = null;

function toast(message, { actionLabel, onAction, ms = 5000 } = {}) {
  const region = $("#toast-region");
  // A modal <dialog> paints in the browser's top layer, above everything in
  // the body no matter the z-index — so a toast raised while the add sheet is
  // open (with its Undo) would be invisible. Move it into that layer.
  const openDialog = document.querySelector("dialog[open]");
  const host = openDialog ?? document.body;
  if (region.parentElement !== host) host.appendChild(region);
  region.innerHTML = `
    <div class="toast">
      <span>${esc(message)}</span>
      ${actionLabel ? `<button class="toast-action">${esc(actionLabel)}</button>` : ""}
    </div>`;
  region.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => region.classList.remove("show"), ms);
  region.querySelector(".toast-action")?.addEventListener("click", () => {
    region.classList.remove("show");
    clearTimeout(toastTimer);
    onAction?.();
  });
}

// The shared library refused a delete. The book is already gone from this
// phone, so the next snapshot will hand it back and it will look like Remove
// did nothing at all. Say what actually happened, and where the fix is —
// it's the Firestore rules, not anything the reader can do on the phone.
let deleteRefusedWarned = 0;
window.addEventListener("shelfie:sync-delete-refused", () => {
  if (Date.now() - deleteRefusedWarned < 30000) return;
  deleteRefusedWarned = Date.now();
  setTimeout(() => {
    toast("The shared library wouldn't let that book be removed, so it will come back. Your Firestore rules need updating — see SETUP-SYNC.md.", { ms: 12000 });
  }, 0);
});

// The store couldn't write. Say so plainly and point at the way out — a
// silent failure here looks like the app losing books.
let storageWarned = 0;
window.addEventListener("shelfie:storage-full", () => {
  if (Date.now() - storageWarned < 30000) return; // one warning per burst
  storageWarned = Date.now();
  // Deferred by a tick on purpose: the failed write happens *inside* an
  // action that goes on to toast its own success ("Rated ★★★★"), and the
  // truth has to be the message left standing.
  setTimeout(() => {
    toast("Storage is full — that change wasn't saved. Export a backup, then remove some books.", {
      actionLabel: "Export",
      onAction: () => showScreen("export"),
      ms: 12000,
    });
  }, 0);
});

// Snapshot a book so an action can be reversed with one tap.
function undoable(message, book, apply) {
  const before = JSON.parse(JSON.stringify(book));
  apply();
  lastUndo = before;
  navigator.vibrate?.(12);
  toast(message, {
    actionLabel: "Undo",
    onAction: () => {
      db.replaceBook(before); // replace, not merge: undo must remove new keys too
      seriesCache.delete(before.id);
      shareToCommunity(before.id);
      renderShelf();
      toast("Undone");
    },
  });
}

// ---------- screen router ----------
// Shelves / Discover / Export / Settings (and the Profile and Shared library
// sub-screens) are real screens rather than dialogs. Add, Confirm and Detail
// stay as modals — they're short task flows on top of whatever you're doing.

const SCREENS = ["shelves", "discover", "export", "settings", "profile", "account", "sync", "stats", "friends", "appearance"];
const SCREEN_NAV = { shelves: "nav-shelves", discover: "discover-btn", export: "export-btn", settings: "settings-btn" };
let currentScreen = "shelves";

function showScreen(name, { push = true } = {}) {
  if (!SCREENS.includes(name)) name = "shelves";
  if (selectMode && name !== "shelves") setSelectMode(false);
  currentScreen = name;

  SCREENS.forEach((s) =>
    $(`#screen-${s}`).classList.toggle("active", s === name)
  );
  Object.entries(SCREEN_NAV).forEach(([screen, id]) =>
    $(`#${id}`).classList.toggle("active", screen === name)
  );

  // Sub-screens keep their parent's nav item lit.
  if (["profile", "sync", "friends", "appearance", "account"].includes(name)) $("#settings-btn").classList.add("active");
  if (name === "stats") $("#nav-shelves").classList.add("active");

  if (name === "discover") renderDiscover();
  else if (name === "export") openExportScreen();
  else if (name === "settings") renderSettingsScreen();
  else if (name === "profile") renderProfileScreen();
  else if (name === "sync") renderSyncScreen();
  else if (name === "stats") renderStatsScreen();
  else if (name === "friends") renderFriendsScreen();
  else if (name === "appearance") renderAppearanceScreen();
  else if (name === "account") renderAccountScreen();

  if (push && history.state?.screen !== name) {
    history.pushState({ screen: name }, "");
    navDepth++;
  }
  window.scrollTo({ top: 0 });
}

// How many entries we've pushed, so the in-app back arrow can pop history
// instead of stacking more entries — otherwise leaving the app would take as
// many presses of the phone's back button as screens you'd visited.
let navDepth = 0;

window.addEventListener("popstate", (e) => {
  navDepth = Math.max(0, navDepth - 1);
  showScreen(e.state?.screen ?? "shelves", { push: false });
});

function goBack(fallback = "shelves") {
  if (navDepth > 0) history.back();
  else showScreen(fallback);
}

document.querySelectorAll("[data-back]").forEach((btn) =>
  btn.addEventListener("click", () => goBack(btn.dataset.back || "shelves"))
);

// Push this profile's signals for a book to the community layer (inert
// unless sharing is enabled in Settings).
function shareToCommunity(id) {
  const b = db.getBook(id);
  if (!b) return;
  const me = currentProfile() ?? "Someone";
  community.publish(b, me);
  // Keep this reader's shelf fingerprint current so "readers like you"
  // recommendations have something to work with (debounced inside).
  community.publishShelf(db.getAllBooks().map((x) => community.bookKey(x)), me);
  // And what the people following you see: your recent reading (debounced).
  social.publishSoon(me);
}

// ---------- rendering ----------

// Escapes quotes as well as angle brackets: this output goes into attributes
// (title="…", data-id="…") as often as it goes into text, and book titles and
// contributor names arrive from Open Library, Google Books, and other people's
// phones — a lone double quote must not be able to end the attribute.
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// The Owned shelf is "everything you own", so a book you own that also sits
// on To Read / Finished / Wishlist appears here too — it's a property of the
// book, not a mutually exclusive location.
// Owned is the household's shelf — one copy, everybody sees it. The other
// three are read through somebody's eyes: `who` null means anybody's, which
// is what the Everyone chip asks for.
function booksForShelf(shelf, who) {
  return shelf === "owned" ? db.getOwnedBooks() : db.getBooksOnShelf(shelf, who);
}

// The shelf/reading/finished state for the person holding the phone.
const myShelf = (b) => db.shelfFor(b, currentProfile());
const iAmReading = (b) => db.readingFor(b, currentProfile());
// What to *call* a book's shelf when there's one label's worth of room: your
// own answer if you've given one, otherwise the household's Owned.
const displayShelf = (b) => myShelf(b) ?? (b.owned || b.shelf === "owned" ? "owned" : b.shelf);

function renderShelf() {
  const personal = PERSONAL_SHELVES.includes(currentShelf);
  // Who the shelf is being read as. "Everyone" is null — anyone's copy counts.
  const target = !personal
    ? null
    : memberFilter === "all" ? null
    : memberFilter === "me" ? currentProfile()
    : memberFilter;

  let books = booksForShelf(currentShelf, target);
  // The tab counts always show your own shelves, whatever the filter is set
  // to — they're how big *your* pile is, not how big the household's is.
  for (const shelf of SHELVES) {
    $(`#count-${shelf}`).textContent = booksForShelf(shelf, currentProfile()).length;
  }
  renderProfileFilter(personal);
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    books = books.filter((b) =>
      (b.title + " " + (b.authors ?? []).join(" ")).toLowerCase().includes(q)
    );
  }

  const hadBeforeFilter = books.length;
  books = books.filter((b) => flt.matchesFilter(b, shelfFilter, { myRating: myRating(b) }));
  books = flt.sortBooks(books, shelfSort, { ratingOf: myRating });
  // What you're reading right now belongs at the top of To Read — what *she's*
  // reading doesn't, so this asks about the person the shelf is being read as.
  if (currentShelf === "tbr" && shelfSort === "added") {
    const readingNow = (b) => db.readingFor(b, target ?? currentProfile());
    books = [...books].sort((a, b) => (readingNow(b) ? 1 : 0) - (readingNow(a) ? 1 : 0));
  }
  updateFilterBadge();

  visibleBooks = books;
  const filtered = hadBeforeFilter > 0 || q;
  $("#empty-text").textContent = filtered
    ? "Nothing matches your search or filters."
    : `Your ${SHELF_LABEL[currentShelf]} shelf is empty.`;
  $("#empty-action").innerHTML = filtered
    ? "Clear filters"
    : `${icon("plus")}<span>Add your first book</span>`;
  $("#empty-action").dataset.action = filtered ? "clear" : "add";
  emptyState.classList.toggle("hidden", books.length > 0);
  $("#shelf-summary").textContent = books.length ? xport.summaryLine(books) : "";

  bookList.className = "book-list " + viewMode;
  disarmQuickAction();
  bookList.innerHTML = "";
  renderQueue = groupBySeries() ? groupIntoSeries(books) : books.slice();
  renderShowNames = allProfiles().length > 1;
  renderChunk();
  renderAzRail(books);
  renderNudge();
  renderHero();
  updateBulkBar(); // "Select all N" tracks the filter you just changed
}

// A quiet line of context at the top of the shelves — who's reading, and
// what's actually in the library right now.
function renderHero() {
  const el = $("#shelf-hero");
  const me = currentProfile();
  const all = db.getAllBooks();
  if (!me || !all.length) {
    el.textContent = "";
    return;
  }
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const reading = all.filter(iAmReading).length;
  const finished = db.getBooksOnShelf("completed", currentProfile()).length;
  const facts = [
    reading ? `${reading} in progress` : null,
    finished ? `${finished} finished` : null,
  ].filter(Boolean);
  el.innerHTML = `<strong>${greeting}, ${esc(me)}</strong>${
    facts.length ? " · " + esc(facts.join(" · ")) : ""
  } <span class="hero-go">${icon("chevronLeft", "flip-x")}</span>`;
}

// Collect books under their series, standalones last, so a shelf can be
// read as collections rather than a flat wall of covers. Returns a render
// list where header entries sit inline with the books they introduce.
// Series names reach us from several sources and rarely agree on spelling:
// "L.O.R.D.S." and "LORDS", "The Stormlight Archive" and "Stormlight
// Archive". Books get grouped on this flattened key so one series stays one
// shelf heading, while the heading itself shows the fullest spelling seen.
function seriesGroupKey(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/\s*(?:series|saga|trilogy|duet|cycle|novels?|books?)\s*$/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function groupIntoSeries(books) {
  const groups = new Map();
  const loose = [];
  for (const b of books) {
    if (b.series?.name) {
      const key = seriesGroupKey(b.series.name);
      if (!key) { loose.push(b); continue; }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    } else {
      loose.push(b);
    }
  }
  // Prefer the spelling used by the most books; ties go to the longer one,
  // which keeps "L.O.R.D.S." over a stray "LORDS".
  const displayName = (list) => {
    const tally = new Map();
    list.forEach((b) => tally.set(b.series.name, (tally.get(b.series.name) ?? 0) + 1));
    return [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
  };
  const out = [];
  [...groups.values()]
    .map((list) => [displayName(list), list])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([name, list]) => {
      list.sort(
        (a, b) => (a.series.position ?? 99) - (b.series.position ?? 99) || a.title.localeCompare(b.title)
      );
      // How much of the series this shelf actually holds, when we know it.
      const known = list.map((b) => seriesCache.get(b.id)?.books?.length).find(Boolean);
      out.push({ __header: name, count: list.length, total: known ?? null });
      out.push(...list);
    });
  if (loose.length) {
    out.push({ __header: "Standalone", count: loose.length, total: null });
    out.push(...loose);
  }
  return out;
}

// Cards are appended in chunks as you scroll, so a huge library opens as
// fast as a small one — and only rendered books trigger series lookups.
const CHUNK = 60;
let renderQueue = [];
let renderShowNames = false;
const flippedIds = new Set();

// ---------- selecting several books at once ----------
//
// Tidying a shelf one book at a time is the thing that makes a big library
// feel like work. In select mode a tap picks a book instead of opening it,
// and the bottom bar moves the lot in one go — still undoable as a batch.

let selectMode = false;
const selectedIds = new Set();

function setSelectMode(on) {
  selectMode = on;
  if (!on) selectedIds.clear();
  disarmQuickAction();
  document.body.classList.toggle("selecting", on);
  $("#select-toggle").classList.toggle("on", on);
  $("#bulk-bar").classList.toggle("hidden", !on);
  renderShelf();
  updateBulkBar();
}

function toggleSelected(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  const card = bookList.querySelector(`[data-id="${CSS.escape(id)}"]`);
  card?.classList.toggle("picked", selectedIds.has(id));
  navigator.vibrate?.(5);
  updateBulkBar();
}

function updateBulkBar() {
  if (!selectMode) return;
  const n = selectedIds.size;
  $("#bulk-count").textContent = n === 1 ? "1 selected" : `${n} selected`;
  const allShown = visibleBooks.length > 0 && visibleBooks.every((b) => selectedIds.has(b.id));
  $("#bulk-all").textContent = allShown ? "Clear all" : `Select all ${visibleBooks.length}`;
  $("#bulk-bar").querySelectorAll("[data-bulk-move]").forEach((btn) => {
    btn.disabled = n === 0;
  });

  // Whose books these are. Rebuilt each time because the roster comes from the
  // shared library and can change while you're standing here; hidden entirely
  // when there's nobody to hand a book to.
  const people = libraryPeople();
  const assign = $("#bulk-assign");
  assign.classList.toggle("hidden", people.length < 2);
  if (people.length >= 2) {
    assign.innerHTML =
      `<span class="bulk-assign-label">Belongs to</span>` +
      people
        .map((p) => `<button class="shelf-pick" data-bulk-assign="${esc(p)}">${esc(p)}</button>`)
        .join("") +
      `<button class="shelf-pick" data-bulk-assign="">Shared</button>`;
    assign.querySelectorAll("[data-bulk-assign]").forEach((btn) => {
      btn.disabled = n === 0;
      btn.addEventListener("click", () => bulkAssign(btn.dataset.bulkAssign));
    });
  }
}

// Hand the selection to somebody — or back to the shared pile. One Undo
// covers the batch, same as a bulk move.
function bulkAssign(who) {
  const books = [...selectedIds].map((id) => db.getBook(id)).filter(Boolean);
  if (!books.length) return;
  const before = JSON.parse(JSON.stringify(books));
  books.forEach((b) => db.updateBook(b.id, { profile: who || null }));
  const n = books.length;
  setSelectMode(false);
  navigator.vibrate?.(15);
  toast(
    who
      ? `${n} book${n === 1 ? "" : "s"} now ${esc(who)}'s`
      : `${n} book${n === 1 ? "" : "s"} back to shared`,
    {
      actionLabel: "Undo",
      onAction: () => {
        before.forEach((b) => db.replaceBook(b));
        renderShelf();
        toast(`Put ${n} book${n === 1 ? "" : "s"} back`);
      },
    }
  );
}

// Moves the selection, with one Undo covering the whole batch.
function bulkMove(to) {
  const books = [...selectedIds].map((id) => db.getBook(id)).filter(Boolean);
  if (!books.length) return;
  const before = JSON.parse(JSON.stringify(books));
  for (const b of books) {
    moveToShelf(b, to);
    seriesCache.delete(b.id);
  }
  social.publishSoon(currentProfile());
  const n = books.length;
  setSelectMode(false);
  navigator.vibrate?.(15);
  toast(`Moved ${n} book${n === 1 ? "" : "s"} to ${SHELF_LABEL[to]}`, {
    actionLabel: "Undo",
    onAction: () => {
      before.forEach((b) => db.replaceBook(b));
      renderShelf();
      toast(`Put ${n} book${n === 1 ? "" : "s"} back`);
    },
  });
}

$("#select-toggle").addEventListener("click", () => setSelectMode(!selectMode));
$("#bulk-cancel").addEventListener("click", () => setSelectMode(false));
$("#bulk-all").addEventListener("click", () => {
  const allShown = visibleBooks.length > 0 && visibleBooks.every((b) => selectedIds.has(b.id));
  if (allShown) selectedIds.clear();
  else visibleBooks.forEach((b) => selectedIds.add(b.id));
  bookList.querySelectorAll("[data-id]").forEach((card) =>
    card.classList.toggle("picked", selectedIds.has(card.dataset.id))
  );
  updateBulkBar();
});
$("#bulk-bar").querySelectorAll("[data-bulk-move]").forEach((btn) =>
  btn.addEventListener("click", () => bulkMove(btn.dataset.bulkMove))
);

function renderChunk() {
  const next = renderQueue.splice(0, CHUNK);
  if (!next.length) return;
  const from = bookList.children.length;
  bookList.insertAdjacentHTML(
    "beforeend",
    next
      .map((item) =>
        item.__header
          ? `<h3 class="group-head">
               <span>${esc(item.__header)}</span>
               <span class="group-count">${item.count}${item.total ? ` of ${item.total}` : ""}</span>
             </h3>`
          : viewMode === "grid"
            ? gridCard(item, renderShowNames)
            : listCard(item, renderShowNames)
      )
      .join("")
  );
  for (let i = from; i < bookList.children.length; i++) {
    const card = bookList.children[i];
    card.classList.add("enter");
    card.style.setProperty("--i", Math.min(i - from, 12)); // cap the stagger
  }
  next.forEach((b) => {
    if (b.__header) return;
    if (flippedIds.has(b.id)) {
      bookList.querySelector(`[data-id="${CSS.escape(b.id)}"] .flip`)?.classList.add("flipped");
    }
    if (!seriesCache.has(b.id)) checkSeriesInBackground(b);
  });
}

new IntersectionObserver((entries) => {
  if (entries.some((e) => e.isIntersecting)) renderChunk();
}, { rootMargin: "600px" }).observe($("#list-sentinel"));

// Render forward until a given index exists, for A–Z jumps.
function ensureRendered(index) {
  while (bookList.children.length <= index && renderQueue.length) renderChunk();
  return bookList.children[index];
}

// ---- A–Z rail: iOS-contacts-style jump, shown when it actually helps ----
function initialOf(b) {
  const source = shelfSort === "author" ? (b.authors ?? [])[0] ?? b.title : b.title;
  const ch = String(source).replace(/^(the|a|an)\s+/i, "").trim()[0]?.toUpperCase() ?? "#";
  return /[A-Z]/.test(ch) ? ch : "#";
}

function renderAzRail(books) {
  const rail = $("#az-rail");
  const useful = !groupBySeries() && ["title", "author"].includes(shelfSort) && books.length >= 25;
  rail.classList.toggle("hidden", !useful);
  if (!useful) return;

  const firstIndex = new Map();
  books.forEach((b, i) => {
    const k = initialOf(b);
    if (!firstIndex.has(k)) firstIndex.set(k, i);
  });
  rail.innerHTML = [...firstIndex.keys()]
    .map((k) => `<button data-jump="${esc(k)}">${esc(k)}</button>`)
    .join("");
  rail.querySelectorAll("[data-jump]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const el = ensureRendered(firstIndex.get(btn.dataset.jump));
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      navigator.vibrate?.(8);
    })
  );
}

function missingInSeries(b) {
  return seriesCache.get(b.id)?.missingCount ?? 0;
}

// Every quick action says what it does in words — an icon alone is a guess,
// and a mis-tap here moves a book off the shelf you were looking at. A cover
// is too narrow for an icon *and* a readable label, so the words win.
// Removing is the one action that can't be reached by doing something else
// afterwards, so it asks first — and says plainly that it's everywhere, since
// the Owned tab lists books that live on other shelves and "remove" could
// otherwise read as "take it out of this one view".
function confirmRemoval(b) {
  const also = myShelf(b) && b.owned ? " It's on your Owned list too." : "";
  return confirm(
    `Remove “${b.title}” from your library?\n\n` +
      `This takes it off every shelf, along with your rating and review.${also}\n\n` +
      `You can undo it straight after.`
  );
}

// One removal, whichever button reached it — the quick action on a flipped
// card and the one in Book details do exactly the same thing.
function removeBookEverywhere(b) {
  const snapshot = JSON.parse(JSON.stringify(b));
  db.removeBook(b.id);
  seriesCache.delete(b.id);
  flippedIds.delete(b.id);
  selectedIds.delete(b.id);
  renderShelf();
  toast(`Removed “${b.title}”`, {
    actionLabel: "Undo",
    onAction: () => {
      db.replaceBook(snapshot);
      renderShelf();
      toast("Restored");
    },
  });
}

// The facts on a turned card: which series it belongs to (and where in it),
// and how long the book is — the two things you'd flip a card to check. The
// title and author aren't repeated back here; they're already printed under
// the book on the shelf itself. Cutting a series name with an ellipsis
// mid-word ("A SERIE…") loses the useful part, so a name too long for the
// card's narrow column steps down to just the number — the full name is one
// tap away in Details.
function factLines(b) {
  const pages = b.pageCount ? `${b.pageCount} pages` : null;
  const name = b.series?.name ?? null;
  const pos = b.series?.position != null ? `#${b.series.position}` : null;
  // The column fits about eight small-caps characters per line, and a word
  // longer than a line can't wrap — it gets cropped mid-letter. So the test
  // is the longest word, not the whole string: "Dune #2" keeps its name,
  // "Stormlight #2" steps down to the number.
  const fits = name && [name, pos].filter(Boolean).join(" ")
    .split(" ").every((w) => w.length <= 8);
  const series = name
    ? fits ? [name, pos].filter(Boolean).join(" ")
           : pos ? `${pos} in the series` : null
    : null;
  return [series, pages].filter(Boolean);
}

// Icon-only at rest, so five actions fit in a rail down the side of the card.
// The word is still rendered — hidden in the rail, but present for the
// tooltip, for anything reading the page aloud, and for the armed state to
// show when you press one. Losing the label from the screen must not lose it
// from the machine.
function qaButton({ attr, label, glyph, on = false }) {
  return `<button class="qa-btn${on ? " on" : ""}" ${attr}
            title="${esc(label)}" aria-label="${esc(label)}">${icon(glyph)}<span
            class="qa-label">${esc(label)}</span></button>`;
}

function gridCard(b, showNames) {
  const rating = myRating(b);
  const missing = missingInSeries(b);
  // Front: the cover. Tap flips to your own take on the book — rating and
  // the actions you reach for most — without leaving the shelf.
  return `
    <article class="grid-book${selectedIds.has(b.id) ? " picked" : ""}" data-id="${esc(b.id)}" title="${esc(b.title)}">
      ${selectMode ? `<span class="pick-dot" aria-hidden="true">${icon("check")}</span>` : ""}
      <div class="flip">
        <div class="flip-front">
          ${coverHtml(b)}
          <button class="page-edge" data-flip aria-label="Quick actions and details"></button>
        </div>
        <div class="flip-back" aria-hidden="true">
          <div class="qa-stars">
            ${[1, 2, 3, 4, 5].map((n) =>
              `<button class="${rating >= n ? "filled" : ""}" data-qa-rate="${n}"
                       aria-label="Rate ${n}">${rating >= n ? "★" : "☆"}</button>`).join("")}
          </div>
          <div class="cc-body">
          <div class="cc-main">
          ${factLines(b).map((f) => `<p class="qa-facts">${esc(f)}</p>`).join("")}
          <p class="cc-review">${esc(b.reviews?.[currentProfile()]?.text ?? "")}</p>
          </div>
          <div class="cc-side">
          <div class="qa-row">
            ${myShelf(b) !== "tbr"
              ? qaButton({ attr: 'data-qa-move="tbr"', label: "To read", glyph: "books" }) : ""}
            ${myShelf(b) === "tbr" || !myShelf(b)
              ? qaButton({ attr: "data-qa-reading", glyph: "bookmark",
                           label: iAmReading(b) ? "Stop reading" : "Reading now", on: iAmReading(b) })
              : ""}
            ${myShelf(b) !== "completed"
              ? qaButton({ attr: 'data-qa-move="completed"', label: "Finished", glyph: "check" }) : ""}
          </div>
          <div class="qa-foot">
            <button class="qa-details" data-qa-details title="Book details" aria-label="Book details">${icon("page")}</button>
            <button class="qa-remove" data-qa-remove
                    aria-label="Remove from library" title="Remove from library">${icon("trash")}</button>
          </div>
          </div>
          </div>
        </div>
      </div>
      <div>
        <p class="grid-title">${esc(b.title)}</p>
        <p class="grid-author">${esc((b.authors ?? []).join(", "))}</p>
      </div>
      <div class="grid-meta">
        ${iAmReading(b) ? `<span class="mini-badge reading" title="Currently reading">${icon("bookOpen")}</span>` : ""}
        ${rating ? `<span class="grid-rating">${starString(rating)}</span>` : ""}
        ${trackMedium() && MEDIUM_ICON[b.medium] ? `<span class="mini-badge medium" title="${esc(MEDIA[b.medium])}">${icon(MEDIUM_ICON[b.medium])}</span>` : ""}
        ${trackContent() && b.spice ? `<span class="mini-badge spice" title="Spice ${b.spice} of 5">${icon("flame")}${b.spice}</span>` : ""}
        ${trackContent() && !b.spice && ["mature", "explicit"].includes(b.content) ? `<span class="mini-badge mature-tag">18+</span>` : ""}
        ${trackContent() && b.content === "kids" ? `<span class="mini-badge kids-tag">${icon("teddy")}</span>` : ""}
        ${currentShelf === "owned" && myShelf(b)
          ? `<span class="mini-badge shelf" title="Also on ${esc(SHELF_LABEL[myShelf(b)])}">${SHELF_ICON[myShelf(b)]}</span>`
          : ""}
        ${missing ? `<span class="mini-badge" title="${missing} more in this series">+${missing}</span>` : ""}
        ${showNames && b.profile ? `<span class="mini-badge who">${esc(b.profile[0])}</span>` : ""}
      </div>
    </article>`;
}

function listCard(b, showNames) {
  const rating = myRating(b);
  const missing = missingInSeries(b);
  const seriesBadge = b.series?.name
    ? `<span class="badge series-badge" title="Part of the ${esc(b.series.name)} series">
         ${esc(b.series.name)}${b.series.position ? " #" + b.series.position : ""}
       </span>`
    : "";
  const moreBadge = missing > 0
    ? `<span class="badge more-badge">${icon("books")} ${missing} more in series</span>`
    : "";
  return `
    <article class="book-card${selectedIds.has(b.id) ? " picked" : ""}" data-id="${esc(b.id)}">
      ${selectMode ? `<span class="pick-dot" aria-hidden="true">${icon("check")}</span>` : ""}
      ${coverHtml(b)}
      <div class="book-info">
        <h3>${esc(b.title)}</h3>
        <p class="authors">${esc((b.authors ?? []).join(", "))}</p>
        <p class="edition">
          ${esc([b.format, b.publisher, b.publishDate].filter(Boolean).join(" · "))}
        </p>
        <p class="isbn">${b.isbn13 ? "ISBN " + esc(b.isbn13) : ""}</p>
        ${rating ? `<p class="card-rating" aria-label="Rated ${rating} of 5">${starString(rating)}</p>` : ""}
        <div class="badges">
          ${iAmReading(b) ? `<span class="badge reading-badge">${icon("bookOpen")} Reading now</span>` : ""}
          ${currentShelf === "owned" && myShelf(b)
            ? `<span class="badge shelf-badge">${SHELF_ICON[myShelf(b)]} ${esc(SHELF_LABEL[myShelf(b)])}</span>`
            : ""}
          ${trackMedium() && MEDIUM_ICON[b.medium] ? `<span class="badge medium-badge">${icon(MEDIUM_ICON[b.medium])} ${esc(MEDIA[b.medium])}${b.owned ? "" : " · not owned"}</span>` : ""}
          ${trackContent() && b.content ? `<span class="badge content-badge">${flt.CONTENT_LABEL[b.content] ?? esc(b.content)}</span>` : ""}
          ${trackContent() && b.spice ? `<span class="badge spice-badge">${icon("flame")} ${b.spice}</span>` : ""}
          ${showNames && b.profile ? `<span class="badge profile-badge">${icon("user")} ${esc(b.profile)}</span>` : ""}
          ${seriesBadge}${moreBadge}
        </div>
      </div>
    </article>`;
}

async function checkSeriesInBackground(book) {
  // "Not in a series" is an answer, not a gap — don't keep re-asking.
  if (book.seriesManual && !book.series?.name) {
    seriesCache.set(book.id, { series: null, books: [], missingCount: 0, checkedAt: Date.now() });
    persistSeriesCache();
    return;
  }
  seriesCache.set(book.id, null); // mark in-flight
  try {
    const series = await api.detectSeries(book);
    if (!series) {
      seriesCache.set(book.id, { series: null, books: [], missingCount: 0, checkedAt: Date.now() });
      persistSeriesCache();
      return;
    }
    if (!book.series?.name && !book.seriesManual) db.updateBook(book.id, { series });

    const entries = await api.listSeriesBooks(series.name, book.authors);
    const ownedTitles = new Set(
      db.getOwnedBooks().map((b) => normTitle(b.title))
    );
    const missing = entries.filter((e) => !ownedTitles.has(normTitle(e.title)));
    seriesCache.set(book.id, {
      series,
      books: entries,
      missingCount: entries.length ? missing.length : 0,
      checkedAt: Date.now(),
    });
    persistSeriesCache();
    renderShelf();
  } catch {
    seriesCache.delete(book.id);
  }
}

function normTitle(t) {
  return (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------- shelf tabs ----------

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", t === tab);
    });
    currentShelf = tab.dataset.shelf;
    flippedIds.clear();
    // A selection belongs to the shelf you made it on.
    if (selectMode) return setSelectMode(false);
    renderShelf();
  });
});

// ---------- search & member filter ----------

let searchTimer = null;
$("#list-search").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderShelf, 120); // keep typing smooth on big shelves
});

// ---------- view mode ----------

function updateViewToggle() {
  const btn = $("#view-toggle");
  // Show the icon of the view you'd switch *to*.
  btn.innerHTML = icon(viewMode === "grid" ? "list" : "grid");
  btn.title = viewMode === "grid" ? "Switch to list view" : "Switch to shelf view";
}

$("#view-toggle").addEventListener("click", () => {
  viewMode = viewMode === "grid" ? "list" : "grid";
  localStorage.setItem(VIEW_KEY, viewMode);
  updateViewToggle();
  renderShelf();
});

$("#empty-action").addEventListener("click", (e) => {
  if (e.currentTarget.dataset.action === "clear") {
    shelfFilter = emptyFilter();
    setSort("added");
    searchQuery = "";
    $("#list-search").value = "";
    if (!$("#filter-panel").classList.contains("hidden")) renderFilterPanel();
    renderShelf();
  } else {
    addModal.showModal();
  }
});

// ---------- filter & sort panel ----------

$("#filter-toggle").addEventListener("click", () => {
  const panel = $("#filter-panel");
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  $("#filter-toggle").setAttribute("aria-expanded", opening);
  if (opening) renderFilterPanel();
});

function updateFilterBadge() {
  const n = flt.activeFilterCount(shelfFilter) + (shelfSort !== "added" ? 1 : 0);
  const badge = $("#filter-count");
  badge.textContent = n;
  badge.classList.toggle("hidden", n === 0);
}

// Genres that actually occur in the library, so the panel has no dead chips.
function libraryGenres() {
  const present = new Set();
  db.getAllBooks().forEach((b) => flt.genresOf(b).forEach((g) => present.add(g)));
  return flt.GENRES.map(([name]) => name).filter((g) => present.has(g));
}

function chipGroup(label, options, current, onPick) {
  const wrap = document.createElement("div");
  wrap.className = "filter-group";
  wrap.innerHTML = `<span class="filter-label">${esc(label)}</span>`;
  const row = document.createElement("div");
  row.className = "profile-filter";
  options.forEach(([value, text, glyph]) => {
    const btn = document.createElement("button");
    btn.className = "filter-chip" + (current === value ? " active" : "");
    // A third element names an icon; chips that have one draw it inline.
    btn.innerHTML = (glyph ? icon(glyph) : "") + `<span>${esc(text)}</span>`;
    btn.addEventListener("click", () => onPick(current === value ? null : value));
    row.appendChild(btn);
  });
  wrap.appendChild(row);
  return wrap;
}

// Dual-thumb page-count slider. Native range inputs are single-thumb, so two
// are stacked with only their thumbs clickable and a filled bar drawn between.
function pageRangeSlider(current, onChange) {
  const { min, max, step } = flt.PAGE_RANGE;
  const value = current ?? flt.fullPageRange();

  const wrap = document.createElement("div");
  wrap.className = "filter-group";
  wrap.innerHTML = `
    <span class="filter-label">Length <span class="range-value"></span></span>
    <div class="range-wrap">
      <div class="range-track"><div class="range-fill"></div></div>
      <input type="range" class="range-min" min="${min}" max="${max}" step="${step}"
             value="${value.min}" aria-label="Minimum pages" />
      <input type="range" class="range-max" min="${min}" max="${max}" step="${step}"
             value="${value.max}" aria-label="Maximum pages" />
    </div>
    <div class="range-ends"><span>${min}</span><span>${max}+</span></div>
    <p class="range-hint">Books with no page count are hidden while this is narrowed.</p>`;

  const lo = wrap.querySelector(".range-min");
  const hi = wrap.querySelector(".range-max");
  const fill = wrap.querySelector(".range-fill");
  const label = wrap.querySelector(".range-value");

  const paint = () => {
    const a = Number(lo.value);
    const b = Number(hi.value);
    fill.style.left = `${(a / max) * 100}%`;
    fill.style.right = `${100 - (b / max) * 100}%`;
    label.textContent = flt.pageRangeLabel({ min: a, max: b });
    wrap.classList.toggle("narrowed", !flt.isFullPageRange({ min: a, max: b }));
  };

  const clamp = (moved) => {
    // Keep a gap so the thumbs can never sit on top of each other.
    if (Number(lo.value) > Number(hi.value) - step) {
      if (moved === lo) lo.value = Math.max(min, Number(hi.value) - step);
      else hi.value = Math.min(max, Number(lo.value) + step);
    }
  };

  [lo, hi].forEach((input) => {
    input.addEventListener("input", () => {
      clamp(input);
      paint();
    });
    input.addEventListener("change", () =>
      onChange({ min: Number(lo.value), max: Number(hi.value) })
    );
  });

  paint();
  return wrap;
}

function renderFilterPanel() {
  const panel = $("#filter-panel");
  panel.innerHTML = "";

  const set = (key) => (value) => {
    shelfFilter[key] = value;
    renderFilterPanel();
    renderShelf();
  };

  // Sort leads the panel: it's what people open this for most, and picking
  // "Series, grouped" is how the shelf gets series headings.
  const sortWrap = document.createElement("div");
  sortWrap.className = "filter-group sort-group";
  sortWrap.innerHTML = `<span class="filter-label">Sort this shelf</span>`;
  const sortRow = document.createElement("div");
  sortRow.className = "profile-filter";
  flt.SORT_OPTIONS.forEach(([value, text, glyph]) => {
    const btn = document.createElement("button");
    btn.className = "filter-chip sort-chip" + (shelfSort === value ? " active" : "");
    btn.dataset.sort = value;
    btn.innerHTML = (glyph ? icon(glyph) : "") + `<span>${esc(text)}</span>`;
    btn.addEventListener("click", () => {
      setSort(value);
      renderFilterPanel();
      renderShelf();
    });
    sortRow.appendChild(btn);
  });
  sortWrap.appendChild(sortRow);
  if (groupBySeries()) {
    const note = document.createElement("p");
    note.className = "sort-note";
    note.textContent = "Books are stacked under their series, standalones last.";
    sortWrap.appendChild(note);
  }
  panel.appendChild(sortWrap);

  const genres = libraryGenres();
  if (genres.length) {
    panel.appendChild(
      chipGroup("Genre", genres.map((g) => [g, g]), shelfFilter.genre, set("genre"))
    );
  }
  panel.appendChild(
    pageRangeSlider(shelfFilter.pages, (range) => {
      shelfFilter.pages = flt.isFullPageRange(range) ? null : range;
      renderShelf();
    })
  );
  panel.appendChild(chipGroup("Series", flt.SERIES_OPTIONS, shelfFilter.series, set("series")));
  panel.appendChild(chipGroup("Published", flt.AGE_OPTIONS, shelfFilter.age, set("age")));
  const formatOptions = flt.FORMAT_OPTIONS.filter(
    ([v]) => trackMedium() || (v !== "ebook" && v !== "audio")
  );
  panel.appendChild(chipGroup("Format", formatOptions, shelfFilter.format, set("format")));
  panel.appendChild(chipGroup("Rating", flt.RATED_OPTIONS, shelfFilter.rated, set("rated")));
  if (currentShelf === "tbr" || currentShelf === "owned") {
    panel.appendChild(chipGroup("Status", flt.STATUS_OPTIONS, shelfFilter.status, set("status")));
  }
  const langs = [...new Set(db.getAllBooks().map((b) => flt.canonLang(b.language)).filter(Boolean))];
  if (langs.length >= 2) {
    panel.appendChild(chipGroup(
      "Language",
      langs.sort().map((c) => [c, flt.langLabel(c)]),
      shelfFilter.language,
      set("language")
    ));
  }
  if (trackContent()) {
    panel.appendChild(chipGroup("Content", flt.CONTENT_OPTIONS, shelfFilter.content, set("content")));
    panel.appendChild(chipGroup("Spice", flt.SPICE_OPTIONS, shelfFilter.spice, set("spice")));
  }

  const clear = document.createElement("button");
  clear.className = "link-btn";
  clear.textContent = "Clear all filters";
  clear.addEventListener("click", () => {
    shelfFilter = emptyFilter();
    setSort("added");
    renderFilterPanel();
    renderShelf();
  });
  panel.appendChild(clear);
}

function renderProfileFilter(show) {
  const el = $("#profile-filter");
  const profiles = allProfiles();
  if (!show || profiles.length === 0) {
    el.innerHTML = "";
    return;
  }
  const me = currentProfile();
  const chips = [];
  if (me) chips.push(["me", `Mine (${me})`]);
  profiles.filter((p) => p !== me).forEach((p) => chips.push([p, p]));
  chips.push(["all", "Everyone"]);
  el.innerHTML = chips
    .map(
      ([v, label]) =>
        `<button class="filter-chip ${memberFilter === v ? "active" : ""}"
                 data-filter="${esc(v)}">${esc(label)}</button>`
    )
    .join("");
  el.querySelectorAll("[data-filter]").forEach((btn) =>
    btn.addEventListener("click", () => {
      memberFilter = btn.dataset.filter;
      renderShelf();
    })
  );
}

// ---------- profile UI ----------

function updateProfileChip() {
  const me = currentProfile();
  $("#profile-avatar").textContent = me ? me[0].toUpperCase() : "?";
  $("#profile-name").textContent = me ?? "Set profile";
  // If the first-run prompt was dismissed, keep a visible nudge so the
  // profile doesn't silently stay unset.
  $("#profile-banner").classList.toggle("hidden", !!me);
}

$("#profile-banner").addEventListener("click", () => showScreen("profile"));
$("#shelf-hero").addEventListener("click", () => showScreen("stats"));

// Everyone this library knows about: names already on books, plus every
// member of the shared library. Used both for "who is holding this phone"
// and for "whose book is this" — a member who has added nothing yet still
// has to be assignable, or the only way to give them a book is to wait for
// them to buy one.
function libraryPeople() {
  const names = new Set(allProfiles());
  syncMembers.forEach((mem) => {
    if (mem.name && mem.name !== "Someone") names.add(mem.name);
  });
  return [...names].sort();
}

$("#profile-chip").addEventListener("click", () => showScreen("profile"));

function renderProfileScreen() {
  const el = $("#profile-content");
  const me = currentProfile();
  const people = libraryPeople();
  // Signed in, your name is yours: it comes from the account, not from which
  // phone you picked it up on. Becoming one of the other people in the library
  // was never a thing anyone wanted to do — it was the only way to hand them a
  // book, and "Belongs to" does that directly. So the roster below is a roster,
  // not a set of costumes.
  const signedIn = !!sync.accountHint();
  const others = people.filter((p) => p !== me);

  el.innerHTML = signedIn
    ? `
    <p>Profiles keep each person's <strong>To Read, Completed and Wishlist</strong>
    separate, while the <strong>Owned</strong> shelf stays shared.</p>
    <div class="settings-section">
      <span class="filter-label">You</span>
      <div class="profile-list" style="margin-top:0.4rem">
        <span class="filter-chip big active">${icon("user")} ${esc(me ?? "Not set")}</span>
      </div>
      <form id="new-profile-form" class="inline-form" style="margin-top:0.7rem">
        <input type="text" id="new-profile-input" maxlength="30" autocomplete="off"
               placeholder="${me ? "Change your name" : "Add a name (e.g. Zach)"}" />
        <button type="submit" class="primary-btn">${me ? "Rename" : "Create"}</button>
      </form>
      <p class="muted" style="font-size:0.78rem;margin-top:0.5rem">
        This name follows your account, so it's the same on every device you
        sign in on.</p>
    </div>
    ${others.length ? `
    <div class="settings-section">
      <span class="filter-label">Others in this library</span>
      <div class="profile-list" style="margin-top:0.4rem">
        ${others.map((p) => `<span class="filter-chip big">${icon("user")} ${esc(p)}</span>`).join("")}
      </div>
      <p class="muted" style="font-size:0.78rem;margin-top:0.5rem">
        Their shelves are theirs — you can't sign in as them. To put a book on
        someone's shelf, open it and set <strong>Belongs to</strong>, or select
        several books and use the bar at the bottom.</p>
    </div>` : ""}`
    : `
    <p>Profiles keep each person's <strong>To Read, Completed and Wishlist</strong>
    separate, while the <strong>Owned</strong> shelf stays shared. Pick who's using
    this phone:</p>
    ${people.length && !me
      ? `<p class="muted" style="font-size:0.8rem;margin-top:-0.3rem">Tap your name
         if it's here — these come from your shared library and shelves.</p>`
      : ""}
    <div class="profile-list">
      ${people
        .map(
          (p) => `<button class="filter-chip big ${p === me ? "active" : ""}"
                          data-pick-profile="${esc(p)}">${icon("user")} ${esc(p)}</button>`
        )
        .join("")}
    </div>
    <form id="new-profile-form" class="inline-form" style="margin-top:0.7rem">
      <input type="text" id="new-profile-input" placeholder="Add a name (e.g. Zach)"
             autocomplete="off" maxlength="30" />
      <button type="submit" class="primary-btn">${people.length ? "Add" : "Create"}</button>
    </form>
    <p class="muted" style="font-size:0.78rem">Each phone remembers its own profile.
    ${sync.isConfigured() ? `Sign in under <strong>Settings → Account</strong> and it
    follows you instead.` : ""}
    Books added before profiles existed are shared — open one and use
    “Belongs to” to assign it.</p>`;

  // Who you are follows the account, not the container the app happens to be
  // running in — so picking a name here settles it everywhere you're signed in.
  const setProfile = (name) => {
    localStorage.setItem(PROFILE_KEY, name);
    sync.saveAccountProfile({ profileName: name }).catch(() => {});
    memberFilter = "me";
    updateProfileChip();
    renderShelf();
    showScreen("shelves");
  };

  el.querySelectorAll("[data-pick-profile]").forEach((btn) =>
    btn.addEventListener("click", () => setProfile(btn.dataset.pickProfile))
  );
  $("#new-profile-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#new-profile-input").value.trim();
    if (name) setProfile(name);
  });
}

// ---------- add flow ----------

$("#add-book-btn").addEventListener("click", () => {
  scanStatus.textContent = "";
  searchResults.innerHTML = "";
  addModal.showModal();
});

document.querySelectorAll("[data-close]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const modal = $("#" + btn.dataset.close);
    if (modal === addModal) closeScanner();
    modal.close();
  })
);

function closeScanner() {
  stopLiveScan(scannerVideo);
  scannerArea.classList.add("hidden");
}

$("#method-camera").addEventListener("click", async () => {
  scannerArea.classList.remove("hidden");
  scanStatus.textContent = "Starting camera… point it at the book's barcode.";
  await startLiveScan(
    scannerVideo,
    (isbn) => {
      scanStatus.textContent = `Found barcode ${isbn} — looking it up…`;
      handleFoundIsbn(isbn);
    },
    (err) => {
      scanStatus.textContent =
        "Camera unavailable (" + err.message + "). Try the photo option or manual entry. " +
        "Note: the camera needs the app served over HTTPS or localhost.";
      scannerArea.classList.add("hidden");
    }
  );
});

$("#stop-scan-btn").addEventListener("click", closeScanner);

$("#method-photo").addEventListener("click", () => $("#photo-input").click());

$("#photo-input").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  scanStatus.textContent = "Reading barcodes from the photo…";
  try {
    const isbns = await scanImageFile(file);
    if (isbns.length === 0) {
      scanStatus.textContent =
        "No barcode found in that photo. Get closer to the barcode (usually on the back cover), or enter the ISBN manually below.";
      return;
    }
    scanStatus.textContent = `Found ${isbns.length} book${isbns.length > 1 ? "s" : ""} — looking them up…`;
    for (const isbn of isbns) await handleFoundIsbn(isbn);
  } catch (err) {
    scanStatus.textContent = "Could not read that image: " + err.message;
  }
});

scanStatus.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-open-existing]");
  if (!btn) return;
  addModal.close();
  openDetail(btn.dataset.openExisting);
});

async function handleFoundIsbn(isbn) {
  try {
    const book = await api.lookupByIsbn(isbn);
    if (!book) {
      scanStatus.textContent = `No book found for ISBN ${isbn}. Try searching by title below.`;
      return;
    }
    // Already own this exact copy? Nothing to decide — say so and move on,
    // which keeps scanning a stack of books fast. On any other shelf it's
    // worth opening the sheet: scanning a book usually means you now have it
    // in hand, and "it's on your Wishlist" should be one tap from Owned.
    const already = findExisting(book);
    if (already?.sameEdition && already.book.owned) {
      // If that copy was added by title search it has no edition details;
      // the barcode in your hand is exactly what's missing, so fill them in.
      const vague = !already.book.isbn13;
      if (vague) {
        db.addBook({ ...book, id: already.book.id });
        seriesCache.delete(already.book.id);
        renderShelf();
      }
      // Don't dead-end: with a big shelf, scanning a book is often the
      // fastest way to *find* it, so offer the way through.
      scanStatus.innerHTML = `${
        vague
          ? `You already own “${esc(book.title)}” — filled in this edition's details.`
          : `You already own “${esc(book.title)}” — it's on your Owned shelf.`
      } <button class="link-btn" data-open-existing="${esc(already.book.id)}">Open it</button>`;
      navigator.vibrate?.(30);
      return;
    }
    // Buzz and flash: unmistakable feedback that the barcode locked on.
    navigator.vibrate?.(30);
    scannerArea.classList.remove("hit");
    void scannerArea.offsetWidth;
    scannerArea.classList.add("hit");
    queueBookForConfirm(book);
  } catch (err) {
    scanStatus.textContent = "Lookup failed: " + err.message;
  }
}

// ---------- manual entry ----------

$("#isbn-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const isbn = api.normalizeIsbn($("#isbn-input").value);
  if (!isbn) {
    scanStatus.textContent = "That doesn't look like a valid ISBN (need 10 or 13 digits).";
    return;
  }
  scanStatus.textContent = `Looking up ISBN ${isbn}…`;
  await handleFoundIsbn(isbn);
  $("#isbn-input").value = "";
});

const LANG_KEY = "shelfie.searchLang.v1";
{
  const sel = $("#search-lang");
  sel.innerHTML = flt.SEARCH_LANGS
    .map(([v, label]) => `<option value="${v}">${label}</option>`)
    .join("");
  sel.value = localStorage.getItem(LANG_KEY) ?? "eng";
  sel.addEventListener("change", () => localStorage.setItem(LANG_KEY, sel.value));
}

$("#title-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#title-input").value.trim();
  if (!q) return;
  scanStatus.textContent = "Searching…";
  let results;
  try {
    results = await api.searchByTitle(q, { language: $("#search-lang").value });
  } catch {
    // Don't tell someone their book doesn't exist when the lookup is what
    // failed — they'd go and add it by hand for no reason.
    scanStatus.textContent = navigator.onLine
      ? "Couldn't reach Open Library just now. Try again in a moment."
      : "You're offline — book search needs a connection.";
    searchResults.innerHTML = "";
    return;
  }
  scanStatus.textContent = results.length
    ? `${results.length} match${results.length === 1 ? "" : "es"} — scroll for more.`
    : "No matches found.";
  searchResults.innerHTML = results
    .map(
      (r, i) => `
      <button class="search-result" data-idx="${i}">
        ${r.coverUrl ? `<img src="${esc(r.coverUrl)}" alt="" />` : `<span class="cover-ph"></span>`}
        <span>
          <strong>${esc(r.title)}</strong><br />
          <small>${esc(r.authors.join(", "))}${r.year ? " · " + r.year : ""}${
            r.language && flt.canonLang(r.language) !== flt.canonLang($("#search-lang").value)
              ? ` · <em>${esc(flt.langLabel(r.language))}</em>` : ""}</small>
        </span>
      </button>`
    )
    .join("");
  searchResults.querySelectorAll(".search-result").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const r = results[Number(btn.dataset.idx)];
      scanStatus.textContent = `Loading “${r.title}”…`;
      // Prefer a real edition via its ISBN so we keep version specifics.
      let book = r.isbns?.length ? await api.lookupByIsbn(r.isbns[0]) : null;
      if (!book) {
        book = {
          id: "ol:" + r.workKey.replace("/works/", ""),
          title: r.title,
          authors: r.authors,
          workKey: r.workKey,
          coverUrl: r.coverUrl?.replace("-S.jpg", "-M.jpg") ?? null,
          isbn13: null, isbn10: null, publisher: null, publishDate: null,
          pageCount: null, format: null, editionKey: null, series: null,
          language: r.language ?? null,
        };
      }
      scanStatus.textContent = "";
      queueBookForConfirm(book);
    })
  );
});

// ---------- confirm / shelf choice ----------

let pendingMedium = "print";

function setPendingMedium(medium) {
  pendingMedium = medium;
  document.querySelectorAll("#medium-choice [data-medium]").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.medium === medium)
  );
}

document.querySelectorAll("#medium-choice [data-medium]").forEach((btn) =>
  btn.addEventListener("click", () => setPendingMedium(btn.dataset.medium))
);

function queueBookForConfirm(book) {
  pendingBooks.push(book);
  if (!confirmModal.open) showNextPendingBook();
}

// Is this book already in the library? The same edition (matching ISBN-13, or
// the id we'd generate) is the same record and gets updated rather than
// duplicated. A different edition of the same work is a real second book —
// worth pointing out, but the user's call.
function findExisting(book) {
  const all = db.getAllBooks();
  const byId = all.find((b) => b.id === book.id);
  if (byId) return { book: byId, sameEdition: true };
  if (book.isbn13) {
    const byIsbn = all.find((b) => b.isbn13 && b.isbn13 === book.isbn13);
    if (byIsbn) return { book: byIsbn, sameEdition: true };
  }
  if (book.workKey) {
    const byWork = all.find((b) => b.workKey && b.workKey === book.workKey);
    // Two records can only be *different* editions if both name an edition.
    // A shelf copy added by title search carries no ISBN, so scanning that
    // book fills in the edition details rather than making a second entry.
    if (byWork) return { book: byWork, sameEdition: !byWork.isbn13 };
  }
  return null;
}

function dupeNote(book) {
  const hit = findExisting(book);
  if (!hit) return "";
  const where = esc(SHELF_LABEL[displayShelf(hit.book)] ?? "your library");
  if (hit.sameEdition) {
    return `<p class="dupe-note">You already have this on your ${where} shelf — picking a
      shelf updates it rather than adding a second one.</p>`;
  }
  return `<p class="dupe-note">You already have a different edition of this on your ${where}
    shelf. Adding it makes a second entry — right if you own both copies.</p>`;
}

function showNextPendingBook() {
  const book = pendingBooks[0];
  if (!book) {
    confirmModal.close();
    return;
  }
  $("#confirm-book").innerHTML = `
    ${coverHtml(book)}
    <div>
      <h3>${esc(book.title)}</h3>
      ${book.subtitle ? `<p class="subtitle">${esc(book.subtitle)}</p>` : ""}
      <p class="authors">${esc((book.authors ?? []).join(", "))}</p>
      <p class="edition">${esc([book.format, book.publisher, book.publishDate,
        book.pageCount ? book.pageCount + " pages" : null].filter(Boolean).join(" · "))}</p>
      <p class="isbn">${book.isbn13 ? "ISBN-13 " + esc(book.isbn13) : ""}
        ${book.isbn10 ? " · ISBN-10 " + esc(book.isbn10) : ""}</p>
      ${dupeNote(book)}
    </div>`;
  // A scanned barcode means a physical book in hand; reset per book. The
  // picker only appears when copy-type tracking is enabled in Settings.
  setPendingMedium("print");
  $("#medium-group").classList.toggle("hidden", !trackMedium());
  if (!confirmModal.open) confirmModal.showModal();
}

// "Owned" and "To Read" look like rival choices, so a book you own and mean
// to read next looks impossible — you pick one and lose the other. It isn't:
// ownership is a separate flag, and To Read / Finished carry it. Rather than
// explain that anywhere, each button says what you'll actually get.
function markShelfPicks() {
  $("#shelf-choice").classList.toggle("owning", $("#also-own-checkbox").checked);
}
$("#also-own-checkbox").addEventListener("change", markShelfPicks);
markShelfPicks();

document.querySelectorAll("[data-add-shelf]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const scanned = pendingBooks.shift();
    if (!scanned) return;
    // Same edition already on a shelf: keep its id so this updates the record
    // (and its ratings and reviews) instead of creating a twin.
    const hit = findExisting(scanned);
    const book = hit?.sameEdition ? { ...scanned, id: hit.book.id } : scanned;
    const shelf = btn.dataset.addShelf;
    const alsoOwn = $("#also-own-checkbox").checked;
    const owned = shelf === "owned" || (alsoOwn && shelf !== "wishlist");
    db.addBook({
      ...flt.suggestContent(book), // coarse auto-tags; user-editable
      ...book,
      shelf,
      owned,
      medium: pendingMedium,
      profile: currentProfile() ?? null,
    });
    // Fetch genre subjects in the background so filters know this book.
    if (book.workKey && !book.subjects?.length) {
      api.fetchWorkSubjects(book.workKey).then((subjects) => {
        if (subjects.length) db.updateBook(book.id, { subjects });
      });
    }
    seriesCache.delete(book.id);
    renderShelf();
    navigator.vibrate?.(15);
    const tab = document.querySelector(`.tab[data-shelf="${shelf}"] .count`);
    tab?.classList.remove("pop");
    void tab?.offsetWidth; // restart the animation
    tab?.classList.add("pop");
    scanStatus.textContent = `Added “${book.title}” to ${SHELF_LABEL[shelf]}.`;
    // Undoing a merge has to put the old record back — removing it would
    // take the book (and its ratings) with it.
    const previous = hit?.sameEdition ? JSON.parse(JSON.stringify(hit.book)) : null;
    toast(`Added to ${SHELF_LABEL[shelf]}`, {
      actionLabel: "Undo",
      onAction: () => {
        if (previous) db.replaceBook(previous);
        else db.removeBook(book.id);
        renderShelf();
        toast(previous ? "Put back how it was" : "Removed again");
      },
    });
    showNextPendingBook();
  })
);

// A toast parked inside a dialog (see toast()) would vanish with it, taking
// its Undo along; hand it back to the page so it lives out its five seconds.
document.querySelectorAll("dialog").forEach((dlg) =>
  dlg.addEventListener("close", () => {
    const region = $("#toast-region");
    if (region.parentElement === dlg) document.body.appendChild(region);
  })
);

confirmModal.addEventListener("close", () => {
  // If dismissed without choosing, drop the current pending book.
  if (pendingBooks.length) {
    pendingBooks.shift();
    if (pendingBooks.length) setTimeout(showNextPendingBook, 50);
  }
});

// ---------- detail view ----------

bookList.addEventListener("click", (e) => {
  const card = e.target.closest("[data-id]");
  if (!card) return;
  const id = card.dataset.id;
  const b = db.getBook(id);
  if (!b) return;

  // While selecting, a tap picks the book — nothing opens, nothing flips.
  if (selectMode) {
    e.preventDefault();
    return toggleSelected(id);
  }

  // List view keeps the straightforward tap-to-open behaviour.
  const flip = card.querySelector(".flip");
  if (!flip) return openDetail(id);

  if (!e.target.closest("[data-qa-move]")) disarmQuickAction();

  const rate = e.target.closest("[data-qa-rate]");
  if (rate) {
    const me = currentProfile() ?? "Me";
    const value = Number(rate.dataset.qaRate);
    undoable(`Rated ${"★".repeat(value)}`, b, () => {
      db.updateBook(id, { ratings: { ...(b.ratings ?? {}), [me]: value }, rating: null });
      shareToCommunity(id);
    });
    flippedIds.delete(id);
    renderShelf();
    return;
  }
  if (e.target.closest("[data-qa-reading]")) {
    undoable(iAmReading(b) ? "No longer reading" : "Started reading", b, () =>
      db.setShelfFor(id, currentProfile(), { reading: !iAmReading(b) })
    );
    flippedIds.delete(id);
    renderShelf();
    return;
  }
  const move = e.target.closest("[data-qa-move]");
  if (move) {
    const to = move.dataset.qaMove;
    // Moving a book between shelves is the one quick action worth a beat of
    // hesitation, so the first tap only arms it.
    if (move.dataset.armed !== "1") return armQuickAction(move);
    // Too soon to be a considered second tap — it's a double-tap or a mash.
    // Restart the window rather than counting it, so drumming on the button
    // never commits; only a tap after a pause does.
    if (Date.now() - armedAt < ARM_DELAY) return armQuickAction(move);
    disarmQuickAction();
    undoable(`Moved to ${SHELF_LABEL[to]}`, b, () => {
      moveToShelf(b, to);
      social.publishSoon(currentProfile());
    });
    flippedIds.delete(id);
    renderShelf();
    return;
  }
  if (e.target.closest("[data-qa-remove]")) {
    if (!confirmRemoval(b)) return;
    removeBookEverywhere(b);
    return;
  }
  if (e.target.closest("[data-qa-details]")) {
    setFlipped(flip, id, false);
    return openDetail(id);
  }
  if (e.target.closest("[data-flip]")) return setFlipped(flip, id, !flip.classList.contains("flipped"));
  if (suppressNextCardClick) return; // a long-press already flipped it

  // Flipped card: tapping the empty part of the back returns to the cover.
  if (flip.classList.contains("flipped")) return setFlipped(flip, id, false);
  openDetail(id);
});

// An armed button is one tap from moving a book, so it can never be left
// armed behind your back: it disarms on any other tap, on flipping the card
// away, and on its own after a few seconds.
let armedBtn = null;
let armedTimer = null;

// A double-tap — a bouncy finger, or a stray one on a scrolling list — must
// not sail through both taps. The confirming tap only counts once the button
// has been armed long enough to have been seen.
const ARM_DELAY = 350;
let armedAt = 0;

function armQuickAction(btn, prompt) {
  disarmQuickAction();
  armedBtn = btn;
  armedAt = Date.now();
  btn.dataset.armed = "1";
  btn.classList.add("armed");
  const label = btn.querySelector(".qa-label");
  if (label) {
    btn.dataset.label = label.textContent;
    // With icons, the armed state is also the legend: it says what the next
    // tap does rather than a bare "Sure?", so pressing a glyph you don't
    // recognise tells you what it is before it does anything.
    label.textContent = prompt ?? `${label.textContent}?`;
  }
  navigator.vibrate?.(6);
  armedTimer = setTimeout(disarmQuickAction, 3500);
}

function disarmQuickAction() {
  clearTimeout(armedTimer);
  if (!armedBtn) return;
  const label = armedBtn.querySelector(".qa-label");
  if (label && armedBtn.dataset.label) label.textContent = armedBtn.dataset.label;
  armedBtn.classList.remove("armed");
  delete armedBtn.dataset.armed;
  delete armedBtn.dataset.label;
  armedBtn = null;
}

// Turning a card lengthens it, which reflows the whole grid below. Left
// alone, a book near the bottom of the screen shoves everything under it
// further down — into rows you haven't reached yet — and the row you were
// actually looking at slides away under your thumb.
//
// So the growth is pushed the other way: the page is scrolled by however much
// the card grew, which pins everything below it exactly where it was and
// spends the new height on the rows above — the ones you've already scrolled
// past and are done with. Shrinking on the way back does the reverse.
//
// Cards near the very top of the page are the exception: there's nothing
// above to spend, and scrolling would just fight the top of the list.
function setFlipped(flip, id, on) {
  disarmQuickAction();
  const before = flip.getBoundingClientRect();
  const scroller = document.scrollingElement ?? document.documentElement;
  const roomAbove = scroller.scrollTop;

  flip.classList.toggle("flipped", on);
  if (on) flippedIds.add(id);
  else flippedIds.delete(id);
  navigator.vibrate?.(8);

  // The card grows over the length of the flip animation, so the correction
  // is applied every frame rather than once at the end — a single catch-up
  // jump afterwards would be the very lurch this exists to prevent. Measured
  // rather than predicted, because the aspect ratio belongs to the skin.
  if (roomAbove < 4 && on) return; // at the top of the list: nothing to spend
  let last = before.height;
  const until = performance.now() + 520; // the 0.4s transition, plus slack
  const pin = () => {
    const now = flip.getBoundingClientRect().height;
    const grew = now - last;
    if (grew) {
      // Growing: only take from what's above, never scroll past the top.
      // Shrinking: give it straight back.
      const shift = grew > 0 ? Math.min(grew, scroller.scrollTop) : grew;
      if (shift) scroller.scrollTop += shift;
      last = now;
    }
    if (performance.now() < until) requestAnimationFrame(pin);
  };
  requestAnimationFrame(pin);
}

// Long-press anywhere on a card is a shortcut to the same quick actions.
let pressTimer = null;
let suppressNextCardClick = false;
bookList.addEventListener("pointerdown", (e) => {
  const card = e.target.closest(".grid-book");
  if (selectMode) return; // a press is a pick, not a flip
  if (!card || e.target.closest("[data-qa-details],[data-qa-rate],[data-qa-move],[data-qa-reading]")) return;
  clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    const flip = card.querySelector(".flip");
    if (!flip) return;
    setFlipped(flip, card.dataset.id, !flip.classList.contains("flipped"));
    suppressNextCardClick = true;
    setTimeout(() => (suppressNextCardClick = false), 400);
  }, 450);
});
["pointerup", "pointercancel", "pointermove", "scroll"].forEach((ev) =>
  bookList.addEventListener(ev, () => clearTimeout(pressTimer), { passive: true })
);

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// Say when you read something. Books the app watched you finish already know,
// but a book logged from an old shelf doesn't — setting a month here is how
// you put it in your reading year. Two selects rather than a date input:
// month is the right grain, and it behaves the same on every phone.
function readMonthRow(book) {
  if (myShelf(book) !== "completed") return "";
  const mine = db.finishedAtFor(book, currentProfile());
  const when = book.readHere && mine ? new Date(mine) : null;
  const valid = when && !Number.isNaN(when.getTime());
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, i) => thisYear - i);
  const selMonth = valid ? when.getMonth() : "";
  const selYear = valid ? when.getFullYear() : thisYear;
  return `
    <div class="read-when">
      <span class="filter-label">Read in</span>
      <div class="read-when-row">
        <select id="read-month">
          <option value="">—</option>
          ${MONTH_NAMES.map((m, i) =>
            `<option value="${i}" ${selMonth === i ? "selected" : ""}>${m}</option>`).join("")}
        </select>
        <select id="read-year">
          ${years.map((y) =>
            `<option value="${y}" ${selYear === y ? "selected" : ""}>${y}</option>`).join("")}
        </select>
      </div>
    </div>`;
}

function wireReadMonth(book) {
  const month = $("#read-month");
  const year = $("#read-year");
  if (!month || !year) return;
  const apply = () => {
    if (month.value === "") {
      // Blank means "don't put this in my reading year" — the record keeps
      // its finish date, it just stops counting.
      db.updateBook(book.id, { readHere: false });
      toast("Left out of your reading year");
    } else {
      const when = new Date(Number(year.value), Number(month.value), 15, 12);
      db.updateBook(book.id, { finishedAt: when.toISOString(), readHere: true });
      toast(`Read in ${MONTH_NAMES[Number(month.value)]} ${year.value}`);
    }
    social.publishSoon(currentProfile());
    renderShelf();
  };
  month.addEventListener("change", apply);
  year.addEventListener("change", () => month.value !== "" && apply());
}

async function openDetail(id) {
  const b = db.getBook(id);
  if (!b) return;

  const rows = [
    ["Author(s)", (b.authors ?? []).join(", ")],
    ...(trackMedium()
      ? [["Copy", MEDIA[b.medium ?? "print"] + (b.owned ? " · owned" : " · not owned")]]
      : []),
    ["Format", b.format],
    ["Language", b.language ? flt.langLabel(b.language) : null],
    ["Publisher", b.publisher],
    ["Published", b.publishDate],
    ["Pages", b.pageCount],
    ["ISBN-13", b.isbn13],
    ["ISBN-10", b.isbn10],
    ["Open Library edition", b.editionKey],
    ["Shelf", SHELF_LABEL[displayShelf(b)] + (b.owned && displayShelf(b) !== "owned" ? " (owned copy)" : "")],
  ].filter(([, v]) => v);

  const heroMeta = [
    (b.authors ?? []).join(", "),
    [b.publishDate, b.pageCount ? `${b.pageCount} pages` : null].filter(Boolean).join(" · "),
    b.series?.name ? `${b.series.name}${b.series.position ? ` #${b.series.position}` : ""}` : null,
  ].filter(Boolean);

  $("#detail-content").innerHTML = `
    <div class="book-hero">
      ${coverHtml(b)}
      <div class="hero-info">
        <h3>${esc(b.title)}</h3>
        ${b.subtitle ? `<p class="subtitle">${esc(b.subtitle)}</p>` : ""}
        <p class="hero-meta">${heroMeta.map(esc).join("<br />")}</p>
        <div class="badges">
          <span class="badge shelf-badge">${SHELF_ICON[displayShelf(b)]} ${esc(SHELF_LABEL[displayShelf(b)])}</span>
          ${iAmReading(b) ? `<span class="badge reading-badge">${icon("bookOpen")} Reading now</span>` : ""}
        </div>
      </div>
    </div>
    <details class="d-section" open><summary>My take</summary><div class="d-body">
    ${(() => {
      // Ownership is always editable for To Read / Finished; the medium
      // chips appear only when copy-type tracking is enabled.
      const readingToggle = myShelf(b) === "tbr" || !myShelf(b)
        ? `<button class="filter-chip ${iAmReading(b) ? "active" : ""}" data-reading-toggle>
             ${icon("bookOpen")} ${iAmReading(b) ? "Reading now" : "Start reading"}</button>`
        : "";
      const ownedToggle = myShelf(b) !== "wishlist"
        ? `<button class="filter-chip ${b.owned ? "active" : ""}" data-owned-toggle
             title="Untoggle for library loans, Kindle Unlimited, borrowed audiobooks">
             ${b.owned ? "✓ I own it" : "Not owned"}</button>`
        : "";
      const mediumChips = trackMedium()
        ? Object.entries(MEDIA)
            .map(([value, label]) =>
              `<button class="filter-chip ${(b.medium ?? "print") === value ? "active" : ""}"
                       data-set-medium="${value}">${label}</button>`)
            .join("")
        : "";
      if (!mediumChips && !ownedToggle && !readingToggle) return "";
      return `<div class="assign-row">
        <span class="rate-label">${mediumChips ? "Copy:" : "Status:"}</span>
        ${mediumChips}${ownedToggle}${readingToggle}
      </div>`;
    })()}
    ${(() => {
      // Everyone in the library, not just everyone who already owns something:
      // handing a new member their first book is exactly when you need this,
      // and it was the one case the old list couldn't do.
      const people = libraryPeople();
      return people.length ? `
    <div class="assign-row">
      <span class="rate-label">Belongs to:</span>
      ${people
        .map((p) => `<button class="filter-chip ${b.profile === p ? "active" : ""}"
                       data-assign="${esc(p)}">${esc(p)}</button>`)
        .join("")}
      <button class="filter-chip ${!b.profile ? "active" : ""}" data-assign="">Shared</button>
    </div>` : "";
    })()}
    ${trackContent() ? `
    <div class="assign-row">
      <span class="rate-label">Content:</span>
      ${flt.CONTENT_OPTIONS.filter(([v]) => v !== "sfw")
        .map(([value, label]) =>
          `<button class="filter-chip ${b.content === value ? "active" : ""}"
                   data-set-content="${value}">${label}</button>`)
        .join("")}
    </div>
    <div class="rate-row">
      <span class="rate-label">Spice:</span>
      <span class="rate-stars">
        ${[1, 2, 3, 4, 5]
          .map((n) => `<button class="star-btn spice-pip ${(b.spice ?? 0) >= n ? "filled" : ""}"
                        data-spice="${n}" aria-label="Spice ${n} of 5">${icon("flame")}</button>`)
          .join("")}
      </span>
      ${b.spice ? `<button class="link-btn" data-clear-spice>clear</button>` : ""}
    </div>` : ""}
    <div class="rate-row">
      <span class="rate-label">Your rating:</span>
      <span class="rate-stars">
        ${[1, 2, 3, 4, 5]
          .map((n) => `<button class="star-btn ${myRating(b) >= n ? "filled" : ""}" data-rate="${n}"
                        aria-label="Rate ${n} of 5">${myRating(b) >= n ? "★" : "☆"}</button>`)
          .join("")}
      </span>
      ${myRating(b) ? `<button class="link-btn" data-clear-rating>clear</button>` : ""}
    </div>
    ${Object.entries(b.ratings ?? {})
      .filter(([name, r]) => name !== currentProfile() && r)
      .map(([name, r]) => `<p class="other-rating">${esc(name)}: <span class="card-rating">${starString(r)}</span></p>`)
      .join("")}
    ${readMonthRow(b)}
    <div class="review-section">
      <span class="filter-label">Your review</span>
      <textarea id="review-input" rows="3" placeholder="What did you think? Reviews sync to your shared library.">${esc(b.reviews?.[currentProfile()]?.text ?? "")}</textarea>
      <button id="save-review-btn" class="secondary-btn">Save review</button>
      ${Object.entries(b.reviews ?? {})
        .filter(([name, r]) => name !== currentProfile() && r?.text)
        .map(([name, r]) => `
          <blockquote class="other-review">
            <p>${esc(r.text)}</p>
            <cite>— ${esc(name)}</cite>
          </blockquote>`)
        .join("")}
      <p class="community-line" id="community-line"></p>
    </div>
    </div></details>

    <details class="d-section"><summary>Book details</summary><div class="d-body">
      <table class="detail-table">
        ${rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(String(v))}</td></tr>`).join("")}
      </table>
    </div></details>

    <details class="d-section"><summary>Find a copy</summary><div class="d-body">
      <div class="store-links">
        ${storeLinks(b)
          .map(([label, url]) =>
            `<a class="store-link" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`)
          .join("")}
      </div>
    </div></details>

    <div class="detail-actions">
      ${SHELVES
        .filter((s) => s !== (s === "owned" ? (b.owned ? "owned" : null) : myShelf(b)))
        .map((s) => `<button class="secondary-btn" data-move="${s}">Move to ${SHELF_LABEL[s]}</button>`)
        .join("")}
      <button class="danger-btn" data-delete>Remove</button>
    </div>
    <details class="d-section" ${b.series?.name ? "open" : ""}><summary>Series</summary>
      <div class="d-body">
        <div id="series-section" class="series-section">
          <p class="series-loading">Checking series info…</p>
        </div>
      </div>
    </details>`;
  detailModal.showModal();
  wireReadMonth(b);

  $("#detail-content").querySelectorAll("[data-move]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const to = btn.dataset.move;
      undoable(`Moved to ${SHELF_LABEL[to]}`, b, () => moveToShelf(b, to));
      social.publishSoon(currentProfile());
      detailModal.close();
      renderShelf();
    })
  );
  $("#save-review-btn")?.addEventListener("click", () => {
    const text = $("#review-input").value.trim();
    const me = currentProfile() ?? "Me";
    const reviews = { ...(b.reviews ?? {}) };
    if (text) reviews[me] = { text, updatedAt: new Date().toISOString() };
    else delete reviews[me];
    db.updateBook(id, { reviews });
    shareToCommunity(id);
    openDetail(id);
  });
  $("#detail-content").querySelectorAll("[data-set-content]").forEach((btn) =>
    btn.addEventListener("click", () => {
      // Tapping the active tag clears it back to untagged.
      db.updateBook(id, { content: b.content === btn.dataset.setContent ? null : btn.dataset.setContent });
      shareToCommunity(id);
      renderShelf();
      openDetail(id);
    })
  );
  $("#detail-content").querySelectorAll("[data-spice]").forEach((btn) =>
    btn.addEventListener("click", () => {
      db.updateBook(id, { spice: Number(btn.dataset.spice) });
      shareToCommunity(id);
      renderShelf();
      openDetail(id);
    })
  );
  $("#detail-content").querySelector("[data-clear-spice]")?.addEventListener("click", () => {
    db.updateBook(id, { spice: null });
    renderShelf();
    openDetail(id);
  });
  $("#detail-content").querySelectorAll("[data-set-medium]").forEach((btn) =>
    btn.addEventListener("click", () => {
      db.updateBook(id, { medium: btn.dataset.setMedium });
      renderShelf();
      openDetail(id);
    })
  );
  // Reading is a thing a person does, not a property of the copy: she can be
  // halfway through the book he hasn't opened.
  $("#detail-content").querySelector("[data-reading-toggle]")?.addEventListener("click", () => {
    db.setShelfFor(id, currentProfile(), { reading: !iAmReading(b) });
    renderShelf();
    openDetail(id);
  });
  $("#detail-content").querySelector("[data-owned-toggle]")?.addEventListener("click", () => {
    db.updateBook(id, { owned: !b.owned });
    renderShelf();
    openDetail(id);
  });
  $("#detail-content").querySelectorAll("[data-assign]").forEach((btn) =>
    btn.addEventListener("click", () => {
      db.updateBook(id, { profile: btn.dataset.assign || null });
      renderShelf();
      openDetail(id);
    })
  );
  $("#detail-content").querySelectorAll("[data-rate]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const me = currentProfile() ?? "Me";
      db.updateBook(id, {
        ratings: { ...(b.ratings ?? {}), [me]: Number(btn.dataset.rate) },
        rating: null, // retire the pre-profile single rating
      });
      shareToCommunity(id);
      renderShelf();
      openDetail(id); // re-render the modal with the new rating
    })
  );
  $("#detail-content").querySelector("[data-clear-rating]")?.addEventListener("click", () => {
    const me = currentProfile() ?? "Me";
    const ratings = { ...(b.ratings ?? {}) };
    delete ratings[me];
    db.updateBook(id, { ratings, rating: null });
    renderShelf();
    openDetail(id);
  });
  $("#detail-content").querySelector("[data-delete]").addEventListener("click", () => {
    if (!confirmRemoval(b)) return;
    detailModal.close();
    removeBookEverywhere(b);
  });

  renderSeriesSection(b);
  renderCommunityLine(b);
}

// "What do the app's users think?" — shown when the community layer has
// signals from beyond this device (future users; today, your household).
async function renderCommunityLine(b) {
  if (!community.isAvailable()) return;
  const summary = await community.fetchSummary(community.bookKey(b));
  const el = $("#community-line");
  if (!el || !summary || !summary.ratingCount) return;
  const bits = [`★ ${summary.ratingAvg.toFixed(1)} from ${summary.ratingCount} reader${summary.ratingCount === 1 ? "" : "s"}`];
  if (summary.spiceCount) bits.push(`Spice ${summary.spiceAvg.toFixed(1)}`);
  if (summary.reviewCount) bits.push(`${summary.reviewCount} review${summary.reviewCount === 1 ? "" : "s"}`);
  el.textContent = "Shelfie readers: " + bits.join(" · ");
}

// No free database knows every series — indie and self-published books are
// routinely missing one, and no amount of guessing fixes that. So you can
// always say what the series is yourself; what you set wins over detection,
// syncs to the rest of the household, and groups the shelf immediately.
function seriesEditor(book) {
  const current = book.series ?? {};
  const names = [...new Set(
    db.getAllBooks().map((b) => b.series?.name).filter(Boolean)
  )].sort();
  return `
    <details class="series-editor">
      <summary>${current.name ? "Change the series" : "Set the series yourself"}</summary>
      <div class="series-form">
        <label>Series
          <input type="text" id="series-name-input" list="known-series"
                 placeholder="e.g. L.O.R.D.S." value="${esc(current.name ?? "")}" />
        </label>
        <datalist id="known-series">
          ${names.map((n) => `<option value="${esc(n)}"></option>`).join("")}
        </datalist>
        <label class="series-num">Book #
          <input type="number" id="series-pos-input" min="1" max="999"
                 placeholder="—" value="${current.position ?? ""}" />
        </label>
        <div class="series-form-actions">
          <button class="primary-btn" id="series-save-btn">Save</button>
          ${current.name ? `<button class="link-btn" id="series-clear-btn">Not in a series</button>` : ""}
        </div>
      </div>
    </details>`;
}

function wireSeriesEditor(book, el) {
  el.querySelector("#series-save-btn")?.addEventListener("click", () => {
    // "L.O.R.D.S. Series" and "L.O.R.D.S." are the same shelf heading; tidy
    // the wording on the way in so the saved name reads as the series' name.
    const name = el.querySelector("#series-name-input").value
      .trim()
      .replace(/\s*(?:series|saga)\s*$/i, "")
      .trim();
    const posRaw = el.querySelector("#series-pos-input").value.trim();
    const position = posRaw === "" ? null : Number(posRaw);
    if (!name) return toast("Give the series a name first");
    // seriesManual stops the background lookup from overwriting this later.
    db.updateBook(book.id, {
      series: { name, position: Number.isFinite(position) ? position : null },
      seriesManual: true,
    });
    seriesCache.delete(book.id);
    toast(`Filed under “${name}”`);
    renderShelf();
    openDetail(book.id);
  });
  el.querySelector("#series-clear-btn")?.addEventListener("click", () => {
    db.updateBook(book.id, { series: null, seriesManual: true });
    seriesCache.delete(book.id);
    toast("Marked as a standalone");
    renderShelf();
    openDetail(book.id);
  });
}

async function renderSeriesSection(book) {
  const section = () => detailModal.querySelector("#series-section");
  let cached = seriesCache.get(book.id);
  if (!cached && book.seriesManual && !book.series?.name) {
    cached = { series: null, books: [] }; // you already said it's a standalone
  }
  if (!cached) {
    try {
      const series = await api.detectSeries(book);
      if (series) {
        const entries = await api.listSeriesBooks(series.name, book.authors);
        cached = { series, books: entries };
        if (!book.series?.name && !book.seriesManual) db.updateBook(book.id, { series });
      } else {
        cached = { series: null, books: [] };
      }
      seriesCache.set(book.id, { ...cached, missingCount: 0, checkedAt: Date.now() });
      persistSeriesCache();
    } catch {
      cached = null;
    }
  }
  const el = section();
  if (!el) return; // modal closed meanwhile

  if (!cached || !cached.series) {
    // No <h3> here — the section this sits in is already titled "Series".
    el.innerHTML = `<p class="muted">No series found for this one. If you know it's
      part of a series, tell it below and the shelf will group it.</p>
      ${seriesEditor(book)}`;
    wireSeriesEditor(book, el);
    return;
  }

  const ownedTitles = new Set(db.getOwnedBooks().map((b) => normTitle(b.title)));
  const wishTitles = new Set(
    db.getBooksOnShelf("wishlist").map((b) => normTitle(b.title))
  );
  const items = cached.books.map((e, i) => {
    const owned = ownedTitles.has(normTitle(e.title));
    const wished = !owned && wishTitles.has(normTitle(e.title));
    const flag = owned
      ? `<span class="own-flag">${icon("check")} owned</span>`
      : wished
        ? `<span class="own-flag wished">${icon("gift")} wishlisted</span>`
        : `<button class="wish-btn" data-wish-idx="${i}">${icon("plus")}<span>Wishlist</span></button>`;
    return `
      <li class="${owned ? "owned" : "missing"}">
        ${e.coverUrl ? `<img src="${esc(e.coverUrl)}" alt="" />` : `<span class="cover-ph"></span>`}
        <span class="series-title">${esc(e.title)}${e.year ? ` <small>(${e.year})</small>` : ""}</span>
        ${flag}
      </li>`;
  });
  const missingCount = cached.books.filter((e) => !ownedTitles.has(normTitle(e.title))).length;
  seriesCache.set(book.id, { ...cached, missingCount, checkedAt: cached.checkedAt ?? Date.now() });
  persistSeriesCache();

  el.innerHTML = `
    <h3>Series: ${esc(cached.series.name)}</h3>
    ${
      items.length
        ? `<p class="muted">${
            missingCount
              ? `You're missing ${missingCount} of ${cached.books.length} books in this series.`
              : `You own all ${cached.books.length} books we found in this series.`
          }</p><ul class="series-list">${items.join("")}</ul>`
        : `<p class="muted">This book is part of “${esc(cached.series.name)}”, but we couldn't list the other entries.</p>`
    }
    ${seriesEditor(book)}`;
  wireSeriesEditor(book, el);

  el.querySelectorAll("[data-wish-idx]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const e = cached.books[Number(btn.dataset.wishIdx)];
      db.addBook({
        id: "ol:" + e.workKey.replace("/works/", ""),
        title: e.title,
        authors: e.authors,
        workKey: e.workKey,
        coverUrl: e.coverUrl?.replace("-S.jpg", "-M.jpg") ?? null,
        isbn13: null, isbn10: null, publisher: null, publishDate: null,
        pageCount: null, format: null, editionKey: null,
        series: { name: cached.series.name, position: null },
        shelf: "wishlist",
        owned: false,
        profile: currentProfile() ?? null,
      });
      renderSeriesSection(book); // re-render to show the wishlisted flag
      renderShelf();
    })
  );

  renderShelf(); // refresh badges with the new missing count
}

// ---------- discover (recommendations) ----------

let recFilter = { genre: null, pages: null, age: null };
let recsCache = null; // { key, recs } — keyed on filters + library size

$("#discover-btn").addEventListener("click", () => showScreen("discover"));

function renderDiscover() {
  const el = $("#discover-content");
  el.innerHTML = "";

  const set = (key) => (value) => {
    recFilter[key] = value;
    renderDiscover();
  };
  const results = document.createElement("div");
  const filterBox = document.createElement("div");
  filterBox.className = "rec-filters";
  filterBox.appendChild(
    chipGroup("Genre", flt.GENRES.map(([g]) => [g, g]), recFilter.genre, set("genre"))
  );
  filterBox.appendChild(
    pageRangeSlider(recFilter.pages, (range) => {
      recFilter.pages = flt.isFullPageRange(range) ? null : range;
      loadRecs(results);
    })
  );
  filterBox.appendChild(chipGroup("Published", flt.AGE_OPTIONS, recFilter.age, set("age")));
  el.appendChild(filterBox);
  el.appendChild(results);
  loadRecs(results);
}

async function loadRecs(container) {
  const books = db.getAllBooks();
  if (books.length < 2) {
    container.innerHTML = `<p class="muted">Add a few books first — recommendations are
      based on the authors and genres on your shelves.</p>`;
    return;
  }
  const key = JSON.stringify(recFilter) + ":" + books.length;
  if (recsCache?.key === key) {
    renderRecs(container, recsCache.recs);
    return;
  }
  container.innerHTML = `<p class="series-loading">Reading your shelves and finding
    well-rated books you don't have yet…</p>`;
  try {
    const recs = await buildRecommendations(books, recFilter);
    recsCache = { key, recs };
    renderRecs(container, recs);
  } catch (err) {
    container.innerHTML = `<p class="sync-error">Couldn't fetch recommendations (${esc(err.message)}). Try again in a bit.</p>`;
  }
}

// Taste signals: authors weighted by how much you engaged (high personal
// rating > wishlisted > merely owned), plus common subjects across your
// works and the genres already on your shelves. When Discover filters are
// active, shelf books matching them drive the profile (3x weight) and the
// rest of the library is context; candidates are constrained to match.
//
// Breadth matters here: Open Library's rating data is thin, so demanding
// well-rated candidates used to collapse the whole pool down to a couple of
// heavily-rated series. Instead this casts a wide net and scores afterwards,
// capping how many books any one author or series can contribute.
async function buildRecommendations(books, f) {
  const focusFilter = { ...emptyFilter(), genre: f.genre, pages: f.pages, age: f.age };
  const anyFilter = !!(f.genre || f.pages || f.age);
  const inFocus = (b) => flt.matchesFilter(b, focusFilter, { myRating: myRating(b) });
  const focusBoost = (b) => (anyFilter && inFocus(b) ? 3 : 1);

  const authorScore = {};
  for (const b of books) {
    const engagement = (myRating(b) ?? 0) >= 4 ? 3 : myShelf(b) === "wishlist" ? 2 : 1;
    const w = engagement * focusBoost(b);
    (b.authors ?? []).forEach((a) => (authorScore[a] = (authorScore[a] ?? 0) + w));
  }
  const topAuthors = Object.entries(authorScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([a]) => a);

  // Mine subjects from filter-matching works first so a Fantasy filter
  // reads your fantasy shelf, not your whole library.
  const subjectScore = {};
  const pool = anyFilter
    ? [...books.filter(inFocus), ...books.filter((b) => !inFocus(b))]
    : books;
  const withWorks = pool.filter((b) => b.workKey).slice(0, 10);
  await Promise.allSettled(
    withWorks.map(async (b) => {
      (await api.fetchWorkSubjects(b.workKey)).forEach(
        (s) => (subjectScore[s] = (subjectScore[s] ?? 0) + focusBoost(b))
      );
    })
  );
  const topSubjects = Object.entries(subjectScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s]) => s);

  // Genres already on the shelves, as a backstop when subject tags are thin
  // (books added from search or Discover often have none yet).
  const genreScore = {};
  books.forEach((b) =>
    flt.genresOf(b).forEach((g) => (genreScore[g] = (genreScore[g] ?? 0) + focusBoost(b)))
  );
  const topGenres = Object.entries(genreScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);

  const genreTerm = f.genre ? flt.genreQueryTerm(f.genre) : null;
  const withGenre = (q) => (genreTerm ? `${q} AND subject:"${genreTerm}"` : q);
  const clauses = api.yearClause(f.age);
  // New releases have few ratings, so ranking them by rating buries them.
  const sort = f.age === "new" ? "new" : "rating";

  const queries = [
    ...topAuthors.map((a) => ({ q: withGenre(`author:"${a}"`), reason: `More by ${a}` })),
    ...topSubjects
      .filter((s) => s.toLowerCase() !== genreTerm)
      .map((s) => ({ q: withGenre(`subject:"${s}"`), reason: s })),
  ];
  if (genreTerm) {
    queries.push({ q: `subject:"${genreTerm}"`, reason: `Top-rated ${f.genre}` });
  } else {
    topGenres.forEach((g) =>
      queries.push({ q: `subject:"${flt.genreQueryTerm(g)}"`, reason: `${g} you might like` })
    );
  }

  const have = new Set(books.map((b) => normTitle(b.title)));
  const haveWorks = new Set(books.map((b) => b.workKey).filter(Boolean));
  const found = new Map();
  api.resetSearchReachability();

  await Promise.allSettled(
    queries.map(async ({ q, reason }) => {
      const rows = await api.searchRankedWithFallback(q, clauses, { limit: 25, sort });
      for (const r of rows) {
        if (!flt.pagesMatch(r.pages, f.pages)) continue;
        if (f.age && !flt.ageMatches(r.year, f.age)) continue;
        if (haveWorks.has(r.workKey)) continue;
        if (/box(ed)? set|omnibus|\bbundle\b/i.test(r.title)) continue;

        const key = seriesKey(r.title);
        if (have.has(normTitle(r.title)) || have.has(key)) continue;
        const existing = found.get(key);
        if (existing) {
          existing.hits++; // corroborated by another query — a better signal
        } else {
          found.set(key, { ...r, reason, hits: 1 });
        }
      }
    })
  );

  // ---- Scoring ----------------------------------------------------------
  // Style first. Reader ratings used to be the base term, which meant a
  // popular book could outrank one that genuinely matched your taste; they
  // are now a modest, confidence-weighted tiebreaker instead.
  //
  //   similarity  (0..1, dominant) — how much a book overlaps your taste:
  //                 shared subjects, author affinity, and how many separate
  //                 taste queries surfaced it
  //   coRead      (0..1, additive)  — readers whose shelves resemble yours
  //                 have this book (needs other users; zero until then)
  //   quality     (small)           — ratings, scaled by how many people
  //                 rated it, so a 4.6 from 9 readers doesn't beat a match
  const candidates = [...found.values()];
  // Nothing came back and nothing got through: that's an outage, not a
  // library with no matches. Say the true thing.
  if (!candidates.length && !api.lastSearchReachedServer()) {
    throw new Error(
      navigator.onLine ? "Open Library isn't answering" : "you're offline"
    );
  }

  // Fetch real subjects for the strongest candidates so overlap is measured,
  // not assumed. Cached in api.js, so this is cheap after the first run.
  const preRanked = candidates
    .sort((a, b) => b.hits - a.hits || (b.avgRating ?? 0) - (a.avgRating ?? 0))
    .slice(0, 30);
  await Promise.allSettled(
    preRanked.map(async (r) => {
      r.subjects = await api.fetchWorkSubjects(r.workKey);
    })
  );

  const tasteTotal = Object.values(subjectScore).reduce((a, b) => a + b, 0) || 1;
  const authorTotal = Object.values(authorScore).reduce((a, b) => a + b, 0) || 1;

  const myKeys = books.map((b) => community.bookKey(b));
  const [summaries, coRead, friends] = await Promise.all([
    community.fetchSummaries(candidates.map((r) => community.bookKey(r))),
    community.coReadScores(myKeys),
    social.socialScores(myKeys),
  ]);

  for (const r of candidates) {
    // Subject overlap, weighted by how central each subject is to your taste.
    const subjHit = (r.subjects ?? []).reduce((sum, s) => sum + (subjectScore[s] ?? 0), 0);
    const subjectMatch = Math.min(subjHit / tasteTotal, 1);

    const authorHit = (r.authors ?? []).reduce((sum, a) => sum + (authorScore[a] ?? 0), 0);
    const authorMatch = Math.min(authorHit / authorTotal, 1);

    const corroboration = Math.min((r.hits - 1) / 2, 1);

    const similarity = 0.5 * subjectMatch + 0.3 * authorMatch + 0.2 * corroboration;

    // Ratings only speak up when enough people have spoken.
    const confidence = Math.min((r.ratingsCount ?? 0) / 60, 1);
    const quality = r.avgRating ? ((r.avgRating - 3.4) / 1.6) * confidence : 0;

    const key = community.bookKey(r);
    const cr = coRead.get(key);
    const cs = summaries.get(key);
    const fr = friends.get(key);
    const communityRating = cs?.ratingCount
      ? ((cs.ratingAvg - 3) / 2) * Math.min(cs.ratingCount / 5, 1)
      : 0;

    // People you actually know outrank every other social signal: a book a
    // friend loved should surface ahead of one that strangers rate highly.
    const known = (fr?.score ?? 0) * (fr?.friend ? 1.1 : 0.8);

    r.score =
      similarity + 1.2 * known + 0.6 * (cr?.score ?? 0) + 0.25 * quality + 0.3 * communityRating;

    // Say why, most specific signal first — and nothing is more specific
    // than a name you know.
    if (fr?.who?.length) {
      const names = fr.who.slice(0, 2).join(" and ");
      const more = fr.who.length > 2 ? ` +${fr.who.length - 2}` : "";
      r.reason = `${names}${more} read this`;
    } else if (cr?.readers) {
      r.reason = `Readers with shelves like yours have this`;
    } else if (cs?.ratingCount) {
      r.reason = `Shelfie readers rate it ★ ${cs.ratingAvg.toFixed(1)}`;
    } else if (subjectMatch > 0.12 && r.subjects?.length) {
      const shared = r.subjects.filter((x) => subjectScore[x]).slice(0, 2);
      if (shared.length) r.reason = `Matches your taste: ${shared.join(", ")}`;
    }
  }
  const scored = candidates.sort((a, b) => b.score - a.score);

  // Keep the list varied: at most two books per author.
  const perAuthor = {};
  const out = [];
  for (const r of scored) {
    const a = r.authors?.[0] ?? "?";
    if ((perAuthor[a] ?? 0) >= 2) continue;
    perAuthor[a] = (perAuthor[a] ?? 0) + 1;
    out.push(r);
    if (out.length >= 24) break;
  }
  return out;
}

// Collapse volume/part numbering so a long manga or serial contributes one
// entry rather than flooding the list ("One Piece, Vol. 3" → "one piece").
function seriesKey(title) {
  return normTitle(
    String(title).replace(
      /[,:]?\s*(vol\.?|volume|bk\.?|book|part|no\.?|#)\s*\d+.*$/i,
      ""
    )
  );
}

function renderRecs(el, recs) {
  if (!recs.length) {
    el.innerHTML = `<p class="muted">Nothing found for these filters — try loosening
      them, or add and rate a few more books.</p>`;
    return;
  }
  const wishTitles = new Set(db.getBooksOnShelf("wishlist").map((b) => normTitle(b.title)));
  el.innerHTML = `
    <p class="muted" style="font-size:0.8rem">Based on the authors and genres on
    your shelves${flt.activeFilterCount(recFilter) ? " (weighted toward your filtered books)" : ""},
    ranked by Open Library reader ratings.</p>
    <ul class="series-list">
      ${recs
        .map((r, i) => {
          const wished = wishTitles.has(normTitle(r.title));
          return `
          <li>
            ${r.coverUrl ? `<img src="${esc(r.coverUrl)}" alt="" />` : `<span class="cover-ph"></span>`}
            <span class="series-title">
              <strong>${esc(r.title)}</strong>${r.year ? ` <small>(${r.year})</small>` : ""}<br />
              <small>${esc(r.authors.join(", "))}${r.pages ? ` · ${r.pages} pp` : ""}</small><br />
              <small class="card-rating">${r.avgRating ? starString(Math.round(r.avgRating)) : ""}</small>
              <small class="muted">${esc(r.reason)}</small>
            </span>
            ${wished
              ? `<span class="own-flag wished">${icon("gift")}</span>`
              : `<button class="wish-btn" data-rec-idx="${i}">${icon("plus")}<span>Wishlist</span></button>`}
          </li>`;
        })
        .join("")}
    </ul>`;
  el.querySelectorAll("[data-rec-idx]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const r = recsCache.recs[Number(btn.dataset.recIdx)];
      db.addBook({
        id: "ol:" + r.workKey.replace("/works/", ""),
        title: r.title,
        authors: r.authors,
        workKey: r.workKey,
        coverUrl: r.coverUrl,
        isbn13: null, isbn10: null, publisher: null,
        publishDate: r.year ? String(r.year) : null,
        pageCount: r.pages ?? null,
        format: null, editionKey: null, series: null,
        shelf: "wishlist",
        owned: false,
        profile: currentProfile() ?? null,
      });
      renderShelf();
      renderRecs(el, recsCache.recs); // re-render to show the wishlisted flag
    })
  );
}

// ---------- export ----------

let exportScope = null;      // shelf key, or "all"
let exportUseView = true;    // honour the current search/filters/profile view

function openExportScreen() {
  exportScope = currentShelf;
  exportUseView = true;
  renderExportScreen();
}

$("#export-btn").addEventListener("click", () => showScreen("export"));

function exportBooks() {
  if (exportScope === "all") return db.getAllBooks();
  if (exportScope === currentShelf && exportUseView) return visibleBooks;
  return booksForShelf(exportScope);
}

function exportTitle() {
  return exportScope === "all" ? "My Library" : `${SHELF_LABEL[exportScope]} shelf`;
}

function renderExportScreen() {
  const el = $("#export-content");
  const books = exportBooks();
  const scopes = [...SHELVES.map((s) => [s, `${SHELF_ICON[s]} ${SHELF_LABEL[s]}`]), ["all", `${icon("books")} Everything`]];
  const canFilter = exportScope === currentShelf;

  el.innerHTML = `
    <div class="filter-group">
      <span class="filter-label">What to export</span>
      <div class="profile-filter">
        ${scopes
          .map(([v, label]) =>
            `<button class="filter-chip ${exportScope === v ? "active" : ""}" data-scope="${v}">${label}</button>`)
          .join("")}
      </div>
    </div>
    ${canFilter
      ? `<label class="check-row">
           <input type="checkbox" id="export-view-check" ${exportUseView ? "checked" : ""} />
           Only what's showing (current search, filters &amp; profile view)
         </label>`
      : ""}
    <div class="export-preview">
      <strong>${esc(exportTitle())}</strong><br />
      ${books.length ? esc(xport.summaryLine(books)) : "No books in this selection."}
    </div>
    <div class="filter-group">
      <span class="filter-label">Format</span>
      <div class="format-grid">
        <button class="method-btn" data-format="page" ${books.length ? "" : "disabled"}>
          <span class="method-icon">${icon("page")}</span>
          <span class="method-label">Printable page</span>
          <span class="method-hint">Opens a styled page you can print or save as PDF</span>
        </button>
        <button class="method-btn" data-format="text" ${books.length ? "" : "disabled"}>
          <span class="method-icon">${icon("quote")}</span>
          <span class="method-label">Share as text</span>
          <span class="method-hint">A tidy list to text or email</span>
        </button>
        <button class="method-btn" data-format="csv" ${books.length ? "" : "disabled"}>
          <span class="method-icon">${icon("chart")}</span>
          <span class="method-label">Spreadsheet</span>
          <span class="method-hint">CSV for Excel or Google Sheets</span>
        </button>
        <button class="method-btn" data-format="json">
          <span class="method-icon">${icon("save")}</span>
          <span class="method-label">Backup</span>
          <span class="method-hint">Full JSON of the whole library</span>
        </button>
      </div>
    </div>
    <p class="export-note" id="export-status">Covers and ratings are included in the printable page.</p>`;

  el.querySelectorAll("[data-scope]").forEach((btn) =>
    btn.addEventListener("click", () => {
      exportScope = btn.dataset.scope;
      renderExportScreen();
    })
  );
  $("#export-view-check")?.addEventListener("change", (e) => {
    exportUseView = e.target.checked;
    renderExportScreen();
  });
  el.querySelectorAll("[data-format]").forEach((btn) =>
    btn.addEventListener("click", () => runExport(btn.dataset.format))
  );
}

// Colours for the printable page, taken from the active aesthetic. Read from
// the skin's *light* palette (flipped and restored within one synchronous
// block, so nothing repaints) because exports are meant for paper.
function exportPalette() {
  const root = document.documentElement;
  const previous = root.getAttribute("data-mode");
  root.setAttribute("data-mode", "light");
  const cs = getComputedStyle(root);
  const pick = (name) => cs.getPropertyValue(name).trim();
  const palette = {
    bg: pick("--bg"),
    card: pick("--card"),
    ink: pick("--ink"),
    inkSoft: pick("--ink-soft"),
    muted: pick("--muted"),
    line: pick("--line"),
    accent: pick("--accent"),
    accentSoft: pick("--accent-soft"),
    gold: pick("--gold"),
    serif: pick("--serif"),
  };
  if (previous) root.setAttribute("data-mode", previous);
  return palette;
}

async function runExport(format) {
  const books = exportBooks();
  const title = exportTitle();
  const name = xport.slug(exportScope === "all" ? "library" : SHELF_LABEL[exportScope]);
  const status = (msg) => ($("#export-status").textContent = msg);
  const who = currentProfile();
  const subtitle = [who ? `${who}'s shelves` : null, sync.isActive() ? "shared household" : null]
    .filter(Boolean)
    .join(" · ");

  if (format === "page") {
    const html = xport.buildPrintableHtml(books, {
      title, subtitle, ratingOf: myRating, palette: exportPalette(),
    });
    const opened = xport.openHtml(html, `shelfie-${name}.html`);
    status(
      opened
        ? "Opened in a new tab — use your browser's Share or Print menu to save it as a PDF."
        : "Downloaded as an HTML file (your browser blocked the new tab)."
    );
    return;
  }

  if (format === "text") {
    const text = xport.buildText(books, title, myRating);
    if (navigator.share) {
      try {
        await navigator.share({ title: `Shelfie — ${title}`, text });
        status("Shared.");
        return;
      } catch {
        /* user dismissed the share sheet — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      status("Copied to your clipboard — paste it anywhere.");
    } catch {
      xport.download(`shelfie-${name}.txt`, text, "text/plain");
      status("Downloaded as a text file.");
    }
    return;
  }

  if (format === "csv") {
    xport.download(`shelfie-${name}.csv`, xport.buildCsv(books, myRating), "text/csv");
    status("Spreadsheet downloaded.");
    return;
  }

  xport.download("shelfie-library-backup.json", db.exportJson(), "application/json");
  status("Backup downloaded — keep it somewhere safe.");
}

// ---------- settings ----------

$("#settings-btn").addEventListener("click", () => showScreen("settings"));

// Settings is grouped the way a person thinks, not the order features
// shipped: who you are, what you share, how books are tracked, how it looks,
// and the data itself. Each group is small enough to scan; anything with real
// depth (profiles, the shared library, appearance) is a row that opens its
// own screen rather than a widget squatting on this one.
function renderSettingsScreen() {
  const el = $("#settings-content");
  const me = currentProfile();
  const household = sync.isActive()
    ? sync.currentLibraryName() ?? sync.currentHousehold()
    : null;

  el.innerHTML = `
    <div class="settings-section">
      <span class="filter-label">You</span>
      <button class="settings-row" data-go="profile">
        <span class="row-main">
          <span class="row-icon">${icon("user")}</span>
          <span>Profile
            <span class="row-sub">${me ? esc(me) : "Not set — tap to choose"}</span>
          </span>
        </span>
        <span class="row-go">›</span>
      </button>
      ${sync.isConfigured() ? `
      <button class="settings-row" data-go="account">
        <span class="row-main">
          <span class="row-icon">${icon("shield")}</span>
          <span>Account
            <span class="row-sub">${
              sync.accountHint()
                ? esc(sync.accountHint())
                : "Not signed in — this device only"
            }</span>
          </span>
        </span>
        <span class="row-go">›</span>
      </button>` : ""}
      <button class="settings-row" data-go="stats">
        <span class="row-main">
          <span class="row-icon">${icon("books")}</span>
          <span>Your reading
            <span class="row-sub">Totals, this year, most-read authors and genres</span>
          </span>
        </span>
        <span class="row-go">›</span>
      </button>
    </div>

    <div class="settings-section">
      <span class="filter-label">Sharing</span>
      <button class="settings-row" data-go="sync">
        <span class="row-main">
          <span class="row-icon">${icon("users")}</span>
          <span>Shared library
            <span class="row-sub">${
              household ? "On · " + esc(household) : sync.isConfigured() ? "Off" : "Needs setup"
            }</span>
          </span>
        </span>
        <span class="row-go">›</span>
      </button>
      <button class="settings-row" data-go="friends">
        <span class="row-main">
          <span class="row-icon">${icon("sparkles")}</span>
          <span>Friends
            <span class="row-sub">${
              !sync.isConfigured()
                ? "Needs the shared-library setup"
                : social.isEnabled()
                  ? `On · following ${social.following().length}`
                  : "Off"
            }</span>
          </span>
        </span>
        <span class="row-go">›</span>
      </button>
      <button class="settings-row" id="community-toggle" ${community.isAvailable() ? "" : "disabled"}>
        <span class="row-main">
          <span class="row-icon">${icon("globe")}</span>
          <span>Community sharing
            <span class="row-sub">${community.isAvailable()
              ? "Share your ratings, tags &amp; reviews (with your first name) to power everyone's recommendations"
              : "Needs the shared-library Firebase setup first"}</span>
          </span>
        </span>
        <span class="row-go">${community.sharingEnabled() ? "On" : "Off"}</span>
      </button>
    </div>

    <div class="settings-section">
      <span class="filter-label">Your books</span>
      <button class="settings-row" id="medium-toggle">
        <span class="row-main">
          <span class="row-icon">${icon("headphones")}</span>
          <span>Track copy types
            <span class="row-sub">Label books as print, e-book, or audiobook</span>
          </span>
        </span>
        <span class="row-go">${trackMedium() ? "On" : "Off"}</span>
      </button>
      <button class="settings-row" id="content-toggle">
        <span class="row-main">
          <span class="row-icon">${icon("flame")}</span>
          <span>Spice &amp; content ratings
            <span class="row-sub">Tag books Kids / Teen / Mature / Explicit, and rate spice 1–5</span>
          </span>
        </span>
        <span class="row-go">${trackContent() ? "On" : "Off"}</span>
      </button>
    </div>

    <div class="settings-section">
      <span class="filter-label">Appearance</span>
      <button class="settings-row" data-go="appearance">
        <span class="row-main">
          <span class="row-icon">${icon("palette")}</span>
          <span>Aesthetic &amp; artwork
            <span class="row-sub">${esc(themes.themeName())} · ${
              esc(themes.MODES.find(([v]) => v === themes.currentMode())?.[1] ?? "Auto")
            }</span>
          </span>
        </span>
        <span class="row-go">›</span>
      </button>
    </div>

    <div class="settings-section">
      <span class="filter-label">Data</span>
      <button class="settings-row" data-go="import">
        <span class="row-main">
          <span class="row-icon">${icon("download")}</span>
          <span>Restore from backup
            <span class="row-sub">Load a Shelfie JSON export</span>
          </span>
        </span>
        <span class="row-go">›</span>
      </button>
      <button class="settings-row" id="persist-toggle">
        <span class="row-main">
          <span class="row-icon">${icon("shield")}</span>
          <span>Protect data from cleanup
            <span class="row-sub" id="persist-status">Checking…</span>
          </span>
        </span>
        <span class="row-go">${persistPref() ? "On" : "Off"}</span>
      </button>
    </div>

    <span class="credit">Shelfie · book data from Open Library &amp; Google Books</span>`;

  $("#community-toggle").addEventListener("click", () => {
    if (!community.isAvailable()) return;
    community.setSharing(!community.sharingEnabled());
    renderSettingsScreen();
  });

  $("#content-toggle").addEventListener("click", () => {
    const next = !trackContent();
    localStorage.setItem(CONTENT_KEY, next ? "1" : "0");
    if (!next) {
      shelfFilter.content = null;
      shelfFilter.spice = null;
    }
    renderSettingsScreen();
    renderShelf();
  });

  updatePersistStatus();
  $("#persist-toggle").addEventListener("click", async () => {
    const next = !persistPref();
    localStorage.setItem(PERSIST_KEY, next ? "1" : "0");
    if (next) {
      try {
        await navigator.storage?.persist?.();
      } catch { /* status line reports the outcome */ }
    }
    renderSettingsScreen();
  });

  $("#medium-toggle").addEventListener("click", () => {
    const next = !trackMedium();
    localStorage.setItem(MEDIUM_KEY, next ? "1" : "0");
    // Don't leave a hidden medium filter silently narrowing the shelves.
    if (!next && ["ebook", "audio"].includes(shelfFilter.format)) {
      shelfFilter.format = null;
    }
    renderSettingsScreen();
    renderShelf();
  });
  el.querySelectorAll("[data-go]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const target = btn.dataset.go;
      // Anything that names a screen opens it; the import row is the one
      // that doesn't, so it stays the fallback.
      if (["profile", "account", "sync", "stats", "friends", "appearance"].includes(target)) {
        showScreen(target);
      } else $("#import-input").click();
    })
  );
}

// Appearance: the aesthetic grid, brightness, and the artwork instructions.
// Its own screen because the theme cards are the physically biggest thing in
// settings, and because the design work ahead (spine palettes, textures)
// belongs somewhere with room to grow.
function renderAppearanceScreen() {
  const el = $("#appearance-content");
  const skin = themes.currentSkin();
  const mode = themes.currentMode();

  el.innerHTML = `
    <div class="settings-section">
      <span class="filter-label">Aesthetic</span>
      <div class="theme-grid">
        ${themes.THEMES.map(
          (t) => `
          <button class="theme-card ${skin === t.id ? "active" : ""}" data-skin="${t.id}">
            <span class="theme-swatch">
              ${t.swatch.map((c) => `<i style="background:${esc(c)}"></i>`).join("")}
            </span>
            <span class="theme-name">${esc(t.name)}${skin === t.id ? " ✓" : ""}</span>
            <span class="theme-blurb">${esc(t.blurb)}</span>
          </button>`
        ).join("")}
      </div>

      <span class="filter-label" style="display:block;margin-top:0.9rem">Brightness</span>
      <div class="seg" style="margin-top:0.45rem">
        ${themes.MODES.map(
          ([v, label]) =>
            `<button class="filter-chip ${mode === v ? "active" : ""}" data-mode="${v}">${label}</button>`
        ).join("")}
      </div>

      <p class="settings-note">
        “Yours” is your own palette — see <code>css/custom.css</code>. Artwork goes
        in <code>assets/</code>, and any icon can be replaced by dropping a file at
        <code>assets/icons/&lt;name&gt;.svg</code>.
        <button class="link-btn" id="refresh-assets">Check for new artwork</button>
      </p>
    </div>`;

  $("#refresh-assets").addEventListener("click", async () => {
    const [found, icons] = await Promise.all([refreshCustomAssets(), refreshIconOverrides()]);
    const n = Object.keys(found ?? {}).length + (icons?.length ?? 0);
    renderAppearanceScreen();
    toast(n ? `Using ${n} file${n === 1 ? "" : "s"} from assets/` : "No artwork found in assets/");
  });
  el.querySelectorAll("[data-skin]").forEach((btn) =>
    btn.addEventListener("click", () => {
      themes.setSkin(btn.dataset.skin);
      renderAppearanceScreen();
    })
  );
  el.querySelectorAll("[data-mode]").forEach((btn) =>
    btn.addEventListener("click", () => {
      themes.setMode(btn.dataset.mode);
      renderAppearanceScreen();
    })
  );
}

// The status line reports what's actually true, not just the preference:
// persistence can be requested but not yet granted, and once granted the
// browser offers no way to hand it back.
async function updatePersistStatus() {
  const el = $("#persist-status");
  if (!el) return;
  let granted = false;
  try {
    granted = (await navigator.storage?.persisted?.()) ?? false;
  } catch { /* treat as not granted */ }
  if (persistPref()) {
    el.textContent = granted
      ? "The browser won't auto-delete your library"
      : "Requested — browsers grant this to apps installed on the home screen or used often";
  } else {
    el.textContent = granted
      ? "Off — but protection already granted; browsers keep it until site data is cleared"
      : "Off — the browser may clear the library if the app goes unused";
  }
}

$("#import-input").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    db.importJson(await file.text());
    seriesCache.clear();
    renderShelf();
    toast("Library restored");
  } catch (err) {
    toast("Import failed: " + err.message);
  }
});

// ---------- bottom nav ----------

$("#nav-shelves").addEventListener("click", () => {
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  if (currentScreen === "shelves") window.scrollTo({ top: 0, behavior: "smooth" });
  else showScreen("shelves");
});

// ---------- shared library (sync) ----------

let syncError = null;
let syncMembers = [];
let syncRequests = [];

function onMembers(members, requests = []) {
  syncMembers = members;
  syncRequests = requests;
  updateSyncIndicator();
  updateRequestBanner();
  if (currentScreen === "sync") renderSyncScreen();
  // Late-arriving member names make good profile suggestions on first run.
  if (currentScreen === "profile" && !currentProfile()) renderProfileScreen();
}

// A pending join request must be impossible to miss — the requester is
// locked out until someone here approves, so a small dot isn't enough.
function updateRequestBanner() {
  const banner = $("#request-banner");
  if (!syncRequests.length) {
    banner.classList.add("hidden");
    return;
  }
  const names = syncRequests.map((r) => r.name ?? "Someone");
  banner.innerHTML = `${icon("bell")} <strong>${esc(names.join(" and "))}</strong>
    ${names.length === 1 ? "wants" : "want"} to join your shared library
    <span class="banner-action">Review</span>`;
  banner.classList.remove("hidden");
}

$("#request-banner").addEventListener("click", () => showScreen("sync"));

function onJoinResolved(approved, libName) {
  syncError = approved
    ? null
    : `Your request to join “${libName}” was declined.`;
  updateSyncIndicator();
  renderShelf();
  if (currentScreen === "sync") renderSyncScreen();
}

// Options every start/join/create call needs, so the member list and this
// device's own entry stay current.
function syncOpts() {
  return {
    localBooks: db.getAllBooks(),
    onMembers,
    profileName: currentProfile(),
  };
}

function timeAgo(iso) {
  const then = Date.parse(iso ?? "");
  if (!then) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 2) return "active now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function membersHtml() {
  if (!syncMembers.length) {
    return `<p class="muted" style="font-size:0.82rem">Looking for other devices…</p>`;
  }
  const mine = sync.deviceId();
  return `
    <ul class="member-list">
      ${syncMembers
        .map((mem) => {
          const isMe = mem.deviceId === mine;
          return `
          <li class="${isMe ? "me" : ""}">
            <span class="avatar">${esc((mem.name ?? "?")[0].toUpperCase())}</span>
            <span class="member-main">
              <strong>${esc(mem.name ?? "Someone")}</strong>${isMe ? " <em>(this phone)</em>" : ""}
              <span class="member-sub">${esc(timeAgo(mem.lastSeen))}</span>
            </span>
            ${isMe ? "" : `<button class="link-btn" data-drop-member="${esc(mem.deviceId)}">Remove</button>`}
          </li>`;
        })
        .join("")}
    </ul>`;
}

function wireMemberButtons(el) {
  el.querySelectorAll("[data-drop-member]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const mem = syncMembers.find((x) => x.deviceId === btn.dataset.dropMember);
      if (!confirm(`Remove “${mem?.name ?? "this device"}” from the member list?\n\nThis only clears the entry — if that phone is still connected it will reappear. To lock someone out for good, create a new library with a different password.`)) {
        return;
      }
      await sync.removeMember(btn.dataset.dropMember);
    })
  );
}

let lastRemoteHash = null;

function onRemoteBooks(books) {
  const hash = JSON.stringify(
    [...books].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  );
  if (hash === lastRemoteHash) return; // nothing actually changed
  lastRemoteHash = hash;
  db.applyRemote(books);
  renderShelf();
}

function onSyncError(err) {
  syncError = err.message;
  updateSyncIndicator();
  if (currentScreen === "sync") renderSyncScreen();
}

function updateSyncIndicator() {
  updateNetPill();
  const dot = $("#sync-dot");
  const waiting = !!sync.pendingJoin() && !sync.isActive();
  const attention = waiting || syncRequests.length > 0;
  dot.classList.toggle("hidden", !(sync.isActive() || waiting));
  dot.classList.toggle("error", !!syncError);
  dot.classList.toggle("pending", attention && !syncError);
  dot.title = syncError
    ? "Sync error: " + syncError
    : waiting
      ? "Waiting for join approval"
      : syncRequests.length
        ? `${syncRequests.length} join request${syncRequests.length === 1 ? "" : "s"} waiting`
        : "Sync on";
}

// ---------- friends ----------

// Separate from timeAgo(), which reads a device's last-seen ("active now").
// A book finished five minutes ago wasn't "active" — it was "just now".
function whenRead(iso) {
  const then = Date.parse(iso ?? "");
  if (!then) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
}

async function renderFriendsScreen() {
  const el = $("#friends-content");

  if (!social.isAvailable()) {
    el.innerHTML = `<p class="muted">Friends need the shared-library setup first —
      it's the same free Firebase project. <button class="link-btn" data-go="sync">Set that up</button>
      and this page comes alive.</p>`;
    el.querySelector("[data-go]").addEventListener("click", () => showScreen("sync"));
    return;
  }

  if (!social.isEnabled()) {
    el.innerHTML = `
      <p>Follow people and their reading shows up here — what they finished, what
        they rated, what they thought. Discover leans on them too: a book your
        friends liked beats a book strangers liked.</p>
      <p class="muted">Turning this on publishes your name, who you follow, and the
        books you've finished, rated or reviewed. Nothing else from your shelves
        leaves the phone, and only people you've given your code to can look you
        up. You can switch it off any time.</p>
      <button class="primary-btn" id="social-on">Turn on Friends</button>`;
    $("#social-on").addEventListener("click", async () => {
      social.setEnabled(true);
      await social.publishMe(currentProfile());
      renderFriendsScreen();
    });
    return;
  }

  el.innerHTML = `
    <div class="settings-section">
      <span class="filter-label">Your code</span>
      <p class="muted">Give this to someone so they can follow you. Anyone with it
        can see the reading you publish here.</p>
      <div class="code-row">
        <code class="friend-code" id="my-code">${esc(social.formatCode(social.myCode()))}</code>
        <button class="secondary-btn" id="copy-code">Copy</button>
      </div>
    </div>

    <div class="settings-section">
      <span class="filter-label">Follow someone</span>
      <form class="inline-form" id="follow-form">
        <input type="text" id="follow-code" placeholder="Their code" autocomplete="off"
               autocapitalize="characters" spellcheck="false" />
        <button type="submit" class="primary-btn">Follow</button>
      </form>
      <p class="muted" id="follow-msg"></p>
    </div>

    <div class="settings-section" id="following-list">
      <span class="filter-label">Following</span>
      <p class="muted">Checking…</p>
    </div>

    <div class="settings-section" id="feed-list">
      <span class="filter-label">Recently read</span>
      <p class="muted">Checking…</p>
    </div>

    <button class="link-btn" id="social-off">Turn Friends off</button>`;

  $("#copy-code").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(social.formatCode(social.myCode()));
      toast("Code copied");
    } catch {
      // Clipboard blocked (older iOS in particular) — select it instead so a
      // long-press copy still works.
      const range = document.createRange();
      range.selectNodeContents($("#my-code"));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      toast("Press and hold to copy");
    }
  });

  $("#social-off").addEventListener("click", () => {
    social.setEnabled(false);
    toast("Friends off — your reading is no longer published");
    renderFriendsScreen();
  });

  $("#follow-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = $("#follow-code").value;
    const problem = social.codeProblem(raw);
    if (problem) return ($("#follow-msg").textContent = problem);
    if (social.isFollowing(raw)) {
      $("#follow-msg").textContent = "You already follow them.";
      return;
    }
    $("#follow-msg").textContent = "Looking them up…";
    const doc = await social.fetchReader(raw);
    if (!doc) {
      $("#follow-msg").textContent =
        "No one found with that code. Check it, and that they've turned Friends on.";
      return;
    }
    await social.follow(raw);
    $("#follow-code").value = "";
    $("#follow-msg").textContent = "";
    toast(`Following ${doc.name ?? "them"}`);
    renderFriendsScreen();
  });

  renderFollowingList();
  renderFeed();
}

async function renderFollowingList() {
  const el = $("#following-list");
  if (!el) return;
  const rows = await social.fetchFollowing();
  if (!el.isConnected) return; // navigated away while loading
  el.innerHTML = `<span class="filter-label">Following</span>${
    rows.length === 0
      ? `<p class="muted">No one yet. Swap codes with someone and their reading
         shows up here.</p>`
      : `<ul class="friend-list">${rows
          .map(
            (r) => `<li>
              <span class="friend-name">${esc(r.missing ? "Unknown code" : r.name)}</span>
              ${r.missing
                ? `<span class="badge">not found</span>`
                : r.friend
                  ? `<span class="badge friend-badge">friends</span>`
                  : `<span class="badge">following</span>`}
              <code class="friend-code small">${esc(social.formatCode(r.code))}</code>
              <button class="link-btn" data-unfollow="${esc(r.code)}">Unfollow</button>
            </li>`
          )
          .join("")}</ul>
        <p class="muted">“Friends” means you follow each other. Their books count
          for the most in Discover.</p>`
  }`;
  el.querySelectorAll("[data-unfollow]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await social.unfollow(btn.dataset.unfollow);
      toast("Unfollowed");
      renderFriendsScreen();
    })
  );
}

async function renderFeed() {
  const el = $("#feed-list");
  if (!el) return;
  const items = await social.fetchFeed();
  if (!el.isConnected) return;
  el.innerHTML = `<span class="filter-label">Recently read</span>${
    items.length === 0
      ? `<p class="muted">Nothing yet — this fills in as the people you follow
         finish and rate books.</p>`
      : `<ul class="feed-list">${items
          .map(
            (a) => `<li>
              <p class="feed-head">
                <strong>${esc(a.who)}</strong>${a.friend ? "" : " <span class='muted'>(following)</span>"}
                <span class="feed-when">${esc(whenRead(a.at))}</span>
              </p>
              <p class="feed-book">${esc(a.title ?? "A book")}${
                a.authors?.length ? ` <span class="muted">· ${esc(a.authors.join(", "))}</span>` : ""
              }</p>
              ${a.rating ? `<p class="card-rating">${starString(a.rating)}</p>` : ""}
              ${a.review ? `<blockquote class="other-review"><p>${esc(a.review)}</p></blockquote>` : ""}
            </li>`
          )
          .join("")}</ul>`
  }`;
}

// ---------- the account screen ----------
//
// An account exists to answer one question the app used to get wrong: are you
// the same person as the one who was here a minute ago in a different window?
// Without one, the answer lives in this container's storage — and the
// home-screen app and Safari have different containers, so the same person
// came out as two. Signing in makes both resolve to one identity, carries the
// profile name across, and keeps your own library in step even when you're
// not sharing with anyone.
function renderAccountScreen() {
  const el = $("#account-content");
  if (!sync.isConfigured()) {
    el.innerHTML = `<p>Accounts need the same free Firebase project as the
      shared library. <button class="link-btn" data-go="sync">Set that up</button>
      and this screen will offer sign-in.</p>`;
    el.querySelector("[data-go]").addEventListener("click", () => showScreen("sync"));
    return;
  }

  if (!sync.accountAvailable()) {
    el.innerHTML = `<p class="muted">Connecting…</p>`;
    sync.warmup()
      .then(() => { if (currentScreen === "account") renderAccountScreen(); })
      .catch(() => {
        el.innerHTML = `<p class="sync-error">${icon("alert")} Couldn't reach the
          sign-in service. Your library is safe on this device — try again when
          you're back online.</p>`;
      });
    return;
  }

  const email = sync.accountEmail();
  if (email) {
    const lib = sync.currentLibraryName();
    el.innerHTML = `
      <div class="settings-section">
        <span class="filter-label">Signed in</span>
        <p style="margin:0.4rem 0 0">${icon("check")} <strong>${esc(email)}</strong></p>
        <p class="muted" style="font-size:0.8rem;margin:0.5rem 0 0">
          You'll be the same person in the home-screen app and in the browser,
          and on any other device you sign in on. Your profile name
          ${currentProfile() ? `(<strong>${esc(currentProfile())}</strong>) ` : ""}travels
          with you.</p>
        ${lib
          ? `<p class="muted" style="font-size:0.8rem;margin:0.5rem 0 0">
              Sharing <strong>${esc(lib)}</strong> — signing in on a new device
              puts you straight back in, no approval needed.</p>`
          : `<p class="muted" style="font-size:0.8rem;margin:0.5rem 0 0">
              ${sync.isPersonalActive() ? icon("check") + " Your library is backed up to this account"
                : "Your library stays on this device"} — it's yours alone until you
              join a shared library.</p>`}
      </div>
      <div class="settings-section">
        <div class="detail-actions">
          <button class="secondary-btn" id="sign-out-btn">Sign out</button>
        </div>
        <p class="muted" style="font-size:0.75rem;margin:0.4rem 0 0">
          Signing out leaves your books on this device. It doesn't delete
          anything from the account.</p>
      </div>`;
    el.querySelector("#sign-out-btn").addEventListener("click", async () => {
      if (!confirm("Sign out of this account on this device?")) return;
      await sync.signOutAccount();
      toast("Signed out.");
      renderAccountScreen();
      renderSettingsScreen();
      updateSyncIndicator();
    });
    return;
  }

  // What this device would lose by becoming somebody else. An anonymous user
  // with books or a library membership is the common case — they've been
  // using Shelfie for months without an account — and the whole point of
  // adding one is that it costs them nothing.
  const bookCount = db.getAllBooks().length;
  const inLibrary = !!sync.currentHousehold();
  const hasStake = bookCount > 0 || inLibrary;

  el.innerHTML = `
    <p>Right now this device is its own island: open Shelfie from your home
    screen and from Safari and the app treats you as two different people,
    because each keeps its own storage. An account is how it knows you're you.</p>
    ${syncError ? `<p class="sync-error">${icon("alert")} ${esc(syncError)}</p>` : ""}
    ${hasStake ? `
    <p class="muted" style="font-size:0.82rem">
      ${icon("check")} Adding an account keeps everything you already have —
      ${bookCount ? `all <strong>${bookCount}</strong> book${bookCount === 1 ? "" : "s"}` : "your shelves"}${
        inLibrary ? ", your place in the shared library," : ","} your ratings and
      your reviews. It attaches a sign-in to the identity this device already
      has rather than making a new one, so nothing changes hands.</p>` : ""}
    <form id="account-form">
      <div class="inline-form">
        <input type="email" id="account-email" placeholder="Email" autocomplete="email" />
      </div>
      <div class="inline-form">
        <input type="password" id="account-password" placeholder="Password (6+ characters)"
               autocomplete="${hasStake ? "new-password" : "current-password"}" />
      </div>
      <div class="detail-actions" style="margin-top:0.35rem">
        ${hasStake ? `
        <button type="submit" class="primary-btn" data-intent="create">Add an account</button>
        <button type="submit" class="secondary-btn" style="margin-top:0"
                data-intent="signin">Sign in to an existing account</button>`
        : `
        <button type="submit" class="primary-btn" data-intent="signin">Sign in</button>
        <button type="submit" class="secondary-btn" style="margin-top:0"
                data-intent="create">Create account</button>`}
      </div>
    </form>
    <p class="muted" style="font-size:0.78rem;margin-top:0.7rem">
      This is separate from any shared-library password. Your books stay on
      this device either way — an account adds a backup of your own library and
      keeps every window signed in as the same you.</p>`;

  let intent = hasStake ? "create" : "signin";
  el.querySelectorAll("#account-form [data-intent]").forEach((btn) =>
    btn.addEventListener("click", () => { intent = btn.dataset.intent; })
  );
  el.querySelector("#account-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#account-email").value.trim();
    const password = $("#account-password").value;
    if (!email || !password) return toast("Enter an email and a password.");

    // The one genuinely lossy move in this screen. "Add an account" LINKS —
    // the uid is kept, so every rating and review this device wrote stays
    // its own. "Sign in" REPLACES the identity, which is right on a fresh
    // device and quietly destructive on one that has been in use: the books
    // survive (they're local, and shared ones live in the household) but
    // ownership of everything written under the old identity does not. So
    // say that plainly rather than discovering it later.
    if (intent === "signin" && hasStake) {
      const ok = confirm(
        "Sign in as a different identity?\n\n" +
        "This device already has its own. Signing in swaps it out, which keeps " +
        "your books but hands back ownership of the ratings and reviews written " +
        "here — you'd no longer be able to edit or remove them.\n\n" +
        "If this is your first account, tap Cancel and use “Add an account” " +
        "instead — that keeps everything."
      );
      if (!ok) return;
    }

    try {
      if (intent === "create") await sync.linkAccount(email, password);
      else await sync.signInAccount(email, password);
    } catch (err) {
      toast(err.message, { ms: 8000 });
      return;
    }
    await afterSignIn();
    toast(intent === "create"
      ? "Account added — everything on this device came with you."
      : "Signed in.");
  });
}

// Signing in changes who the app thinks you are, so everything keyed to that
// has to catch up: the account's profile name and library membership, then
// whichever sync channel that leaves you on.
async function afterSignIn() {
  try {
    await initSync();
  } catch (err) {
    syncError = err.message;
  }
  updateProfileChip();
  renderShelf();
  renderAccountScreen();
  renderSettingsScreen();
  updateSyncIndicator();
}

function renderSyncScreen() {
  const el = $("#sync-content");

  if (!sync.isConfigured()) {
    el.innerHTML = `
      <p>A shared library lets two (or more) phones see and edit the <strong>same
      live collection</strong> — great for households: either of you scans a book
      and it appears on both phones, and the series checker counts everyone's books.</p>
      <p>It needs a one-time, free Firebase setup (about 5 minutes) by whoever
      owns the app. Follow the steps in
      <a href="https://github.com/zacharyclukey/Library-app/blob/claude/book-library-series-app-jsqsp7/SETUP-SYNC.md"
         target="_blank" rel="noopener">SETUP-SYNC.md</a>,
      then this screen will offer Create / Join options.</p>`;
    return;
  }

  if (sync.currentHousehold() && sync.isActive()) {
    renderSyncActive(el);
  } else if (sync.pendingJoin()) {
    renderSyncWaiting(el);
  } else {
    renderSyncJoin(el);
  }
}

function renderSyncWaiting(el) {
  const libName = sync.pendingJoin()?.libName ?? "the library";
  el.innerHTML = `
    <p>⏳ <strong>Waiting for approval.</strong></p>
    <p>Your request to join <strong>“${esc(libName)}”</strong> has been sent.
    A current member needs to approve it — ask them to open
    <em>Settings → Shared library</em> on their phone and tap Approve.</p>
    <p class="muted" style="font-size:0.82rem">You can close this — the app keeps
    checking and connects automatically once you're approved. No books are
    shared in either direction until then.</p>
    ${syncError ? `<p class="sync-error">${icon("alert")} ${esc(syncError)}</p>` : ""}
    <div class="detail-actions">
      <button id="cancel-join-btn" class="danger-btn">Cancel request</button>
    </div>`;
  $("#cancel-join-btn").addEventListener("click", async () => {
    await sync.cancelPending();
    syncError = null;
    updateSyncIndicator();
    renderSyncScreen();
  });
}

function requestsHtml() {
  if (!syncRequests.length) return "";
  return `
    <div class="settings-section">
      <span class="filter-label">Join requests</span>
      <ul class="member-list">
        ${syncRequests
          .map(
            (r) => `
          <li class="request">
            <span class="avatar">${esc((r.name ?? "?")[0].toUpperCase())}</span>
            <span class="member-main">
              <strong>${esc(r.name ?? "Someone")}</strong> wants to join
              <span class="member-sub">${esc(timeAgo(r.requestedAt))}</span>
            </span>
            <button class="approve-btn" data-approve="${esc(r.deviceId)}">Approve</button>
            <button class="link-btn" data-deny="${esc(r.deviceId)}">Deny</button>
          </li>`
          )
          .join("")}
      </ul>
    </div>`;
}

function wireRequestButtons(el) {
  el.querySelectorAll("[data-approve]").forEach((btn) =>
    btn.addEventListener("click", () => sync.approveJoin(btn.dataset.approve))
  );
  el.querySelectorAll("[data-deny]").forEach((btn) =>
    btn.addEventListener("click", () => sync.denyJoin(btn.dataset.deny))
  );
}

// The account section on the active-sync screen. This is the LINK side of
// the account story — it must only ever attach a credential to the existing
// signed-in user, because this device owns a membership and possibly years
// of ratings, all keyed to its current uid. (The sign-in side lives on the
// join screen, where a device has nothing to lose.) See js/sync.js.
function accountSectionHtml() {
  if (!sync.accountAvailable()) return "";
  const email = sync.accountEmail();
  if (email) {
    return `
      <div class="settings-section">
        <span class="filter-label">Your account</span>
        <p class="muted" style="margin:0.4rem 0 0">${icon("check")} Signed in as
        <strong>${esc(email)}</strong>. Your place in this library survives
        reinstalls — on a new device or browser, sign in with this email, then
        join with the library name and password, and you'll be let straight in.</p>
      </div>`;
  }
  return `
    <div class="settings-section">
      <span class="filter-label">Protect your membership</span>
      <p class="muted" style="margin:0.4rem 0 0.5rem">
        Right now your place in this library lives only on this device — if the
        app is ever deleted or the browser cleared, getting back in needs
        another member's approval. Add an email and you can sign back in from
        anywhere, no approval needed.</p>
      <form id="link-account-form">
        <div class="inline-form">
          <input type="email" id="link-email" placeholder="Email" autocomplete="email" />
        </div>
        <div class="inline-form">
          <input type="password" id="link-password" placeholder="Account password (6+ characters)"
                 autocomplete="new-password" />
        </div>
        <div class="detail-actions" style="margin-top:0.35rem">
          <button type="submit" class="primary-btn">Link account</button>
        </div>
        <p class="muted" style="font-size:0.75rem;margin:0.4rem 0 0">
          This is a new password for signing in — not your library password, and
          it doesn't need to match it.</p>
      </form>
    </div>`;
}

function wireAccountForm(el) {
  const form = el.querySelector("#link-account-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const email = await sync.linkAccount(
        $("#link-email").value, $("#link-password").value
      );
      toast(`Linked — you can now sign in as ${email} from any device.`);
    } catch (err) {
      toast(err.message, { ms: 8000 });
      return;
    }
    renderSyncScreen();
  });
}

function renderSyncActive(el) {
  const requestBlock = requestsHtml();
  const memberBlock = requestBlock + `
    <div class="settings-section">
      <span class="filter-label">Who's in this library (${syncMembers.length || "…"})</span>
      ${membersHtml()}
      <p class="muted" style="font-size:0.75rem;margin:0.5rem 0 0">
        One entry per device — a phone and a tablet show separately. Names come
        from each device's profile.</p>
    </div>` + accountSectionHtml();

  const leaveBlock = `
    ${syncError ? `<p class="sync-error">${icon("alert")} ${esc(syncError)}</p>` : ""}
    <div class="detail-actions">
      <button id="leave-btn" class="danger-btn">Leave shared library</button>
    </div>`;

  if (sync.isNamed()) {
    const name = sync.currentLibraryName() ?? "Shared library";
    el.innerHTML = `
      <p>${icon("check")} Sharing is <strong>on</strong>. This phone is connected to:</p>
      <p class="household-code">${icon("books")} ${esc(name)}</p>
      <p class="muted">Password protected. To let someone in, tell them the
      library name and password — on their phone: <em>Settings → Shared
      library → Join</em>. The password never leaves your devices, so there's
      no way to recover it if forgotten; to change it, create a new library
      (your books come along) and have everyone rejoin.</p>
      ${memberBlock}
      ${leaveBlock}`;
  } else {
    // Legacy code-based household.
    const code = sync.currentHousehold();
    el.innerHTML = `
      <p>${icon("check")} Sharing is <strong>on</strong>. This phone is part of household:</p>
      <p class="household-code">${esc(code)}</p>
      <p class="muted">Anyone who joins with this code shares the library.</p>
      ${memberBlock}
      <div class="settings-section">
        <span class="filter-label">Upgrade to a named library</span>
        <p class="muted" style="margin:0.4rem 0 0.5rem">Give the library a real
        name and a password instead of a code. Your books come along; your
        partner then joins with the new name + password.</p>
        <form id="convert-form">
          <div class="inline-form">
            <input type="text" id="convert-name" placeholder="Library name (e.g. Lukey Library)"
                   autocomplete="off" />
          </div>
          <div class="inline-form">
            <input type="password" id="convert-password" placeholder="Password (8+ characters)"
                   autocomplete="new-password" />
          </div>
          <div class="detail-actions" style="margin-top:0.35rem">
            <button type="submit" class="primary-btn" data-convert-intent="create">Create it</button>
            <button type="submit" class="secondary-btn" style="margin-top:0"
                    data-convert-intent="join">Join existing</button>
          </div>
          <p class="muted" style="font-size:0.75rem;margin:0.4rem 0 0">
            If someone else already upgraded this household, use <em>Join existing</em>
            with the name and password they chose.</p>
        </form>
      </div>
      ${leaveBlock}`;

    let convertIntent = "create";
    el.querySelectorAll("[data-convert-intent]").forEach((btn) =>
      btn.addEventListener("click", () => (convertIntent = btn.dataset.convertIntent))
    );
    $("#convert-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      await activateNamed(
        $("#convert-name").value,
        $("#convert-password").value,
        convertIntent === "create"
      );
    });
  }

  wireMemberButtons(el);
  wireRequestButtons(el);
  wireAccountForm(el);
  $("#leave-btn").addEventListener("click", () => {
    if (confirm("Leave the shared library on this phone? Your books stay on this phone and in the cloud for other members.")) {
      sync.leave();
      syncMembers = [];
      syncError = null;
      updateSyncIndicator();
      renderSyncScreen();
    }
  });
}

function renderSyncJoin(el) {
  // Load the SDK so the sign-in section can offer itself; re-render once it's
  // there. Harmless when already loaded, a no-op when sync isn't configured.
  if (!sync.accountAvailable()) {
    sync.warmup().then(() => {
      // Re-render to reveal the sign-in section — but never over someone's
      // half-typed library name if the SDK took its time loading.
      const untouched = !$("#library-name")?.value && !$("#library-password")?.value;
      if (currentScreen === "sync" && !sync.currentHousehold() && untouched) renderSyncScreen();
    }).catch(() => {});
  }
  el.innerHTML = `
    <p>Name your library and protect it with a password. Whoever enters the
    <strong>same name and password</strong> lands in the same library — create
    it once, then your partner joins with the same details. Books already on
    each phone are merged in, so nothing is lost.</p>
    ${syncError ? `<p class="sync-error">${icon("alert")} ${esc(syncError)}</p>` : ""}
    <form id="library-form">
      <div class="inline-form">
        <input type="text" id="library-name" placeholder="Library name (e.g. Lukey Library)"
               autocomplete="off" />
      </div>
      <div class="inline-form">
        <input type="password" id="library-password" placeholder="Password (6+ characters)"
               autocomplete="off" />
      </div>
      <div class="detail-actions" style="margin-top:0.35rem">
        <button type="submit" class="primary-btn" data-intent="join">Join library</button>
        <button type="submit" class="secondary-btn" style="margin-top:0"
                data-intent="create">Create new library</button>
      </div>
    </form>
    ${sync.accountAvailable() ? `
    <div class="settings-section" style="margin-top:0.9rem">
      <span class="filter-label">Already a member?</span>
      ${sync.accountEmail() ? `
      <p class="muted" style="margin:0.4rem 0 0">${icon("check")} Signed in as
      <strong>${esc(sync.accountEmail())}</strong> — join above with the library
      name and password and you'll be let straight in.</p>` : `
      <p class="muted" style="margin:0.4rem 0 0.5rem">
        If you linked an account on your old device, sign in first — then join
        above and you'll be recognised, with no approval needed.</p>
      <form id="signin-form">
        <div class="inline-form">
          <input type="email" id="signin-email" placeholder="Email" autocomplete="email" />
        </div>
        <div class="inline-form">
          <input type="password" id="signin-password" placeholder="Account password"
                 autocomplete="current-password" />
        </div>
        <div class="detail-actions" style="margin-top:0.35rem">
          <button type="submit" class="secondary-btn" style="margin-top:0">Sign in</button>
        </div>
      </form>`}
    </div>` : ""}
    <p class="muted" style="font-size:0.78rem;margin-top:0.8rem">
      The password is only ever used on your phones to locate the library — it's
      never sent or stored online, so pick something you'll both remember.
      <button type="button" id="legacy-toggle" class="link-btn">Have an old household code?</button>
    </p>
    <form id="legacy-form" class="inline-form hidden">
      <input type="text" id="join-code-input" placeholder="Old household code"
             autocomplete="off" autocapitalize="none" />
      <button type="submit" class="primary-btn">Join by code</button>
    </form>`;

  let intent = "join";
  el.querySelectorAll("[data-intent]").forEach((btn) =>
    btn.addEventListener("click", () => (intent = btn.dataset.intent))
  );
  $("#library-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await activateNamed($("#library-name").value, $("#library-password").value, intent === "create");
  });

  el.querySelector("#signin-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const email = await sync.signInAccount(
        $("#signin-email").value, $("#signin-password").value
      );
      toast(`Signed in as ${email} — now join your library above.`);
    } catch (err) {
      toast(err.message, { ms: 8000 });
      return;
    }
    renderSyncScreen();
  });

  $("#legacy-toggle").addEventListener("click", () =>
    $("#legacy-form").classList.toggle("hidden")
  );
  $("#legacy-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("#join-code-input").value;
    if (!code.trim()) return;
    syncError = null;
    try {
      await sync.join(code, db.getAllBooks(), onRemoteBooks, onSyncError, syncOpts());
    } catch (err) {
      syncError = err.message;
    }
    updateSyncIndicator();
    renderSyncScreen();
  });
}

async function activateNamed(name, password, create) {
  syncError = null;
  try {
    if (create) {
      await sync.openNamed({
        name,
        password,
        create: true,
        onRemote: onRemoteBooks,
        onError: onSyncError,
        ...syncOpts(),
      });
    } else {
      const res = await sync.requestJoin({
        name,
        password,
        localBooks: () => db.getAllBooks(),
        onRemote: onRemoteBooks,
        onError: onSyncError,
        onMembers,
        profileName: currentProfile(),
        onResolved: onJoinResolved,
      });
      if (res?.recognised) toast("Welcome back — your account was recognised, no approval needed.");
    }
  } catch (err) {
    syncError = err.message;
  }
  updateSyncIndicator();
  renderSyncScreen();
}

// Your account decides who you are before anything else does. The home-screen
// app and Safari are separate storage containers, so each was inventing its
// own anonymous identity and its own profile — the same person appearing as
// two different people depending on which icon they tapped. Signing in makes
// both contexts resolve to one uid, and the account doc carries the profile
// name and shared-library membership across, so they stop disagreeing.
async function restoreAccount() {
  let acct = null;
  try {
    acct = await sync.accountBootstrap();
  } catch {
    return null; // offline, or the SDK couldn't load — local identity stands
  }
  if (!acct) return null;

  // The name travels with the account, so a new device is you rather than a
  // stranger who has to introduce themselves.
  //
  // Awaited, not fired and forgotten: start() writes the library membership to
  // this same document a moment later, and two un-ordered writes race. Getting
  // the name in first means the account is never left holding a library but no
  // idea who you are — which is what a new device reads to answer both.
  if (acct.profileName && acct.profileName !== currentProfile()) {
    localStorage.setItem(PROFILE_KEY, acct.profileName);
    updateProfileChip();
  } else if (!acct.profileName && currentProfile()) {
    await sync.saveAccountProfile({ profileName: currentProfile() }).catch(() => {});
    acct.profileName = currentProfile();
  }

  // Signed in on a device that isn't in the shared library your account is a
  // member of: follow the account in rather than asking anyone to approve a
  // person who is demonstrably already inside.
  if (acct.libId && !sync.currentHousehold()) {
    sync.adoptLibrary(acct.libId, acct.libName);
  }
  return acct;
}

async function initSync() {
  if (!sync.isConfigured()) return;
  const acct = await restoreAccount();

  if (!sync.currentHousehold() && sync.pendingJoin()) {
    sync.watchPending({
      localBooks: () => db.getAllBooks(),
      onRemote: onRemoteBooks,
      onError: onSyncError,
      onMembers,
      profileName: currentProfile(),
      onResolved: onJoinResolved,
    });
    updateSyncIndicator();
  }

  if (sync.currentHousehold()) {
    try {
      await sync.start(onRemoteBooks, onSyncError, syncOpts());
    } catch (err) {
      syncError = err.message;
    }
  } else if (acct) {
    // Signed in and sharing with nobody: your own library is the one that
    // syncs, so the same books are there in every context you sign in to.
    try {
      await sync.startPersonal(onRemoteBooks, onSyncError, { localBooks: db.getAllBooks() });
    } catch (err) {
      syncError = err.message;
    }
  }
  updateSyncIndicator();
}

// Books scanned before genre support have no subject tags; fetch them
// gently in the background so genre filters cover the whole library.
async function backfillSubjects() {
  const missing = db
    .getAllBooks()
    .filter((b) => b.workKey && !b.subjects?.length)
    .slice(0, 20);
  let updated = false;
  for (const b of missing) {
    const subjects = await api.fetchWorkSubjects(b.workKey);
    if (subjects.length) {
      db.updateBook(b.id, { subjects });
      updated = true;
    }
    await new Promise((r) => setTimeout(r, 400)); // be polite to the API
  }
  if (updated) renderShelf();
}

// ---------- init ----------
paintIcons();
updateNetPill();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
requestPersistence();
themes.apply();
// Swapped-in icon files (assets/icons/) before the first render, so a
// replaced glyph never flashes as the built-in first.
await loadIconOverrides().catch(() => {});
applyCustomAssets(); // picks up anything in assets/; a no-op when it's empty
themes.watchSystem(() => {
  if (currentScreen === "settings") renderSettingsScreen();
});
updateViewToggle();
updateProfileChip();
renderShelf();
initSync();
backfillSubjects();
history.replaceState({ screen: "shelves" }, "");
if (!currentProfile()) showScreen("profile");

// Home-screen shortcut: long-press the app icon -> "Scan a book".
if (new URLSearchParams(location.search).get("action") === "scan") {
  history.replaceState({ screen: "shelves" }, "", "./");
  addModal.showModal();
  $("#method-camera").click();
}
