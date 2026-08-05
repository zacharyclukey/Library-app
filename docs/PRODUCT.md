# What makes Shelfie worth using

An honest read of where this app stands against the ones people already have on
their phones — what's genuinely ours, what's parity, and what's missing. Written
so nobody builds a worse version of a solved problem, or quietly erodes the
thing that makes this app worth choosing.

Market specifics (pricing, limits, who owns whom) move. Treat the *shape* of the
comparison as durable and re-check any specific before you rely on it.

---

## The position, in one paragraph

Book apps split into two camps. **Cataloguers** know what you own — Libib,
LibraryThing, CLZ Books, Book Buddy. They scan barcodes well, hold thousands of
items, and treat reading as an afterthought. **Trackers** know what you're
reading — Goodreads, StoryGraph, Fable, Hardcover, Literal, Bookly. They do
stats, reviews and social, and have essentially no concept of a physical shelf.
A person with 400 books at home and a queue in their head has to run two apps
and reconcile them by hand.

**Shelfie is the one app that holds both**, and it can only do that because of a
single design decision: *owning is a property of a book, not a place it sits.*
Every other app makes you file a book under one heading. That one rule is the
whole product. Protect it.

---

## What's genuinely ours

Six things. For each: what people do today instead, and how we could lose it.

### 1. One photo, many books

Point the camera at a shelf and every barcode in the frame becomes a book —
ticked through as one list, sent to a shelf in one tap, undone as one action.

*Today people:* scan one book at a time. The good cataloguers do rapid
sequential scanning, which is faster than typing but still one book per gesture.
Nobody turns a single photograph into eight books.

*Why it wins:* the worst moment in any library app is the first hour. This turns
a 300-book onboarding from an evening into a few minutes of pointing.

*How we lose it:* by letting the reader stop at the first barcode, or by making
the review list slow enough that batching stops feeling like a shortcut.

### 2. The sunset moment

You close a book, and the app hands you the next one. One pick, cover-forward,
reason in plain English, two deliberately different alternates, mood dials that
re-rank instantly. It works offline, on a shelf of three books.

*Today people:* go to a recommendations *screen*, when they remember it exists.
Recommendations are a destination in every competing app.

*Why it wins:* it arrives at the only moment a reader is genuinely open to being
told what to read next. Timing is the feature; the ranking is just what makes it
credible. This is the most defensible idea in the app.

*How we lose it:* by firing it when someone is cataloguing rather than reading,
by firing it four times in ten minutes, or by making it a badge. All three are
already guarded — see `docs/DECISIONS.md`. Keep them guarded.

### 3. A spice and content dial that's actually first-class

Kids / Teen / Mature / Explicit, plus a 1–5 spice scale, with matching filters
including an SFW filter — opt-in, synced, exported, and invisible until enabled.

*Today people:* read Goodreads review text, keep a spreadsheet, or ask a
Facebook group. Content *warnings* exist elsewhere; a spice **scale** you can
filter and sort on does not, in any mainstream app.

*Why it wins:* romantasy and adjacent genres are where the readers and the
buying are, and their single most-asked question about a book has no first-class
answer anywhere. Ours is one tap in the detail view.

*How we lose it:* by making it visible to people who didn't ask for it, or by
pretending a free database rates spice. No source does. It's the reader's call,
and the app must never assert a number it invented.

### 4. Household sharing that understands two readers

One shared collection of what the household owns; To Read, Finished and Wishlist
kept per person. She's finished it, he hasn't started — both true at once, same
book, one library.

*Today people:* keep separate accounts and duplicate the catalogue, or share one
account and lose whose queue is whose.

*Why it wins:* it is the actual shape of a house with books in it. Goodreads
cannot represent it at all.

*How we lose it:* by letting a personal action write to the household record, or
the reverse. `shelfFor()` in `db.js` is where that line is drawn.

### 5. Series completion as a shelf fact

A card says `📚 3 more in series`; the detail view lists the whole set marked
owned / not owned; the gaps go to the wishlist in one tap.

*Today people:* open a browser, find a series page, cross-reference it against
memory in a bookshop.

*Why it wins:* genre readers buy in sets. This is the feature that's open when
someone is standing in a shop deciding.

*How we lose it:* by guessing. A confident wrong series is worse than no series,
because it's invisible until someone goes looking for a book that isn't where
they filed it.

### 6. It refuses to give you homework

No "N books need rating". No streaks. No badges. No counters that go up while
you're not looking. At most one unrated book is ever offered, and waving it off
buys days of quiet.

*Today people:* accumulate a guilt pile in whichever tracker they abandoned.

*Why it wins:* it's the reason the app still gets opened in month six. Nearly
every competitor has monetised engagement pressure; not having it is a real,
statable difference.

*How we lose it:* one badge. Genuinely, one.

---

## Where we're behind, in the order it matters

**1. No import from another app.** *This is the adoption blocker.* Every
competitor takes a Goodreads CSV; StoryGraph built its early growth on it. A
reader with 800 books will not retype them, and everything good about Shelfie
only shows up on a full shelf. We already have ISBN lookup, a manual-add path
and a JSON importer — the work is a CSV parser and a patient batch lookup with
a progress line. Highest-value thing on the roadmap by a distance.

**2. Reading progress doesn't exist.** `reading` is a boolean. Competitors track
page or percentage, and some track sessions. For an app built around the moment
you *finish*, this matters less than it looks — but "I'm 240 pages in" is table
stakes now, and it also makes the finish moment self-evident rather than
something you have to remember to declare.

**3. Accessibility is unaudited.** Focus management in dialogs and
screen-reader labelling have never been checked. This is a public-standard
blocker, not a nice-to-have, and it is the item most likely to embarrass us in
front of strangers.

**4. Nothing for notes, quotes or highlights.** Reviews exist; the thing people
actually do — keep a line they loved — has nowhere to go.

**5. Audiobooks are a label, not a format.** `medium: audio` records where you
own a book. Duration, and progress in hours, are absent, and a meaningful share
of heavy readers are now mostly listening.

**6. Finding people requires swapping codes out of band.** Correct for a family,
a hard ceiling on anything social. Deliberate for now — see `SECURITY.md` — but
name it as the ceiling it is.

**7. No public face.** No screenshots, no landing page, no privacy policy. All
three are prerequisites for a store listing, not marketing extras.

---

## The standard each area is held to

| Area | Beat | Where we stand |
|---|---|---|
| Adding books | The best sequential barcode scanners | **Ahead** — one photo, many books |
| Edition accuracy | Goodreads (weak here) | **Ahead** — edition-first by design |
| Owning vs reading | Everyone | **Ahead** — the core idea |
| Series | Goodreads series pages | **Ahead** on owned/not-owned; behind on coverage for indie titles |
| Recommendations | StoryGraph | **Different** — ours is a moment, theirs is a better engine on a bigger corpus. Ours must stay explainable and offline |
| Stats | StoryGraph | **Behind, deliberately** — ours are honest and small. Don't chase |
| Content/spice | StoryGraph warnings | **Ahead** — a filterable scale exists nowhere else |
| Progress tracking | StoryGraph, Bookly | **Behind** — see above |
| Social | Goodreads, Fable | **Behind, deliberately** — no accounts, no feed of strangers |
| Import/export | Everyone | **Behind on import**, ahead on export (four formats, themed, printable) |
| Offline | Everyone | **Ahead** — the app is fully usable with no signal and no cloud |
| Privacy | Everyone | **Ahead** — local by default, three separate opt-ins, documented honestly |

---

## What we should not build

- **A feed of strangers.** It's the thing people are leaving other apps to
  escape, and it would drag accounts, moderation and a support burden behind it.
- **Streaks, badges, or any counter that accumulates.** See above; this is
  load-bearing.
- **A rating we invented.** Spice and content tags are the reader's, or they're
  a suggestion clearly marked as one. Never assert a number no source rated.
- **Server-side anything.** It ends the free hosting and the offline guarantee
  in the same stroke.
- **Stats for their own sake.** Ours are derived from what's already on the
  shelves and stay that way. Competing on dashboards is competing where we're
  weakest and it isn't why anyone would choose this.
