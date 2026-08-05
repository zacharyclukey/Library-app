# Tests

Each suite opens the real app in a headless browser, taps through it the way a
person would, and prints numbered observations. They exist so a change can be
made without wondering what it broke two screens away.

## Running them

Needs [Node.js](https://nodejs.org). From the project folder:

```
npm install          # once — fetches a headless browser
npm test             # everything (~10 minutes)
npm test regress     # just suites whose name contains "regress"
npm test bugs        # the hardening suites
```

The runner serves the app locally, runs each suite, and prints `ok` or `FAIL`.
A failure dumps that suite's full output so you can read what it saw.

`smoke.mjs` talks to the real Open Library rather than a mock, so it's skipped
unless you pass `--network`. Everything else runs offline.

## What each one covers

**Core behaviour**

| Suite | Covers |
|---|---|
| `smoke.mjs` | ISBN handling and lookup helpers, no browser |
| `regress.mjs` | The main path: add, shelve, rate, series, export |
| `uitest2.mjs` | Empty states, filter badges |
| `screentest.mjs` | Screen routing, back-button stack, dialogs |
| `proftest.mjs` | Profiles, per-person shelves and ratings |
| `wishtest.mjs` | Wishlist, store links, moving between shelves |

**Features**

| Suite | Covers |
|---|---|
| `filtertest.mjs` | Genre, length, series, age filters; sorting |
| `langtest.mjs` | Language-aware search and filtering |
| `spicetest.mjs` | Spice/content tags, SFW filter, opt-in behaviour |
| `mediumtest.mjs` | Print/e-book/audiobook tracking, opt-in behaviour |
| `grouptest.mjs` | Series grouping, quick actions, stats, offline pill |
| `seriestest.mjs` | Manual series tagging; spellings collapsing to one group |
| `scandupe.mjs` | Scanning a book you already have, six ways |
| `phototest.mjs` | Adding from a photo: six books in one shot, batch undo, soft focus, several photos at once |
| `byhandtest.mjs` | ISBN check digits, and adding a book no catalogue has |
| `readstats.mjs` | The reading-year rule |
| `readmonth.mjs` | The "Read in" month override |
| `bulkmove.mjs` | Selecting several books and moving them |
| `socialtest.mjs` | Following, mutual friendship, feed, friend weighting |
| `customtest.mjs` | The "Yours" aesthetic, `assets/` drop-ins, contrast |
| `polish.mjs` | 300-book performance, A–Z rail, offline, service worker |
| `toasttest.mjs` | Undo staying visible above an open dialog |
| `parsetest.mjs` | Series-name parsing, 16 real title shapes |
| `overflowtest.mjs` | Card layout at five screen widths |

**Hardening** — each was written after finding a real defect

| Suite | Covers |
|---|---|
| `bugs1.mjs` | Hostile and malformed book data |
| `bugs2.mjs` | Attribute injection, corrupt storage, full storage |
| `bugs3.mjs` | Rapid taps, undo chains, navigation stress |
| `bugs4.mjs` | Delete and undo, import/export round trip |
| `bugs5.mjs` | Two phones syncing, malformed records in transit |
| `bugs6.mjs` | Every aesthetic × light/dark: contrast and overflow |
| `bugs7.mjs` | Dead, slow, empty and nonsense API responses |
| `bugs8.mjs` | Duplicate detection, Discover's empty states |

## Writing another

Copy the closest existing suite. The shape is: mock the network, seed
`localStorage`, drive the UI, print what you observe, end with an error list.

Two things that have caused trouble more than once:

1. **In Playwright, the last matching route wins.** Register catch-all mocks
   *before* specific ones or they'll swallow them.
2. **`addInitScript` re-runs on reload**, so `page.reload()` re-seeds
   localStorage. To test persistence, open a new page in the same context
   instead.

## What isn't covered

Camera scanning (needs real hardware), live Firebase (mocked at the network
layer), iOS Safari specifically (Chromium only), and accessibility.
