// Scans public/data/drinks.json for drink names that are probably the same product under a
// different spelling/abbreviation ("Cafe Latte" vs "Caffè Latte") and didn't merge in
// build-drinks.mjs. Prints candidates for manual review — add confirmed cases to that
// script's NAME_ALIASES list, then re-run `npm run build-drinks`.
//
// Run with `npm run audit-names` any time the transcription batches change.

import { readFileSync } from 'node:fs';

const items = JSON.parse(readFileSync('public/data/drinks.json', 'utf8'));

function foldAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normalize(s) {
  return foldAccents(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

const normed = items.map((it) => ({ ...it, _norm: normalize(it.name) }));

// Bucket by first 2 chars + rough length to cut down comparisons.
const buckets = new Map();
for (const it of normed) {
  const key = it._norm.slice(0, 2);
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(it);
}

const seen = new Set();
const candidates = [];
for (const bucket of buckets.values()) {
  for (let i = 0; i < bucket.length; i++) {
    for (let j = i + 1; j < bucket.length; j++) {
      const a = bucket[i], b = bucket[j];
      if (a._norm === b._norm) continue; // would already be same slug/merged unless price differs -- handled separately
      const maxLen = Math.max(a._norm.length, b._norm.length);
      if (Math.abs(a._norm.length - b._norm.length) > 4) continue;
      const dist = levenshtein(a._norm, b._norm);
      const ratio = dist / maxLen;
      if (dist <= 3 && ratio <= 0.25) {
        const pairKey = [a.id, b.id].sort().join('|');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        candidates.push({ a, b, dist, ratio });
      }
    }
  }
}

// Also catch exact-normalized-name matches that DIDN'T merge because price or type differs.
const byNorm = new Map();
for (const it of normed) {
  if (!byNorm.has(it._norm)) byNorm.set(it._norm, []);
  byNorm.get(it._norm).push(it);
}
console.log('=== Exact same normalized name, but separate items (price/type differs) ===');
for (const [norm, group] of byNorm.entries()) {
  if (group.length < 2) continue;
  console.log(`\n"${norm}":`);
  group.forEach((it) => console.log(`  ${it.name} | $${it.price} | ${it.type} | ${it.venues.map((v) => v.venue).join(', ')}`));
}

console.log(`\n\n=== ${candidates.length} fuzzy near-duplicate name candidates (edit distance <= 3) ===`);
candidates.sort((x, y) => x.ratio - y.ratio);
for (const { a, b, dist } of candidates) {
  console.log(`\n[dist=${dist}] "${a.name}" ($${a.price}, ${a.type}) <-> "${b.name}" ($${b.price}, ${b.type})`);
  console.log(`  A venues: ${a.venues.map((v) => v.venue).join(', ')}`);
  console.log(`  B venues: ${b.venues.map((v) => v.venue).join(', ')}`);
}
