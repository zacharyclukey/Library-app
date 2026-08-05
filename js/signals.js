// What the reader actually did — the feedback loop the recommender learns from.
//
// Discover could always tell you *why* it picked a book. It could never tell
// whether you agreed. Nothing recorded that a recommendation was shown, taken
// or waved off, which meant the feature improved only as the library grew, and
// a change to the ranking could never be shown to be an improvement.
//
// This is that record. An append-only ring buffer in localStorage, capped, and
// private: nothing here is ever published, synced, or attached to a household.
// It is the reader's own history of saying yes and no.
//
// The important part is that a `shown` event carries the *feature vector* that
// produced the rank, not just the outcome. Outcomes alone say someone declined;
// features say what the ranker believed at the moment they declined, which is
// the only thing you can learn from later. See docs/RECOMMENDATIONS.md.

const KEY = "shelfie.signals.v1";
const VERSION = 1;

// The buffer is a trade against a store that already has a full-disk path
// (js/db.js dispatches shelfie:storage-full). 400 events is roughly 60 KB with
// feature vectors attached, and covers months of ordinary use.
const CAP = 400;

// How long a "not for me" keeps a book out of the running. Long enough to
// mean something, short enough that a mood in March doesn't bind you in
// December.
const DISMISS_DAYS = 90;

export const TYPES = [
  "shown",       // painted in a recommendation list
  "wishlisted",  // added to the wishlist from a recommendation
  "started",     // sent to To Read and flagged reading
  "dismissed",   // "not for me"
  "finished",    // moved to Finished
  "abandoned",   // was being read, then shelved unfinished
  "rated",       // a star rating landed
  "dial",        // a mood dial moved
];

// Outcomes that mean the reader took the recommendation, as against merely
// being shown it. The learner splits on exactly this.
const ACCEPTING = new Set(["wishlisted", "started"]);

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    cache = raw?.v === VERSION && Array.isArray(raw.e) ? raw.e : [];
  } catch {
    cache = [];
  }
  return cache;
}

// Writes are best-effort by design. A full disk must not break a shelf move:
// losing the tail of the log costs some future ranking quality, which is not
// worth failing a user action over.
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: VERSION, e: cache }));
    } catch {
      // Out of room: halve the log and try once more. Old events are the
      // least valuable thing in the store.
      cache = cache.slice(-Math.floor(CAP / 2));
      try {
        localStorage.setItem(KEY, JSON.stringify({ v: VERSION, e: cache }));
      } catch { /* stays in memory for this session */ }
    }
  }, 400);
}

// Field names are one letter because 400 of these live in a quota-bounded
// store and the difference is real: `bookKey` alone would cost ~3 KB.
//
//   t  type          k  book key        at  epoch ms      p  profile
//   s  source        r  reason shown    i   list position
//   f  feature vector (shown events only)
//   x  extras (rating value, dial name, …)
export function log(type, detail = {}) {
  if (!TYPES.includes(type)) return null;
  const events = load();
  const ev = { t: type, at: Date.now() };
  if (detail.key) ev.k = String(detail.key);
  if (detail.profile) ev.p = String(detail.profile);
  if (detail.source) ev.s = String(detail.source);
  if (detail.reason) ev.r = String(detail.reason).slice(0, 80);
  if (Number.isFinite(detail.position)) ev.i = detail.position;
  if (detail.features) ev.f = roundAll(detail.features);
  if (detail.value !== undefined) ev.x = detail.value;
  events.push(ev);
  if (events.length > CAP) events.splice(0, events.length - CAP);
  save();
  return ev;
}

// Three decimals is well beyond what any of these features resolve to, and it
// keeps a stored vector to about a third of its natural length.
function roundAll(features) {
  const out = {};
  for (const [k, v] of Object.entries(features)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000;
    else if (typeof v === "boolean") out[k] = v ? 1 : 0;
  }
  return out;
}

// Logging a whole painted list at once, so one render is one write.
//
// A list re-renders for reasons that have nothing to do with the reader seeing
// it again — wishlisting a book, turning a mood dial, coming back to the
// screen. Counting those as fresh impressions would inflate every count built
// on them: the staleness penalty would bury books nobody ever declined, and
// the training set would fill with duplicate rows. So a book already shown in
// the last few minutes is not logged again.
const RESHOW_QUIET_MS = 5 * 60 * 1000;

export function logShown(rows, profile) {
  const events = load();
  const cutoff = Date.now() - RESHOW_QUIET_MS;
  const recent = new Set();
  for (const e of events) {
    if (e.t === "shown" && e.k && e.at >= cutoff) recent.add(e.k);
  }
  rows.forEach((row, i) => {
    if (row.key && recent.has(row.key)) return;
    if (row.key) recent.add(row.key);
    const ev = { t: "shown", at: Date.now(), i };
    if (row.key) ev.k = String(row.key);
    if (profile) ev.p = String(profile);
    if (row.source) ev.s = String(row.source);
    if (row.reason) ev.r = String(row.reason).slice(0, 80);
    if (row.features) ev.f = roundAll(row.features);
    events.push(ev);
  });
  if (events.length > CAP) events.splice(0, events.length - CAP);
  save();
}

export function all() {
  return [...load()];
}

export function ofType(type) {
  return load().filter((e) => e.t === type);
}

export function count(type) {
  return type ? load().reduce((n, e) => n + (e.t === type ? 1 : 0), 0) : load().length;
}

// ---------- dismissal ----------
//
// A "not for me" that changes nothing next time is a lie the reader will catch
// inside two sessions, so this is consulted by the candidate builder before
// anything else runs.

export function dismiss(key, profile, detail = {}) {
  return log("dismissed", { ...detail, key, profile });
}

// Undo has to actually undo. Logging a compensating event would leave the
// dismissal in the log and the book still suppressed, so the event is removed
// — this is the one place the buffer is not append-only, and it is deliberate:
// a control the reader can't take back is worse than no control.
export function undismiss(key, profile) {
  const events = load();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.t !== "dismissed" || e.k !== key) continue;
    if (profile && e.p && e.p !== profile) continue;
    events.splice(i, 1);
  }
  save();
}

export function dismissedKeys(profile) {
  const cutoff = Date.now() - DISMISS_DAYS * 24 * 3600 * 1000;
  const out = new Set();
  for (const e of load()) {
    if (e.t !== "dismissed" || e.at < cutoff || !e.k) continue;
    if (profile && e.p && e.p !== profile) continue;
    out.add(e.k);
  }
  return out;
}

// Books put in front of this reader lately and not taken. Not a rejection —
// they may simply not have looked — but a list that keeps showing the same
// five books reads as broken, so the ranker damps anything recently shown.
export function shownRecently(profile, days = 14) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const counts = new Map();
  for (const e of load()) {
    if (e.t !== "shown" || e.at < cutoff || !e.k) continue;
    if (profile && e.p && e.p !== profile) continue;
    counts.set(e.k, (counts.get(e.k) ?? 0) + 1);
  }
  // Anything the reader then acted on is not stale — it's a success.
  for (const e of load()) {
    if (ACCEPTING.has(e.t) && e.k) counts.delete(e.k);
  }
  return counts;
}

// Books this reader gave up on. Weighed as a real negative by js/taste.js.
export function abandonedKeys(profile) {
  const out = new Set();
  for (const e of load()) {
    if (e.t !== "abandoned" || !e.k) continue;
    if (profile && e.p && e.p !== profile) continue;
    out.add(e.k);
  }
  return out;
}

// ---------- measurement ----------
//
// Private counters, for the debug view and for judging whether a ranking
// change helped. Never published, never shown as a score to the reader.
export function acceptance(profile) {
  const shown = new Map();
  const took = new Set();
  for (const e of load()) {
    if (profile && e.p && e.p !== profile) continue;
    if (e.t === "shown" && e.k) shown.set(e.k, (shown.get(e.k) ?? 0) + 1);
    else if (ACCEPTING.has(e.t) && e.k) took.add(e.k);
  }
  const offered = shown.size;
  const accepted = [...took].filter((k) => shown.has(k)).length;
  return { offered, accepted, rate: offered ? accepted / offered : null };
}

// Which sources are earning their place. Returns
// Map<source, { shown, accepted }>.
export function bySource(profile) {
  const out = new Map();
  const sourceOf = new Map();
  for (const e of load()) {
    if (profile && e.p && e.p !== profile) continue;
    if (e.t === "shown" && e.k && e.s) {
      sourceOf.set(e.k, e.s);
      const row = out.get(e.s) ?? { shown: 0, accepted: 0 };
      row.shown++;
      out.set(e.s, row);
    }
  }
  for (const e of load()) {
    if (profile && e.p && e.p !== profile) continue;
    if (!ACCEPTING.has(e.t) || !e.k) continue;
    const s = sourceOf.get(e.k);
    if (!s) continue;
    const row = out.get(s);
    if (row) row.accepted++;
  }
  return out;
}

// Every `shown` event that has both a feature vector and a known outcome —
// the training set for the learned re-ranker, and the replay set for the test
// harness. Label is 1 if the reader took it, 0 if it was shown and passed.
export function trainingRows(profile) {
  const took = new Set();
  for (const e of load()) {
    if (profile && e.p && e.p !== profile) continue;
    if (ACCEPTING.has(e.t) && e.k) took.add(e.k);
  }
  const seen = new Set();
  const rows = [];
  for (const e of load()) {
    if (e.t !== "shown" || !e.f || !e.k) continue;
    if (profile && e.p && e.p !== profile) continue;
    if (seen.has(e.k)) continue; // one row per book, the first time it was offered
    seen.add(e.k);
    rows.push({ key: e.k, features: e.f, label: took.has(e.k) ? 1 : 0, at: e.at });
  }
  return rows;
}

export function clear() {
  cache = [];
  try {
    localStorage.removeItem(KEY);
  } catch { /* nothing to do */ }
}
