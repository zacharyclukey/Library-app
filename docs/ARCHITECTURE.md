# Architecture

For a programmer picking this up cold. The non-technical version is
[WALKTHROUGH.md](WALKTHROUGH.md); the reasoning behind the choices is
[DECISIONS.md](DECISIONS.md).

## Shape

A static PWA. No build step, no bundler, no framework, no runtime
dependencies. Plain HTML, CSS, and ES modules served straight from GitHub
Pages. `npm` appears only so the test suite can install a headless browser —
the app itself never touches `node_modules`.

```
~14,000 lines total, none of it compiled (plus ~6,000 more of tests)
  js/app.js         4,960   UI, state, event handling, screen routing
  css/styles.css    2,802   tokens, five skins × light/dark, layout
  js/sync.js          818   Firebase household sync, membership, join approval
  js/api.js           530   Open Library / Google Books, series detection
  js/candidates.js    414   where a recommendation can come from (five sources)
  index.html          410   every screen and dialog, statically declared
  js/rank.js          364   feature vector, weights, diversity, explanations
  css/identity.css    363   the motifs that survive every skin
  js/ean13.js         354   EAN-13/UPC-A decoding, no dependencies
  js/db.js            342   localStorage store + schema repair
  js/taste.js         327   one reader's signed, decayed taste profile
  js/signals.js       290   what the reader did — the feedback loop
  js/social.js        281   following, friends, activity feed
  js/filters.js       247   genre map, filter predicates, sort orders
  js/community.js     243   shared ratings/tags/reviews, co-read scoring
  js/export.js        218   printable HTML, text, CSV, JSON
  js/icons.js         218   inline SVG icon set
  js/scanner.js       203   BarcodeDetector + our own reader, merged
  js/assets.js        139   optional artwork discovery
  js/themes.js        112   skin registry, light/dark resolution
```

`js/app.js` is large and knowingly so — see DECISIONS.

## Data flow

```
      ┌─────────────┐
      │  index.html │  static skeleton: screens, dialogs, nav
      └──────┬──────┘
             │
      ┌──────▼──────┐   renders into it, owns all state
      │   app.js    │
      └──┬───┬───┬──┘
         │   │   │
   ┌─────▼┐ ┌▼───────┐ ┌▼─────────┐
   │db.js │ │api.js  │ │sync.js   │
   │local │ │Open    │ │Firebase  │──┬─ community.js
   │store │ │Library │ │household │  └─ social.js
   └──────┘ └────────┘ └──────────┘
```

The recommender hangs off the same three, as a pipeline rather than a tree:

```
   signals.js ──► taste.js ──► candidates.js ──► rank.js ──► app.js
   what you        who you       five sources      score,      Discover,
   did about it    are           of books          spread,     and the
        ▲                                          explain     sunset sheet
        └──────────────── every outcome feeds back ─────────────────┘
```

Each stage is a plain module with no state beyond one localStorage key, so any
of them can be exercised in isolation — which is what `tests/rectest.mjs` does
for the ranking arithmetic. The loop back from `app.js` to `signals.js` is the
part that makes the feature improve with use; see
[RECOMMENDATIONS.md](RECOMMENDATIONS.md).

Rules that hold throughout:

- **`db.js` is the only thing that touches `localStorage` for books.** Every
  read passes through a repair pass (below), so the rest of the app can trust
  the schema absolutely.
- **`sync.js` owns the Firebase handle.** `community.js` and `social.js` get it
  via `sync.firestore()`, so the SDK loads once, on demand, and never at all if
  sync is off.
- **`app.js` owns all UI state.** No module renders anything except `app.js`.
- **Everything network-dependent degrades.** Every remote call is wrapped; a
  failure logs and returns empty rather than throwing. The app is fully usable
  with no network and no Firebase project.

## The store (`db.js`)

One localStorage key, `shelfie.library.v1`, holding an array of book records.
The schema is documented at the top of the file.

The important part is `repair()`, which runs on **every read and every write**.
Records arrive from four directions — our own writers, a JSON import, another
household member's phone, and whatever shape Open Library returned the day a
book was added — and one malformed record used to throw mid-render and blank
the entire shelf. Now every record is normalised on the way out: wrong types
coerced, unknown shelves defaulted, duplicate ids collapsed, ratings clamped.
Clean records take a fast path and are returned untouched, so the cost is
~0.05 ms on a 500-book library.

`save()` catches quota errors and dispatches `shelfie:storage-full` rather than
failing silently — `app.js` listens and tells the user.

## Sync (`sync.js`)

A household id is derived on-device: PBKDF2, 150k iterations, SHA-256, library
name as salt, password as input. So the id is unguessable but reproducible from
name + password, and no password is ever transmitted.

Documents live at `households/{id}/books/{bookId}`. Reserved doc ids prefixed
`_` carry non-book state — `_meta`, `_member:{deviceId}`, `_join:{deviceId}` —
so membership and join requests arrive on the same snapshot as the books with
no extra reads, and the security rules stay a single match block.

Anonymous Firebase Auth signs each device in silently; the uid is stamped onto
every community and social document so the rules can verify ownership. See
[SECURITY.md](SECURITY.md).

## Book metadata (`api.js`)

Open Library first (edition-accurate, `language:` constrained so translations
stop leaking in), Google Books as fallback and for series hints. Both free,
neither needs a key.

Series detection, in order: a manual tag the user set (wins outright) → series
tags on the edition → other editions of the same work → title/subtitle patterns
from Google Books. That last one is deliberately strict — it demands a book
number — because a wrong series files a book under a heading that doesn't
exist, which is worse than no series at all.

Third-party rows are filtered and coerced on arrival for the same reason `db.js`
repairs records: one null in `docs` used to take out an entire result set.

## Rendering (`app.js`)

Template literals into `innerHTML`, with `esc()` on every interpolation —
including quotes, because output lands in attributes as often as in text.

Large shelves render in chunks of 60 with an IntersectionObserver sentinel; a
300-book shelf paints in ~300 ms. Sync snapshots are hashed before re-rendering
so an identical snapshot doesn't snap a flipped card shut mid-interaction.

Screens are static sections in `index.html` toggled by `showScreen()`, with
`history.pushState` so the phone's back button walks the stack. Dialogs use
native `<dialog>` — which means they render in the browser's top layer, which
is why the toast region is moved *into* the open dialog when one is up.

## Theming

CSS custom properties, `[data-skin]` × `[data-mode]`. Adding an aesthetic is
two CSS blocks plus one registry entry in `themes.js`; no other code changes.
Mode is resolved in JS rather than by media query, so each skin needs only one
dark block, and an inline script in `index.html` applies the saved choice
before first paint.

Three stylesheets, and the order is the design system:

```
css/styles.css     structure, and the five aesthetics
css/custom.css     the user's own file — the fifth skin ("Yours") lives here
css/identity.css   what stays constant across every aesthetic
```

Later sheets win at equal specificity, so `custom.css` beats the built-in
skins and `identity.css` survives both. What it holds is deliberately small —
the mark, the 2:3 cover and its binding, the fore-edge, the shelf ledge, the
checkout card, and the rule that ratings are struck in brass. Everything in
it is still written in theme variables, so it follows the palette; what's
fixed is the motif, not the colour.

Token *values* that the user is invited to change stay in `styles.css` even
when the rule consuming them is in `identity.css` — `--card-stock` and
friends, for instance. Otherwise `identity.css` would load after `custom.css`
and clobber the override. The split is: values are vibe, motifs are identity.

Full reasoning and the complete asset map: [IDENTITY.md](IDENTITY.md).

## Offline

`sw.js` caches the app shell with stale-while-revalidate: the cached copy
serves immediately and refreshes in the background, so a deploy lands on the
next launch without version juggling. Covers are cached best-effort. API calls
always go to the network. Bump `SHELL_CACHE` when you want to force eviction of
stale caches.

## Tests

`tests/` holds ~30 Playwright suites driving the real app in headless Chromium
with Open Library, Google Books, and Firestore mocked at the network layer.
Multi-device suites run two browser contexts against a shared in-process
`Map` standing in for Firestore.

```
npm install && npm test
```

Each suite prints numbered observations and ends with its own health line; the
runner treats a non-empty error list as failure and dumps the full output.

One trap, since it has bitten repeatedly: **in Playwright the last matching
route wins**, so catch-all mocks must be registered *before* specific ones.

## Known soft spots

- `app.js` at 4,960 lines is the obvious refactor target.
- Barcode reading is now entirely on-device (`js/ean13.js`); there is no
  runtime CDN dependency left. The reader is deliberately narrow — EAN-13 and
  UPC-A only — so it would need extending before it could read anything that
  isn't a book barcode.
- No accessibility audit has been done: focus management in dialogs and
  screen-reader labelling are unverified.
- Community summaries are last-writer-wins, recomputed client-side.
- Anonymous auth means a cleared browser loses the uid, and with it write
  access to that device's own community and social documents.
