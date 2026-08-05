# Security and privacy — the honest account

What is protected, what isn't, and what would have to change before strangers
use this. Written so a programmer reviewing it doesn't have to work it out, and
so nobody is surprised later.

**Current posture: suitable for family and friends. Not suitable for public
release.** The gap is identity, and it's listed at the bottom.

---

## What leaves the phone

Nothing, until you switch something on. Three separate opt-ins:

| Feature | What it publishes | Who can read it |
|---|---|---|
| **Shared library** | Your books, ratings, reviews, tags | Anyone with the library name + password |
| **Community** | Ratings, spice/content tags, reviews, first name | Any signed-in app user |
| **Friends** | Name, who you follow, books finished/rated/reviewed | Anyone you gave your code to |

Your shelves, wishlist, and reading queue never leave the device unless the
shared library is on.

## How access control works

**Firestore rules are the only access control.** The Firebase web config in
`js/firebase-config.js` is public by design — Firebase intends it to be — so
the rules in [SETUP-SYNC.md](../SETUP-SYNC.md) carry the whole load.

They enforce three things:

1. **Signed in.** Every read and write requires a Firebase user. Anonymous
   sign-in happens silently, so nobody makes an account, but the open internet
   can't reach the database.
2. **Ownership.** Community and social documents carry the writer's uid, and
   the rules refuse writes to a document owned by someone else. One person
   can't overwrite another's ratings, reviews, or friend profile.
3. **Size.** Documents are capped at 20 KB, so a bug or a bad actor can't fill
   the free tier.

**Household ids** are derived on-device: PBKDF2, 150,000 iterations, SHA-256,
library name as salt. The password is never transmitted or stored — only the
derived id is, and it can't be reversed. Two households with the same name are
prevented at creation.

## What is *not* protected

- **Codes are bearer credentials.** Anyone holding your library password, or
  your friend code, is you as far as the system is concerned. There is no
  second factor and no way to tell one holder from another. (The optional
  email account in *Settings → Shared library* narrows one consequence of
  this: a linked member who reinstalls signs back in and is recognised by
  uid, instead of re-entering through the bearer-code door. The door itself
  is unchanged for everyone else.)
- **Household members are equal.** Anyone in a shared library can delete any
  book in it. Membership can be removed from the member list, but a device that
  still has the code can rejoin.
- **Community summaries are last-writer-wins**, recomputed client-side by
  whoever rated most recently. A hostile client could publish a wrong average.
- **No moderation.** Reviews and display names are user-written and shown to
  others, with no report, block, or removal path.
- **No rate limiting.** Rules cap document size, not request volume.

## What's been hardened

Not theoretical — each of these was a real defect found by testing, and each
has a suite in `tests/`:

- **Escaping covers attribute context.** `esc()` escapes quotes as well as
  angle brackets, because output lands in `title="…"` and `data-id="…"` as
  often as in text. A book title containing a quote could previously break out
  of its attribute. Titles come from Open Library, not from you.
- **Malformed records can't take down the app.** Every record is normalised on
  read (`db.js`), so a bad import or another member's phone can't blank a
  shelf. Applies to data arriving over sync too.
- **Third-party API responses are filtered and coerced.** One null row in an
  Open Library response used to throw and empty the whole result set.
- **Storage failures are reported, not swallowed.** A full device says so
  instead of pretending the change saved.
- **Firestore document ids are validated**, so an imported book with `/` in its
  id can't produce a malformed path.

Coverage: `tests/bugs1.mjs` (hostile data), `bugs2.mjs` (attribute injection,
corrupt storage, quota), `bugs5.mjs` (malformed records over sync).

## Before anyone outside the family uses this

In order:

1. **Real accounts.** Firebase Auth with Sign in with Apple / Google, replacing
   bearer codes. Rules scope to `request.auth.uid`. This touches `sync.js`,
   `community.js` and `social.js` — the seams are marked in comments.

   *Partially done:* an optional Email/Password credential can now be linked
   to the anonymous account (`sync.js`, "the account"), done the right way —
   `linkWithCredential`, uid preserved — and `requestJoin` recognises a
   returning uid as an existing member. What remains for a public release is
   making accounts mandatory, adding OAuth providers, and scoping the rules
   to uids instead of household knowledge.

   > **Link, don't replace.** Everyone already has an anonymous account, and
   > the rules tie every rating, review and friend profile to its uid. Adding
   > a provider must call `linkWithCredential()` on the *existing* anonymous
   > user, not `signInWithPopup()` on a fresh one. Sign someone in as a new
   > account and they get a new uid — the rules then refuse their own past
   > documents, which presents as their history silently going read-only. It
   > is one function call either way; only one of them is right.
   >
   > Related: leave **auto-deletion of anonymous accounts** switched off in
   > the Firebase console (Authentication → Settings). It purges accounts
   > untouched for 30 days, which would orphan the documents of anyone who
   > hadn't opened the app that month.
   >
   > Sign in with Apple on the web also needs a Services ID, Team ID, Key ID
   > and private key, all of which require a paid Apple Developer membership.
   > Google needs only a support email.
2. **Cloud-authoritative storage**, so no one loses a library to a cleared
   browser.
3. **Moderation**: report, block, and content removal for reviews and names.
4. **Privacy policy, terms, and a real account-deletion path.** Data export
   already exists.
5. **Vendor the ZXing scanner fallback** — it currently loads from a CDN at
   runtime, which is both an availability and a supply-chain concern.
6. **Rate limiting**, via App Check or Cloud Functions.

Items 1–3 are the ones that make it *unsafe* rather than merely imperfect.

## Reporting something

It's a personal project with no security contact. If you're reviewing it and
find something, tell the owner directly.
