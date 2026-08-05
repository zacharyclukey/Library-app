// Shelf exports: a printable/shareable page, a plain-text list, a CSV for
// spreadsheets, and the raw JSON backup.

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const fmtDate = (d = new Date()) =>
  d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

function yearOf(b) {
  const m = String(b.publishDate ?? "").match(/\d{4}/);
  return m ? m[0] : "";
}

export function stats(books) {
  const pages = books.reduce((n, b) => n + (Number(b.pageCount) || 0), 0);
  const authors = new Set();
  const series = new Set();
  books.forEach((b) => {
    (b.authors ?? []).forEach((a) => authors.add(a));
    if (b.series?.name) series.add(b.series.name);
  });
  return { count: books.length, pages, authors: authors.size, series: series.size };
}

export function summaryLine(books) {
  const s = stats(books);
  const bits = [`${s.count} book${s.count === 1 ? "" : "s"}`];
  if (s.pages) bits.push(`${s.pages.toLocaleString()} pages`);
  if (s.series) bits.push(`${s.series} series`);
  return bits.join(" · ");
}

// ---------- plain text (for sharing in a message) ----------

export function buildText(books, title, ratingOf = () => null) {
  const lines = [`${title} — ${summaryLine(books)}`, ""];
  books.forEach((b, i) => {
    const bits = [`${i + 1}. ${b.title}`];
    if (b.authors?.length) bits.push(`— ${b.authors.join(", ")}`);
    const y = yearOf(b);
    if (y) bits.push(`(${y})`);
    const r = ratingOf(b);
    if (r) bits.push("★".repeat(r));
    lines.push(bits.join(" "));
  });
  lines.push("", `Exported from Shelfie on ${fmtDate()}`);
  return lines.join("\n");
}

// ---------- CSV ----------

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// `shelfOf` is injected for the same reason `ratingOf` is: a shelf belongs to
// a person now, and this module has no idea who is holding the phone. Reading
// b.shelf directly would export the household's fallback, so a book you
// finished could leave here still labelled "tbr".
export function buildCsv(books, ratingOf = () => null, shelfOf = (b) => b.shelf) {
  const headers = [
    "Title", "Subtitle", "Authors", "Series", "Series #", "Copy type", "Format",
    "Publisher", "Published", "Pages", "ISBN-13", "ISBN-10", "Shelf", "Owned",
    "My rating", "Content", "Spice", "Belongs to", "Added",
  ];
  const rows = books.map((b) => [
    b.title, b.subtitle, (b.authors ?? []).join("; "),
    b.series?.name, b.series?.position,
    { print: "print", ebook: "e-book", audio: "audiobook" }[b.medium] ?? "print",
    b.format, b.publisher, b.publishDate,
    b.pageCount, b.isbn13, b.isbn10, shelfOf(b), b.owned ? "yes" : "no",
    ratingOf(b), b.content, b.spice, b.profile, b.addedAt?.slice(0, 10),
  ]);
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

// ---------- printable page ----------

// A self-contained HTML page: nice on screen, tidy on paper, and it prints
// to PDF from any phone browser's share sheet.
export function buildPrintableHtml(books, opts = {}) {
  const { title = "My Library", subtitle = "", ratingOf = () => null } = opts;
  // The page is styled in the app's current aesthetic, always in its light
  // palette so it prints well on paper.
  const p = {
    bg: "#f7f4ee", card: "#ffffff", ink: "#1c2230", inkSoft: "#4a5263",
    muted: "#7a8394", line: "#e3e0d8", accent: "#22304d", accentSoft: "#e9edf6",
    gold: "#d99b1e",
    serif: '"Iowan Old Style", Palatino, Georgia, serif',
    ...(opts.palette ?? {}),
  };
  const s = stats(books);

  const statChips = [
    [s.count, s.count === 1 ? "book" : "books"],
    s.pages ? [s.pages.toLocaleString(), "pages"] : null,
    s.authors ? [s.authors, s.authors === 1 ? "author" : "authors"] : null,
    s.series ? [s.series, s.series === 1 ? "series" : "series"] : null,
  ].filter(Boolean);

  const cards = books
    .map((b) => {
      const hue = hueOf(b.title);
      const meta = [b.format, b.publisher, yearOf(b)].filter(Boolean).join(" · ");
      const rating = ratingOf(b);
      return `
      <li class="bk">
        <div class="cv" style="--h:${hue}">
          <div class="fb"><span>${esc(b.title)}</span><em>${esc((b.authors ?? [])[0] ?? "")}</em></div>
          ${b.coverUrl ? `<img src="${esc(b.coverUrl)}" alt="" loading="lazy"
             onerror="this.style.display='none'" />` : ""}
        </div>
        <div class="tx">
          <h3>${esc(b.title)}</h3>
          ${b.authors?.length ? `<p class="au">${esc(b.authors.join(", "))}</p>` : ""}
          ${meta ? `<p class="mt">${esc(meta)}</p>` : ""}
          ${b.series?.name
            ? `<p class="sr">${esc(b.series.name)}${b.series.position ? ` #${b.series.position}` : ""}</p>`
            : ""}
          ${rating ? `<p class="rt">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</p>` : ""}
          ${b.pageCount ? `<p class="mt">${b.pageCount} pages</p>` : ""}
        </div>
      </li>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} — Shelfie</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem 3rem;
    background: ${p.bg}; color: ${p.ink};
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 900px; margin: 0 auto; }
  header { text-align: center; border-bottom: 2px solid ${p.accent}; padding-bottom: 1.25rem; margin-bottom: 1.75rem; }
  h1 { font-family: ${p.serif}; font-size: 2rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
  .sub { color: ${p.muted}; font-size: .9rem; margin: 0; }
  .stats { display: flex; flex-wrap: wrap; justify-content: center; gap: .5rem; margin-top: 1rem; }
  .stat { background: ${p.card}; border: 1px solid ${p.line}; border-radius: 999px; padding: .3rem .85rem; font-size: .82rem; }
  .stat b { font-family: ${p.serif}; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .8rem; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  .bk { display: flex; gap: .9rem; background: ${p.card}; border: 1px solid ${p.line}; border-radius: 12px; padding: .8rem; break-inside: avoid; }
  .cv { position: relative; width: 62px; height: 93px; flex: none; border-radius: 3px 6px 6px 3px; overflow: hidden; box-shadow: 0 2px 6px rgba(16,24,40,.18); }
  .cv img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .fb { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; text-align: center;
        padding: .35rem; color: #fff; background: linear-gradient(150deg, hsl(var(--h) 34% 44%), hsl(var(--h) 40% 25%)); }
  .fb span { font-family: ${p.serif}; font-size: .58rem; line-height: 1.2; font-weight: 600; }
  .fb em { font-size: .5rem; opacity: .75; font-style: normal; margin-top: .2rem; }
  .tx { min-width: 0; }
  h3 { font-family: ${p.serif}; font-size: 1rem; margin: 0 0 .15rem; line-height: 1.25; }
  .au { margin: 0; font-size: .85rem; color: ${p.inkSoft}; }
  .mt { margin: .15rem 0 0; font-size: .75rem; color: ${p.muted}; }
  .sr { margin: .25rem 0 0; font-size: .72rem; color: ${p.accent}; background: ${p.accentSoft}; display: inline-block; padding: .1rem .5rem; border-radius: 999px; }
  .rt { margin: .25rem 0 0; font-size: .8rem; color: ${p.gold}; letter-spacing: .08em; }
  footer { text-align: center; color: ${p.muted}; font-size: .78rem; margin-top: 2rem; }
  @media print {
    body { background: #fff; padding: 0; font-size: 11pt; }
    .bk { border-color: #ccc; }
    ul { grid-template-columns: repeat(2, 1fr); gap: .5rem; }
    footer { position: fixed; bottom: 0; left: 0; right: 0; }
  }
</style></head>
<body><div class="wrap">
  <header>
    <h1>${esc(title)}</h1>
    ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ""}
    <div class="stats">${statChips
      .map(([n, l]) => `<span class="stat"><b>${n}</b> ${l}</span>`)
      .join("")}</div>
  </header>
  <ul>${cards}</ul>
  <footer>Exported from Shelfie · ${fmtDate()}</footer>
</div></body></html>`;
}

// Stable colour per title so a coverless book always looks the same.
export function hueOf(text) {
  let h = 0;
  for (const ch of String(text ?? "")) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// ---------- delivery ----------

export function download(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Open generated HTML in a new tab so the user can read, print, or
// "Save as PDF" from the browser's own share sheet. Falls back to a
// download when the tab is blocked.
export function openHtml(html, filename) {
  const tab = window.open("", "_blank");
  if (!tab) {
    download(filename, html, "text/html");
    return false;
  }
  tab.document.write(html);
  tab.document.close();
  return true;
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
