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

## Fonts

Font files go in `assets/fonts/`. Then uncomment the font block in
`css/custom.css` and point it at your file. `.woff2` is the format to use —
it's the smallest and every phone reads it.

## After adding a file

Commit and push. Your phone picks it up the next time you open the app
(sometimes one launch later, since the previous version is cached so the app
still opens offline).
