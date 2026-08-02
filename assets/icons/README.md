# assets/icons/ — replace any icon

One file per icon, named after the slot it fills:

```
assets/icons/flame.svg      replaces the flame (spice, explicit)
assets/icons/books.svg      replaces the shelves icon
assets/icons/gear.svg       replaces the settings icon
```

Every name, and where each one shows up, is listed in
[`../../docs/ASSETS.md`](../../docs/ASSETS.md).

## What the file should be

A plain `<svg>` with a `viewBox`. The built-ins use `0 0 24 24`; yours can use
any square viewBox and it's respected.

- **Outlines with no colours set** → your drawing takes the app's palette and
  each aesthetic's line weight, exactly like the built-ins. Usually what you
  want.
- **Coloured in** (any `fill`, `stroke` or `style` on the drawing) → used
  exactly as given, in every aesthetic.

```svg
<svg viewBox="0 0 24 24">
  <path d="M12 3 19 6.5v5c0 4-2.9 7.4-7 8.8-4.1-1.4-7-4.8-7-8.8v-5z"/>
</svg>
```

Delete the file and the built-in drawing comes back. Nothing here can break
the app — a file that's missing, misnamed or malformed is skipped.
