# 📚 Shelfie — photo-powered personal book library

A zero-build web app for tracking the books you **own**, want **to read**, and have
**completed** — by taking a picture of the book.

## Features

- **Add books by photo** 📷
  - **Live camera scan** — point your phone at the barcode on the back cover.
  - **Take/upload a picture** — snap a photo (a shot with *several* books' barcodes
    visible adds them all at once).
  - Manual fallback: type an ISBN or search by title/author.
- **Edition-accurate records** — the scanned ISBN identifies the *specific version*
  you own: publisher, publish date, physical format (hardcover/paperback), page
  count, ISBN-10/13, Open Library edition key, and that edition's cover art.
- **Four shelves** — Owned, To Read, Completed, and Wishlist. TBR/Completed books
  can also be flagged as owned copies so series tracking sees them.
- **Wishlist + "find this book" links** 🎁 — missing series books can be
  wishlisted straight from the series view, and every book links out to
  Amazon (direct product page via its ISBN when possible), Barnes & Noble,
  Bookshop.org, ThriftBooks, AbeBooks (used), WorldCat (your local library),
  and Goodreads (reviews).
- **Star ratings** ⭐ — rate any book 1–5 from its detail view; ratings show on
  cards and sync to the household.
- **Profiles** 👤 — each phone picks a profile; To Read, Completed, and Wishlist
  are kept per person (with Mine / partner / Everyone filters) while the Owned
  shelf stays shared. Books can be reassigned from their detail view, and each
  person's star ratings are tracked separately.
- **Shelf search** 🔎 — filter the current shelf by title or author as you type.
- **Filters & sorting** ⚙️ — filter any shelf by genre (derived from Open Library
  subject tags), length, series vs standalone, publication age, format, and
  rating status; sort by date added, title, author, publish year, length, or
  your rating.
- **Discover** ✨ — free recommendations built from your shelves: favorite
  authors and recurring genres are mined from your library, then matched against
  well-rated Open Library books you don't own, with one-tap wishlisting.
  Discover takes genre/length/age filters too — when set, your shelf books
  matching the filter drive the taste profile (with the rest of the library as
  context) and results are constrained to match.
- **Series awareness** — each owned book is checked against Open Library and Google
  Books series data. Cards show a `📚 N more in series` badge when the series has
  books you don't own, and the detail view lists every book in the series marked
  ✅ owned / ◻️ not owned.
- **Two ways to browse** — a cover-forward shelf grid where each row of books sits
  on a wooden ledge (with spine-styled fallback covers for books with no jacket
  art), or a detailed list, plus a bottom navigation bar.
- **Aesthetics** 🕯️ — pick the mood in Settings: **Reading Room** (walnut,
  parchment, brass lamplight — the default), **Cottage Garden**, **Dark
  Academia**, or **Modern**, each with light/dark/auto brightness. Themes carry
  through to printable exports. See [Adding an aesthetic](#adding-an-aesthetic).
- **Exports per shelf** 📤 — export any shelf (or everything, optionally limited to
  what your filters are showing) as a printable/shareable page with covers and
  stats, a plain-text list for messaging, a CSV for spreadsheets, or a full JSON
  backup.
- **Your data stays yours** — everything is stored in your browser's localStorage,
  with JSON export/import for backup or moving devices.
- **Optional shared library** 👩‍❤️‍👨 — link two or more phones into one live
  collection with a **library name + password** (scan on one phone, it appears
  on the other; series tracking counts everyone's books), with a member list
  showing who's connected and when they were last active. The password never
  leaves your devices — it's used on-phone to derive the library's storage
  location (PBKDF2), creating a library that already exists is refused rather
  than silently merged, and new devices must be **approved by an existing
  member** before any books flow in either direction. Runs on Firebase's free
  tier with a one-time setup — see [SETUP-SYNC.md](SETUP-SYNC.md).

## Running it

No build step, no dependencies to install — it's plain HTML/CSS/JS. Serve the folder
over HTTP (the camera requires a secure context, i.e. **HTTPS or localhost**):

```bash
# any static server works, e.g.:
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>. On a phone, host it over HTTPS (e.g. GitHub
Pages, Netlify, or `npx serve` behind a tunnel) so the camera is allowed.

## How it works

| Piece | Approach |
| --- | --- |
| Barcode reading | Native `BarcodeDetector` API (Chrome/Edge/Android); automatic fallback to the ZXing library (loaded on demand) on Safari/Firefox |
| Book metadata | Open Library ISBN API (edition-specific), gaps filled from Google Books |
| Series detection | Edition series tags → other editions of the same work → Google Books title heuristics; series roster from Open Library search |
| Storage | `localStorage`, JSON export/import |

Both APIs are free and keyless; series data is best-effort (coverage is strong for
popular series, spottier for obscure ones).

## Adding an aesthetic

Themes are data, not special cases — adding one takes two CSS blocks and one
registry entry, and it shows up in Settings automatically.

1. In `css/styles.css`, copy an existing palette and give it your own colours:

   ```css
   :root[data-skin="my-theme"]                    { /* light palette */ }
   :root[data-skin="my-theme"][data-mode="dark"]  { /* dark palette  */ }
   ```

   Every surface reads from those tokens (`--bg`, `--card`, `--ink`, `--accent`,
   `--shelf-grad`, `--page-glow`, `--page-texture`, …), so nothing else needs to
   change. A theme can also swap its display font by setting `--serif`, and opt
   out of the wood-grain header with `--header-grain: none`.

2. In `js/themes.js`, add an entry to `THEMES` with an `id` matching the CSS, a
   `name`, a one-line `blurb`, and three `swatch` colours for its preview chip.

`js/themes.js` resolves *auto* to light or dark in JavaScript and sets
`data-mode` on `<html>`, so no palette needs a media query, and an inline script
in `index.html` applies the saved choice before first paint (no flash).

## Project layout

```
index.html        app shell (shelf tabs, bottom nav, modals)
css/styles.css    design tokens, light/dark themes, layouts
js/app.js         UI logic and state
js/db.js          localStorage persistence
js/api.js         Open Library / Google Books lookups + series detection
js/filters.js     genre mapping, filter predicates, sort orders
js/themes.js      aesthetic registry + light/dark resolution
js/export.js      printable page / text / CSV / JSON exports
js/sync.js        optional shared-household sync (Firebase)
js/scanner.js     camera + photo barcode scanning
```
