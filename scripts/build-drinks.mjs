// Merges the per-batch transcription outputs in data/extracted/*.json into a single
// validated, de-duplicated dataset at public/data/drinks.json, which the app fetches at runtime.
//
// Re-run with `npm run build-drinks` after editing/regenerating any batch file.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXTRACTED_DIR = path.join(ROOT, 'data', 'extracted');
const IMAGES_DIR = path.join(ROOT, 'public', 'data', 'images');
const OUTPUT_PATH = path.join(ROOT, 'public', 'data', 'drinks.json');

const VALID_TYPES = new Set(['cocktail', 'mocktail', 'spirit', 'wine', 'beer', 'cider', 'coffee', 'tea', 'soda', 'dessert', 'other']);

// Princess doesn't print a per-item Plus/Premier flag consistently across menus, so instead
// of trusting each menu's own formatting we derive package inclusion from a fleet-wide rule:
// Plus covers drinks $15 and under, Premier covers everything Plus does plus $15.01-$20.
// (Premier is a superset of Plus, so "plus" already implies "also under premier".)
const PLUS_MAX = 15;
const PREMIER_MAX = 20;

// Accent-fold first so transcription inconsistencies like "Rosé" vs "Rose" between
// batches (different agents, same wine) still land in the same dedup/slug bucket.
function foldAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Known transcription inconsistencies for the SAME product across independently-transcribed
// menu photos: brand-name typos, English/Spanish spelling of the same printed brand, and
// abbreviation punctuation ("X.O" vs "XO"). Found via scripts/_audit-spelling.mjs — a fuzzy
// edit-distance scan across the merged dataset — and verified by hand against the source
// photos before adding here, since a wrong alias would silently merge two different drinks.
const NAME_ALIASES = [
  [/\billegal\b/g, 'ilegal'], // "Ilegal Mezcal" is the correct brand spelling (one L)
  [/\bazzuro\b/g, 'azzurro'], // Peroni Nastro Azzurro
  [/\bvila sandi\b/g, 'villa sandi'],
  [/\bbarons de rothschild\b/g, 'baron de rothschild'],
  [/\bjadoyt\b/g, 'jadot'], // Maison Louis Jadot
  [/\breserve ocho\b/g, 'reserva ocho'], // Bacardi Reserva Ocho
  [/\bno 10\b/g, 'no ten'], // Tanqueray No. 10 / No. Ten / N° Ten
  [/\bn ten\b/g, 'no ten'],
  [/\b(\d+)\s*yr\b/g, '$1 yo'], // "12 Yr" vs "12 YO" age statements
  [/\bcaffe\b/g, 'cafe'], // "Caffè Latte" (accent-folded to "caffe") vs "Cafe Latte"
  // Melorosa wines print as "X by Jason Aldean[, CA/California]" almost everywhere, but
  // Butcher's Block flips the word order and abbreviates "Sauvignon" — same two wines either way.
  [/\bby jason aldean,? ca(lifornia)?\b/g, 'by jason aldean'],
  [/\bmelorosa jason aldean red blend\b/g, 'melorosa red blend by jason aldean'],
  [/\bmelorosa jason aldean sauv blanc\b/g, 'melorosa sauvignon blanc by jason aldean'],
];

function slugify(s) {
  let normalized = foldAccents(s)
    .toLowerCase()
    .replace(/[.°]/g, ''); // strip abbreviation punctuation without splitting words: "X.O" -> "xo"
  for (const [pattern, replacement] of NAME_ALIASES) normalized = normalized.replace(pattern, replacement);
  return normalized
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function coerceNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function packageFromPrice(price) {
  if (price === null || price === undefined) return null;
  if (price <= PLUS_MAX) return 'plus';
  if (price <= PREMIER_MAX) return 'premier';
  return null;
}

// A handful of menus explicitly mark an item as a Premier-only perk regardless of its low
// price (e.g. Coffee & Cones granitas: "$8, complimentary for guests with Princess Premier" —
// no mention of Plus). Only fires on genuine positive inclusion language, not on "Beyond"/
// "not included with Plus or Premier" notes, which always mention Plus too and are left alone.
function isPremierOnlyOverride(notes) {
  if (!notes) return false;
  return /complimentary for guests with princess premier/i.test(notes) && !/\bplus\b/i.test(notes);
}

function main() {
  if (!existsSync(EXTRACTED_DIR)) {
    console.error(`Missing ${path.relative(ROOT, EXTRACTED_DIR)} — nothing to merge.`);
    process.exit(1);
  }

  const batchFiles = readdirSync(EXTRACTED_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!batchFiles.length) {
    console.error('No batch-*.json files found in data/extracted/.');
    process.exit(1);
  }

  const raw = [];
  for (const file of batchFiles) {
    const fullPath = path.join(EXTRACTED_DIR, file);
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
    } catch (err) {
      console.error(`FAILED to parse ${file}: ${err.message}`);
      process.exit(1);
    }
    if (!Array.isArray(parsed)) {
      console.error(`${file} is not a JSON array — skipping.`);
      continue;
    }
    console.log(`${file}: ${parsed.length} items`);
    for (const item of parsed) raw.push({ ...item, _batch: file });
  }

  const warnings = [];
  const missingImages = new Set();

  // Phase 1: normalize each raw record (still one per venue listing).
  const records = [];
  for (const item of raw) {
    if (!item.name || !item.venueSlug) {
      warnings.push(`Skipped item with missing name/venueSlug in ${item._batch}: ${JSON.stringify(item).slice(0, 120)}`);
      continue;
    }
    let type = VALID_TYPES.has(item.type) ? item.type : 'other';
    if (type !== item.type) warnings.push(`${item._batch}: unrecognized type "${item.type}" on "${item.name}" -> coerced to "other"`);

    const alcoholic = item.alcoholic !== false;
    // `type` is "which menu shelf it's on," not "does it contain coffee": an Irish coffee or
    // espresso martini is a cocktail that happens to use coffee, same shelf as any other mixed
    // drink. Reserve "coffee" for the non-alcoholic coffee-shop order. Enforced here (not left
    // to each transcription batch's judgment) so it can't drift on a re-transcription, and so
    // the same drink transcribed as "coffee" by one batch and "cocktail" by another still
    // matches on `type` during cross-venue grouping.
    if (type === 'coffee' && alcoholic) type = 'cocktail';

    const price = coerceNumber(item.price);
    const priceBottle = coerceNumber(item.priceBottle);

    if (item.sourceImage) {
      const localPath = path.join(IMAGES_DIR, item.sourceImage.replace(/^images\//, ''));
      if (existsSync(IMAGES_DIR) && !existsSync(localPath)) missingImages.add(item.sourceImage);
    }

    records.push({
      name: String(item.name).trim(),
      venue: item.venue,
      venueSlug: item.venueSlug,
      venueType: item.venueType || 'other',
      type,
      category: item.category || null,
      description: item.description || '',
      ingredients: Array.isArray(item.ingredients) ? item.ingredients.map((s) => String(s).trim().toLowerCase()).filter(Boolean) : [],
      price,
      priceText: item.priceText || (price !== null ? `$${price.toFixed(2)}` : null),
      priceBottle,
      premium: Boolean(item.premium),
      alcoholic,
      region: item.region || null,
      notes: item.notes || null,
      sourceImage: item.sourceImage || null,
    });
  }

  // Same venue + same name + same price is the same listing even if two independent
  // transcriptions (e.g. two overlapping source photos of one physical menu, like the
  // Coffee Currents page scraped twice under different captions) judged its `type`
  // differently — e.g. a spirited coffee filed as "cocktail" by one pass and "coffee" by
  // another. Collapse those before cross-venue grouping so they don't show up twice.
  const perVenueSeen = new Map();
  const sameVenueDuplicatesDropped = [];
  const dedupedRecords = [];
  for (const rec of records) {
    const key = `${rec.venueSlug}|${slugify(rec.name)}|${rec.price}`;
    if (perVenueSeen.has(key)) {
      sameVenueDuplicatesDropped.push(`${rec.venue} / ${rec.name} (type "${rec.type}", already have "${perVenueSeen.get(key)}")`);
      continue;
    }
    perVenueSeen.set(key, rec.type);
    dedupedRecords.push(rec);
  }

  // A few drink names are reused fleet-wide for genuinely different recipes that happen to
  // share a name, type, and price by coincidence — verified by hand via scripts/_audit-merges.mjs
  // (a token-overlap similarity check across every multi-venue group). These must NOT merge.
  const FORCE_SPLIT_KEYS = new Set([
    `${slugify("Captain's Bounty")}|11|cocktail`, // Standard Bar: Bacardi/Kraken rums + Coca-Cola. Crab Shack: Sailor Jerry/Cruzan rums + pineapple/sweet-sour.
    `${slugify('Passion Lilly')}|14|cocktail`, // Bellini's: Montenegro Amaro + vermouth. Cascades: vanilla vodka + lychee + prosecco.
  ]);

  // Phase 2: group identical drinks (same name + price + recipe) served at multiple venues —
  // e.g. "24k Margarita" is poured at Wheelhouse, The MIX, Bellini's, Crooners, etc. identically.
  // Matched on name+price+type rather than the full description text: two independent
  // transcriptions of the same physical drink can word the recipe slightly differently
  // ("Grand Marnier" vs "Grand Marnier float"), but `type` still guards against merging a
  // cocktail with an unrelated mocktail that happens to share a name and price.
  const groups = new Map();
  for (const rec of dedupedRecords) {
    let key = `${slugify(rec.name)}|${rec.price}|${rec.type}`;
    if (FORCE_SPLIT_KEYS.has(key)) key += `|${rec.venueSlug}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }

  const seenIds = new Map();
  const items = [];

  for (const group of groups.values()) {
    const first = group[0];

    const venues = [];
    const seenVenueSlugs = new Set();
    for (const rec of group) {
      if (seenVenueSlugs.has(rec.venueSlug)) continue; // same drink photographed twice at the same venue
      seenVenueSlugs.add(rec.venueSlug);
      venues.push({ venue: rec.venue, venueSlug: rec.venueSlug, venueType: rec.venueType, sourceImage: rec.sourceImage });
    }
    venues.sort((a, b) => a.venue.localeCompare(b.venue));

    let pkg = packageFromPrice(first.price);
    if (group.some((rec) => isPremierOnlyOverride(rec.notes))) pkg = 'premier';

    const notes = group.map((rec) => rec.notes).find(Boolean) || null;

    const priceSuffix = first.price !== null ? `-${first.price}` : '';
    let baseId = `${slugify(first.name)}${priceSuffix}`;
    let id = baseId;
    let n = 2;
    while (seenIds.has(id)) id = `${baseId}-${n++}`;
    seenIds.set(id, true);

    items.push({
      id,
      name: first.name,
      venues,
      type: first.type,
      category: first.category,
      description: first.description,
      ingredients: first.ingredients,
      price: first.price,
      priceText: first.priceText,
      priceBottle: first.priceBottle,
      package: pkg,
      premium: group.some((rec) => rec.premium),
      alcoholic: first.alcoholic,
      region: first.region,
      notes,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2));

  const totalListings = records.length;
  const mergedAway = totalListings - items.length;
  console.log(`\nWrote ${items.length} distinct drinks to ${path.relative(ROOT, OUTPUT_PATH)} (from ${totalListings} menu listings, ${mergedAway} merged as duplicates/cross-venue repeats)`);

  const multiVenue = items.filter((it) => it.venues.length > 1).sort((a, b) => b.venues.length - a.venues.length);
  console.log(`\n${multiVenue.length} drinks appear at more than one venue. Top 10:`);
  multiVenue.slice(0, 10).forEach((it) => console.log(`  ${it.name} (${it.venues.length} venues): ${it.venues.map((v) => v.venue).join(', ')}`));

  const byVenue = new Map();
  for (const it of items) for (const v of it.venues) byVenue.set(v.venue, (byVenue.get(v.venue) || 0) + 1);
  console.log(`\nVenues (${byVenue.size}), drinks available at each:`);
  for (const [v, c] of [...byVenue.entries()].sort()) console.log(`  ${v}: ${c}`);

  const packageCounts = { plus: 0, premier: 0, none: 0 };
  for (const it of items) packageCounts[it.package || 'none']++;
  console.log(`\nPackage inclusion: Plus ${packageCounts.plus}, Premier-only ${packageCounts.premier}, not included ${packageCounts.none}`);

  if (sameVenueDuplicatesDropped.length) {
    console.log(`\n${sameVenueDuplicatesDropped.length} same-venue duplicate(s) dropped (same venue+name+price, differing only in judged type):`);
    sameVenueDuplicatesDropped.forEach((d) => console.log(`  - ${d}`));
  }
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    warnings.forEach((w) => console.log(`  - ${w}`));
  }
  if (missingImages.size) {
    console.log(`\n${missingImages.size} referenced source image(s) not found under public/data/images/:`);
    [...missingImages].forEach((f) => console.log(`  - ${f}`));
  }
}

main();
