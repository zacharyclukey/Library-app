# How Shelfie works — a tour for anyone

Written for someone who doesn't write code. If you're a programmer, read
[ARCHITECTURE.md](ARCHITECTURE.md) instead — it's the same story with the
technical detail left in.

---

## The one-sentence version

Shelfie is a **web page that behaves like an app**. It lives in a folder of
plain files, GitHub serves those files at a web address, and your phone saves a
copy so it opens instantly even with no signal.

There's no server doing any thinking. Everything happens on the phone.

---

## Where your books actually live

**On your phone, in the browser's own storage.** Not in the cloud, unless you
switch on the shared library.

That's why the app works on a plane, and why it's fast. It's also the thing to
understand about the risks: if you clear your browser data, the books go with
it. Two protections exist —

- **Export** (bottom nav) writes your whole library to a file you can keep.
- **Shared library** (Settings) copies everything to Google's Firebase, so two
  phones stay in step and each is a backup of the other.

## What happens when you scan a book

1. The camera reads the barcode — that's the ISBN, the number for one specific
   printing of one specific book.
2. The app asks **Open Library** (a free, public book database) what that number
   is. If it doesn't know, it asks **Google Books** instead.
3. What comes back is the *edition*: this cover, this page count, this
   publisher — not just "a copy of Dune somewhere".
4. If you already have that book, the app says so rather than adding a second
   one.
5. You pick a shelf. Done.

Nothing about this costs money, and neither database needs an account.

## The four shelves

**Owned, To Read, Finished, Wishlist.**

The one non-obvious rule: *owning* a book is a property of the book, not a
place it sits. A book you own that's also on To Read shows up on **both**
shelves. So the Owned shelf is always your complete collection, and To Read is
always your actual queue.

## What each screen does

| Screen | What it's for |
|---|---|
| **Shelves** | Your books. Search, sort, filter, select several at once |
| **Discover** | Book suggestions built from what's already on your shelves |
| **＋** | Add a book — scan, photograph, or search |
| **Export** | Save or print a shelf; back up everything |
| **Settings** | Look and feel, profiles, sharing, friends, your reading stats |

## The bits worth knowing about

**Tap a book** to open its full page. **Tap the ⋯** (or press and hold) to flip
the cover over — rating, and the actions you reach for most. Moving a book
between shelves from there takes **two taps**: the first arms the button, the
second does it. That's deliberate, so a stray thumb never reorganises your
shelf.

**Everything can be undone.** Every action puts a message at the bottom of the
screen with an **Undo** button for a few seconds. Nothing asks "are you sure?"
because nothing needs to.

**Series.** The app checks whether each book belongs to a series and tells you
what you're missing. When the databases don't know — common for indie and
self-published books — you can tell it yourself in the book's page, and that
sticks.

**Nothing feels like homework.** There's no "you have 14 books to rate" counter
anywhere. At most one unrated book is ever offered, and waving it off keeps it
quiet for days.

## Sharing, and who can see what

Three separate things, all **off until you turn them on**:

1. **Shared library** — you and Kelsey edit the same collection. Set up with a
   library name and password.
2. **Community** — your ratings and reviews join a shared pool that improves
   everyone's recommendations.
3. **Friends** — follow people by swapping codes. Their reading shows in a feed,
   and their taste weighs heaviest in your recommendations.

Your reading history never leaves the phone unless you switch one of these on.

## What it costs

Nothing, and that's a design constraint rather than an accident:

- **GitHub Pages** hosts the files — free.
- **Open Library** and **Google Books** provide book data — free, no account.
- **Firebase** does the syncing — free tier, which is far more than a family
  will ever use.

---

## The files, in plain English

Everything sits in one folder. The parts you'd ever touch are at the top.

| File or folder | What it is |
|---|---|
| `assets/` | **Yours.** Drop in a logo or textures — see `assets/README.md` |
| `css/custom.css` | **Yours.** Your colours, fonts, and tweaks |
| `DESIGN.md` | How to change the look, step by step |
| `index.html` | The page skeleton — every screen and button lives here |
| `css/styles.css` | All the styling for the app itself |
| `js/app.js` | The big one: what happens when you tap things |
| `js/db.js` | Saving and loading your books |
| `js/api.js` | Talking to Open Library and Google Books |
| `js/scanner.js` | Reading barcodes from the camera |
| `js/filters.js` | Searching, filtering, sorting |
| `js/themes.js` | The five aesthetics and light/dark |
| `js/sync.js` | The shared library |
| `js/community.js` | Shared ratings and reviews |
| `js/social.js` | Following, friends, the feed |
| `js/export.js` | Making printable pages, spreadsheets, backups |
| `js/icons.js` | The little drawings on the buttons |
| `js/assets.js` | Notices your artwork and uses it |
| `sw.js` | The bit that makes it work offline |
| `tests/` | Automated checks — see below |
| `docs/` | This folder |

## The tests

`tests/` holds around thirty automated checks. Each one opens the real app in an
invisible browser, taps through it like a person, and reports what it found.
They're what catches a change breaking something two screens away.

To run them you need [Node.js](https://nodejs.org) installed, then in a terminal
from the project folder:

```
npm install        # once
npm test           # runs everything
npm test regress   # runs one
```

You don't need to understand them to use the app. They're there so that when
you hand this to a programmer, they can change something and immediately know
whether they broke it.

## If you want to try changes yourself

```
npm start
```

Then open <http://localhost:8765>. Edit a file, save, refresh the browser. This
is a private copy on your own machine — nothing you do here reaches your phone
until you commit and push.

## Handing this to a programmer

Point them at [ARCHITECTURE.md](ARCHITECTURE.md) for how it's built,
[DECISIONS.md](DECISIONS.md) for *why* it's built that way, and
[SECURITY.md](SECURITY.md) for the honest account of what's protected and what
isn't. Those three files exist so nobody has to reverse-engineer reasoning from
the code.
