// @requires-network — talks to the real Open Library API, not a mock.
import { lookupByIsbn, detectSeries, listSeriesBooks, isbn10to13, normalizeIsbn } from "/home/user/Library-app/js/api.js";

console.log("isbn10to13:", isbn10to13("0439064872")); // expect 9780439064873
console.log("normalize:", normalizeIsbn("978-0-545-01022-1"));

// Harry Potter and the Chamber of Secrets, Scholastic paperback
const book = await lookupByIsbn("9780439064873");
console.log("lookup:", JSON.stringify(book, null, 2));

const series = await detectSeries(book);
console.log("series:", series);

if (series) {
  const list = await listSeriesBooks(series.name, book.authors);
  console.log("series books:", list.map((b) => `${b.title} (${b.year})`).slice(0, 12));
}
