// Does the series parser catch real-world title shapes, and refuse junk?
import { parseSeriesFromText } from "../js/api.js";
const cases = [
  ["Catching Fire (The Hunger Games, Book 2)", "The Hunger Games", 2],
  ["The Ritual (L.O.R.D.S. Book 1)", "L.O.R.D.S.", 1],
  ["The Sinner (L.O.R.D.S., Book 2)", "L.O.R.D.S.", 2],
  ["Carnage (The Spade Brothers #3)", "The Spade Brothers", 3],
  ["Sabotage (LORDS Series Book 4)", "LORDS", 4],
  ["Madness (Book 5 of the L.O.R.D.S. Series)", "L.O.R.D.S.", 5],
  ["Words of Radiance (The Stormlight Archive, Book Two)", "The Stormlight Archive", 2],
  ["A Court of Mist and Fury (A Court of Thorns and Roses, Vol. 2)", "A Court of Thorns and Roses", 2],
  ["Fourth Wing: The Empyrean, Book 1", "The Empyrean", 1],
  ["Mistborn (Mistborn, #1)", "Mistborn", 1],
  // must NOT match
  ["Piranesi", null],
  ["The Ritual: A Dark College Bully Romance", null],
  ["Project Hail Mary (A Novel)", null],
  ["Circe (Unabridged)", null],
  ["Dune (Deluxe Edition)", null],
  ["The Way of Kings (Illustrated)", null],
];
let pass = 0;
for (const [text, name, pos] of cases) {
  const got = parseSeriesFromText(text);
  const ok = name === null ? got === null : got?.name === name && got?.position === pos;
  if (ok) pass++;
  console.log(`${ok ? "ok  " : "FAIL"} ${text}\n       → ${got ? `${got.name} #${got.position}` : "(none)"}${ok ? "" : `   want ${name === null ? "(none)" : `${name} #${pos}`}`}`);
}
console.log(`\n${pass}/${cases.length}`);
console.log("ERRORS:", pass === cases.length ? "none" : [`${cases.length - pass} title shapes parsed wrong`]);
