// Inline SVG icon set.
//
// Drawn as strokes with `currentColor`, so icons take their colour from
// whatever they sit in and match every aesthetic for free. Their *character*
// follows the theme too: each skin sets --icon-stroke and --icon-cap in CSS,
// so Reading Room gets a softer, heavier hand, Modern a thin crisp one, and
// so on. Adding an icon here makes it available everywhere via icon("name").
//
// REPLACING ONE
// -------------
// Every icon is a named, swappable asset. Drop a file at
// assets/icons/<name>.svg and it replaces the drawing below — no code change,
// no configuration. `npm start`, look at the app, overwrite the file, refresh.
// Delete the file and the built-in comes back.
//
// The built-ins stay inline rather than living as files so the app paints
// instantly on first load and works offline before anything is fetched; the
// override is looked up once and remembered (see loadIconOverrides).
//
// A replacement should be a plain <svg> with a 24×24 viewBox. Strokes drawn
// in currentColor inherit the palette and the skin's line weight the same way
// the built-ins do; a filled or multi-colour drawing is used exactly as given.
// ICON_NAMES lists every name, and docs/ASSETS.md prints the same list with
// what each one is for.

const PATHS = {
  // The Shelfie mark. Two spines, a book leaning with its page ends toward
  // you, and a ledge that overhangs both ends — the same shelf as the
  // home-screen icon in assets/brand/app-icon.svg, on the same 24x24 grid.
  // The leaning one is a book just taken down; its fore-edge is the same
  // detail the app uses as the way into a card.
  //
  // It is deliberately its own name rather than sharing `books`, which is the
  // icon for the Shelves tab. They looked alike enough to share a slot and
  // never were: replacing the artwork on a tab shouldn't restyle the brand,
  // and putting your own logo in the top bar shouldn't repaint six buttons.
  //
  // Unlike every other icon here, the mark keeps one line weight in all five
  // aesthetics — see css/identity.css. A logo that changed hand between skins
  // would be a different logo each time.
  mark: '<path d="M2.6 20.6h18.8"/><path d="M5 20.6V11.3a1.1 1.1 0 0 1 1.1-1.1h1.4a1.1 1.1 0 0 1 1.1 1.1v9.3"/><path d="M9.5 20.6V8.5a1.1 1.1 0 0 1 1.1-1.1h1.6a1.1 1.1 0 0 1 1.1 1.1v12.1"/><path d="M9.5 16.2h3.8"/><path d="M14.5 20.6l1.05-8.6a1.15 1.15 0 0 1 1.3-1l2.6.32a1.15 1.15 0 0 1 1 1.3L19 20.6z"/><path d="M17.5 20.6l1.4-7.6"/>',

  // The empty shelf. Shelfie's mark is books standing on a ledge, so the
  // picture for having none is the shelving without them — three bare ledges,
  // on feet so it reads as furniture rather than a table or a list icon,
  // with a heavier base plank echoing the one the real shelves stand on.
  // Deliberately empty: the emptiness is the message, and the button beneath
  // it is the invitation.
  emptyShelf:
    '<rect x="4.2" y="3.2" width="15.6" height="16.6" rx="1.3"/>' +
    '<path d="M4.2 8.7h15.6M4.2 14.2h15.6"/>' +
    '<path d="M4.6 19.8h14.8" stroke-width="2.4"/>' +
    '<path d="M7 20.9v.9M17 20.9v.9"/>',

  // shelves & status
  books: '<path d="M4 19V6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v13"/><path d="M9 19V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12"/><path d="M14.5 19 16 7.2a1 1 0 0 1 1.1-.9l2.4.3a1 1 0 0 1 .9 1.1L18.8 19"/><path d="M3 19h18"/>',
  bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/>',
  gift: '<path d="M4 11h16v8.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11z"/><path d="M3.5 7.5h17V11h-17z"/><path d="M12 7.5v13"/><path d="M12 7.5S10.8 4 8.8 4a2 2 0 0 0 0 3.5H12zM12 7.5S13.2 4 15.2 4a2 2 0 0 1 0 3.5H12z"/>',
  bookOpen: '<path d="M12 7.5S10 5.5 4.5 5.5v12C10 17.5 12 19.5 12 19.5s2-2 7.5-2v-12C14 5.5 12 7.5 12 7.5z"/><path d="M12 7.5v12"/>',

  // navigation & actions
  sparkles: '<path d="M12 4.5 13.6 9 18 10.6 13.6 12.2 12 16.7 10.4 12.2 6 10.6 10.4 9z"/><path d="M18 15.5l.7 1.9 1.8.7-1.8.7-.7 1.9-.7-1.9-1.8-.7 1.8-.7z"/>',
  share: '<path d="M12 15.5V4.5"/><path d="m8.2 8.2 3.8-3.7 3.8 3.7"/><path d="M5 13.5v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.3 1.3 0 0 0 .3 1.5l.1.1a1.6 1.6 0 1 1-2.2 2.2l-.1-.1a1.3 1.3 0 0 0-2.2.9v.3a1.6 1.6 0 1 1-3.2 0v-.2a1.3 1.3 0 0 0-2.2-.9l-.1.1a1.6 1.6 0 1 1-2.2-2.2l.1-.1a1.3 1.3 0 0 0-.9-2.2h-.3a1.6 1.6 0 0 1 0-3.2h.2a1.3 1.3 0 0 0 .9-2.2l-.1-.1a1.6 1.6 0 1 1 2.2-2.2l.1.1a1.3 1.3 0 0 0 2.2-.9v-.3a1.6 1.6 0 1 1 3.2 0v.2a1.3 1.3 0 0 0 2.2.9l.1-.1a1.6 1.6 0 1 1 2.2 2.2l-.1.1a1.3 1.3 0 0 0 .9 2.2h.3a1.6 1.6 0 0 1 0 3.2h-.2a1.3 1.3 0 0 0-1.2.9z"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  chevronLeft: '<path d="m14.5 5.5-6 6.5 6 6.5"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',

  // toolbar
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  sliders: '<path d="M4 8h10M18 8h2M4 16h4M12 16h8"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="5" cy="6.5" r="1.1"/><circle cx="5" cy="12" r="1.1"/><circle cx="5" cy="17.5" r="1.1"/>',

  // add flow
  camera: '<path d="M4 8.5h3l1.5-2h7L17 8.5h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.2"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="m4.5 17.5 4.6-4.3a1 1 0 0 1 1.4 0l3 2.8 2-1.8a1 1 0 0 1 1.3 0l2.7 2.4"/>',

  // settings
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5a7 7 0 0 1 14 0"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8"/><path d="M17.5 14.2a6 6 0 0 1 3.5 5.3"/>',
  download: '<path d="M12 4.5v10"/><path d="m8.2 10.8 3.8 3.7 3.8-3.7"/><path d="M5 15.5v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/>',
  headphones: '<path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2"/><path d="M4.5 13.5h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1zM19.5 13.5h-2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1z"/>',
  shield: '<path d="M12 3.8 19 6.4v5c0 4.2-2.9 7.4-7 8.8-4.1-1.4-7-4.6-7-8.8v-5z"/>',
  globe: '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.1 2.3 3.2 5.2 3.2 8.2s-1.1 5.9-3.2 8.2c-2.1-2.3-3.2-5.2-3.2-8.2s1.1-5.9 3.2-8.2z"/>',
  palette: '<path d="M12 3.8a8.2 8.2 0 0 0 0 16.4c1 0 1.6-.7 1.6-1.5 0-.5-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.9.7-1.5 1.6-1.5h1.6a4.4 4.4 0 0 0 4.4-4.4c0-3.8-3.7-6.8-8.2-6.8z"/><circle cx="8" cy="11" r="1.1"/><circle cx="12" cy="8" r="1.1"/><circle cx="16" cy="11" r="1.1"/>',

  // content & audience — replacing the emoji these used to be
  // A chilli read as a stray "5" at badge size — its outline is a crescent,
  // and a crescent is a digit before it is a vegetable. A flame survives the
  // shrink because nothing else in the set is a teardrop.
  flame: '<path d="M12 2.6C10.6 6.6 6.2 9 6.2 13.6a5.8 5.8 0 0 0 11.6 0c0-4-3.2-5.6-5.8-11z"/><path d="M12 11.8c1.5 1.9 2.2 3 2.2 4.1a2.2 2.2 0 0 1-4.4 0c0-1.1.7-2.2 2.2-4.1z"/>',
  teddy: '<circle cx="12" cy="13.6" r="6"/><circle cx="6.6" cy="6.9" r="2.7"/><circle cx="17.4" cy="6.9" r="2.7"/><circle cx="9.9" cy="12.4" r=".9"/><circle cx="14.1" cy="12.4" r=".9"/>',
  sprout: '<path d="M12 20v-7"/><path d="M12 13C12 9.7 9.6 7 6.5 7c0 3.3 2.4 6 5.5 6z"/><path d="M12 13c0-2.8 2-5 4.6-5 0 2.8-2 5-4.6 5z"/>',
  mature: '<circle cx="12" cy="12" r="8.4"/><path d="m6.1 17.9 11.8-11.8"/>',
  print: '<path d="M5.5 4.5h9a2 2 0 0 1 2 2v13H7.5a2 2 0 0 1-2-2z"/><path d="M16.5 6.5h2a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2"/><path d="M8.5 8.5h5M8.5 11.5h5"/>',
  tablet: '<rect x="6.5" y="3.5" width="11" height="17" rx="1.8"/><path d="M10.8 17.6h2.4"/>',
  party: '<path d="m4.5 19.5 4-11 7 7z"/><path d="M14 4.5v2M18.5 6l-1.4 1.4M20 11h-2"/>',
  alert: '<path d="M12 4.8 20.5 19H3.5z"/><path d="M12 10v4"/><circle cx="12" cy="16.6" r=".9"/>',
  store: '<path d="M4.5 9.5h15v9a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/><path d="M4 9.5 5.6 5a1 1 0 0 1 .9-.5h11a1 1 0 0 1 .9.5L20 9.5"/><path d="M9.5 19.5v-5h5v5"/>',
  bell: '<path d="M12 4.5a5.5 5.5 0 0 1 5.5 5.5c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5A5.5 5.5 0 0 1 12 4.5z"/><path d="M10.3 18.5a1.8 1.8 0 0 0 3.4 0"/>',
  clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3 1.8"/>',
  save: '<path d="M5.5 4.5h10l4 4v11a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z"/><path d="M8 4.5v5h7"/><rect x="8" y="13" width="8" height="6.5"/>',
  quote: '<path d="M20.5 5.5H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2.5v3.5l4-3.5h8a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z"/>',
  chart: '<path d="M4.5 19.5h15"/><rect x="6.5" y="11" width="3" height="6"/><rect x="11" y="7" width="3" height="10"/><rect x="15.5" y="13.5" width="3" height="3.5"/>',
  page: '<path d="M6.5 3.5h7l4.5 4.5v12a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M13.5 3.5V8H18"/>',
  ribbon: '<path d="M8 3.5h8v13l-4-2.6-4 2.6z"/>',
  trash: '<path d="M5 7h14"/><path d="M10 7V5.6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V7"/><path d="M6.6 7l.8 11.6a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L18 7"/><path d="M10.4 10.6v5.8M13.6 10.6v5.8"/>',
};

// ---------- swapped-in replacements ----------

const OVERRIDE_KEY = "shelfie.iconFiles.v1";
const RECHECK_MS = 12 * 3600 * 1000;

// name -> full <svg> markup read from assets/icons/<name>.svg
const overrides = new Map();

function iconUrl(name) {
  return `assets/icons/${name}.svg`;
}

// Fetch one file, keeping only what's inside <svg>. Anything unparseable is
// ignored rather than allowed to draw nothing.
async function readIconFile(name) {
  try {
    const res = await fetch(iconUrl(name), { cache: "no-cache" });
    if (!res.ok) return null;
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg || doc.querySelector("parsererror")) return null;
    return {
      inner: svg.innerHTML,
      viewBox: svg.getAttribute("viewBox") ?? "0 0 24 24",
      // A drawing that states its own colours is used exactly as given; one
      // that states none is treated like a built-in and takes the palette.
      // Guessing this beats asking, since the whole point is that dropping a
      // file in is the entire procedure.
      styled: [svg, ...svg.querySelectorAll("*")].some(
        (el) =>
          (el.getAttribute("fill") && el.getAttribute("fill") !== "none") ||
          el.getAttribute("stroke") ||
          el.hasAttribute("style") ||
          el.hasAttribute("class")
      ),
    };
  } catch {
    return null;
  }
}

// Which names have a file, remembered so the folder isn't swept on every
// launch — the same approach js/assets.js uses for artwork. Files that were
// found last time are re-read (they're tiny, and it means editing one takes
// effect immediately); the full sweep runs twice a day or on demand.
export async function loadIconOverrides({ force = false } = {}) {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(OVERRIDE_KEY));
  } catch { /* first run */ }
  const known = Array.isArray(saved?.names) ? saved.names : [];
  const fresh = saved && Date.now() - (saved.at ?? 0) < RECHECK_MS;

  // Usually only the handful of names that had a file last time are read, so
  // editing one takes effect on the next launch. The full sweep — which is
  // what notices a *new* file — runs twice a day, or on demand from Settings.
  const sweeping = force || !fresh;
  const reading = sweeping ? ICON_NAMES : known;

  const names = [];
  await Promise.all(
    reading.map(async (name) => {
      const found = await readIconFile(name);
      // Read every time rather than trusting what's already loaded: deleting
      // a file has to put the built-in back, and that only shows up as a name
      // that has stopped resolving.
      if (found) {
        overrides.set(name, found);
        names.push(name);
      } else {
        overrides.delete(name);
      }
    })
  );

  // Only a full sweep may write the memo. Refreshing the timestamp after a
  // partial read would keep pushing the sweep into the future, and a new file
  // would never be found.
  if (sweeping) {
    try {
      localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ at: Date.now(), names }));
    } catch { /* storage full — swept again next launch */ }
  }
  return names;
}

export function refreshIconOverrides() {
  return loadIconOverrides({ force: true });
}

// One <svg> per call; `cls` lets callers size or nudge individual icons.
export function icon(name, cls = "") {
  const swapped = overrides.get(name);
  if (swapped) {
    const own = swapped.styled ? " ico-file" : "";
    return `<svg class="ico${own} ${cls}" viewBox="${swapped.viewBox}" aria-hidden="true" focusable="false">${swapped.inner}</svg>`;
  }
  const path = PATHS[name];
  if (!path) return "";
  return (
    `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`
  );
}

export const ICON_NAMES = Object.keys(PATHS);
