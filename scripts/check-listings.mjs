// Run: node scripts/check-listings.mjs
// Flags closed listings, ones closing within 7 days, missing fields and non-https links.
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("../public/data/listings.json", import.meta.url)));
const now = Date.now();
const DAY = 86_400_000;
let problems = 0;

console.log(`Listings: ${data.items.length} · data updated ${data.updated}`);
for (const k of ["usd", "gbp"]) {
  const age = Math.round((now - new Date(data.rates[k].date)) / DAY);
  if (age > 7) { console.log(`⚠  ${k.toUpperCase()} rate is ${age} days old`); problems++; }
}

const ids = new Set();
for (const it of data.items) {
  const tag = `[${it.cat}] ${it.title}`;
  for (const f of ["id", "cat", "title", "get", "who", "steps", "link"]) {
    if (!it[f] || (Array.isArray(it[f]) && !it[f].length)) { console.log(`✖  ${tag}: missing ${f}`); problems++; }
  }
  if (ids.has(it.id)) { console.log(`✖  duplicate id ${it.id}`); problems++; }
  ids.add(it.id);
  if (!String(it.link).startsWith("https://")) { console.log(`✖  ${tag}: link must be https`); problems++; }
  if (it.rolling) continue;
  if (!it.due) { console.log(`✖  ${tag}: no due date`); problems++; continue; }
  const days = (new Date(it.due) - now) / DAY;
  if (it.opens) { if (days < 0) console.log(`ℹ  ${tag}: should be open now — confirm and update`); continue; }
  if (days < 0) { console.log(`✖  ${tag}: CLOSED (${it.dueText}) — remove or roll to next cycle`); problems++; }
  else if (days < 7) console.log(`⏰ ${tag}: ${Math.ceil(days)} day(s) left`);
  if (it.flag) console.log(`?  ${tag}: needs confirming — ${it.flag}`);
}
console.log(problems ? `\n${problems} problem(s) to fix.` : "\nAll good.");
process.exitCode = problems ? 1 : 0;
