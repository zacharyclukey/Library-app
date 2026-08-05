// Friends: following people, and seeing what they read.
//
// Follow is one-way — you follow someone by entering their code. When they
// follow you back the app calls it a friendship, and friends count for more
// everywhere: their books weigh heaviest in Discover, and their reading shows
// first in the feed.
//
// Identity without accounts
// -------------------------
// There's no sign-up. Each person gets an opaque reader code the first time
// they turn Friends on, and sharing that code is how someone follows you. The
// code is the whole credential, exactly like the library name + password that
// already links two phones — which means the trust model is "give it to people
// you'd give your phone number to". A public release would move this behind
// Firebase Auth; only this module and the rules would change.
//
// Data model (Firestore, alongside community/)
//
//   community/_social/signals/{readerId}
//     { readerId, name, follows: [readerId…], recent: [activity…], updatedAt }
//
// The "signals" subcollection name is deliberate: it's the one the Firestore
// rules in SETUP-SYNC.md already allow under community/, so Friends works on
// a project set up before this existed, with no rule changes.
//
// One document per person holds everything about them: who they follow (so
// mutual friendship can be worked out without a second read) and their recent
// reading (so the feed costs one read per person you follow).

import * as sync from "./sync.js";
import * as db from "./db.js";
import { bookKey } from "./community.js";

const ENABLED_KEY = "shelfie.social.v1";
const ID_KEY = "shelfie.readerId.v1";
const FOLLOWING_KEY = "shelfie.following.v1";
const SOCIAL_DOC = "_social";

// ---------- identity ----------

export function isEnabled() {
  return localStorage.getItem(ENABLED_KEY) === "1";
}

export function setEnabled(on) {
  localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  if (on) myCode();
}

export function isAvailable() {
  return sync.isConfigured();
}

// Readable-ish but not guessable: four groups of four, uppercase, no
// look-alike characters, so it survives being read aloud or typed by hand.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return chars.slice(0, 16).join("").replace(/(.{4})(?=.)/g, "$1-");
}

export function myCode() {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = newCode();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

// Codes are stored and compared without the dashes, so a friend can type them
// however they like.
export function normalizeCode(code) {
  return String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatCode(code) {
  return normalizeCode(code).replace(/(.{4})(?=.)/g, "$1-");
}

export function codeProblem(code) {
  const c = normalizeCode(code);
  if (c.length < 16) return "That code looks too short — it's 16 characters.";
  if (c.length > 16) return "That code looks too long — it's 16 characters.";
  if (c === normalizeCode(myCode())) return "That's your own code.";
  return null;
}

// ---------- who you follow ----------

export function following() {
  try {
    const list = JSON.parse(localStorage.getItem(FOLLOWING_KEY));
    return Array.isArray(list) ? list.map(normalizeCode).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveFollowing(list) {
  localStorage.setItem(FOLLOWING_KEY, JSON.stringify([...new Set(list)]));
}

export function isFollowing(code) {
  return following().includes(normalizeCode(code));
}

export async function follow(code) {
  const id = normalizeCode(code);
  saveFollowing([...following(), id]);
  await publishMe();
  return id;
}

export async function unfollow(code) {
  saveFollowing(following().filter((c) => c !== normalizeCode(code)));
  await publishMe();
}

// ---------- publishing ----------

function readerDoc(fs, id) {
  return fs.m.doc(fs.db, "community", SOCIAL_DOC, "signals", normalizeCode(id));
}

// The reading worth showing: what you finished, rated or reviewed, newest
// first. Titles and your own words only — nothing about the rest of your
// shelves, and nothing you haven't already chosen to record.
function recentActivity(profileName, limit = 25) {
  const rows = db
    .getAllBooks()
    .map((b) => {
      const rating = b.ratings?.[profileName] ?? null;
      const review = b.reviews?.[profileName]?.text ?? null;
      const at = b.reviews?.[profileName]?.updatedAt ?? db.finishedAtFor(b, profileName) ?? null;
      // Finished is per-person now: publish what *this* profile finished,
      // not whatever the record's original single shelf happened to say.
      if (!at || (db.shelfFor(b, profileName) !== "completed" && !rating && !review)) return null;
      return {
        key: bookKey(b),
        title: b.title ?? null,
        authors: b.authors ?? [],
        coverUrl: b.coverUrl ?? null,
        rating,
        review,
        at,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  return rows.slice(0, limit);
}

export async function publishMe(profileName) {
  if (!isEnabled() || !isAvailable()) return false;
  const fs = await sync.firestore();
  if (!fs) return false;
  const name = profileName ?? localStorage.getItem("shelfie.profile.v1") ?? "Someone";
  try {
    await fs.m.setDoc(readerDoc(fs, myCode()), {
      // Lets the rules refuse anyone else overwriting your reader document.
      uid: sync.uid(),
      readerId: normalizeCode(myCode()),
      name,
      follows: following(),
      recent: JSON.parse(JSON.stringify(recentActivity(name))),
      updatedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    return false; // rules not deployed, or offline — never break the app
  }
}

// Debounced: rating five books in a row shouldn't write five times.
let publishTimer = null;
export function publishSoon(profileName) {
  if (!isEnabled() || !isAvailable()) return;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => publishMe(profileName), 4000);
}

// ---------- reading other people ----------

export async function fetchReader(code) {
  if (!isAvailable()) return null;
  try {
    const fs = await sync.firestore();
    if (!fs) return null;
    const snap = await fs.m.getDoc(readerDoc(fs, code));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}

// Everyone you follow, each marked friend (they follow you back) or not.
// Codes that don't resolve come back as `missing` rather than disappearing,
// so a mistyped code can be seen and removed.
export async function fetchFollowing() {
  const mine = normalizeCode(myCode());
  const codes = following();
  if (!codes.length) return [];
  const rows = await Promise.all(
    codes.map(async (code) => {
      const doc = await fetchReader(code);
      if (!doc) return { code, missing: true, friend: false, name: null, recent: [] };
      const follows = Array.isArray(doc.follows) ? doc.follows.map(normalizeCode) : [];
      return {
        code,
        missing: false,
        friend: follows.includes(mine),
        name: doc.name ?? "Someone",
        recent: Array.isArray(doc.recent) ? doc.recent : [],
        updatedAt: doc.updatedAt ?? null,
      };
    })
  );
  // Friends first, then most recently active.
  return rows.sort(
    (a, b) =>
      Number(b.friend) - Number(a.friend) ||
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
  );
}

// One list of everything the people you follow have been reading.
export async function fetchFeed(limit = 40) {
  const readers = await fetchFollowing();
  const items = [];
  for (const r of readers) {
    if (r.missing) continue;
    for (const a of r.recent) {
      items.push({ ...a, who: r.name, friend: r.friend, code: r.code });
    }
  }
  return items
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, limit);
}

// ---------- recommendations ----------

// How much the people you follow like each book you don't have yet.
// Returns Map<bookKey, { score 0..1, who: [names], friend: bool }>.
//
// A friend counts for more than someone you follow one-way, and a book two
// friends have read counts for more than one either has — the point is
// "people whose taste you actually know", not raw popularity.
const FRIEND_WEIGHT = 1;
const FOLLOW_WEIGHT = 0.55;

export async function socialScores(myKeys) {
  const out = new Map();
  if (!isEnabled() || !isAvailable()) return out;
  const readers = await fetchFollowing();
  if (!readers.length) return out;

  const mine = new Set(myKeys);
  for (const reader of readers) {
    if (reader.missing) continue;
    const weight = reader.friend ? FRIEND_WEIGHT : FOLLOW_WEIGHT;
    for (const item of reader.recent) {
      if (!item.key || mine.has(item.key)) continue;
      // A rating they gave shifts it: a 5 counts more than a 2, and a book
      // they simply finished sits in the middle.
      const liked = item.rating ? (item.rating - 2.5) / 2.5 : 0.4;
      if (liked <= 0) continue;
      const prev = out.get(item.key) ?? { score: 0, who: [], friend: false };
      prev.score += weight * liked;
      if (!prev.who.includes(reader.name)) prev.who.push(reader.name);
      prev.friend = prev.friend || reader.friend;
      out.set(item.key, prev);
    }
  }
  const max = Math.max(...[...out.values()].map((v) => v.score), 1);
  for (const [k, v] of out) out.set(k, { ...v, score: v.score / max });
  return out;
}
