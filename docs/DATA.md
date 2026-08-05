# Data model

Everything the app stores, on the device and in the cloud. Useful when
debugging, when writing a migration, or when answering "where did that come
from?".

---

## A book record

The only shape that really matters. Lives in the `shelfie.library.v1` array;
`js/db.js` guarantees every field's type on the way out of the store.

```js
{
  id: "isbn:9780593135204",   // "isbn:…" | "ol:…" | "manual:…" — stable, opaque
  title: "Project Hail Mary",
  subtitle: null,
  authors: ["Andy Weir"],     // always an array of strings

  // Edition-specific — the whole point of scanning a barcode
  isbn13: "9780593135204",
  isbn10: "0593135202",
  publisher: "Ballantine Books",
  publishDate: "2021",
  pageCount: 476,
  format: "Hardcover",
  editionKey: "OL32444442M",  // Open Library edition
  workKey: "/works/OL20802877W", // Open Library work — shared across editions
  coverUrl: "https://covers.openlibrary.org/…",
  language: "eng",

  // Where it sits
  shelf: "owned",             // owned | tbr | completed | wishlist
  owned: true,                // ownership is a property, not a location
  reading: false,             // currently reading
  medium: "print",            // print | ebook | audio  (opt-in feature)
  profile: "Zach",            // whose entry this is; null = shared

  // What you thought
  ratings: { Zach: 5, Kelsey: 4 },              // per person, 1–5
  reviews: { Zach: { text: "…", updatedAt } },  // per person
  rating: null,               // legacy single rating, pre-profiles

  // Content tags (opt-in feature)
  content: "mature",          // kids | teen | general | mature | explicit
  spice: 3,                   // 1–5

  // Series
  series: { name: "The Empyrean", position: 1 },
  seriesManual: true,         // you set it; detection must not overwrite

  // Dates and reading history
  addedAt: "2026-01-14T…",
  finishedAt: "2026-06-02T…",
  readHere: true,             // the app watched you finish it — see below
}
```

Two fields carry rules rather than facts:

- **`readHere`** — only set when a book moved to Finished *from* To Read or
  while flagged as reading. It's what keeps "books finished this year" counting
  reading rather than cataloguing. Only ever written `true`, so a later move
  can't clear it. The **Read in** month picker sets it manually.
- **`seriesManual`** — set when you name a series (or declare "not in a
  series") yourself. Background detection checks it and won't overwrite.

## Device storage

All localStorage, all prefixed `shelfie.` and suffixed with a version.

| Key | Holds |
|---|---|
| `library.v1` | **The books.** Everything else is preference or cache |
| `profile.v1` | Which profile this phone is using |
| `deviceId.v1` | Random per-device id, for the member list |
| `skin.v1` · `mode.v1` · `theme.v1` | Aesthetic, brightness (`theme` is legacy) |
| `view.v1` · `shelfSort.v1` · `searchLang.v1` | Grid/list, sort order, search language |
| `household.v1` · `householdName.v1` | Derived shared-library id and its name |
| `pendingJoin.v1` | An outstanding join request |
| `shareCommunity.v1` | Community sharing on/off |
| `social.v1` · `readerId.v1` · `following.v1` | Friends on/off, your code, who you follow |
| `trackContent.v1` · `trackMedium.v1` | Optional features on/off |
| `persistStorage.v1` | Whether to ask the browser not to evict data |
| `nudgeSnooze.v1` | When to next offer an unrated book |
| `signals.v1` | **What you did about recommendations** — see below |
| `taste.v1` | Derived taste profile per person; rebuilt from the shelves |
| `rankWeights.v1` | Learned ranking weights, once there's history to learn from |
| `seriesCache.v1` · `subjectCache.v1` | Lookup caches (1 week / 30 days) |
| `assets.v1` | What was last found in `assets/`, and when |

Only `library.v1` is irreplaceable. Everything else is preference or
regenerable cache — useful to know when debugging: clearing the rest is safe.

`signals.v1` is the one worth understanding before you clear it. It is a capped
ring buffer (400 events) of which books were put in front of you, which you
took, and which you waved off, each stamped with the feature vector that ranked
it. It never leaves the device — it is not synced, not published, and not part
of the household — and the recommender's ability to improve with use comes
entirely from it. Clearing it is safe and loses the learning, not any books.
`taste.v1` and `rankWeights.v1` are both derived from it plus the shelves, so
they regenerate on their own.

## Cloud (Firestore)

Only written when a feature is switched on. Rules are in
[SETUP-SYNC.md](../SETUP-SYNC.md); the trust model is in
[SECURITY.md](SECURITY.md).

```
households/{householdId}/books/{bookId}     the shared library
  ├─ _meta                                  library name, created date
  ├─ _member:{deviceId}                     who's in it, last seen
  └─ _join:{deviceId}                       pending join request

community/{bookKey}                         aggregate: avg rating, tag votes
  └─ signals/{contributorId}                one person's rating/tags/review

community/_readers/signals/{contributorId}  shelf fingerprint (book keys only)
community/_social/signals/{readerCode}      name, follows[], recent reading
```

Two conventions worth knowing:

- **`_`-prefixed document ids are reserved**, and filtered out of book lists.
  It's how membership and join requests ride along on the same snapshot as the
  books, with no extra reads and no extra rules.
- **Everything lives under a `signals` subcollection**, including friend
  profiles, because that's the path the published rules allow. It's why Friends
  works on a project set up before Friends existed.

**`householdId`** is `nl_` + PBKDF2(name + password) — unguessable, but
reproducible on any phone that knows both. The password never leaves the
device.

**`bookKey`** is the identity a book has *across* users, so two people who own
different editions still pool their ratings: Open Library work id → ISBN-13 →
normalised `title-author` slug, first available wins.

## Formats you can export

From the Export screen — all generated on-device, nothing uploaded.

| Format | For |
|---|---|
| Printable page | Reading or printing; carries the current aesthetic |
| Plain text | Pasting into a message |
| CSV | Spreadsheets; includes copy type, content and spice columns |
| JSON | **Backup.** Re-importable, and the only complete record |

The JSON export is the full library verbatim. It's the thing to keep a copy of.
