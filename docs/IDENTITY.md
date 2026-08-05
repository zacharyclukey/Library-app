# What makes Shelfie Shelfie

Two things live in tension in this app. The aesthetics are meant to be
yours — five of them ship, you can write a sixth, and almost every colour is
a variable you're invited to change. But if *everything* were negotiable
there'd be nothing left underneath: five apps that happen to share a
database.

So a small number of things are held constant across every aesthetic. This
page is what they are, why each one earns its place, and — because that's the
question you'll actually have at 11pm — **which file each thing comes out
of**.

The short version:

| | |
|---|---|
| **The vibe is yours** | colours, fonts, corner roundness, textures, artwork, icon drawings |
| **The identity isn't** | the mark, the book, the fore-edge, the ledge, the checkout card, the brass |

---

## The six constants

### 1. The mark

Two spines, a book leaning with its page ends toward you, and a ledge that
overhangs both ends. The leaning book is the point: it's the one just taken
down or not yet put back, which is the difference between a library and a
shelf in a catalogue photograph. Its fore-edge is also the app's own way in —
see 3.

It keeps **one line weight in every aesthetic**. Every other icon in Shelfie
takes its hand from the skin — Dark Academia draws at 1.55 with square caps,
Cottage Garden at 2.0 and round — but a logo that changed weight between
skins would read as a different logo each time.

- Drawn in **`js/icons.js`**, under the name `mark`
- Its weight is pinned in **`css/identity.css`**, section 1
- The home-screen version is **`assets/brand/app-icon.svg`**

### 2. The book

Covers are 2:3 and carry a shaded gutter down the left edge — the binding
rolling away from you. It costs one pseudo-element and it's the whole
difference between a shelf of books and a grid of thumbnails.

- **`css/identity.css`**, section 2

### 3. The fore-edge

You open a book's actions by its page ends, the stack you'd put a thumb on.
What this replaced was a three-dot button sitting on top of somebody's cover
art — a UI control parked on artwork. The affordance belongs to the object.

The stack sits **behind the cover**, showing only the sliver that clears its
right side. Drawn on top of the artwork it was still a strip of somebody's
cover spent on a control, just quieter about it than the three dots were. The
visible page is what carries the motif; the tap target over it is wider than
the sliver, so it stays a thumb-sized thing to reach for.

- **`css/identity.css`**, section 3

### 4. The ledge

Every row of books stands on a shelf. Rows line up into one continuous ledge
because each cell's ledge reaches halfway into the column gutters.

- **`css/identity.css`**, section 4
- Swap the wood for your own: drop **`assets/shelf.png`**

### 5. The checkout card

Turn a book over and you get the card out of the pocket inside a library
book: card stock, a ruled head naming the book, your marks below.

Everything on it takes its colour from the *stock*, not the theme, and the
stock stays cream in dark mode. That's deliberate — a checkout card is cream
in a dark room too. It's also why the card has its own brass
(`--stock-brass`): the gold that works on a dark themed card would be a pale
wash on cream.

- **`css/identity.css`**, section 5
- The paper grain is **`assets/textures/card-stock.svg`**

### 6. The brass

Ratings are struck in metal, not printed in ink. Each aesthetic picks its own
brass — Reading Room's lamplit gold, Modern's sharper amber — but a star is
never body text.

`--gold` is the bright face of the metal, for fills and dark grounds.
`--gold-ink` is the same metal struck deeper, for glyphs on pale surfaces.
Using `--gold` for a star on `--card` measures between 2.4:1 and 3.5:1
depending on the skin, under the 4.5:1 a text glyph needs; `--gold-ink`
clears it in all five, light and dark.

- **`css/identity.css`**, section 6

---

## How it's held

By load order, in `index.html`:

```
css/styles.css      structure, and the five aesthetics
css/custom.css      YOURS — colours, fonts, corners, textures
css/identity.css    the six things above
```

Later stylesheets win over earlier ones at equal specificity. So your edits in
`custom.css` beat the built-in aesthetics — that's what makes the "Yours" skin
work — and the six constants survive whatever you do there.

That's the entire mechanism. No build step, no CSS layers, nothing clever.

**These rules still use theme variables**, so they follow your palette.
Locked means the shelf is always there, not that it's always brown.

**And you own this repository.** If you genuinely want to change one, edit
`css/identity.css`. The point isn't to stop you — it's that you should be
doing it on purpose, rather than discovering three weeks later that the app
quietly stopped looking like itself.

---

## Where every asset comes from

Everything visible in Shelfie that isn't a book cover, and the exact file it
comes out of.

### Pictures you can drop in

Nothing to edit — put the file in place, refresh, done. Take it away and the
original comes back. If a new file doesn't show up, tap **Settings → Check
for new artwork**.

| What you see | Comes from | Good size |
|---|---|---|
| Mark in the top bar | `assets/logo.png` `.svg` `.jpg` | ~128×128, transparent |
| Texture across the top bar | `assets/header.png` `.jpg` `.webp` | Wide, subtle |
| The ledge under each row | `assets/shelf.png` `.jpg` | ~200×24, tiles sideways |
| Paper behind the page | `assets/paper.png` `.jpg` | Tiles seamlessly |
| Picture on an empty shelf | `assets/empty.png` `.svg` `.jpg` | ~200×200, transparent |

Those five are *discovered* — `js/assets.js` probes for them and remembers
what it found, which is what the Settings button re-triggers. They're styled
in `css/styles.css` (artwork section) and `css/identity.css` (the mark, the
ledge).

Textures are different: the CSS points straight at a fixed path, so you
overwrite the file rather than adding one, and there's nothing to re-check.

| What you see | Comes from |
|---|---|
| Grain on a checkout card | `assets/textures/card-stock.svg` |

### Icons

Every icon is a named slot. Save your drawing as `assets/icons/<name>.svg`
and it replaces the built-in; delete it and the built-in returns. Outlines
with no colours set inherit the palette and the skin's line weight; a
coloured drawing is used exactly as given.

The full list of names is in [ASSETS.md](ASSETS.md). Built-in drawings live
in `js/icons.js`.

`mark` is on that list, and is the one icon that ignores the skin's line
weight. It's also separate from `books` (the Shelves tab) — replacing the tab
icon no longer restyles the brand, and vice versa.

### The home-screen icon

The one asset a person sees *before* the app opens.

| File | What it is |
|---|---|
| `assets/brand/app-icon.svg` | The artwork. Edit this one. |
| `icons/icon-180.png` | Apple touch icon — generated |
| `icons/icon-192.png` | Manifest icon — generated |
| `icons/icon-512.png` | Manifest icon — generated |

To change it: edit the SVG, then run

```
npm run icons
```

which rewrites all three PNGs from it. (They have to exist as files — a
phone's home screen can't be handed an SVG.) Commit the PNGs with the SVG.

Its colours are Reading Room's walnut, parchment and brass, and they're fixed
rather than themed, because a home-screen icon can't follow a setting that
lives inside the app. The splash colours in `manifest.webmanifest` and the
`theme-color` meta in `index.html` match it for the same reason.

### Colours, fonts, shapes

| What | Where |
|---|---|
| The five built-in aesthetics | `css/styles.css`, top of file |
| Your own aesthetic ("Yours") | `css/custom.css`, section 1 |
| Corner roundness, texture switches | `css/custom.css`, section 2 |
| Your own font | `css/custom.css`, section 3 + `assets/fonts/` |
| Which aesthetics appear in Settings | `js/themes.js` |

Adding a sixth aesthetic is two CSS blocks plus one entry in `themes.js`.

The plain-English guide to all of this is [`DESIGN.md`](../DESIGN.md).
