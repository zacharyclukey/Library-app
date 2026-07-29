// Serves the app on http://localhost:8765 so you can open it in a browser.
//
//   npm start
//
// Useful while changing css/custom.css or dropping files into assets/: edit,
// save, refresh. Nothing is compiled, so what you see is exactly what the
// phone will get.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, normalize } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.PORT ?? 8765);

const TYPES = {
  ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".woff": "font/woff",
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  const target = path.endsWith("/") ? join(file, "index.html") : file;
  try {
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": TYPES[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store", // always see the edit you just made
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
}).listen(PORT, () => {
  console.log(`Shelfie is running at http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});
