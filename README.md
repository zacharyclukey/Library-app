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
- **Four shelves** — Owned, To Read, Finished, and Wishlist. Owning a book is a
  property of the book, not a location: a book you own that's also on To Read or
  Finished appears on **both** shelves (marked with a small "also on" hint), so
  the Owned shelf is always your full collection.
- **Currently reading** 📖 — flag what you're reading now from a book's detail
  view; it's badged on the card, floats to the top of To Read, has its own
  filter chip, and clears automatically when you move the book to Finished.
- **Spice & content ratings (opt-in)** 🌶️ — enable **Settings → Spice & content
  ratings** to tag books Kids / Teen / Mature / Explicit and rate spice on a
  1–5 🌶️ scale, with matching filters (including an SFW filter that hides
  anything marked mature or explicit). Tags sync to the household and export to
  CSV. Books are auto-suggested a tag when the data supports it (Google Books'
  maturity flag, "Erotic fiction"/"Juvenile fiction"-style subject tags), but no
  free source rates spice levels — so it's your call, one tap in the detail
  view. Off by default and invisible until enabled.
- **Print, Kindle, and Audible aware (opt-in)** 📱🎧 — "read but not owned" is
  always available via the *I own this copy* checkbox. For people who also want
  to track *where* they own things, enable **Settings → Track copy types** to
  label books Print / E-book / Audiobook: a picker appears when adding, copy
  types show on cards, are editable from the detail view, and filter like any
  format. Off by default and invisible until enabled; CSV exports always carry
  the column. (Amazon offers no free API for Kindle or Audible libraries, so
  these are logged in-app rather than auto-imported.)
- **Wishlist + "find this book" links** 🎁 — missing series books can be
  wishlisted straight from the series view, and every book links out to
  Amazon (direct product page via its ISBN when possible), Barnes & Noble,
  Bookshop.org, ThriftBooks, AbeBooks (used), WorldCat (your local library),
  and Goodreads (reviews).
- **Star ratings & reviews** ⭐ — rate any book 1–5 and write a review from its
  detail view; both are per-person, show to your household, and sync.
- **Community layer (opt-in, structural)** 🌍 — the seed of user-powered
  recommendations: with **Settings → Community sharing** on, your ratings,
  spice/content tags, and reviews (attributed by first name) publish to a
  shared `community/{bookKey}` collection keyed by stable book identity
  (Open Library work → ISBN → title slug). Discover blends these signals over
  the free-database baseline — "Shelfie readers rate it ★ 4.8" outranks a raw
  Open Library score — and book details show the community's take. Free
  databases remain the foundation; the community layer enriches wherever its
  data exists, and a future multi-user release swaps in Firebase Auth without
  touching the UI (see `js/community.js`).
- **Profiles** 👤 — each phone picks a profile; To Read, Completed, and Wishlist
  are kept per person (with Mine / partner / Everyone filters) while the Owned
  shelf stays shared. Books can be reassigned from their detail view, and each
  person's star ratings are tracked separately.
- **Shelf search** 🔎 — filter the current shelf by title or author as you type.
- **Language-aware** 🌐 — title/author search asks Open Library for the best
  edition in your chosen language (default English, switchable per search, so
  Spanish translations stop sneaking in), each book records its edition's
  language, and a Language filter appears on shelves whenever the library
  spans more than one.
- **Filters & sorting** ⚙️ — filter any shelf by genre (derived from Open Library
  subject tags), length (a dual-thumb page-count slider), series vs standalone,
  publication age, format, and rating status; sort by date added, title, author,
  publish year, length, or your rating.
- **Discover** ✨ — free recommendations built from your shelves: favorite
  authors and recurring genres are mined from your library, then matched against
  well-rated Open Library books you don't own, with one-tap wishlisting.
  Discover takes the same genre, page-range, and age filters — when set, your
  shelf books matching them drive the taste profile (with the rest of the
  library as context) and results are constrained to match.
- **Series awareness** — each owned book is checked against Open Library and Google
  Books series data. Cards show a `📚 N more in series` badge when the series has
  books you don't own, and the detail view lists every book in the series marked
  ✅ owned / ◻️ not owned.
- **Two ways to browse** — a cover-forward shelf grid where each row of books sits
  on a wooden ledge (with spine-styled fallback covers for books with no jacket
  art), or a detailed list, plus a bottom navigation bar.
- **Tap a cover to flip it** 🔄 — the back of each card is your own take: rate it,
  mark it as currently reading, move shelves, or open the full book sheet. Every
  action shows a toast with **Undo**, so nothing needs a confirmation popup.
- **Built for big shelves** 📚 — cards render in chunks as you scroll (a
  300-book shelf paints as fast as a small one), an A–Z rail jumps you through
  the list when sorted by title or author, and search is debounced.
- **Never homework** 🌿 — there is deliberately no "N books need rating" counter.
  At most one finished-but-unrated book is offered at a time, rateable in a
  single tap and easy to wave off (which stays quiet for days).
- **Works offline** ✈️ — a service worker caches the app shell and covers, so it
  opens instantly with no connection; series lookups are cached for a week
  instead of re-fetched every session. Add it to your home screen and long-press
  the icon for a "Scan a book" shortcut.
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
