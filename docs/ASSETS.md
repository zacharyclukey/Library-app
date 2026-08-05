# Making it yours

Everything you see in Shelfie that isn't a book cover is a file you can
replace. No code, no build step, no configuration — put a file in the right
place with the right name and the app uses it. Take the file away and the
original comes back.

This page is the whole list: what each slot is, what it's called, and what
size works.

## How replacing anything works

1. Put your file in the `assets/` folder, named exactly as listed below.
2. Refresh the app.
3. Don't like it? Delete the file, refresh again. You're back to stock.

If a new file doesn't show up, open **Settings → Check for new artwork**. The
app remembers what it found rather than hunting for dozens of files on every
launch, and that button tells it to look again right now.

Nothing here can break the app. A file that's missing, misnamed, or corrupt is
skipped and the built-in version is used instead.

## Pictures

Drop any one of the listed names — the first one that exists wins, so
`logo.png` beats `logo.svg` if you have both.

| What it is | File | What works well |
| --- | --- | --- |
| Your mark in the top bar | `assets/logo.png` `.svg` `.jpg` | Square-ish, transparent background, around 128×128 |
| Texture across the top bar | `assets/header.png` `.jpg` `.webp` | Something subtle — linen, marbled paper, wood. It sits over the header colour |
| The ledge each row of books sits on | `assets/shelf.png` `.jpg` | A narrow strip that tiles left-to-right, around 200×24 |
| Paper texture behind the page | `assets/paper.png` `.jpg` | Must tile seamlessly, or the seams will show |
| The picture on an empty shelf | `assets/empty.png` `.svg` `.jpg` | Around 200×200, transparent background |

## Icons

Every icon in the app is a named slot. To replace one, save your drawing as
`assets/icons/<name>.svg` — so your own flame goes at
`assets/icons/flame.svg`.

A replacement should be a plain `<svg>` with a `viewBox` (24×24 is what the
built-ins use, but any square viewBox works — yours is respected). If it's
drawn in `currentColor` strokes it picks up the palette and each skin's line
weight automatically, exactly like the built-ins. A filled or multi-colour
drawing is used as-is.

### The mark

| Name | Where it appears |
| --- | --- |
| `mark` | The Shelfie mark in the top bar, and on an empty shelf |

This one behaves slightly differently from the rest: it keeps a single line
weight in every aesthetic, where other icons follow the skin's hand. See
[IDENTITY.md](IDENTITY.md) for why, and for the home-screen icon, which is a
separate asset entirely.

### Shelves & status

| Name | Where it appears |
| --- | --- |
| `books` | The Shelves tab, and the "Series, grouped" sort |
| `bookmark` | To Read |
| `check` | Finished |
| `gift` | Wishlist |
| `bookOpen` | Currently reading |

### Getting around

| Name | Where it appears |
| --- | --- |
| `sparkles` | The Discover tab |
| `share` | The Export tab |
| `gear` | The Settings tab |
| `plus` | The big add button |
| `chevronLeft` | Back |
| `close` | Closing a sheet or dialog |
| `more` | The quick-actions button on a book |

### Toolbar

| Name | Where it appears |
| --- | --- |
| `search` | Search |
| `sliders` | Filters |
| `grid` | Grid view |
| `list` | List view |

### Adding a book

| Name | Where it appears |
| --- | --- |
| `camera` | Scan a barcode |
| `image` | A book with no cover |

### Settings & elsewhere

| Name | Where it appears |
| --- | --- |
| `user` | Your profile |
| `users` | Household members, friends |
| `download` | Import / backup |
| `headphones` | Audiobook |
| `print` | Print book |
| `tablet` | E-book |
| `shield` | SFW |
| `globe` | Language |
| `palette` | Themes and skins |
| `bell` | Notifications |
| `save` | Saving |
| `quote` | Reviews |
| `chart` | Reading stats |
| `page` | Page counts |
| `alert` | A warning |
| `trash` | Remove a book from your library |

Four more are drawn and ready but not on screen yet — `store`, `clock`,
`ribbon` and `party`. They're listed here so the set stays complete; replacing
one now works, it just won't show up until the part of the app that uses it
lands.

### Content tags

| Name | Where it appears |
| --- | --- |
| `teddy` | Kids |
| `sprout` | Teen |
| `mature` | Mature |
| `flame` | Explicit, and the spice scale |

## Colours

Colours live in `css/custom.css`. That file is yours — nothing else writes to
it, and it loads last, so anything you put there wins.

It ships with the **Yours** skin already set up and every value commented, so
you can change one line, refresh, and see what moved. If you make a mess of
it, delete everything in the file and the app falls back to the stock skins.

## Textures

`assets/textures/` holds the pattern files the design itself uses — the card
stock behind a flipped book, for instance. They're SVG, so they stay crisp at
any size and are small enough to edit in a text editor. Replacing one is the
same deal: same name, same folder.

| File | What it is |
| --- | --- |
| `assets/textures/card-stock.svg` | The paper grain on the back of a book card |

## The home-screen icon

The icon you tap to open Shelfie is the one asset that isn't picked up
automatically, because a phone's home screen can't be handed an SVG.

| File | What it is |
| --- | --- |
| `assets/brand/app-icon.svg` | The artwork — edit this one |
| `icons/icon-180.png` | Apple touch icon — generated |
| `icons/icon-192.png` | Manifest icon — generated |
| `icons/icon-512.png` | Manifest icon — generated |

Edit the SVG, then run `npm run icons` to rewrite all three PNGs from it, and
commit them together.

## A note on sizes

Nothing here has to be exact. Images are scaled to fit their slot, so a logo
that's 400×400 works fine — it'll just be a slightly bigger download than it
needs to be. The sizes above are what looks sharpest without wasting space.
