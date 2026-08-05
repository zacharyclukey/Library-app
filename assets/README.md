# assets/ — drop your pictures here

Put a file in this folder using one of the exact names below and it shows up
in the app. Nothing to edit, no code to write. Leave a slot empty and the
app keeps its normal look, so you can do one at a time.

| File name | Where it shows up | What works well |
|---|---|---|
| `logo.png` | The mark next to "Shelfie" in the top bar | Square, transparent background, at least 120×120 |
| `header.png` | A texture across the top bar | Wide and subtle — linen, paper, wood. It sits at 35% strength over the header colour |
| `shelf.png` | The ledge each row of books sits on | A narrow strip that tiles side to side, around 200×24 |
| `paper.png` | Texture behind the whole page | Must tile seamlessly, and stay faint |
| `empty.png` | The picture on an empty shelf | Square, roughly 300×300 |

`.jpg` works anywhere `.png` does. `logo` and `empty` can also be `.svg`.

**Keep them small.** Under ~200 KB each. These load on every launch, and the
app is meant to open instantly even with no signal.

## Textures

`textures/` holds the surfaces the app draws on — paper grain, card stock, wood.
Same rule as above: overwrite the file at its exact path and the app uses your
version. Keep them seamlessly tileable and low-contrast, since text sits on top.

| File | Where it shows up |
|---|---|
| `textures/card-stock.svg` | The paper grain on a book's checkout card |

More arrive as the aesthetic work lands; every one of them is a file you can
replace rather than something baked into the code.

## Brand

`brand/` holds the artwork that stays the same whichever aesthetic you're in.

| File | Where it shows up |
|---|---|
| `brand/app-icon.svg` | The icon on your home screen |

Unlike everything else here it isn't picked up automatically — a phone can't
be handed an SVG. Edit it, then run `npm run icons` to rewrite
`icons/icon-180.png`, `icon-192.png` and `icon-512.png` from it.

The mark *inside* the app is a drawing rather than a file; replace it at
`icons/mark.svg` like any other icon. Why these two are separate, and what
else holds steady across aesthetics: [`../docs/IDENTITY.md`](../docs/IDENTITY.md).

## Icons

`icons/` replaces the app's own icons, one file per name. Save your drawing as
`icons/<name>.svg` — `icons/flame.svg` replaces the flame, and so on. Delete
the file and the built-in drawing comes back.

Every name, and where each one appears: [`../docs/ASSETS.md`](../docs/ASSETS.md).

## Fonts

Font files go in `assets/fonts/`. Then uncomment the font block in
`css/custom.css` and point it at your file. `.woff2` is the format to use —
it's the smallest and every phone reads it.

## After adding a file

Commit and push, then refresh the app. Anything in this folder is fetched
fresh rather than served from the offline cache, so a file you changed or
deleted takes effect straight away. If the app doesn't notice a *new* file,
tap **Settings → Check for new artwork** — it only hunts for files it hasn't
seen twice a day, and that button tells it to look now.
