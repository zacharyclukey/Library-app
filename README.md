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
- **Your data stays yours** — everything is stored in your browser's localStorage,
  with JSON export/import for backup or moving devices.
- **Optional shared library** 👩‍❤️‍👨 — link two or more phones into one live
  "household" collection (scan on one phone, it appears on the other; series
  tracking counts everyone's books). Runs on Firebase's free tier with a
  one-time setup — see [SETUP-SYNC.md](SETUP-SYNC.md).

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

## Project layout

```
index.html        app shell (shelves, add/confirm/detail modals)
css/styles.css    styling
js/app.js         UI logic and state
js/db.js          localStorage persistence
js/api.js         Open Library / Google Books lookups + series detection
js/scanner.js     camera + photo barcode scanning
```
