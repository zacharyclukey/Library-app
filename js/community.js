// Community data layer — the seed of the "our own users power recommendations"
// vision. Free databases (Open Library / Google Books) stay the baseline;
// this layer collects the app's own users' ratings, spice/content tags, and
// reviews, and blends them in wherever they exist.
//
// Data model (Firestore, alongside the households collection):
//
//   community/{bookKey}                     — aggregate summary, recomputed
//     { bookKey, title, authors, ratingAvg, ratingCount,
//       spiceAvg, spiceCount, content: {tag: votes}, reviewCount, updatedAt }
//   community/{bookKey}/signals/{contributorId}
//     { bookKey, title, authors, name, rating, spice, content, review, updatedAt }
//
// bookKey is a stable identity across users: the Open Library work when we
// have it (editions of the same book should pool), else ISBN-13, else a
// normalized title+author slug.
//
// Sharing is opt-in per device (Settings). Contributions carry the profile's
// first name for review attribution — that's disclosed on the toggle. At
// couple-scale the open Firestore rules are fine; a public release would move
// this behind Firebase Auth + stricter rules, which only touches this module.

import * as sync from "./sync.js";

const SHARE_KEY = "shelfie.shareCommunity.v1";

export function sharingEnabled() {
  return localStorage.getItem(SHARE_KEY) === "1";
}

export function setSharing(on) {
  localStorage.setItem(SHARE_KEY, on ? "1" : "0");
}

export function isAvailable() {
  return sync.isConfigured();
}

// ---------- identity ----------

export function bookKey(book) {
  if (book.workKey) return "ol_" + book.workKey.replace("/works/", "");
  if (book.isbn13) return "isbn_" + book.isbn13;
  const slug = `${book.title ?? ""} ${(book.authors ?? [])[0] ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return "t_" + (slug || "unknown");
}

function contributorId(profileName) {
  const who = (profileName ?? "anon").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${sync.deviceId()}_${who}`;
}

// ---------- publish ----------

// Push this profile's signals for one book. Fire-and-forget; inert unless
// sharing is on and Firebase is configured. Also recomputes the aggregate
// summary (last-writer-wins — fine at this scale).
export async function publish(book, profileName) {
  if (!sharingEnabled() || !isAvailable()) return false;
  const fs = await sync.firestore();
  if (!fs) return false;
  const { m, db } = fs;

  const key = bookKey(book);
  const rating = book.ratings?.[profileName] ?? null;
  const review = book.reviews?.[profileName]?.text ?? null;
  const signal = {
    bookKey: key,
    title: book.title ?? null,
    authors: book.authors ?? [],
    name: profileName ?? null,
    rating,
    spice: book.spice ?? null,
    content: book.content ?? null,
    review,
    updatedAt: new Date().toISOString(),
  };

  try {
    await m.setDoc(
      m.doc(db, "community", key, "signals", contributorId(profileName)),
      JSON.parse(JSON.stringify(signal))
    );
    await recomputeSummary(fs, key);
    return true;
  } catch {
    return false; // rules not deployed yet, or offline — never break the app
  }
}

async function recomputeSummary({ m, db }, key) {
  const snap = await m.getDocs(m.collection(db, "community", key, "signals"));
  const signals = snap.docs.map((d) => d.data());
  if (!signals.length) return;

  const nums = (xs) => xs.filter((x) => typeof x === "number");
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const ratings = nums(signals.map((s) => s.rating));
  const spices = nums(signals.map((s) => s.spice));
  const content = {};
  signals.forEach((s) => {
    if (s.content) content[s.content] = (content[s.content] ?? 0) + 1;
  });

  await m.setDoc(m.doc(db, "community", key), {
    bookKey: key,
    title: signals[0].title ?? null,
    authors: signals[0].authors ?? [],
    ratingAvg: avg(ratings),
    ratingCount: ratings.length,
    spiceAvg: avg(spices),
    spiceCount: spices.length,
    content,
    reviewCount: signals.filter((s) => s.review).length,
    updatedAt: new Date().toISOString(),
  });
}

// ---------- read ----------

export async function fetchSummary(key) {
  if (!isAvailable()) return null;
  try {
    const fs = await sync.firestore();
    if (!fs) return null;
    const snap = await fs.m.getDoc(fs.m.doc(fs.db, "community", key));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}

export async function fetchReviews(key) {
  if (!isAvailable()) return [];
  try {
    const fs = await sync.firestore();
    if (!fs) return [];
    const snap = await fs.m.getDocs(fs.m.collection(fs.db, "community", key, "signals"));
    return snap.docs
      .map((d) => d.data())
      .filter((s) => s.review)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  } catch {
    return [];
  }
}

// Summaries for a batch of candidate books (recommendation blending).
// Returns Map<bookKey, summary>; missing books simply aren't in the map.
export async function fetchSummaries(keys) {
  const out = new Map();
  if (!sharingEnabled() || !isAvailable() || !keys.length) return out;
  const fs = await sync.firestore();
  if (!fs) return out;
  await Promise.allSettled(
    keys.slice(0, 30).map(async (key) => {
      try {
        const snap = await fs.m.getDoc(fs.m.doc(fs.db, "community", key));
        if (snap.exists()) out.set(key, snap.data());
      } catch { /* skip */ }
    })
  );
  return out;
}
