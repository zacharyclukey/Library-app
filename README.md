# 📚 Shelfie — photo-powered personal book library

A zero-build web app for tracking the books you **own**, want **to read**, and have
**completed** — by taking a picture of the book.

## Features

- **Add books by photo** 📷
  - **Live camera scan** — point your phone at the barcode on the back cover.
  - **Take/upload a picture** — snap a photo *or* pick one from your camera
    roll, and select several at once if a big shelf took a few shots. A shot
    with *several* books' barcodes visible really does add them all: the reader
    scans the whole picture rather than stopping at the first barcode it finds,
    and everything it found comes up as one list you tick through and send to a
    shelf in a single tap (undoable as one).
  - Manual fallback: type an ISBN or search by title/author. A mistyped ISBN is
    caught by its own check digit — you get "that isn't a valid ISBN" rather than
    a puzzling "no book found" that reads as though the book doesn't exist.
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
- **Friends** 🤝 — follow people by swapping reader codes (Settings → Friends).
  Following is one-way; when someone follows you back the app calls it a
  friendship. Their reading lands in a feed — what they finished, rated and
  wrote — and Discover leans on them hardest: a book a friend loved outranks
  one strangers rate highly, and the card says *"Kelsey read this"* rather
  than *"readers like you"*. Friends count roughly twice a one-way follow.
  Off by default; turning it on publishes your name, who you follow, and the
  books you've finished, rated or reviewed — nothing else from your shelves,
  and only to people you gave your code to. No accounts: the code *is* the
  credential, the same trust model as the shared-library password (see
  `js/social.js`).
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
- **Sorting & filters** ⚙️ — the **Sort** button opens with the sort orders
  first: date added, title, author, publish year, length, your rating, or
  **📚 Series, grouped**, which stacks the shelf under series headings with
  standalones last (remembered per device). Series names are matched loosely,
  so "L.O.R.D.S.", "LORDS" and "The L.O.R.D.S. Series" form one heading rather
  than three, and the heading shows the fullest spelling. Below that, filter
  any shelf by
  genre (derived from Open Library subject tags), length (a dual-thumb
  page-count slider), series vs standalone, publication age, format, and
  rating status.
- **What next?** 📖 — finish a book and the app asks how it was, then offers
  the next one: **one pick, cover-forward, with the reason in plain English**
  (*"More of Court — you gave Court of Thorns five stars"*, *"Kelsey rated it
  ★★★★★"*), two deliberately different alternates, and mood dials that re-rank
  instantly. **Start reading**, **Wishlist**, or **Not tonight** — and all three
  teach it. Two of the five candidate sources need no network, so there is
  always an answer, offline, even on a shelf of three books. Offered once per
  finish, never a badge, and never when you're merely cataloguing a book you
  read years ago.
- **Discover** ✨ — the same engine as a browsing screen. Recommendations come
  from **five sources**, not one: your own To Read and Wishlist, the next book
  in a series you rated well, what friends finished and rated, readers whose
  shelves resemble yours, and Open Library searches built from your taste.
  Scoring is **style first** — subject overlap, author affinity, corroboration —
  with reader ratings as a confidence-weighted tiebreaker, so a 4.6 from nine
  readers won't outrank a real match. Every card says why it's there, and the
  reason is checked against the book rather than asserted from the query that
  found it.
- **It learns, and it's private about it** 🧠 — your taste profile is **signed**
  (a book you rated one star pushes its author *down*; that author stops being
  recommended entirely), **decayed** (a six-month half-life, so this year's
  reading outweighs a phase you grew out of), and **per profile**. "Not for me"
  suppresses a book for 90 days. What you were shown and what you did about it
  is recorded on the device — capped, never synced, never published, never shown
  to you as a chore — and is what lets the ranking improve with use rather than
  just with library size. See [`docs/RECOMMENDATIONS.md`](docs/RECOMMENDATIONS.md).
- **Series awareness** — each owned book is checked against Open Library and Google
  Books series data. Cards show a `📚 N more in series` badge when the series has
  books you don't own, and the detail view lists every book in the series marked
  ✅ owned / ◻️ not owned.
- **Say it yourself when the databases don't know** ✍️ — the free catalogues have
  thin data on indie and self-published books, and no amount of guessing fixes a
  series nobody indexed. When a scan or a search turns up nothing, **add it
  yourself**: type the title (and author, year, pages if you like) and it goes on
  the shelf like any other book, keeping the ISBN you scanned so the same barcode
  finds *your* record later instead of making a second copy. Every book's detail
  view also has a **Set the series yourself** field (with a picker of series already in your library, so the rest
  of the set is one tap each). What you set beats detection, never gets
  overwritten, syncs to the household, and groups the shelf straight away.
  "Not in a series" sticks too, instead of being re-guessed every launch.
- **Move a pile at once** ☑️ — the tick button in the toolbar turns the shelf
  into a picker: tap books to select (nothing opens or flips), then send the
  lot to Owned / To Read / Finished / Wishlist from the bar along the bottom.
  **Select all** takes whatever the current search and filters are showing, so
  "everything by this author" or "everything under 300 pages" is two taps. The
  whole batch undoes as one.
- **Two ways to browse** — a cover-forward shelf grid where each row of books sits
  on a wooden ledge (with spine-styled fallback covers for books with no jacket
  art), or a detailed list, plus a bottom navigation bar.
- **Tap for the book page, flip for quick actions** 🔄 — tapping a card opens its
  full detail sheet; the **⋯** button (or a long press) flips the cover over to
  a quick panel with the common facts, a rating, currently-reading, and shelf
  moves. Every action is **labelled in words**, and a shelf move takes two
  taps — the first arms the button ("Sure?"), which disarms on its own after a
  few seconds — so a book never moves by accident. Every action then shows a
  toast with **Undo**, so nothing needs a confirmation popup.
- **Themed icon set** — icons are inline SVG drawn in `currentColor`, and each
  aesthetic sets its own hand via `--icon-stroke` / `--icon-cap`: Reading Room
  soft and heavier, Cottage rounded, Dark Academia finely engraved, Modern thin
  and crisp (see `js/icons.js`).
- **Quiet motion** — covers fade in over their coloured fallback, cards rise in
  as each chunk loads, and the shelf you just added to gives its count a small
  pop. All of it respects `prefers-reduced-motion`.
- **Built for big shelves** 📚 — cards render in chunks as you scroll (a
  300-book shelf paints as fast as a small one), an A–Z rail jumps you through
  the list when sorted by title or author, and search is debounced.
- **Group by series (optional)** 🗂️ — **off by default**; a toggle in the filter
  panel collects each shelf into its series (ordered by book number, with
  standalones last), so a big library can read as collections rather than a wall
  of covers. Tap it again — or Clear all filters — to go back to a flat shelf.
  Your choice is remembered per device.
- **Your reading** 📊 — tap the greeting (or Settings) for totals, books and
  pages finished this year with a per-month bar row, most-read authors, and the
  genres on your shelves. All derived from data already on the shelves.
  *This year* counts reading, not cataloguing: a book lands in it when the app
  watched you finish it — waiting on To Read, or flagged as currently reading,
  then moved to Finished. Logging books you read years ago leaves the year's
  count alone. It works silently; the only visible part is a **Read in**
  month/year on any finished book, for putting an older read into the right
  month yourself (or leaving it out).
- **Honest connection status** — when you're offline or sync is paused, a quiet
  pill says so and reassures you that changes are saved on the phone. A failed
  book search says the lookup failed rather than "no matches found", Discover
  distinguishes an Open Library outage from an empty result, and if the phone's
  storage is full the app says the change wasn't saved instead of pretending it
  was.
- **No accidental duplicates** 👯 — scan a book you already own and it says so
  rather than adding a twin, with a one-tap **Open it** to jump to the book (on
  a big shelf, scanning is the fastest way to *find* something). If that copy
  was added by title search, the barcode fills in the missing edition details.
  Scan one sitting on To Read or Wishlist and the sheet opens so a single tap
  moves it to Owned, keeping its ratings and reviews. Only a genuinely
  different edition — both copies naming a different ISBN — becomes a second
  entry, and it tells you before it does.
- **Hard to break** 🛟 — every record is normalised on the way out of
  `js/db.js`, so a malformed book (a bad import, an old app version, another
  member's phone) is repaired rather than throwing mid-render and leaving a
  shelf looking empty. Search results from Open Library get the same treatment,
  and all text is escaped for attribute contexts as well as body text.
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
| Barcode reading | The platform's `BarcodeDetector` where it exists (Chrome/Edge/Android), **plus** our own EAN-13 reader in `js/ean13.js`, always. The built-in one sweeps the picture line by line and returns *every* barcode it crosses, which is what makes one photo of eight books add eight books. No library, no CDN, works offline |
| Book metadata | Open Library ISBN API (edition-specific), gaps filled from Google Books |
| Series detection | Your own manual tag (wins outright) → edition series tags → other editions of the same work → Google Books title/subtitle patterns ("(L.O.R.D.S. Book 1)", "(Book 2 of …)", "(… , #3)"); series roster from Open Library search |
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

## Understanding it

Written so you don't have to read the code to know how it works — and so
someone else can pick it up without a handover:

- **[docs/WALKTHROUGH.md](docs/WALKTHROUGH.md)** — a tour for anyone, no code
  required. What every screen does, where the books live, what each file is.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how it's put together, for
  a programmer seeing it cold.
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — *why* it's built this way, with
  the costs of each choice stated plainly.
- **[docs/SECURITY.md](docs/SECURITY.md)** — what's protected, what isn't, and
  what would have to change before strangers use it.
- **[docs/DATA.md](docs/DATA.md)** — every field, key and collection.
- **[docs/PRODUCT.md](docs/PRODUCT.md)** — what this does that other book apps
  don't, where it's behind, and what it should never become.
- **[docs/MOBILE.md](docs/MOBILE.md)** — the road to the App Store: what it
  costs, what the port involves, and what keeps it cheap.
- **[tests/README.md](tests/README.md)** — ~30 automated suites and what each
  one covers.

Changing the app? Start with **[CLAUDE.md](CLAUDE.md)** — the rules that don't
bend, the bar every change is held to, and what to run before you push.

## Making it yours

Personal touches live in three places, all safe from app updates:

- **`assets/`** — drop in `logo.png`, `header.png`, `shelf.png`, `paper.png`
  or `empty.png` and they appear. No code, and any you skip keep the stock
  look. See [`assets/README.md`](assets/README.md).
- **`assets/icons/`** — every icon in the app is a named, swappable slot. Save
  your drawing as `assets/icons/<name>.svg` and it replaces the built-in;
  delete the file and the built-in comes back.
- **`css/custom.css`** — your own file, loaded last so it always wins. It
  holds the **"Yours"** aesthetic (a fifth option in Settings, shipped as a
  soft neutral palette), plus commented-out switches for corner roundness,
  a custom font, and texture.

Step-by-step, written for someone who doesn't write code:
**[DESIGN.md](DESIGN.md)**. Every replaceable file, by name and size:
**[docs/ASSETS.md](docs/ASSETS.md)**.

## Project layout

```
docs/             how it works, why, and what's safe
tests/            ~30 browser suites  ·  npm test
index.html        app shell (shelf tabs, bottom nav, modals)
css/styles.css    design tokens, light/dark themes, layouts
css/custom.css    YOURS — personal palette, fonts, tweaks
assets/           YOURS — optional logo/texture/artwork drop-ins
js/app.js         UI logic and state
js/db.js          localStorage persistence (+ repairs malformed records)
js/api.js         Open Library / Google Books lookups + series detection
js/filters.js     genre mapping, filter predicates, sort orders
js/themes.js      aesthetic registry + light/dark resolution
js/export.js      printable page / text / CSV / JSON exports
js/sync.js        optional shared-household sync (Firebase)
js/social.js      following, friends, and the reading feed
js/scanner.js     camera + photo barcode scanning
js/ean13.js       the EAN-13/UPC-A reader itself (no dependencies)
```
