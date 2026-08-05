# The recommendations plan

Where Discover is now, what's wrong with it, and the ten steps between here and
the thing we're actually building: **you finish a book, and the app hands you
the next one.**

Written after a full read of `js/app.js`, `js/community.js`, `js/social.js`,
`js/filters.js` and `js/api.js`. Every claim below has a file and a line behind
it. The reasoning style is [DECISIONS.md](DECISIONS.md)'s — where a choice has
a cost, the cost is stated.

Everything here is free: GitHub Pages, the Firestore free tier, GitHub Actions
minutes, Open Library and Google Books. No step in this plan adds a bill.

---

## The end state

A book moves to **Finished**. Right then, before the moment passes:

- *How was it?* — five stars, one tap.
- **The next book.** One pick, cover forward, with a reason in plain English —
  *"Book 3 of Stormlight, and you gave book 2 five stars"*, *"Kelsey rated this
  five last month"*, *"Same slow-burn court intrigue, and a shorter one"*.
- Two alternates, deliberately unlike each other and unlike the pick.
- A row of dials — lighter, faster, longer, something different — that re-rank
  instantly, offline, from what's already loaded.
- Three answers: **Start reading**, **Wishlist**, **Not tonight**. All three are
  training data.

It has to be instant, it has to work with no signal, and it has to be right
often enough that people stop browsing. And it has to get better every week it
is used, without anyone tuning it by hand.

None of those four things is true today.

---

## What's actually there

Discover works, and the ranking philosophy is right — people over popularity,
stated in DECISIONS.md and implemented honestly in `buildRecommendations`
(`js/app.js:2481`). The community and social layers are built, wired, and
already collecting. This plan is not a rewrite. It is a loop the feature is
missing, plus the moment it was always for.

## What's wrong

**1. Nothing you disliked counts.** `js/app.js:2489`:

```js
const engagement = (myRating(b) ?? 0) >= 4 ? 3 : b.shelf === "wishlist" ? 2 : 1;
```

A book you rated one star weighs the same as one you own and never opened —
and it weighs *positively*. Every book you hated is currently pulling your
taste profile toward its author and its subjects. The strongest opinion a
reader ever expresses is the one signal we throw away.

**2. Your taste is built from your ten oldest books.** `js/app.js:2504`:

```js
const withWorks = pool.filter((b) => b.workKey).slice(0, 10);
```

With no filter set, `pool` is the library in insertion order. Half the taste
profile — the subject half — is mined from the first ten books ever added, and
nothing you read afterwards can change it. Read for two years and it still
describes the fortnight you set the app up.

**3. Discover can't ask most of the questions.** `recFilter` is
`{ genre, pages, age }` (`js/app.js:2417`). `filters.js` already implements
nine axes — spice, audience, language, series, format, status, rating — and the
shelf screen uses all of them. The goal is "exactly what they're looking for"
and two thirds of the vocabulary we already own isn't offered.

**4. It's slow, and the cache doesn't help.** `js/app.js:2418`:

```js
let recsCache = null; // key: JSON.stringify(recFilter) + ":" + books.length
```

In memory, so a reload discards it; keyed on library *size*, so rating ten
books invalidates nothing. A cold open is ~13 Open Library searches through a
queue with a 220 ms floor between them (`js/api.js:295`) plus up to 30 work
fetches. Seconds. A sunset moment cannot cost seconds.

**5. Friends can boost a book but never introduce one.** Candidates come only
from Open Library searches built out of your own authors and subjects
(`js/app.js:2534`). `socialScores` and `coReadScores` are then consulted as
lookup tables. A book your closest friend loved is invisible unless one of your
own taste queries happened to return it. The signal the whole feature claims to
lead with is wired as a tiebreaker.

**6. A household shares one blurred taste.** `buildRecommendations` reads
`db.getAllBooks()` with no profile scoping (`js/app.js:2609`), even though
ratings, To Read and Wishlist are all per-person.

**7. Every rating re-reads every rating.** `recomputeSummary`
(`js/community.js:97`) pulls the whole `signals` subcollection for a book and
rewrites the summary, on every publish, from whichever phone was last. That is
reads proportional to the number of people who rated the book, paid by a phone,
every time anyone rates it.

**8. Every Discover open downloads every reader.** `coReadScores`
(`js/community.js:191`) fetches the entire `community/_readers/signals`
collection and does the similarity maths on the device. It is a full collection
scan run on a phone. A hundred sharing users is a hundred document reads per
open; the free tier is 50,000 reads a day. This works today because there is
one household. It stops working at exactly the point the feature starts to.

**9. The same book has different names.** `bookKey` (`js/community.js:41`)
resolves Open Library work → ISBN-13 → title slug. Two people who added the
same book different ways produce two keys, and their ratings never pool. Every
cross-user signal in the app is quietly diluted by this.

**10. It cannot improve with usage, only with library size.** Nothing anywhere
records that a recommendation was shown, taken, or ignored. There is no
feedback loop, so "gets smarter over time" is currently untrue — and there is
no way to tell whether a change to the ranking made it better or worse.

**11. A new user gets nothing.** Under two books, Discover says come back later
(`js/app.js:2450`) — at the moment someone is most curious about what this app
is for.

---

## The shape of the fix

Five new modules, each small, each testable, and `app.js` gaining wiring rather
than logic.

```
js/signals.js     what the reader did — the loop that makes the rest compound
js/taste.js       a durable, signed, decaying picture of one person's taste
js/candidates.js  where books come from — five sources, not one
js/rank.js        an explicit feature vector, weights that can learn
js/model.js       the cross-user model, fetched once a day instead of scanned
```

---

## Phase 1 — Record what happened

**Ship this first.** Nothing else in this plan compounds until events exist,
and every week without it is a week of data we can't get back.

`js/signals.js`: an append-only ring buffer in localStorage, capped at ~500
events, schema-versioned, evictable.

Events: `shown`, `opened`, `wishlisted`, `started`, `dismissed`, `finished`,
`rated`, `abandoned`, `dial_moved`. Each carries the book key, the reason
string that was displayed, its position in the list, the filter and mood state
at the time — and **the feature vector that produced the rank**.

Logging the features, not just the outcome, is the part that matters. It's what
makes offline replay possible in Phase 9 and learned weights possible in
Phase 4. Without it we can measure that someone said no, but never why the
ranker thought they'd say yes.

Wiring: `renderRecs` logs what it actually paints; the wishlist button, a new
*Not for me* control, the shelf move to `completed`, the nudge card
(`js/app.js:218`) and the detail-view rating each log their event.

Private by default. Nothing leaves the device in this phase.

*Cost:* ~150 lines and no visible change. It is still the highest-leverage
commit in the plan.

## Phase 2 — Make dismissal mean something

A *Not for me* that changes nothing next time is a lie the user will catch
within two sessions. A dismissed book is suppressed from candidates for 90
days, and its author and top subjects take a small negative nudge in Phase 3's
taste object.

Small, immediate, and the first thing that will make the feature feel like it's
listening.

## Phase 3 — Taste as a durable object

`js/taste.js` replaces the recomputed-from-scratch profile with a stored one,
per profile:

```js
shelfie.taste.v1 = {
  profile: "Zach",
  authors:  { "Robin Hobb": 4.2, ... },              // signed
  subjects: { "court intrigue": 3.1, "grimdark": -1.4, ... },
  genres:   { ... },
  lengthBand: { ... },   // what you actually finish, not what you buy
  updatedAt, version
}
```

Four rules, each fixing something above:

- **Signed.** Five stars +2, four +1, three 0, two −1, one −2. Abandoned −1.
  Wishlisted +0.5. Merely owned +0.25. Dismissed −0.25. (Fixes #1.)
- **Decayed.** Every weight multiplied by ~0.97 per week of age — a six-month
  half-life — applied lazily on read, never by a timer. This year's reading
  outweighs a phase you grew out of.
- **Per profile.** Keyed on `currentProfile()`. (Fixes #6.)
- **Complete and incremental.** Subjects come from every book with a
  `workKey`, not the first ten — affordable precisely because it is updated one
  book at a time, when that book is added or rated, rather than thirty at once
  when Discover opens. `api.fetchWorkSubjects` already caches for 30 days
  (`js/api.js:232`), so the marginal cost is usually zero. (Fixes #2 and most
  of #4.)

*Why stored rather than recomputed:* recomputation is what forced the ten-book
sample and the seconds-long cold path in the first place. An incremental object
is O(1) per event, survives a reload, and lets Discover open with no network.

*Cost:* another localStorage key on a store that already has a quota path
(`shelfie:storage-full`, `js/db.js:156`). Capped and rebuildable from the
library, so eviction is a slow first run, never a loss.

## Phase 4 — Five sources, not one

`js/candidates.js`, each source returning `{ key, book, source, sourceScore }`:

1. **Taste queries** — today's Open Library path, unchanged in kind, driven by
   the fuller taste object and pre-warmed rather than run on demand.
2. **Friends' shelves** — what people you follow finished and rated four or
   five. `social.fetchFollowing()` already returns their `recent` arrays with
   titles, covers and ratings (`js/social.js:200`). Promoting this from lookup
   table to source is a few dozen lines and it fixes #5.
3. **Co-read** — from the batch model in Phase 7. One document read.
4. **Series continuation** — you finished book two, rated it well, and don't
   own book three. `api.listSeriesBooks` already exists (`js/api.js:471`). This
   is the highest-precision recommendation a reading app can make and today it
   appears only as a badge on a card — never in Discover, never at the moment
   someone finishes book two.
5. **Your own shelves** — To Read and Wishlist. The best next book is very
   often one you already chose.

Source 5 deserves its own paragraph. It's free, instant, offline, needs no
Firebase and no other users, and on most nights it should win. It also means
the sunset experience works on day one for someone with three books — which
deletes #11 rather than papering over it, and keeps the app from being a thing
that only ever sends you shopping.

Dedupe on `bookKey` after Phase 8's normalisation.

## Phase 5 — The sunset screen

The moment a book moves to Finished (`js/app.js:1795` for a single card,
`js/app.js:722` for a batch), offer the sheet described at the top of this
document.

Three rules it inherits from the rest of the app:

- **Once per finish, never a backlog.** No badge, no counter, no "3 books
  waiting". DECISIONS.md is explicit about this and it applies here more than
  anywhere: the sunset is a gift at the end of a book, not a chore queue.
- **Always has an answer.** Sources 4 and 5 need no network, so an offline
  phone still gets a pick with a real reason.
- **Instant.** Candidates for the current profile are refreshed in the
  background on app open and after any rating, so the answer is already
  computed before the book is finished. `recsCache` becomes a persisted,
  profile-keyed, pre-warmed cache with a real invalidation key — the taste
  object's `updatedAt`, not the library's length.

Rating at the moment of finishing is worth ten nudges a week later, and it is
the highest-quality signal the app will ever collect. The nudge card stays for
the books that slipped past.

Discover keeps its screen and its engine: same modules, browse mode, full
filter set.

## Phase 6 — Ranking that can learn

`js/rank.js`. Today's arithmetic (`js/app.js:2616`) is good and stays as the
starting point — it just moves out of an inline loop and into an explicit
feature vector:

`subjectMatch`, `authorMatch`, `corroboration`, `friendScore`, `friendIsMutual`,
`coRead`, `communityRating×confidence`, `publicRating×confidence`, `lengthFit`,
`seriesContinuation`, `onYourShelf`, `moodMatch`, `staleness`.

Scoring stays a **linear combination**, deliberately. It's readable, it's
debuggable by printing it, and it's what lets each card say why it's there in
words — and that sentence is half the feature.

Weights begin at today's hand-tuned values. Once a profile has 40 or more
outcome events, fit a small logistic regression on device — accepted versus
shown-and-passed — over the logged feature vectors, and blend:

```
w = (1 − α)·w_default + α·w_learned,   α ramps with event count, capped at 0.6
```

Twelve weights over 500 events is a few milliseconds of plain JavaScript. No
library, no service, no build step. The cap means a cold or weird log can
nudge the ranking but never seize it.

Diversity gets stricter too: today's max-two-per-author, plus max-one-per-series
and a subject-spread pass, so three picks are three different evenings.

## Phase 7 — Compute the cross-user model once, not per phone

Replace the client-side collection scan (#8) and the per-rating summary rewrite
(#7) with one scheduled job.

- **GitHub Actions**, nightly cron, free. Reads Firestore with a service-account
  key in repo secrets.
- Computes item→item co-occurrence over reader fingerprints, cosine-normalised,
  top 20 neighbours per book — plus the book aggregate summaries that
  `recomputeSummary` currently recomputes from a phone.
- Writes **one** artifact, `models/coread.v1`, sharded by key prefix if it
  passes Firestore's 1 MiB document cap.
- Clients fetch it at most once a day and cache it in localStorage.

Per-user reads drop from *O(everyone who shares)* to one. Writes per rating drop
from *O(everyone who rated that book)* to zero. Both stay inside the free tier
at a scale the current design cannot reach.

*Privacy:* the artifact holds book-to-book counts. No user ids, no reader
fingerprints, nothing attributable. It is the aggregate, not the audience.

*Cost:* this is the one piece of infrastructure the plan adds — a service
account key in repo secrets, and a scheduled job that can silently stop.
*Fallback if that's unwanted:* keep the client scan but bound it — sample 50
fingerprints, cache the derived neighbour map for 24 hours. Same shape, worse
recall, still free, no secret.

## Phase 8 — One book, one name

Fix `bookKey` so signals pool (#9):

- Resolve to the Open Library **work** wherever possible, including for books
  added by ISBN — `lookupByIsbn` already returns `workKey` (`js/api.js:93`), it
  just isn't on older records. A one-time backfill fills it from `isbn13`.
- Keep ISBN-13 → slug as the fallback, but normalise the slug harder. `seriesKey`
  (`js/app.js:2679`) already strips volume numbering; the same treatment for
  subtitles, articles and punctuation belongs here.
- Publish an **alias map** alongside the model — `isbn_… → ol_…`, `t_… → ol_…`,
  learned from records that carry both — so signals written under an old key
  fold into the right book instead of sitting somewhere nobody reads.

Unglamorous, invisible, and it multiplies the value of every cross-user signal
in the app.

## Phase 9 — Mood, which filters can't express

Filters answer *what shape of book*. They don't answer *what do I want
tonight*. Five dials, not thirty:

| Dial | Ends | Where the value comes from |
|---|---|---|
| Weight | light ↔ involving | subjects + page count, corrected by community tags |
| Pace | slow burn ↔ fast | community tags |
| Familiarity | more like that ↔ something different | a knob on the ranker, no data needed |
| Length | an evening ↔ a project | `pageCount`, already on every record |
| Spice | none ↔ hot | already in the data model, opt-in, already syncing |

Familiarity is free and immediate: it raises or lowers the weight on
`subjectMatch` and `authorMatch`. Length and spice are free because the data is
already there. Weight and pace start as a rough guess from subject tags and
length, and are **corrected by readers** — a one-tap "this one moves" on a
finished book, published exactly like spice and content tags are today
(`js/community.js:62`), on rules that are already deployed.

*Why not have a language model tag the catalogue:* it costs money, and the
requirement is that this stays free. The community route is slower to start and
it is the one that keeps getting better as more people use the app — which is
the actual goal, not a shortcut to it.

## Phase 10 — Knowing whether any of it worked

Without this, every phase above is an opinion.

- **Replay harness** — `tests/rectest.mjs` plus fixture libraries and event
  logs, run through the ranker with the network mocked exactly as the other
  ~30 suites do. Assertions on the things we claim: a friend's five outranks a
  stranger's 4.8; an author you rated one star doesn't come back; a dismissed
  book stays gone; series continuation beats a generic subject match.
- **An offline number** — hold out each fixture profile's last few accepted
  books, measure precision@3 and MRR, print it in the suite. A weight change
  then shows up as a number instead of a feeling.
- **Private counters** — acceptance rate of the sunset pick, share of picks by
  source, share by reason. On device, never published, visible in a debug view.
- **The guardrail** — no ranking change lands if it lowers replay precision@3.

---

## Order, and why this order

| # | Phase | Why here | What ships |
|---|---|---|---|
| 1 | Signals | nothing compounds until events exist | nothing visible |
| 2 | Dismissal | makes *Not for me* honest | one control |
| 3 | Taste object | kills the ten-book sample and the missing negative | a better Discover |
| 4 | Five sources | works offline, deletes cold start | the sunset becomes possible |
| 5 | Sunset screen | the goal | **the feature** |
| 6 | Feature-vector ranker | refactor behind tests, no behaviour change | nothing visible |
| 7 | Batch model | before user count makes the phone scan hurt | scale |
| 8 | Identity | multiplies every cross-user signal | nothing visible |
| 9 | Mood dials | "exactly what they're looking for" | the differentiator |
| 10 | Learned weights | worthless without 1, thin without 7 | it starts improving on its own |

Evaluation (Phase 10's harness) runs alongside from step 3 onward, not at the
end.

Three of these are order-critical. **1 before everything**, because a month of
un-logged usage is a month that can't be replayed. **7 before the user base
grows**, because the client-side scan degrades exactly as the feature succeeds.
**10 last**, because a learner with no log is just a slower version of the
hand-tuned weights.

Steps 1–5 are the milestone worth aiming at: after them the sunset experience
exists, works offline, and is collecting the data the rest of the plan spends.

---

## Costs and risks, stated plainly

**localStorage pressure.** Taste, event log and candidate cache all land in a
store that already has a full-disk path. Everything is capped, the event log is
a ring buffer, and every one of them is rebuildable from the library — so
eviction costs a slow first run, never data.

**`app.js` grows.** It is 3,974 lines and already the known refactor target
(ARCHITECTURE.md). Every phase here lands in a *new* module; app.js gains
wiring only. The sunset sheet is the one real addition, and it's a good excuse
to start pulling screen renderers out.

**A learner can go wrong quietly.** Hence the linear form, the α cap, and the
rule that no ranking change ships against a worse replay score.

**Open Library rate limits stay the bottleneck.** `QUERY_GAP` is 220 ms and
Discover fires a dozen queries. Pre-warming moves that off the critical path;
it doesn't remove it. The taste object helps twice over — a stable profile
between runs means a cached candidate set stays valid across sessions instead
of being rebuilt from scratch every open.

**The batch job is a dependency that can rot.** A scheduled Action that stops
running degrades the co-read source silently. It needs a staleness check in the
client — an old model is ignored rather than trusted — and the stated fallback
above if the secret is unwanted.

**Community tags need volume to be useful.** Pace and weight will be thin for a
long time. They start as a heuristic from data we already have, so the dials
work from day one and improve rather than waiting.

**None of it costs money.** GitHub Pages, the Firestore free tier, GitHub
Actions minutes, Open Library, Google Books. If any phase ever needs a bill,
that's the signal to stop and rethink it, not to pay it.
