// Scoring a candidate, as an explicit feature vector rather than one long sum
// buried in a render function.
//
// The arithmetic that was inline in app.js was good and is preserved here term
// for term — the default weights below are the numbers it used. What changes is
// that the terms are now named, logged, testable, and adjustable:
//
//   * each card's "why" line is derived from the same vector that ranked it,
//     so the explanation can't drift from the decision
//   * js/signals.js stores the vector with every `shown` event, which is what
//     makes replay and measurement possible at all
//   * once a reader has enough history, the weights themselves start to move
//
// Scoring stays a **linear combination** on purpose. The whole app is meant to
// be debuggable by reading it, and a model that can't be read can't produce an
// honest sentence about why a book is on the screen — which is half the
// feature. See docs/RECOMMENDATIONS.md.

import * as taste from "./taste.js";
import * as signals from "./signals.js";

// Today's hand-tuned numbers, decomposed. `similarity` was
// 0.5·subject + 0.3·author + 0.2·corroboration, and the social terms were
// 1.2·known where known itself carried a 1.1/0.8 friend multiplier.
export const DEFAULT_WEIGHTS = {
  subjectMatch: 0.5,
  authorMatch: 0.3,
  corroboration: 0.2,
  friend: 0.96,
  friendMutual: 0.36, // stacks on `friend`, so a mutual friend totals 1.32
  coRead: 0.6,
  communityRating: 0.3,
  publicRating: 0.25,
  // Sources that didn't exist before.
  seriesNext: 0.9,   // the highest-precision call a reading app can make
  onShelf: 0.55,     // you already chose this one
  lengthFit: 0.25,
  moodMatch: 0.5,
  // Penalties.
  stale: -0.35,      // shown lately and passed over
  dislike: -0.8,     // by an author or about a subject you rated down
};

export const FEATURES = Object.keys(DEFAULT_WEIGHTS);

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

// ---------- features ----------
//
// ctx: { taste, coRead, summaries, friends, stale, mood, profile }
export function features(r, ctx = {}) {
  const t = ctx.taste ?? {};
  const subjMass = taste.mass(t.subjects);
  const authMass = taste.mass(t.authors);

  // Overlap, weighted by how central each subject is to this reader — and only
  // the positive side counts as a match. The negative side is a penalty below,
  // not a smaller match, so a book about something you actively dislike can
  // never look like a mild fit.
  let subjHit = 0;
  let subjMiss = 0;
  for (const s of r.subjects ?? []) {
    const w = t.subjects?.[s] ?? 0;
    if (w > 0) subjHit += w;
    else subjMiss += -w;
  }
  let authHit = 0;
  let authMiss = 0;
  for (const a of r.authors ?? []) {
    const w = t.authors?.[a] ?? 0;
    if (w > 0) authHit += w;
    else authMiss += -w;
  }

  const cr = ctx.coRead?.get(r.key);
  const cs = ctx.summaries?.get(r.key);
  const fr = ctx.friends?.get(r.key);

  // Ratings only speak up once enough people have spoken. A 4.6 from nine
  // readers must not outrank a real taste match.
  const publicConfidence = Math.min((r.ratingsCount ?? 0) / 60, 1);
  const communityConfidence = cs?.ratingCount ? Math.min(cs.ratingCount / 5, 1) : 0;

  const friendScore = r.sources?.friends ?? fr?.score ?? 0;
  const isMutual = r.friend === true || fr?.friend === true;

  return {
    subjectMatch: clamp01(subjHit / subjMass),
    authorMatch: clamp01(authHit / authMass),
    corroboration: clamp01(((r.hits ?? 1) - 1) / 2),
    friend: clamp01(friendScore),
    friendMutual: isMutual ? clamp01(friendScore) : 0,
    coRead: clamp01(r.sources?.community ?? cr?.score ?? 0),
    communityRating: cs?.ratingAvg ? ((cs.ratingAvg - 3) / 2) * communityConfidence : 0,
    publicRating: r.avgRating ? ((r.avgRating - 3.4) / 1.6) * publicConfidence : 0,
    seriesNext: r.sources?.series ? clamp01(r.sources.series) : 0,
    onShelf: r.sources?.shelves ? clamp01(r.sources.shelves) : 0,
    lengthFit: lengthFit(r.pages, t.length),
    moodMatch: ctx.mood ? moodMatch(r, ctx.mood, t) : 0,
    stale: clamp01((ctx.stale?.get(r.key) ?? 0) / 3),
    dislike: clamp01((subjMiss / subjMass) * 2 + (authMiss / authMass) * 3),
  };
}

// How close a book sits to the length this reader actually gets on with. A
// gentle nudge, never a filter — the explicit page-range control is the filter.
function lengthFit(pages, band) {
  if (!band || !Number.isFinite(pages) || pages <= 0) return 0;
  const z = (pages - band.mean) / band.sd;
  return Math.exp(-0.5 * z * z);
}

// ---------- mood ----------
//
// Filters answer "what shape of book". Mood answers "what do I want tonight",
// and it is applied here rather than as a filter because it should bend a
// ranking, not empty a list.
//
// Two of the four dials need no data the app doesn't already hold. `length`
// reads pageCount. `familiarity` is a knob on the ranker itself, applied in
// weightsFor() rather than as a feature. The other two lean on subject tags
// until community pace/weight tags accumulate.
const HEAVY = /philosoph|politic|literary|history|war|theolog|essays|science|economic|biograph/i;
const LIGHT = /humor|humour|romance|cozy|cosy|comic|young adult|adventure|fairy/i;
const FAST = /thriller|suspense|mystery|action|adventure|detective/i;
const SLOW = /literary|epic|saga|memoir|philosoph|historical fiction/i;

function moodMatch(r, mood, t) {
  const hay = [...(r.subjects ?? []), r.title ?? ""].join(" | ");
  let score = 0;
  let terms = 0;

  if (mood.weight) {
    terms++;
    const heavy = HEAVY.test(hay) ? 1 : 0;
    const light = LIGHT.test(hay) ? 1 : 0;
    const long = Number.isFinite(r.pages) && r.pages > 450 ? 1 : 0;
    const lean = heavy + long - light; // −1 light … 2 involving
    score += mood.weight === "involving" ? clamp01(lean / 2) : clamp01((1 - lean) / 2);
  }
  if (mood.pace) {
    terms++;
    const fast = FAST.test(hay) ? 1 : 0;
    const slow = SLOW.test(hay) ? 1 : 0;
    score += mood.pace === "fast" ? clamp01(fast - slow + 0.5) : clamp01(slow - fast + 0.5);
  }
  if (mood.length) {
    terms++;
    if (!Number.isFinite(r.pages)) score += 0.4; // unknown: neither reward nor punish
    else if (mood.length === "evening") score += clamp01((450 - r.pages) / 250);
    else score += clamp01((r.pages - 300) / 300);
  }
  if (!terms) return 0;
  // Familiarity is handled in weightsFor(), not here — it changes how much
  // subject and author overlap are worth, which is exactly what it means.
  void t;
  return score / terms;
}

// ---------- weights ----------

// The familiarity dial, and the learned adjustment, both land here.
export function weightsFor({ mood, learned, alpha = 0 } = {}) {
  const w = { ...DEFAULT_WEIGHTS };
  if (learned && alpha > 0) {
    const a = Math.min(Math.max(alpha, 0), MAX_ALPHA);
    for (const k of FEATURES) {
      if (Number.isFinite(learned[k])) w[k] = (1 - a) * w[k] + a * learned[k];
    }
  }
  if (mood?.familiarity === "similar") {
    w.subjectMatch *= 1.6;
    w.authorMatch *= 1.8;
    w.seriesNext *= 1.2;
  } else if (mood?.familiarity === "different") {
    w.subjectMatch *= 0.45;
    w.authorMatch *= 0.15;
    w.seriesNext *= 0.4;
    w.coRead *= 1.3;
    w.publicRating *= 1.4;
  }
  return w;
}

export function score(f, weights = DEFAULT_WEIGHTS) {
  let sum = 0;
  for (const k of FEATURES) sum += (weights[k] ?? 0) * (f[k] ?? 0);
  return sum;
}

// ---------- learning ----------
//
// Once a reader has enough history, fit the weights to what they actually
// took. Logistic regression on the logged feature vectors: accepted (opened,
// wishlisted, started) against shown-and-passed.
//
// Thirteen weights over a few hundred rows is a few milliseconds of plain
// JavaScript — no library, no service, no build step. The blend is capped so a
// thin or strange log can nudge the ranking and never seize it, and the
// fallback on too little data is simply the hand-tuned defaults.

export const MIN_ROWS = 40;
export const MAX_ALPHA = 0.6;

export function alphaFor(rowCount) {
  if (rowCount < MIN_ROWS) return 0;
  // Reaches the cap at ~250 outcomes; gentle before then.
  return Math.min(MAX_ALPHA, ((rowCount - MIN_ROWS) / 210) * MAX_ALPHA);
}

export function fit(rows, { iterations = 220, rate = 0.35, l2 = 0.02 } = {}) {
  const positives = rows.filter((r) => r.label === 1).length;
  // A log with no accepts (or nothing but accepts) has no gradient worth
  // following; it would just learn the constant.
  if (rows.length < MIN_ROWS || positives < 4 || positives === rows.length) return null;

  const w = {};
  for (const k of FEATURES) w[k] = DEFAULT_WEIGHTS[k];
  let bias = 0;

  for (let it = 0; it < iterations; it++) {
    const grad = {};
    for (const k of FEATURES) grad[k] = 0;
    let gBias = 0;
    for (const row of rows) {
      let z = bias;
      for (const k of FEATURES) z += w[k] * (row.features[k] ?? 0);
      const p = 1 / (1 + Math.exp(-z));
      const err = p - row.label;
      for (const k of FEATURES) grad[k] += err * (row.features[k] ?? 0);
      gBias += err;
    }
    const step = rate / rows.length;
    for (const k of FEATURES) w[k] -= step * (grad[k] + l2 * w[k] * rows.length);
    bias -= step * gBias;
  }

  // A learned weight that has run away is a sign of a degenerate log, not an
  // insight. Clamp to a band around the defaults so the blend stays sane.
  for (const k of FEATURES) {
    const d = DEFAULT_WEIGHTS[k];
    const span = Math.max(0.8, Math.abs(d) * 2.5);
    w[k] = Math.min(d + span, Math.max(d - span, w[k]));
  }
  return w;
}

const LEARNED_KEY = "shelfie.rankWeights.v1";

// Refit at most once a session, and only when the log has grown. Stored so a
// cold start uses what was already learned rather than the bare defaults.
export function learnedWeights(profile) {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(LEARNED_KEY))?.[profile ?? "_"] ?? null;
  } catch { /* fall through to a refit */ }
  const rows = signals.trainingRows(profile);
  if (stored && stored.rows === rows.length) {
    return { weights: stored.w, alpha: alphaFor(rows.length), rows: rows.length };
  }
  const w = fit(rows);
  if (!w) return { weights: null, alpha: 0, rows: rows.length };
  try {
    const all = JSON.parse(localStorage.getItem(LEARNED_KEY)) ?? {};
    all[profile ?? "_"] = { w, rows: rows.length, at: Date.now() };
    localStorage.setItem(LEARNED_KEY, JSON.stringify(all));
  } catch { /* derived data — recomputed next time */ }
  return { weights: w, alpha: alphaFor(rows.length), rows: rows.length };
}

// ---------- explaining ----------
//
// Most specific signal first, and nothing is more specific than a name you
// know. The candidate's own reason (set by the source that found it) wins
// whenever it is more concrete than anything the vector can say.
export function explain(r, f, ctx = {}) {
  if (r.source === "series" || r.source === "shelves" || r.source === "friends") {
    return r.reason;
  }
  if (f.friend > 0 && r.who?.length) return r.reason;
  if (f.coRead > 0.15) return "Readers with shelves like yours have this";
  const cs = ctx.summaries?.get(r.key);
  if (cs?.ratingCount) return `Shelfie readers rate it ★ ${cs.ratingAvg.toFixed(1)}`;
  if (f.subjectMatch > 0.12 && r.subjects?.length) {
    const shared = r.subjects.filter((s) => (ctx.taste?.subjects?.[s] ?? 0) > 0).slice(0, 2);
    if (shared.length) return `Matches your taste: ${shared.join(", ")}`;
  }
  if (f.authorMatch > 0.2 && r.authors?.length) {
    const known = r.authors.find((a) => (ctx.taste?.authors?.[a] ?? 0) > 0);
    if (known) return `More by ${known}`;
  }
  // The reason a source attached is the query that found the book, not a fact
  // about the book. An author search returns anthologies and co-authored
  // volumes, so "More by X" has to be checked against who actually wrote this
  // one — a reason that quietly lies is worse than a vague one.
  return verifiedReason(r, ctx) ?? "Well rated, and new to your shelves";
}

function verifiedReason(r, ctx) {
  const claim = r.reason;
  if (!claim) return null;

  // "More by X" — only if X actually wrote this one.
  const byAuthor = claim.match(/^More by (.+)$/);
  if (byAuthor) return (r.authors ?? []).includes(byAuthor[1]) ? claim : null;

  // A bare subject name as a reason means a subject query found the book. It
  // stands only if the book carries that subject.
  const isSubjectClaim = (ctx.taste?.subjects?.[claim] ?? 0) > 0;
  const carriesIt = (r.subjects ?? []).some((s) => s.toLowerCase() === claim.toLowerCase());
  if (isSubjectClaim && !carriesIt) return null;

  return claim;
}

// ---------- the pass ----------

// Score, sort, and spread. Diversity is not decoration: five variations on one
// book reads as a broken list even when every one of them is a good match.
export function rank(rows, ctx = {}, { limit = 24, perAuthor = 2, perSeries = 1 } = {}) {
  // Weights are derived from the mood in play, so a caller that changes the
  // mood and reuses a context can't accidentally rank against the old dials.
  const weights = weightsFor({ mood: ctx.mood, learned: ctx.learned, alpha: ctx.alpha });
  const scored = rows.map((r) => {
    const f = features(r, ctx);
    return { ...r, features: f, score: score(f, weights), reason: explain(r, f, ctx) };
  });
  scored.sort((a, b) => b.score - a.score);

  const authorCount = {};
  const seriesCount = {};
  const out = [];
  for (const r of scored) {
    const a = r.authors?.[0] ?? "?";
    const s = r.book?.series?.name ?? (r.source === "series" ? r.reason : null);
    if ((authorCount[a] ?? 0) >= perAuthor) continue;
    if (s && (seriesCount[s] ?? 0) >= perSeries) continue;
    authorCount[a] = (authorCount[a] ?? 0) + 1;
    if (s) seriesCount[s] = (seriesCount[s] ?? 0) + 1;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// Three picks that are actually different from each other: the best book, then
// the best one from a different source, then the best from a third. This is
// what the sunset sheet offers, and the variety is the point — one more of the
// same is not an alternative.
export function spread(ranked, n = 3) {
  const out = [];
  const usedSources = new Set();
  for (const r of ranked) {
    if (out.length >= n) break;
    if (usedSources.has(r.source)) continue;
    usedSources.add(r.source);
    out.push(r);
  }
  for (const r of ranked) {
    if (out.length >= n) break;
    if (!out.includes(r)) out.push(r);
  }
  return out;
}
