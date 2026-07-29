// Runs every suite in this folder against a local copy of the app.
//
//   node tests/run.mjs            # all of them
//   node tests/run.mjs regress    # just the ones whose name contains "regress"
//
// Each suite drives a real headless browser through the real app and prints
// numbered observations. A suite passes if it finishes and reports no browser
// errors; anything else is printed in full so you can read what happened.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve, normalize } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = 8765;

const TYPES = {
  ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

// A static file server, so the only thing you need installed is Node.
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  const target = path.endsWith("/") ? join(file, "index.html") : file;
  try {
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
});

await new Promise((ok) => server.listen(PORT, ok));

const filter = process.argv[2];
const NOT_SUITES = new Set(["run.mjs", "serve.mjs"]);
const wantNetwork = process.argv.includes("--network");

const suites = readdirSync(import.meta.dirname)
  .filter((f) => f.endsWith(".mjs") && !NOT_SUITES.has(f))
  .filter((f) => !filter || filter.startsWith("--") || f.includes(filter))
  .sort();

// A few suites talk to the real Open Library rather than a mock, so they need
// a working connection and fail meaninglessly without one. They're opt-in.
const needsNetwork = (f) =>
  readFileSync(join(import.meta.dirname, f), "utf8").startsWith("// @requires-network");

if (!suites.length) {
  console.error(filter ? `No suite matches "${filter}".` : "No suites found.");
  server.close();
  process.exit(1);
}

console.log(`Running ${suites.length} suite${suites.length === 1 ? "" : "s"} against http://localhost:${PORT}\n`);

const failures = [];
let skipped = 0;
for (const suite of suites) {
  process.stdout.write(`  ${suite.padEnd(20)}`);
  if (!wantNetwork && needsNetwork(suite)) {
    console.log("skip  needs a connection — run with --network");
    skipped++;
    continue;
  }
  const started = Date.now();
  const out = await new Promise((done) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, suite)], {
      cwd: import.meta.dirname,
      env: { ...process.env },
    });
    let text = "";
    child.stdout.on("data", (d) => (text += d));
    child.stderr.on("data", (d) => (text += d));
    child.on("close", (code) => done({ text, code }));
  });
  const secs = ((Date.now() - started) / 1000).toFixed(0);

  // A suite reports its own health on the last line: "errors: []" / "ERRORS: none".
  const clean = /(^|\n)\s*(errors|ERRORS):\s*(\[\]|none)\s*$/i.test(out.text.trimEnd());
  if (out.code === 0 && clean) {
    console.log(`ok    ${secs}s`);
  } else {
    console.log(`FAIL  ${secs}s`);
    failures.push({ suite, text: out.text });
  }
}

server.close();

if (failures.length) {
  for (const f of failures) {
    console.log(`\n${"—".repeat(60)}\n${f.suite}\n${"—".repeat(60)}`);
    console.log(f.text.trimEnd());
  }
  console.log(`\n${failures.length} of ${suites.length - skipped} failed.`);
  process.exit(1);
}
console.log(`\nAll ${suites.length - skipped} passed.${skipped ? ` (${skipped} skipped)` : ""}`);
