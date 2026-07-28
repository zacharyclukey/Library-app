# Making Shelfie yours

Everything personal lives in **two places**. You never need to touch anything
else, and app updates won't overwrite either of them.

| What | Where | What it's for |
|---|---|---|
| Pictures | `assets/` | Logo, textures, artwork — just drop files in |
| Colours, fonts, shapes | `css/custom.css` | One file, heavily commented, all yours |

There's no build step and nothing to install. Change a file, push it, and the
app updates.

---

## The fastest possible change: pictures

Drop a file into `assets/` with the right name and it appears. That's it —
no code at all.

- `assets/logo.png` → your mark in the top bar
- `assets/header.png` → a texture across the top bar
- `assets/shelf.png` → the ledge each row of books sits on
- `assets/paper.png` → texture behind the page
- `assets/empty.png` → the picture on an empty shelf

Full sizes and tips: [`assets/README.md`](assets/README.md).

Miss one out and the app keeps its normal look for that piece, so you can do
them one at a time and see how each lands.

---

## Colours: your own aesthetic

Settings → Aesthetic has a fifth option, **Yours**. Its colours live in
`css/custom.css` and start as a soft neutral palette, so it works before you
touch it.

Open `css/custom.css`, find section 1, and change any colour. The lines are
labelled in plain English:

```css
--bg: #f2eee9;      /* the page behind everything */
--card: #fdfbf8;    /* book cards, panels, sheets */
--accent: #6a5a48;  /* buttons, selected tab, active chips */
```

Change `--accent` alone and you'll see a real difference — it's the colour on
every button and active control.

### Picking colours

Grab hex codes (`#6a5a48`) from anywhere: a photo, [coolors.co](https://coolors.co),
a paint chip. The rules of thumb that keep it readable:

- `--ink` on `--bg` needs strong contrast. Very dark text on very light page,
  or the reverse. If you have to squint, it's wrong.
- `--accent-ink` sits **on top of** `--accent`, so those two must contrast
  hard. Dark accent → near-white ink. Light accent → near-black ink.
- `--accent-soft` should be a barely-there tint of `--accent`, not a bold
  version of it.

### Dark mode

Section 1 has a second block for dark. If you only do the light one, dark
mode still works — it just stays on the neutral defaults. Worth doing
eventually if you or Kelsey use Auto brightness.

---

## Fonts

1. Put the font file in `assets/fonts/` — `.woff2` is the format you want.
2. In `css/custom.css`, find section 3 and uncomment the block.
3. Change `MyFont.woff2` to your file's actual name, in both places.

`--serif` is the display font (book titles, headings, the app name).
`--sans` is everything else. Setting only `--serif` is often the better-looking
choice — it changes the character without hurting readability.

[Google Fonts](https://fonts.google.com) lets you download real files with the
"Download family" button. If you get a `.ttf`, convert it to `.woff2` at
[cloudconvert.com](https://cloudconvert.com) — much smaller, so the app stays
quick.

---

## Shapes and texture

Section 2 of `css/custom.css` has ready-made switches. Uncomment to use:

- **Corner roundness** — `4px` for crisp and modern, `22px` for soft and
  friendly.
- **Flat header** — removes the wood-grain stripes from the top bar.
- **No paper texture** — a perfectly clean background.
- **No glow** — removes the warm light at the top of the page.

---

## How to turn a line on

Everything optional in `css/custom.css` is *commented out* — wrapped in `/*`
and `*/`, which means "ignore this". To switch it on, delete those two marks:

```css
/* off
:root { --header-grain: none; }
*/
```

```css
/* on */
:root { --header-grain: none; }
```

To switch it back off, put the marks back. Nothing you do here can break the
app — worst case a colour looks wrong, and you change it again.

---

## Seeing your changes

**On a computer**, from the project folder:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000> in a browser. Edit, save, refresh. This is
by far the fastest way to try things — no pushing, no waiting.

**On your phone**: commit and push, wait about a minute for GitHub Pages, then
reopen the app. It sometimes takes one extra launch, because the last version
is cached so the app opens instantly with no signal.

---

## If something looks broken

Undo your last change and refresh. If you'd rather start clean, `css/custom.css`
can be emptied entirely — the app falls back to its built-in look, and the
"Yours" aesthetic simply matches the defaults until you fill it in again.

Nothing in `assets/` is required either. Delete a file and that piece goes back
to normal.
