// Inline SVG icon set.
//
// Drawn as strokes with `currentColor`, so icons take their colour from
// whatever they sit in and match every aesthetic for free. Their *character*
// follows the theme too: each skin sets --icon-stroke and --icon-cap in CSS,
// so Reading Room gets a softer, heavier hand, Modern a thin crisp one, and
// so on. Adding an icon here makes it available everywhere via icon("name").

const PATHS = {
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
  flame: '<path d="M12 3.5s5 4.2 5 8.6a5 5 0 0 1-10 0c0-1.7.8-3.2 1.7-4.4.3 1.2 1 2 1.8 2.3.3-2.6.9-4.7 1.5-6.5z"/>',
  shield: '<path d="M12 3.8 19 6.4v5c0 4.2-2.9 7.4-7 8.8-4.1-1.4-7-4.6-7-8.8v-5z"/>',
  globe: '<circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.1 2.3 3.2 5.2 3.2 8.2s-1.1 5.9-3.2 8.2c-2.1-2.3-3.2-5.2-3.2-8.2s1.1-5.9 3.2-8.2z"/>',
  palette: '<path d="M12 3.8a8.2 8.2 0 0 0 0 16.4c1 0 1.6-.7 1.6-1.5 0-.5-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.9.7-1.5 1.6-1.5h1.6a4.4 4.4 0 0 0 4.4-4.4c0-3.8-3.7-6.8-8.2-6.8z"/><circle cx="8" cy="11" r="1.1"/><circle cx="12" cy="8" r="1.1"/><circle cx="16" cy="11" r="1.1"/>',
};

// One <svg> per call; `cls` lets callers size or nudge individual icons.
export function icon(name, cls = "") {
  const path = PATHS[name];
  if (!path) return "";
  return (
    `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${path}</svg>`
  );
}

export const ICON_NAMES = Object.keys(PATHS);
