import * as db from "./db.js";
import * as api from "./api.js";
import * as sync from "./sync.js";
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
let pendingBooks = []; // queue of looked-up books waiting for shelf choice
const seriesCache = new Map(); // book.id -> { series, books } | null

const SHELF_LABEL = { owned: "Owned", tbr: "To Be Read", completed: "Completed", wishlist: "Wishlist" };
const SHELVES = ["owned", "tbr", "completed", "wishlist"];

function starString(rating) {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
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
  const books = db.getBooksOnShelf(currentShelf);
  for (const shelf of SHELVES) {
    $(`#count-${shelf}`).textContent = db.getBooksOnShelf(shelf).length;
  }
  emptyState.classList.toggle("hidden", books.length > 0);
  bookList.innerHTML = books
    .map((b) => {
      const cached = seriesCache.get(b.id);
      const missing = cached?.missingCount ?? 0;
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
        <img class="cover" src="${esc(b.coverUrl ?? "")}" alt=""
             onerror="this.classList.add('no-cover')" loading="lazy" />
        <div class="book-info">
          <h3>${esc(b.title)}</h3>
          <p class="authors">${esc((b.authors ?? []).join(", "))}</p>
          <p class="edition">
            ${esc([b.format, b.publisher, b.publishDate].filter(Boolean).join(" · "))}
          </p>
          <p class="isbn">${b.isbn13 ? "ISBN " + esc(b.isbn13) : ""}</p>
          ${b.rating ? `<p class="card-rating" aria-label="Rated ${b.rating} of 5">${starString(b.rating)}</p>` : ""}
          <div class="badges">${seriesBadge}${moreBadge}</div>
        </div>
      </article>`;
    })
    .join("");

  // Kick off background series checks for owned books we haven't checked yet.
  books.forEach((b) => {
    if (!seriesCache.has(b.id)) checkSeriesInBackground(b);
  });
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
    <img class="cover" src="${esc(book.coverUrl ?? "")}" alt=""
         onerror="this.classList.add('no-cover')" />
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
    db.addBook({ ...book, shelf, owned });
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
  const card = e.target.closest(".book-card");
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
      <img class="cover" src="${esc(b.coverUrl ?? "")}" alt=""
           onerror="this.classList.add('no-cover')" />
      <div>
        <h3>${esc(b.title)}</h3>
        ${b.subtitle ? `<p class="subtitle">${esc(b.subtitle)}</p>` : ""}
        <table class="detail-table">
          ${rows.map(([k, v]) => `<tr><th>${k}</th><td>${esc(String(v))}</td></tr>`).join("")}
        </table>
      </div>
    </div>
    <div class="rate-row">
      <span class="rate-label">Your rating:</span>
      <span class="rate-stars">
        ${[1, 2, 3, 4, 5]
          .map((n) => `<button class="star-btn ${b.rating >= n ? "filled" : ""}" data-rate="${n}"
                        aria-label="Rate ${n} of 5">${b.rating >= n ? "★" : "☆"}</button>`)
          .join("")}
      </span>
      ${b.rating ? `<button class="link-btn" data-clear-rating>clear</button>` : ""}
    </div>
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
  $("#detail-content").querySelectorAll("[data-rate]").forEach((btn) =>
    btn.addEventListener("click", () => {
      db.updateBook(id, { rating: Number(btn.dataset.rate) });
      renderShelf();
      openDetail(id); // re-render the modal with the new rating
    })
  );
  $("#detail-content").querySelector("[data-clear-rating]")?.addEventListener("click", () => {
    db.updateBook(id, { rating: null });
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
      });
      renderSeriesSection(book); // re-render to show the 🎁 flag
      renderShelf();
    })
  );

  renderShelf(); // refresh badges with the new missing count
}

// ---------- export / import ----------

$("#export-btn").addEventListener("click", () => {
  const blob = new Blob([db.exportJson()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "shelfie-library.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#import-btn").addEventListener("click", () => $("#import-input").click());
$("#import-input").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    db.importJson(await file.text());
    seriesCache.clear();
    renderShelf();
  } catch (err) {
    alert("Import failed: " + err.message);
  }
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

$("#sync-btn").addEventListener("click", () => {
  renderSyncModal();
  syncModal.showModal();
});

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

// ---------- init ----------
renderShelf();
initSync();
