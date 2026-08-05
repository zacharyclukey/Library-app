# Why it's built this way

The reasoning behind choices that would otherwise look arbitrary — or wrong —
to someone reading the code cold. Where a decision has a real cost, the cost is
stated.

---

### No build step, no framework, no dependencies

The app is plain files served directly. No React, no bundler, nothing to
`npm install` before it runs.

*Why:* it's a personal app maintained occasionally by one person who isn't a
full-time developer. A toolchain rots — in a year, `npm install` fails on a
transitive dependency and the app can't be changed. Plain files still open in
2035. It also means the thing you edit is exactly the thing the phone runs,
which makes debugging trivial.

*Cost:* `app.js` is 3,700 lines because there are no components to split it
into. Templating is string concatenation, so escaping is a discipline rather
than a guarantee.

### Everything on the device, cloud optional

Books live in `localStorage`. Firebase is opt-in.

*Why:* the app must open instantly and work with no signal, and a book library
is not worth a login screen.

*Cost:* clearing browser data destroys the library unless sync or an export
exists. iOS also evicts storage from unopened sites — mitigated with
`navigator.storage.persist()`, not solved. A published version would have to
invert this and make the cloud authoritative.

### The Owned shelf is a property, not a place

A book you own that's also on To Read appears on both shelves.

*Why:* the alternative — one shelf per book — forces "do I file this under
owned or to-read?", and then the Owned shelf isn't your collection any more.
Ownership is a fact about the book; the shelf is where it is in your reading.

### Repair every record on read, not on write

`db.js` normalises every record on the way out of the store.

*Why:* records arrive from four directions we don't control, including other
people's phones and whatever Open Library returned two years ago. Validating on
write can't fix what's already stored. One record with `authors` as a bare
string used to throw mid-render and leave the whole shelf blank — which reads
to a user as *the app lost my books*.

*Cost:* a pass over every read. Measured at ~0.05 ms per 500 books thanks to a
fast path for already-clean records, against ~0.38 ms for the JSON parse.

### Two taps to move a book, one tap for everything else

Shelf moves on the flip side arm first and commit on a second tap after a short
pause. Ratings don't.

*Why:* a mis-tap that moves a book off the shelf you're looking at is
disorienting and hard to notice. A mis-tap that sets a rating is trivially
undone. The pause exists because a double-tap or a bouncy finger shouldn't
sail through both taps — mashing the button never commits.

*Rejected:* a confirmation dialog. The whole app avoids modal confirmations in
favour of undo, and one exception would look like a mistake.

### Undo instead of "are you sure?"

Every action reports itself with an Undo button for a few seconds.

*Why:* confirmations tax every action to prevent the rare bad one, and people
learn to dismiss them without reading. Undo taxes nothing and is a better
safety net. This is also why deleting a book has no confirmation.

### The reading-year stat counts reading, not cataloguing

A book only counts toward "finished this year" if the app watched you finish
it: it was on To Read, or flagged as reading, and then moved to Finished.

*Why:* logging a shelf of books read years ago would otherwise inflate the
number until it meant nothing. Books added straight onto Finished are
cataloguing.

*Cost:* marking an owned book Finished without ever queueing it doesn't count —
which is also what bulk backfill looks like, so the two can't be told apart.
The **Read in** month picker on any finished book is the manual override.

*Deliberately not done:* explaining any of this on the stats screen. It should
just work.

### Series names are matched loosely

Grouping compares a flattened key — lowercased, articles and punctuation
stripped — so "L.O.R.D.S.", "LORDS" and "The L.O.R.D.S. Series" are one
heading, displayed under the fullest spelling seen.

*Why:* series names arrive from several sources that rarely agree on
punctuation or the leading article. Matching literally produced two headings
that looked identical.

### Series detection refuses to guess

A title pattern only counts as a series if it carries a book number.

*Why:* parentheses in book titles hold "(A Novel)" and "(A Dark Romance)" far
more often than a series. A wrong series files a book under a heading that
doesn't exist — worse than no series, because it's invisible until you go
looking for the book.

*Consequence:* indie and self-published books frequently get nothing, which is
why manual series tagging exists and always wins over detection.

### Identity is a bearer code, not an account

The household is addressed by a code derived from name + password; a friend is
followed by pasting their reader code.

*Why:* accounts mean sign-up, password reset, and an email pipeline — a large
amount of machinery for an app used by a family. The code model is understood
by anyone who has shared a Wi-Fi password.

*Cost:* whoever holds a code *is* that person. This is stated plainly in the UI
and in [SECURITY.md](SECURITY.md), and it's the first thing a public release
would have to replace.

### Anonymous auth, added later

Firebase anonymous sign-in happens silently, purely so the security rules can
require *a* signed-in user.

*Why:* it costs nothing, needs no UI, and is the difference between "anyone who
finds the URL can wipe the database" and "only app users can". It is not
identity — it's a gate.

*Cost:* clearing the browser loses the uid, and with it write access to that
device's own community and social documents.

### Recommendations weight people over popularity

Order of influence: friends → people you follow → readers with similar shelves
→ subject and author overlap → raw public ratings.

*Why:* an early version leaned on Open Library's rating average and returned
the same handful of famous books to everyone. Public ratings are now a
confidence-weighted tiebreaker — a 4.6 from nine readers doesn't outrank a real
taste match.

### Nothing is ever a backlog

No "14 books need rating" counter exists anywhere. At most one unrated finished
book is ever offered, and dismissing it stays quiet for days.

*Why:* an explicit ask. A tracking app that accumulates chores stops being
opened.

### Artwork is discovered, not configured

Drop `logo.png` into `assets/` and it appears; no file to edit.

*Why:* the person doing the design work has limited code skills. A config file
is one more thing to get wrong.

*Cost:* the folder has to be probed. Mitigated by remembering what was found,
so a full check runs twice a day rather than every launch, while the one or two
files believed to exist are confirmed each time — which is free, since the
browser fetches them to paint anyway.

### `css/custom.css` is never touched by the app's own code

It loads last and is the user's file.

*Why:* personal styling and app updates must not fight. Anything in it wins
over the built-in aesthetics, and nothing the maintainer does can overwrite it.

### One sheet loads after the user's, and holds six things

`css/identity.css` is last in `index.html`, after `custom.css`. It carries the
mark, the 2:3 cover and its binding shadow, the fore-edge, the shelf ledge, the
checkout card, and the rule that ratings are struck in brass.

*Why:* five aesthetics with every colour negotiable is five apps that share a
database. Something has to be the same in all of them or there's no Shelfie
underneath the skin. These six are structural rather than chromatic, so they
survive a palette swap without fighting it — every rule in the file is still
written in theme variables, so the shelf follows your colours. What's fixed is
that there *is* a shelf.

*Cost:* a cascade trap, and it bit during the work. Anything `identity.css`
declares in `:root` beats the same declaration in `custom.css`, which is fine
for the locked proportions and wrong for everything else. So token *values*
the user is invited to change — `--card-stock`, `--stock-ink`, `--gold` — are
declared in `styles.css`, which loads first, while the rules consuming them
live in `identity.css`. Values are vibe; motifs are identity. Get that backwards
and you silently override the person you meant to serve.

*Alternative rejected:* CSS `@layer`, which expresses this directly. It would
need `@import ... layer()` from inside `styles.css`, since a `<link>` can't be
assigned a layer — serialising two stylesheet fetches on first load, and
failing closed on any browser that doesn't support it, taking the "Yours" skin
down with it. Load order does the same job with nothing to support.

---

## Things deliberately not done

- **Amazon wishlist import** — no free API exists. Wishlists are in-app.
- **Kindle/Audible library import** — same reason. Copy types are logged
  manually, and the feature is off by default so it's invisible to anyone who
  doesn't want it.
- **Spine recognition from a shelf photo** — needs OCR plus fuzzy matching that
  free tiers don't support well. Barcodes only, though one photo can carry
  several.
- **Server-side anything** — would end the free hosting and the offline-first
  guarantee.
- **A design-system export** — evaluated; it would create a second copy of the
  styling that drifts from the real stylesheet.
