# Getting onto the App Store

The road from "a web page that behaves like an app" to a real listing on the
App Store and Google Play — what it costs, what it involves, and what we have to
keep doing *now* so the port stays a fortnight's work instead of a rewrite.

Nothing here needs doing yet. It exists so that the day the owner decides to
spend money, the answer is a checklist rather than a research project.

Costs and store rules move. Verify every figure and every guideline number
before acting on it.

---

## The short version

**Wrap the existing app with [Capacitor](https://capacitorjs.com).** Don't
rewrite it. The app becomes a real native binary — App Store and Play Store
listings, home-screen icon, native camera, native storage — while the thing you
edit stays exactly the folder of plain files it is today.

Rough shape of the work: **a fortnight of focused effort**, most of it on store
paperwork rather than code. Ongoing cost is a hundred dollars a year plus a way
to build for iOS.

---

## Why Capacitor and not the alternatives

| Option | Verdict |
|---|---|
| **Capacitor** | **Recommended.** Points at a folder of static files and produces Xcode and Android Studio projects. Our whole app *is* that folder. Native plugins available exactly where the web falls short — camera, storage, share, haptics — each swappable behind the module boundaries we already keep. |
| **PWABuilder / bare PWA wrapper** | Cheaper and faster, real rejection risk. Apple's review guidelines treat an app that is only a repackaged website as failing the minimum-functionality bar. Capacitor clears it *because* real native plugins do real native work. |
| **React Native / Flutter rewrite** | Rejected. Throws away 20,000 working lines, contradicts the no-build-step decision the project rests on, and buys nothing a wrapper doesn't. |
| **Stay a PWA, install from the browser** | What we do today, and it works. But there's no store presence, no discovery, no way to charge, and iOS is the platform where installed-web-app storage is least durable. |

---

## What it costs

**Money, per year:**

- Apple Developer Program — around **$99/year**. Required to ship to iPhones at
  all, including to yourself beyond a seven-day test build.
- Google Play Console — around **$25, one time**.
- A Mac, or a cloud Mac / CI service, to build and submit the iOS app. This is
  the one that surprises people. If there's no Mac in the house, budget a
  hosted-build service.
- Optional: a domain and a landing page. Cheap, but a privacy policy has to be
  hosted *somewhere* — both stores require a public URL.

**Time:** the code is the small part.

| Work | Effort |
|---|---|
| Capacitor init, iOS + Android projects building | a day |
| Native barcode scanning behind `scanner.js` | 2–3 days |
| Native storage behind the `shelfie.*` keys | 2–3 days |
| Icons, splash screens, permission strings | a day |
| Privacy policy, data-safety disclosures, store copy, screenshots | 3–4 days |
| First submission and the review round-trip | a week of waiting, some of it iterating |

---

## What the port actually involves

**1. Wrap it.**

```bash
npm i @capacitor/core @capacitor/cli
npx cap init          # webDir: the repo root — the app is already the payload
npx cap add ios android
```

At this point the app runs in a native shell, essentially unchanged. Everything
below is upgrading web fallbacks to native ones.

**2. Native barcode scanning.** Swap the internals of `js/scanner.js` for
Google's ML Kit barcode plugin, keeping `scanImageFile`, `startLiveScan` and
`stopLiveScan` exactly as they are exported today. One file, because nothing
else in the app touches the camera.

This is also the biggest *quality* win of going native. Our own `ean13.js`
reader is what makes scanning work on iPhone at all — iOS Safari has no
`BarcodeDetector` — but ML Kit reads creased, angled, glossy and partially
shadowed barcodes far better than a line-sweep in JavaScript can. Keep
`ean13.js` regardless: it stays the reader for the web build, and the shared
test suite keeps both honest.

**3. Native storage.** This is the one that fixes a real risk rather than adding
polish. Web storage on iOS is evictable — an installed app that goes unopened
can have its library cleared by the operating system.
`navigator.storage.persist()` mitigates it and does not solve it. A native store
ends the problem outright.

The migration is small **because of a rule we already keep**: all 29 keys are
namespaced `shelfie.<thing>.v1`, and the library itself is reachable only
through `db.js`. So it's one shim that iterates the `shelfie.` prefix on first
launch, plus a swap of the persistence calls inside `db.js`. Nothing else in the
app learns that storage changed.

**4. Permissions and store paperwork.**

- Camera usage description strings (iOS `Info.plist`, Android manifest). iOS
  rejects builds whose strings don't say *why* in plain language.
- Icons and splash screens — `scripts/make-icons.mjs` already generates the
  icon set.
- Data-safety and privacy-nutrition disclosures. We're unusually well placed
  here: [`SECURITY.md`](SECURITY.md) already states exactly what leaves the
  phone under each of the three opt-ins, in a table. It converts almost
  line-for-line into what the stores ask for.
- **If email linking is offered in-app, an in-app account deletion path is
  mandatory** under Apple's rules. We currently offer linking. This is a real
  code item, not paperwork — plan for it.

---

## What to protect now, so this stays cheap

Every one of these is already a rule in [`../CLAUDE.md`](../CLAUDE.md). This is
*why* they're rules — each one is a day of native porting that we don't have to
do.

- **Books reach storage only through `db.js`**, and every other piece of state
  is one namespaced `shelfie.*` key. → storage migration is a shim, not a hunt.
- **Camera access lives only in `scanner.js`.** → ML Kit is a one-file swap.
- **Network calls stay in `api.js` and the Firebase modules.** → nothing to
  audit when the origin changes.
- **All paths relative.** → a native shell serves from `capacitor://localhost`;
  an absolute URL to the deployed origin breaks silently in the wrapper and
  works fine in every test we run.
- **Feature-detect, always.** The service worker, `BarcodeDetector`,
  `navigator.storage`, `share` — a native shell has a different set of these
  than a browser does. Nothing should assume.
- **Keep using `<dialog>` and `env(safe-area-inset-*)`.** Both work correctly in
  the native web view, and both are already in place — `viewport-fit=cover` is
  set and the safe-area insets are honoured throughout `styles.css`. Notched
  phones are handled today.
- **No build step.** The moment a bundler is required, "point Capacitor at the
  folder" stops being true and this whole document gets more expensive.

---

## What should be true before spending the money

Ordered. Don't buy a developer account before the first three are done.

1. **Accessibility audit passed.** Focus management in dialogs, screen-reader
   labelling, contrast. Currently unaudited, and app review does look.
2. **An import path from Goodreads or StoryGraph exists.** Shipping a library
   app that can't accept an existing library wastes the launch. See
   [`PRODUCT.md`](PRODUCT.md).
3. **The identity model is settled.** Bearer codes are right for a family and
   explicitly not right for strangers — [`SECURITY.md`](SECURITY.md) says so.
   A public listing needs that answered, and the account layer that already
   exists is most of it.
4. **CI runs the test suite on every merge.** Manual test runs are fine for one
   maintainer; they aren't fine when a bad merge means a week of store review.
5. **Screenshots that make someone want it**, and a privacy policy at a real
   URL.
6. **A decision about money** — free, paid once, or a tier. This changes the
   store listing, the account model, and possibly the sync architecture, so it
   should be answered before submission rather than after.
