// Adding books from a photo — the "several books in one shot" promise.
//
// The regression this guards: a photo of a pile used to add one or two books
// out of eight. The reader decoded the picture as a whole and returned a
// single result, so most of the shelf in front of the camera was silently
// dropped. These suites build photos with a known set of barcodes in them and
// check that every one comes back.
import { chromium } from "playwright-core";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];
const tmp = mkdtempSync(join(tmpdir(), "shelfie-photo-"));

const ISBNS = [
  "9780593135204", "9780316769488", "9780061120084",
  "9780545010221", "9780439023481", "9780765326355",
];
const TITLES = {
  "9780593135204": "Project Hail Mary", "9780316769488": "The Catcher in the Rye",
  "9780061120084": "To Kill a Mockingbird", "9780545010221": "Deathly Hallows",
  "9780439023481": "The Hunger Games", "9780765326355": "The Way of Kings",
};

// EAN-13, drawn the way it's printed on a back cover.
const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

function ean13Bits(code) {
  const d = [...code].map(Number);
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + "101";
}

// Build a photo of `codes.length` back covers laid out in a grid and write it
// to disk, so the file goes through the real <input type="file">.
async function makePhoto(page, codes, { cols = 3, width = 3024, height = 2268, blur = 0 } = {}) {
  const dataUrl = await page.evaluate(
    ({ codes, bits, cols, width, height, blur }) => {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const g = c.getContext("2d");
      g.fillStyle = "#b9a68c";
      g.fillRect(0, 0, width, height);
      const rows = Math.ceil(codes.length / cols);
      const cw = width / cols;
      const ch = height / rows;
      codes.forEach((code, i) => {
        const cx = (i % cols) * cw;
        const cy = Math.floor(i / cols) * ch;
        g.fillStyle = "#e8e2d6";
        g.fillRect(cx + cw * 0.04, cy + ch * 0.04, cw * 0.92, ch * 0.92);
        // Render at a whole number of pixels per module, then scale it down
        // onto the cover — a printed barcode photographed from a distance.
        const b = bits[code];
        const M = 8, quiet = 9;
        const s = document.createElement("canvas");
        s.width = (b.length + quiet * 2) * M;
        s.height = M * 70;
        const sg = s.getContext("2d");
        sg.fillStyle = "#fff";
        sg.fillRect(0, 0, s.width, s.height);
        sg.fillStyle = "#000";
        for (let k = 0; k < b.length; k++) {
          if (b[k] === "1") sg.fillRect((quiet + k) * M, M * 5, M, M * 55);
        }
        g.imageSmoothingQuality = "high";
        g.drawImage(s, cx + cw * 0.5, cy + ch * 0.66, cw * 0.42, ch * 0.2);
      });
      let out = c;
      if (blur) {
        const b2 = document.createElement("canvas");
        b2.width = width;
        b2.height = height;
        const bg = b2.getContext("2d");
        bg.filter = `blur(${blur}px)`;
        bg.drawImage(c, 0, 0);
        out = b2;
      }
      return out.toDataURL("image/jpeg", 0.85);
    },
    { codes, bits: Object.fromEntries(codes.map((c) => [c, ean13Bits(c)])), cols, width, height, blur }
  );
  const file = join(tmp, `photo-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  return file;
}

async function open(existing = []) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  // In Playwright the LAST matching route wins, so these go broadest first
  // and the one we actually want answering registers last.
  await page.route(/openlibrary\.org/, (r) => r.fulfill({ status: 404, body: "" }));
  await page.route(/googleapis|gstatic|covers\.openlibrary/, (r) => r.abort());
  // The reader must be entirely on-device. If anything still reaches for a
  // CDN this blocks it, and the suite fails rather than passing on a
  // connection the phone might not have.
  await page.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs/, (r) => r.abort());
  await page.route(/openlibrary\.org\/isbn\/(\d+)\.json/, (r) => {
    const isbn = r.request().url().match(/isbn\/(\d+)\.json/)[1];
    if (!TITLES[isbn]) return r.fulfill({ status: 404, body: "" });
    return r.fulfill({
      json: {
        title: TITLES[isbn], isbn_13: [isbn], number_of_pages: 300,
        publish_date: "2015", physical_format: "Paperback",
        works: [{ key: "/works/W" + isbn }], authors: [],
      },
    });
  });
  await page.addInitScript((books) => {
    localStorage.setItem("shelfie.profile.v1", "Zach");
    localStorage.setItem("shelfie.library.v1", JSON.stringify(books));
  }, existing);
  await page.goto("http://localhost:8765/");
  await page.waitForTimeout(500);
  await page.click("#add-book-btn");
  await page.waitForTimeout(200);
  return { ctx, page };
}

const shelved = (page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("shelfie.library.v1") ?? "[]").map((b) => b.title).sort()
  );

// 1. Six books in one shot — the headline case.
{
  const { ctx, page } = await open();
  const file = await makePhoto(page, ISBNS);
  await page.setInputFiles("#photo-input", file);
  await page.waitForTimeout(6000);
  const batchOpen = await page.isVisible("#batch-modal");
  const listed = await page.locator("#batch-list .batch-row").count();
  console.log("1. photo of six books");
  console.log("   batch sheet opens:", batchOpen, "| books listed:", listed, "of 6");
  if (batchOpen) {
    await page.click('[data-batch-shelf="owned"]');
    await page.waitForTimeout(800);
    console.log("   on the shelf:", (await shelved(page)).length, "books");
    console.log("   titles:", JSON.stringify(await shelved(page)));
  }
  await ctx.close();
}

// 2. Undo puts the whole batch back, as one action.
{
  const { ctx, page } = await open();
  await page.setInputFiles("#photo-input", await makePhoto(page, ISBNS));
  await page.waitForTimeout(6000);
  if (await page.isVisible("#batch-modal")) {
    await page.click('[data-batch-shelf="tbr"]');
    await page.waitForTimeout(600);
    const before = (await shelved(page)).length;
    await page.click(".toast-action");
    await page.waitForTimeout(600);
    console.log("2. undo a batch");
    console.log("   added:", before, "| after undo:", (await shelved(page)).length);
  } else {
    console.log("2. undo a batch — batch sheet never opened");
  }
  await ctx.close();
}

// 3. Unticking a book leaves it out.
{
  const { ctx, page } = await open();
  await page.setInputFiles("#photo-input", await makePhoto(page, ISBNS));
  await page.waitForTimeout(6000);
  if (await page.isVisible("#batch-modal")) {
    await page.click("#batch-none");
    await page.locator("#batch-list input").first().check();
    await page.click('[data-batch-shelf="owned"]');
    await page.waitForTimeout(700);
    console.log("3. untick all but one");
    console.log("   on the shelf:", JSON.stringify(await shelved(page)));
  }
  await ctx.close();
}

// 4. A single book still gets the ordinary one-book sheet, dupe note and all.
{
  const { ctx, page } = await open();
  await page.setInputFiles("#photo-input", await makePhoto(page, [ISBNS[0]], { cols: 1, width: 1400, height: 1900 }));
  await page.waitForTimeout(5000);
  console.log("4. photo of one book");
  console.log("   single confirm sheet:", await page.isVisible("#confirm-modal"),
    "| batch sheet:", await page.isVisible("#batch-modal"));
  await ctx.close();
}

// 5. Books already owned are absorbed rather than offered again.
{
  const { ctx, page } = await open(
    ISBNS.slice(0, 3).map((isbn) => ({
      id: "isbn:" + isbn, title: TITLES[isbn], authors: [], isbn13: isbn,
      workKey: "/works/W" + isbn, shelf: "owned", owned: true,
      addedAt: "2026-01-01T00:00:00Z",
    }))
  );
  await page.setInputFiles("#photo-input", await makePhoto(page, ISBNS));
  await page.waitForTimeout(6000);
  const listed = await page.locator("#batch-list .batch-row").count();
  const note = await page.textContent("#batch-note").catch(() => "");
  console.log("5. three of the six already owned");
  console.log("   offered:", listed, "(expected 3) | note:", JSON.stringify(note.replace(/\s+/g, " ").trim()));
  await ctx.close();
}

// 6. A slightly soft photo still reads — phones focus on the pile, not the ink.
{
  const { ctx, page } = await open();
  await page.setInputFiles("#photo-input", await makePhoto(page, ISBNS, { blur: 1.5 }));
  await page.waitForTimeout(7000);
  console.log("6. soft-focus photo");
  console.log("   books found:", await page.locator("#batch-list .batch-row").count(), "of 6");
  await ctx.close();
}

// 7. A picture with no barcode says so, and says something useful.
{
  const { ctx, page } = await open();
  const blank = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1200; c.height = 900;
    const g = c.getContext("2d");
    g.fillStyle = "#8a7f6d";
    g.fillRect(0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  });
  const file = join(tmp, "blank.jpg");
  writeFileSync(file, Buffer.from(blank.split(",")[1], "base64"));
  await page.setInputFiles("#photo-input", file);
  await page.waitForTimeout(4000);
  console.log("7. a photo with no barcode in it");
  console.log("   says:", JSON.stringify((await page.textContent("#scan-status")).replace(/\s+/g, " ").trim()));
  console.log("   no sheet opened:", !(await page.isVisible("#batch-modal")) && !(await page.isVisible("#confirm-modal")));
  await ctx.close();
}

// 8. Several photos at once — a big shelf in a few shots.
{
  const { ctx, page } = await open();
  const a = await makePhoto(page, ISBNS.slice(0, 3), { cols: 3, width: 2400, height: 1200 });
  const b = await makePhoto(page, ISBNS.slice(3), { cols: 3, width: 2400, height: 1200 });
  await page.setInputFiles("#photo-input", [a, b]);
  await page.waitForTimeout(9000);
  console.log("8. two photos in one go");
  console.log("   books found:", await page.locator("#batch-list .batch-row").count(), "of 6");
  await ctx.close();
}

console.log("\nERRORS:", errors.length ? errors : "none");
await browser.close();
