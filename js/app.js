import * as db from "./db.js";
import * as api from "./api.js";
import * as sync from "./sync.js";
import * as flt from "./filters.js";
import * as xport from "./export.js";
import { scanImageFile, startLiveScan, stopLiveScan } from "./scanner.js";

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
const seriesCache = new Map(); // book.id -> { series, books } | null

// ---------- profiles ----------
// A profile is just a name. The Owned shelf is shared by the household;
// To Read / Completed / Wishlist entries belong to whoever added them
// (books with no profile are treated as shared and show up for everyone).

const PROFILE_KEY = "shelfie.profile.v1";
const PERSONAL_SHELVES = ["tbr", "completed", "wishlist"];
let memberFilter = "me"; // "me" | "all" | a profile name
let searchQuery = "";

const emptyFilter = () =>
  ({ genre: null, length: null, series: null, age: null, format: null, rated: null });
let shelfFilter = emptyFilter();
let shelfSort = "added";

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
const SHELF_ICON = { owned: "📗", tbr: "🔖", completed: "✅", wishlist: "🎁" };
const SHELVES = ["owned", "tbr", "completed", "wishlist"];

const VIEW_KEY = "shelfie.view.v1";
const THEME_KEY = "shelfie.theme.v1";
let viewMode = localStorage.getItem(VIEW_KEY) ?? "grid";

function starString(rating) {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

// A cover that always looks intentional: a coloured spine-styled fallback
// (stable colour per title) sits underneath, and the real jacket covers it
// when one loads.
function coverHtml(b) {
  const author = (b.authors ?? [])[0] ?? "";
  return `<div class="cover-wrap" style="--h:${xport.hueOf(b.title)}">
      <div class="cover-fallback">
        <span class="fb-title">${esc(b.title)}</span>
        ${author ? `<span class="fb-author">${esc(author)}</span>` : ""}
      </div>
      ${b.coverUrl
        ? `<img class="cover" src="${esc(b.coverUrl)}" alt="" loading="lazy"
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
    ["🛒 Amazon", b.isbn10
      ? `https://www.amazon.com/dp/${b.isbn10}`
      : `https://www.amazon.com/s?k=${q}`],
    ["📕 Barnes & Noble", `https://www.barnesandnoble.com/s/${q}`],
    ["🏪 Bookshop.org", `https://bookshop.org/search?keywords=${q}`],
    ["♻️ ThriftBooks", `https://www.thriftbooks.com/browse/?b.search=${q}`],
    ["📜 AbeBooks", isbn
      ? `https://www.abebooks.com/servlet/SearchResults?isbn=${isbn}`
      : `https://www.abebooks.com/servlet/SearchResults?kn=${q}`],
    ["🏛️ Library (WorldCat)", `https://search.worldcat.org/search?q=${q}`],
    ["⭐ Goodreads", `https://www.goodreads.com/search?q=${q}`],
  ];
}

// ---------- rendering ----------

function esc(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function renderShelf() {
  let books = db.getBooksOnShelf(currentShelf);
  for (const shelf of SHELVES) {
    $(`#count-${shelf}`).textContent = db.getBooksOnShelf(shelf).length;
  }

  const personal = PERSONAL_SHELVES.includes(currentShelf);
  renderProfileFilter(personal);
  if (personal && memberFilter !== "all") {
    const target = memberFilter === "me" ? currentProfile() : memberFilter;
    books = books.filter((b) => !b.profile || !target || b.profile === target);
  }
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    books = books.filter((b) =>
      (b.title + " " + (b.authors ?? []).join(" ")).toLowerCase().includes(q)
    );
  }

  const hadBeforeFilter = books.length;
  books = books.filter((b) => flt.matchesFilter(b, shelfFilter, { myRating: myRating(b) }));
  books = flt.sortBooks(books, shelfSort, { ratingOf: myRating });
  updateFilterBadge();

  visibleBooks = books;
  const filtered = hadBeforeFilter > 0 || q;
  $("#empty-text").textContent = filtered
    ? "Nothing matches your search or filters."
    : `Your ${SHELF_LABEL[currentShelf]} shelf is empty.`;
  $("#empty-action").textContent = filtered ? "Clear filters" : "＋ Add your first book";
  $("#empty-action").dataset.action = filtered ? "clear" : "add";
  emptyState.classList.toggle("hidden", books.length > 0);
  $("#shelf-summary").textContent = books.length ? xport.summaryLine(books) : "";

  const showNames = allProfiles().length > 1;
  bookList.className = "book-list " + viewMode;
  bookList.innerHTML = books
    .map((b) => (viewMode === "grid" ? gridCard(b, showNames) : listCard(b, showNames)))
    .join("");

  // Kick off background series checks for owned books we haven't checked yet.
  books.forEach((b) => {
    if (!seriesCache.has(b.id)) checkSeriesInBackground(b);
  });
}

function missingInSeries(b) {
  return seriesCache.get(b.id)?.missingCount ?? 0;
}

function gridCard(b, showNames) {
  const rating = myRating(b);
  const missing = missingInSeries(b);
  return `
    <article class="grid-book" data-id="${esc(b.id)}" title="${esc(b.title)}">
      ${coverHtml(b)}
      <div>
        <p class="grid-title">${esc(b.title)}</p>
        <p class="grid-author">${esc((b.authors ?? []).join(", "))}</p>
      </div>
      <div class="grid-meta">
        ${rating ? `<span class="grid-rating">${starString(rating)}</span>` : ""}
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
    ? `<span class="badge more-badge">📚 ${missing} more in series</span>`
    : "";
  return `
    <article class="book-card" data-id="${esc(b.id)}">
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
          ${showNames && b.profile ? `<span class="badge profile-badge">👤 ${esc(b.profile)}</span>` : ""}
          ${seriesBadge}${moreBadge}
        </div>
      </div>
    </article>`;
}

async function checkSeriesInBackground(book) {
  seriesCache.set(book.id, null); // mark in-flight
  try {
    const series = await api.detectSeries(book);
    if (!series) {
      seriesCache.set(book.id, { series: null, books: [], missingCount: 0 });
      return;
    }
    if (!book.series?.name) db.updateBook(book.id, { series });

    const entries = await api.listSeriesBooks(series.name, book.authors);
    const ownedTitles = new Set(
      db.getOwnedBooks().map((b) => normTitle(b.title))
    );
    const missing = entries.filter((e) => !ownedTitles.has(normTitle(e.title)));
    seriesCache.set(book.id, {
      series,
      books: entries,
      missingCount: entries.length ? missing.length : 0,
    });
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
    renderShelf();
  });
});

// ---------- search & member filter ----------

$("#list-search").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderShelf();
});

// ---------- view mode ----------

function updateViewToggle() {
  const btn = $("#view-toggle");
  // Show the icon of the view you'd switch *to*.
  btn.textContent = viewMode === "grid" ? "▤" : "▦";
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
    shelfSort = "added";
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
  options.forEach(([value, text]) => {
    const btn = document.createElement("button");
    btn.className = "filter-chip" + (current === value ? " active" : "");
    btn.textContent = text;
    btn.addEventListener("click", () => onPick(current === value ? null : value));
    row.appendChild(btn);
  });
  wrap.appendChild(row);
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

  const genres = libraryGenres();
  if (genres.length) {
    panel.appendChild(
      chipGroup("Genre", genres.map((g) => [g, g]), shelfFilter.genre, set("genre"))
    );
  }
  panel.appendChild(chipGroup("Length", flt.LENGTH_OPTIONS, shelfFilter.length, set("length")));
  panel.appendChild(chipGroup("Series", flt.SERIES_OPTIONS, shelfFilter.series, set("series")));
  panel.appendChild(chipGroup("Published", flt.AGE_OPTIONS, shelfFilter.age, set("age")));
  panel.appendChild(chipGroup("Format", flt.FORMAT_OPTIONS, shelfFilter.format, set("format")));
  panel.appendChild(chipGroup("Rating", flt.RATED_OPTIONS, shelfFilter.rated, set("rated")));

  const sortWrap = document.createElement("div");
  sortWrap.className = "filter-group";
  sortWrap.innerHTML = `<span class="filter-label">Sort by</span>`;
  const select = document.createElement("select");
  select.className = "sort-select";
  flt.SORT_OPTIONS.forEach(([value, text]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    opt.selected = shelfSort === value;
    select.appendChild(opt);
  });
  select.addEventListener("change", () => {
    shelfSort = select.value;
    renderShelf();
  });
  sortWrap.appendChild(select);
  panel.appendChild(sortWrap);

  const clear = document.createElement("button");
  clear.className = "link-btn";
  clear.textContent = "Clear all filters";
  clear.addEventListener("click", () => {
    shelfFilter = emptyFilter();
    shelfSort = "added";
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

const profileModal = $("#profile-modal");

function updateProfileChip() {
  const me = currentProfile();
  $("#profile-avatar").textContent = me ? me[0].toUpperCase() : "?";
  $("#profile-name").textContent = me ?? "Set profile";
}

$("#profile-chip").addEventListener("click", () => {
  renderProfileModal();
  profileModal.showModal();
});

function renderProfileModal() {
  const el = $("#profile-content");
  const me = currentProfile();
  const profiles = allProfiles();
  el.innerHTML = `
    <p>Profiles keep each person's <strong>To Read, Completed and Wishlist</strong>
    separate, while the <strong>Owned</strong> shelf stays shared. Pick who's using
    this phone:</p>
    <div class="profile-list">
      ${profiles
        .map(
          (p) => `<button class="filter-chip big ${p === me ? "active" : ""}"
                          data-pick-profile="${esc(p)}">👤 ${esc(p)}</button>`
        )
        .join("")}
    </div>
    <form id="new-profile-form" class="inline-form" style="margin-top:0.7rem">
      <input type="text" id="new-profile-input" placeholder="Add a name (e.g. Zach)"
             autocomplete="off" maxlength="30" />
      <button type="submit" class="primary-btn">${profiles.length ? "Add" : "Create"}</button>
    </form>
    <p class="muted" style="font-size:0.78rem">Each phone remembers its own profile.
    Books added before profiles existed are shared — open one and use
    “Belongs to” to assign it.</p>`;

  el.querySelectorAll("[data-pick-profile]").forEach((btn) =>
    btn.addEventListener("click", () => {
      localStorage.setItem(PROFILE_KEY, btn.dataset.pickProfile);
      memberFilter = "me";
      updateProfileChip();
      profileModal.close();
      renderShelf();
    })
  );
  $("#new-profile-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#new-profile-input").value.trim();
    if (!name) return;
    localStorage.setItem(PROFILE_KEY, name);
    memberFilter = "me";
    updateProfileChip();
    profileModal.close();
    renderShelf();
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

async function handleFoundIsbn(isbn) {
  try {
    const book = await api.lookupByIsbn(isbn);
    if (!book) {
      scanStatus.textContent = `No book found for ISBN ${isbn}. Try searching by title below.`;
      return;
    }
    if (db.hasBook(book.id)) {
      scanStatus.textContent = `“${book.title}” is already in your library.`;
      return;
    }
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

$("#title-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#title-input").value.trim();
  if (!q) return;
  scanStatus.textContent = "Searching…";
  const results = await api.searchByTitle(q);
  scanStatus.textContent = results.length ? "" : "No matches found.";
  searchResults.innerHTML = results
    .map(
      (r, i) => `
      <button class="search-result" data-idx="${i}">
        ${r.coverUrl ? `<img src="${esc(r.coverUrl)}" alt="" />` : `<span class="cover-ph"></span>`}
        <span>
          <strong>${esc(r.title)}</strong><br />
          <small>${esc(r.authors.join(", "))}${r.year ? " · " + r.year : ""}</small>
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
        };
      }
      scanStatus.textContent = "";
      queueBookForConfirm(book);
    })
  );
});

// ---------- confirm / shelf choice ----------

function queueBookForConfirm(book) {
  pendingBooks.push(book);
  if (!confirmModal.open) showNextPendingBook();
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
    </div>`;
  if (!confirmModal.open) confirmModal.showModal();
}

document.querySelectorAll("[data-add-shelf]").forEach((btn) =>
  btn.addEventListener("click", () => {
    const book = pendingBooks.shift();
    if (!book) return;
    const shelf = btn.dataset.addShelf;
    const alsoOwn = $("#also-own-checkbox").checked;
    const owned = shelf === "owned" || (alsoOwn && shelf !== "wishlist");
    db.addBook({ ...book, shelf, owned, profile: currentProfile() ?? null });
    // Fetch genre subjects in the background so filters know this book.
    if (book.workKey && !book.subjects?.length) {
      api.fetchWorkSubjects(book.workKey).then((subjects) => {
        if (subjects.length) db.updateBook(book.id, { subjects });
      });
    }
    seriesCache.delete(book.id);
    renderShelf();
    scanStatus.textContent = `Added “${book.title}” to ${SHELF_LABEL[shelf]}.`;
    showNextPendingBook();
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
  if (card) openDetail(card.dataset.id);
});

async function openDetail(id) {
  const b = db.getBook(id);
  if (!b) return;

  const rows = [
    ["Author(s)", (b.authors ?? []).join(", ")],
    ["Format", b.format],
    ["Publisher", b.publisher],
    ["Published", b.publishDate],
    ["Pages", b.pageCount],
    ["ISBN-13", b.isbn13],
    ["ISBN-10", b.isbn10],
    ["Open Library edition", b.editionKey],
    ["Shelf", SHELF_LABEL[b.shelf] + (b.owned && b.shelf !== "owned" ? " (owned copy)" : "")],
  ].filter(([, v]) => v);

  $("#detail-content").innerHTML = `
    <div class="confirm-book">
      ${coverHtml(b)}
      <div>
        <h3>${esc(b.title)}</h3>
        ${b.subtitle ? `<p class="subtitle">${esc(b.subtitle)}</p>` : ""}
        <table class="detail-table">
          ${rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(String(v))}</td></tr>`).join("")}
        </table>
      </div>
    </div>
    ${allProfiles().length ? `
    <div class="assign-row">
      <span class="rate-label">Belongs to:</span>
      ${allProfiles()
        .map((p) => `<button class="filter-chip ${b.profile === p ? "active" : ""}"
                       data-assign="${esc(p)}">${esc(p)}</button>`)
        .join("")}
      <button class="filter-chip ${!b.profile ? "active" : ""}" data-assign="">Shared</button>
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
    <div class="find-section">
      <h3>Find this book</h3>
      <div class="store-links">
        ${storeLinks(b)
          .map(([label, url]) =>
            `<a class="store-link" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`)
          .join("")}
      </div>
    </div>
    <div class="detail-actions">
      ${SHELVES
        .filter((s) => s !== b.shelf)
        .map((s) => `<button class="secondary-btn" data-move="${s}">Move to ${SHELF_LABEL[s]}</button>`)
        .join("")}
      <button class="danger-btn" data-delete>Remove</button>
    </div>
    <div id="series-section" class="series-section">
      <h3>Series</h3>
      <p class="series-loading">Checking series info…</p>
    </div>`;
  detailModal.showModal();

  $("#detail-content").querySelectorAll("[data-move]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const to = btn.dataset.move;
      // Moving off the wishlist to owned/tbr/completed means you got the book.
      const owned = to === "owned" ? true : to === "wishlist" ? false : b.owned || b.shelf === "wishlist";
      db.updateBook(id, { shelf: to, owned });
      detailModal.close();
      renderShelf();
    })
  );
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
    if (confirm(`Remove “${b.title}” from your library?`)) {
      db.removeBook(id);
      seriesCache.delete(id);
      detailModal.close();
      renderShelf();
    }
  });

  renderSeriesSection(b);
}

async function renderSeriesSection(book) {
  const section = () => detailModal.querySelector("#series-section");
  let cached = seriesCache.get(book.id);
  if (!cached) {
    try {
      const series = await api.detectSeries(book);
      if (series) {
        const entries = await api.listSeriesBooks(series.name, book.authors);
        cached = { series, books: entries };
        if (!book.series?.name) db.updateBook(book.id, { series });
      } else {
        cached = { series: null, books: [] };
      }
      seriesCache.set(book.id, { ...cached, missingCount: 0 });
    } catch {
      cached = null;
    }
  }
  const el = section();
  if (!el) return; // modal closed meanwhile

  if (!cached || !cached.series) {
    el.innerHTML = `<h3>Series</h3><p class="muted">No series found — this looks like a standalone book.</p>`;
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
      ? `<span class="own-flag">✅ owned</span>`
      : wished
        ? `<span class="own-flag wished">🎁 wishlisted</span>`
        : `<button class="wish-btn" data-wish-idx="${i}">＋ Wishlist</button>`;
    return `
      <li class="${owned ? "owned" : "missing"}">
        ${e.coverUrl ? `<img src="${esc(e.coverUrl)}" alt="" />` : `<span class="cover-ph"></span>`}
        <span class="series-title">${esc(e.title)}${e.year ? ` <small>(${e.year})</small>` : ""}</span>
        ${flag}
      </li>`;
  });
  const missingCount = cached.books.filter((e) => !ownedTitles.has(normTitle(e.title))).length;
  seriesCache.set(book.id, { ...cached, missingCount });

  el.innerHTML = `
    <h3>Series: ${esc(cached.series.name)}</h3>
    ${
      items.length
        ? `<p class="muted">${
            missingCount
              ? `You're missing ${missingCount} of ${cached.books.length} books in this series.`
              : `You own all ${cached.books.length} books we found in this series. 🎉`
          }</p><ul class="series-list">${items.join("")}</ul>`
        : `<p class="muted">This book is part of “${esc(cached.series.name)}”, but we couldn't list the other entries.</p>`
    }`;

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
      renderSeriesSection(book); // re-render to show the 🎁 flag
      renderShelf();
    })
  );

  renderShelf(); // refresh badges with the new missing count
}

// ---------- discover (recommendations) ----------

const discoverModal = $("#discover-modal");
let recFilter = { genre: null, length: null, age: null };
let recsCache = null; // { key, recs } — keyed on filters + library size

$("#discover-btn").addEventListener("click", () => {
  discoverModal.showModal();
  renderDiscover();
});

function renderDiscover() {
  const el = $("#discover-content");
  el.innerHTML = "";

  const set = (key) => (value) => {
    recFilter[key] = value;
    renderDiscover();
  };
  const filterBox = document.createElement("div");
  filterBox.className = "rec-filters";
  filterBox.appendChild(
    chipGroup("Genre", flt.GENRES.map(([g]) => [g, g]), recFilter.genre, set("genre"))
  );
  filterBox.appendChild(chipGroup("Length", flt.LENGTH_OPTIONS, recFilter.length, set("length")));
  filterBox.appendChild(chipGroup("Published", flt.AGE_OPTIONS, recFilter.age, set("age")));
  el.appendChild(filterBox);

  const results = document.createElement("div");
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
// works. When Discover filters are active, shelf books matching the filter
// drive the profile (3x weight) and the rest of the library is context;
// candidates are then constrained to the filter too. Results come from
// Open Library ranked by community rating.
async function buildRecommendations(books, f) {
  const focusFilter = { ...emptyFilter(), genre: f.genre, length: f.length, age: f.age };
  const anyFilter = !!(f.genre || f.length || f.age);
  const inFocus = (b) => flt.matchesFilter(b, focusFilter, { myRating: myRating(b) });
  const focusBoost = (b) => (anyFilter && inFocus(b) ? 3 : 1);

  const authorScore = {};
  for (const b of books) {
    const engagement = (myRating(b) ?? 0) >= 4 ? 3 : b.shelf === "wishlist" ? 2 : 1;
    const w = engagement * focusBoost(b);
    (b.authors ?? []).forEach((a) => (authorScore[a] = (authorScore[a] ?? 0) + w));
  }
  const topAuthors = Object.entries(authorScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([a]) => a);

  // Mine subjects from filter-matching works first so a Fantasy filter
  // reads your fantasy shelf, not your whole library.
  const subjectScore = {};
  const pool = anyFilter
    ? [...books.filter(inFocus), ...books.filter((b) => !inFocus(b))]
    : books;
  const withWorks = pool.filter((b) => b.workKey).slice(0, 8);
  await Promise.allSettled(
    withWorks.map(async (b) => {
      (await api.fetchWorkSubjects(b.workKey)).forEach(
        (s) => (subjectScore[s] = (subjectScore[s] ?? 0) + focusBoost(b))
      );
    })
  );
  const topSubjects = Object.entries(subjectScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s]) => s);

  const genreTerm = f.genre ? flt.genreQueryTerm(f.genre) : null;
  const withGenre = (q) => (genreTerm ? `${q} subject:"${genreTerm}"` : q);
  const queries = [
    ...topAuthors.map((a) => ({ q: withGenre(`author:"${a}"`), reason: `More by ${a}` })),
    ...topSubjects
      .filter((s) => s.toLowerCase() !== genreTerm)
      .map((s) => ({ q: withGenre(`subject:"${s}"`), reason: s })),
  ];
  if (genreTerm) queries.push({ q: `subject:"${genreTerm}"`, reason: `Top-rated ${f.genre}` });

  const have = new Set(books.map((b) => normTitle(b.title)));
  const found = new Map();
  await Promise.allSettled(
    queries.map(async ({ q, reason }) => {
      for (const r of await api.searchRanked(q, 12)) {
        if (f.length && !flt.lengthMatches(r.pages, f.length)) continue;
        if (f.age && !flt.ageMatches(r.year, f.age)) continue;
        const t = normTitle(r.title);
        if (!have.has(t) && !found.has(t)) found.set(t, { ...r, reason });
      }
    })
  );
  return [...found.values()]
    .sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0))
    .slice(0, 15);
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
              ? `<span class="own-flag wished">🎁</span>`
              : `<button class="wish-btn" data-rec-idx="${i}">＋ Wishlist</button>`}
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
      renderRecs(el, recsCache.recs); // re-render to show the 🎁 flag
    })
  );
}

// ---------- export ----------

const exportModal = $("#export-modal");
let exportScope = null;      // shelf key, or "all"
let exportUseView = true;    // honour the current search/filters/profile view

$("#export-btn").addEventListener("click", () => {
  exportScope = currentShelf;
  exportUseView = true;
  renderExportModal();
  exportModal.showModal();
});

function exportBooks() {
  if (exportScope === "all") return db.getAllBooks();
  if (exportScope === currentShelf && exportUseView) return visibleBooks;
  return db.getBooksOnShelf(exportScope);
}

function exportTitle() {
  return exportScope === "all" ? "My Library" : `${SHELF_LABEL[exportScope]} shelf`;
}

function renderExportModal() {
  const el = $("#export-content");
  const books = exportBooks();
  const scopes = [...SHELVES.map((s) => [s, `${SHELF_ICON[s]} ${SHELF_LABEL[s]}`]), ["all", "📚 Everything"]];
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
          <span class="method-icon">📄</span>
          <span class="method-label">Printable page</span>
          <span class="method-hint">Opens a styled page you can print or save as PDF</span>
        </button>
        <button class="method-btn" data-format="text" ${books.length ? "" : "disabled"}>
          <span class="method-icon">💬</span>
          <span class="method-label">Share as text</span>
          <span class="method-hint">A tidy list to text or email</span>
        </button>
        <button class="method-btn" data-format="csv" ${books.length ? "" : "disabled"}>
          <span class="method-icon">📊</span>
          <span class="method-label">Spreadsheet</span>
          <span class="method-hint">CSV for Excel or Google Sheets</span>
        </button>
        <button class="method-btn" data-format="json">
          <span class="method-icon">💾</span>
          <span class="method-label">Backup</span>
          <span class="method-hint">Full JSON of the whole library</span>
        </button>
      </div>
    </div>
    <p class="export-note" id="export-status">Covers and ratings are included in the printable page.</p>`;

  el.querySelectorAll("[data-scope]").forEach((btn) =>
    btn.addEventListener("click", () => {
      exportScope = btn.dataset.scope;
      renderExportModal();
    })
  );
  $("#export-view-check")?.addEventListener("change", (e) => {
    exportUseView = e.target.checked;
    renderExportModal();
  });
  el.querySelectorAll("[data-format]").forEach((btn) =>
    btn.addEventListener("click", () => runExport(btn.dataset.format))
  );
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
    const html = xport.buildPrintableHtml(books, { title, subtitle, ratingOf: myRating });
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

const settingsModal = $("#settings-modal");

$("#settings-btn").addEventListener("click", () => {
  renderSettingsModal();
  settingsModal.showModal();
});

function currentTheme() {
  return localStorage.getItem(THEME_KEY) ?? "auto";
}

function applyTheme(theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}

function renderSettingsModal() {
  const el = $("#settings-content");
  const me = currentProfile();
  const household = sync.isActive() ? sync.currentHousehold() : null;
  const theme = currentTheme();

  el.innerHTML = `
    <div class="settings-section">
      <button class="settings-row" data-go="profile">
        <span class="row-main">
          <span class="row-icon">👤</span>
          <span>Profile
            <span class="row-sub">${me ? esc(me) : "Not set — tap to choose"}</span>
          </span>
        </span>
        <span class="row-go">›</span>
      </button>
      <button class="settings-row" data-go="sync">
        <span class="row-main">
          <span class="row-icon">👩‍❤️‍👨</span>
          <span>Shared library
            <span class="row-sub">${
              household ? "On · " + esc(household) : sync.isConfigured() ? "Off" : "Needs setup"
            }</span>
          </span>
        </span>
        <span class="row-go">›</span>
      </button>
      <button class="settings-row" data-go="import">
        <span class="row-main">
          <span class="row-icon">📥</span>
          <span>Restore from backup
            <span class="row-sub">Load a Shelfie JSON export</span>
          </span>
        </span>
        <span class="row-go">›</span>
      </button>
    </div>

    <div class="settings-section">
      <span class="filter-label">Appearance</span>
      <div class="seg" style="margin-top:0.45rem">
        ${[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]]
          .map(([v, label]) =>
            `<button class="filter-chip ${theme === v ? "active" : ""}" data-theme="${v}">${label}</button>`)
          .join("")}
      </div>
    </div>

    <span class="credit">📚 Shelfie · book data from Open Library &amp; Google Books</span>`;

  el.querySelectorAll("[data-theme]").forEach((btn) =>
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.theme);
      renderSettingsModal();
    })
  );
  el.querySelectorAll("[data-go]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const target = btn.dataset.go;
      settingsModal.close();
      if (target === "profile") {
        renderProfileModal();
        profileModal.showModal();
      } else if (target === "sync") {
        renderSyncModal();
        syncModal.showModal();
      } else {
        $("#import-input").click();
      }
    })
  );
}

$("#import-input").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    db.importJson(await file.text());
    seriesCache.clear();
    renderShelf();
    alert("Library restored.");
  } catch (err) {
    alert("Import failed: " + err.message);
  }
});

// ---------- bottom nav ----------

$("#nav-shelves").addEventListener("click", () => {
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---------- shared library (sync) ----------

const syncModal = $("#sync-modal");
let syncError = null;

function onRemoteBooks(books) {
  db.applyRemote(books);
  renderShelf();
}

function onSyncError(err) {
  syncError = err.message;
  updateSyncIndicator();
  if (syncModal.open) renderSyncModal();
}

function updateSyncIndicator() {
  const dot = $("#sync-dot");
  dot.classList.toggle("hidden", !sync.isActive());
  dot.classList.toggle("error", !!syncError);
  dot.title = syncError ? "Sync error: " + syncError : "Sync on";
}

function renderSyncModal() {
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

  const code = sync.currentHousehold();
  if (code && sync.isActive()) {
    el.innerHTML = `
      <p>✅ Sharing is <strong>on</strong>. This phone is part of household:</p>
      <p class="household-code">${code}</p>
      <p class="muted">Anyone who opens the app and joins with this code shares
      the same library. Share it only with people you trust — it's the only key.</p>
      ${syncError ? `<p class="sync-error">⚠️ ${syncError}</p>` : ""}
      <div class="detail-actions">
        <button id="copy-code-btn" class="secondary-btn">Copy code</button>
        <button id="leave-btn" class="danger-btn">Leave shared library</button>
      </div>`;
    $("#copy-code-btn").addEventListener("click", () =>
      navigator.clipboard?.writeText(code)
    );
    $("#leave-btn").addEventListener("click", () => {
      if (confirm("Leave the shared library on this phone? Your books stay on this phone and in the cloud for other members.")) {
        sync.leave();
        syncError = null;
        updateSyncIndicator();
        renderSyncModal();
      }
    });
    return;
  }

  el.innerHTML = `
    <p>Create a shared library and give the code to your partner, or enter a
    code someone shared with you. Books already on this phone are merged in —
    nothing is lost.</p>
    ${syncError ? `<p class="sync-error">⚠️ ${syncError}</p>` : ""}
    <div class="detail-actions">
      <button id="create-household-btn" class="primary-btn">Create shared library</button>
    </div>
    <form id="join-form" class="inline-form" style="margin-top:0.8rem">
      <input type="text" id="join-code-input" placeholder="Enter a household code"
             autocomplete="off" autocapitalize="none" />
      <button type="submit" class="primary-btn">Join</button>
    </form>`;

  const activate = async (code) => {
    syncError = null;
    try {
      await sync.join(code, db.getAllBooks(), onRemoteBooks, onSyncError);
    } catch (err) {
      syncError = err.message;
    }
    updateSyncIndicator();
    renderSyncModal();
  };
  $("#create-household-btn").addEventListener("click", () => activate(sync.generateCode()));
  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#join-code-input").value;
    if (code.trim()) activate(code);
  });
}

async function initSync() {
  if (sync.isConfigured() && sync.currentHousehold()) {
    try {
      await sync.start(onRemoteBooks, onSyncError);
    } catch (err) {
      syncError = err.message;
    }
    updateSyncIndicator();
  }
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
applyTheme(currentTheme());
updateViewToggle();
updateProfileChip();
renderShelf();
initSync();
backfillSubjects();
if (!currentProfile()) {
  renderProfileModal();
  profileModal.showModal();
}
