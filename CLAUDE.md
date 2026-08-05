# Working on Shelfie

The operating standard for anyone — person or agent — changing this app. Read
it before your first edit. It is short on purpose; the reasoning behind
everything here lives in [`docs/DECISIONS.md`](docs/DECISIONS.md), and if a
line here ever contradicts the comment at the top of a source file, **the file
comment wins** and this document needs fixing.

---

## What we're building

A **photo-powered personal book library**: point a phone at a barcode — or at a
whole shelf — and the books you own, want, and have finished are catalogued by
edition, tracked per person, and used to hand you the next thing to read.

And what we're building *toward*: the one app that knows **both** what is
physically on your shelves and where you are in your reading. Nearly every
competitor does one or the other. That gap is the product. See
[`docs/PRODUCT.md`](docs/PRODUCT.md) for the honest competitive picture and
[`docs/MOBILE.md`](docs/MOBILE.md) for the road to an app store.

The destination is a **paid app people would recommend to a friend**. Not a
personal project that happens to be public. Hold your work to that.

---

## The bar

Four questions. Every change answers all four before it ships. If you can't
answer one, say so in the commit message rather than guessing.

**1. Does this do something the other apps don't?**
Parity features are worth building, but know which you're doing. If it's parity
(import, progress, notes), match the best version on the market, don't invent a
worse one. If it's ours (one photo → many books, the sunset moment, the spice
dial, household-shared ownership with personal queues), it has to be *obviously*
better than the workaround people use today, or it isn't worth the code.

**2. Does it work intuitively, at or above market standard?**
Test it as a person with 400 books and a toddler, not as the person who wrote
it. A feature that needs explaining has failed. Compare against the app people
would otherwise use — StoryGraph for stats, Libib for cataloguing, Goodreads for
series — and be honest when ours is worse.

**3. Would you put your name on it in public?**
Not "does it work". Would you screenshot it. Ship-blockers are listed under
*Public standard* below.

**4. Does it make the phone-app port harder?**
Every rule under *Boundaries* exists so that going native is a fortnight rather
than a rewrite. Breaking one costs real money later. See
[`docs/MOBILE.md`](docs/MOBILE.md).

---

## Boundaries — the rules that don't bend

These are invariants, not preferences. A change that breaks one is wrong even
if it works and the tests pass.

1. **Books reach storage only through `db.js`.** Every read runs `repair()`, so
   the rest of the app can trust the schema absolutely. Other modules may own
   *their own* single namespaced key (there are 29, all `shelfie.<thing>.v1`,
   catalogued in [`docs/DATA.md`](docs/DATA.md)) — but nothing except `db.js`
   reads or writes the library.
2. **New persisted state = one new `shelfie.<thing>.v1` key, documented in
   `docs/DATA.md`.** Never a second library key, never an un-namespaced key.
   The naming is what makes the native storage migration a single shim.
3. **`sync.js` owns the Firebase handle.** `community.js` and `social.js` get it
   via `sync.firestore()`. The SDK loads once, on demand, and never at all if
   sync is off.
4. **`app.js` owns all UI state and is the only module that renders.** Other
   modules return data. No module reaches into the DOM.
5. **Network calls live in `api.js` (books) and the Firebase modules.** The only
   other `fetch` in the codebase is `icons.js` probing for local asset overrides,
   and it should stay that way.
6. **Camera access lives in `scanner.js`.** Nothing else calls `getUserMedia` or
   touches `BarcodeDetector`.
7. **Everything network-dependent degrades.** Every remote call is wrapped; a
   failure logs and returns empty rather than throwing. The app must stay fully
   usable with no network and no Firebase project. Never add a feature that
   fails closed.
8. **All paths relative.** No absolute URLs to the deployed origin — a native
   shell serves from `capacitor://localhost` and absolute paths break there.
9. **Escape every interpolation.** `esc()` on everything going into a template
   literal, including values landing in attributes. String templating means
   escaping is a discipline, not a guarantee.
10. **No build step. No runtime dependencies. No CDN.** `npm` exists only so the
    tests can install a headless browser. If a change needs a bundler, the
    change is wrong. This is the decision the whole project rests on.

---

## Product opinions that don't bend

Break one of these and you've broken the app even if every test passes. Each is
argued in full in `docs/DECISIONS.md`.

- **Owning is a property, not a place.** A book you own that's also on To Read
  appears on both shelves. The Owned shelf is always the complete collection.
- **Undo, never "are you sure?"** Every action raises a toast with Undo for a
  few seconds. There are no confirmation dialogs anywhere — not for delete, not
  for anything. The one exception is a shelf move on the flip card, which arms
  on the first tap and commits on the second.
- **Nothing is ever a backlog.** No "14 books need rating" counter, no streaks,
  no badges, no chore queue. At most one unrated book is offered at a time and
  waving it off stays quiet for days. A tracking app that accumulates homework
  stops being opened.
- **Reading is not cataloguing.** The year stat and the sunset sheet both fire
  only when the app *watched* you finish a book — it was queued or flagged as
  reading, then moved to Finished. Backfilling forty old books must interrupt
  you zero times.
- **Series detection refuses to guess.** A title pattern only counts as a series
  if it carries a book number. A wrong series heading is worse than none, and a
  manual tag always wins over detection.
- **People over popularity.** Recommendation influence runs friends → follows →
  similar shelves → subject and author overlap → public ratings last, as a
  confidence-weighted tiebreaker.
- **Opt-in features are invisible until enabled.** Spice, copy types, community,
  friends — all off by default, and the UI shows no trace of them until the
  switch is thrown.
- **Say why, in plain English.** Every recommendation states its reason
  ("Kelsey rated it ★★★★★"), and the reason is checked against the book rather
  than asserted from the query that found it.
- **Tell the truth when something breaks.** "The lookup failed", not "no matches
  found". "That change wasn't saved", not silence. An honest failure is a
  feature here.

## The stylesheet order *is* the design system

```
css/styles.css     structure, five aesthetics, and every token value
css/custom.css     THE USER'S FILE — never touched by app code, always wins
css/identity.css   the six motifs that survive every skin
```

Token **values** the user may want to change live in `styles.css` (loads
first). The **rules** consuming them live in `identity.css` (loads last). Get
that backwards and you silently override the person you meant to serve. Values
are vibe; motifs are identity.

---

## House style

**Code.** Match the file you're in. Plain ES modules, no clever abstraction,
comments that explain *why* rather than *what*. Every file opens with a comment
stating its job and its non-obvious constraints — if you change what a file is
for, change that comment in the same commit. It is the documentation of record.

**Commits.** Imperative, plain English, describing the effect on the reader —
not the mechanics. The existing log is the reference:

> `Read every barcode in the photo, not just the first`
> `Never ask about a book you catalogued rather than read`
> `Stand the books on the shelf, and let a pulled card pass in front of it`

Not `fix scanner bug` or `refactor app.js`. No model names, no tool names, no
issue numbers in the subject.

**Docs.** When behaviour changes, the doc that describes it changes in the same
commit. `docs/README.md` is the index. Non-technical readers are a real
audience — `WALKTHROUGH.md` and `DESIGN.md` are written for the owner, not for
programmers, and must stay that way.

---

## Before you push

```bash
npm install     # once
npm test        # ~10 minutes, all suites
npm test bugs   # the hardening suites, when you're iterating
```

**A red suite blocks the push.** If a test is wrong, fix the test in the same
commit and say why in the message. Never delete a suite to get green.

New behaviour needs a suite or a case in an existing one — `tests/README.md`
lists the ~30 suites and what each covers; add yours to that table. Suites drive
the real app in headless Chromium with Open Library, Google Books and Firestore
mocked at the network layer.

### Traps that have bitten, repeatedly

- **In Playwright, the last matching route wins.** Register catch-all mocks
  *before* specific ones or your specific mock never fires.
- **A modal `<dialog>` makes the rest of the document inert.** A toast raised
  before the dialog opened sits there looking pressable and refusing to be
  pressed. The toast region travels into the open dialog and back out again —
  keep it that way.
- **Sync snapshots are hashed before re-render**, so an identical snapshot
  doesn't snap a flipped card shut mid-interaction. Don't bypass it.
- **iOS Safari has no `BarcodeDetector`.** Our own `ean13.js` is what makes
  scanning work on iPhone at all. It is not a fallback; on iOS it is the reader.

---

## Workflow

- Trunk is **`claude/book-library-series-app-jsqsp7`** (the repo's default
  branch). Work on your own branch, merge trunk into yours before you push, and
  keep your branch's scope to one thing.
- Several branches run in parallel. `js/app.js` is 5,000 lines and is where
  every collision happens — say in your commit message which screens you
  touched, and merge trunk in early rather than at the end.
- Don't open a pull request unless the owner asks for one.
- Don't touch `css/custom.css` or anything in `assets/` — those belong to the
  owner, and app updates must never fight personal styling.

---

## Public standard

Things that must be true before this is offered to strangers. Do not let these
rot; they are the difference between a project and a product.

- **Accessibility is unaudited.** Focus management in dialogs and screen-reader
  labelling have never been checked. This is the largest open risk to shipping
  and it blocks any store listing that claims a public standard.
- **Identity is a bearer code.** Whoever holds a library password or a friend
  code *is* that person. Fine for a family, stated plainly in
  [`docs/SECURITY.md`](docs/SECURITY.md), and the first thing a public release
  must replace.
- **There is no import path from another app.** A reader with 800 books on
  Goodreads cannot get them in. Every competitor supports this. It is the single
  biggest adoption blocker and it is not hard.
- **No CI.** Tests are real and good, but nothing runs them automatically before
  a merge into trunk.

## Decisions that belong to the owner, not to you

Raise these, don't resolve them: spending money (developer accounts, hosting,
domains), anything that publishes user data by default, replacing the bearer-code
identity model, adding a paid tier, and any change to the ten boundaries above.
