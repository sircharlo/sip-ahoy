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

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function coerceNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
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

  const seenIds = new Map();
  const seenDupeKeys = new Map(); // (venue, name, price) -> true duplicate photo/listing
  const missingImages = new Set();
  const warnings = [];
  const duplicatesDropped = [];
  const items = [];

  for (const item of raw) {
    if (!item.name || !item.venueSlug) {
      warnings.push(`Skipped item with missing name/venueSlug in ${item._batch}: ${JSON.stringify(item).slice(0, 120)}`);
      continue;
    }
    const type = VALID_TYPES.has(item.type) ? item.type : 'other';
    if (type !== item.type) warnings.push(`${item._batch}: unrecognized type "${item.type}" on "${item.name}" -> coerced to "other"`);

    const price = coerceNumber(item.price);
    const priceBottle = coerceNumber(item.priceBottle);

    // Same venue + same name + same price is almost certainly the same drink seen twice
    // (e.g. two source photos of the same physical menu page) rather than a coincidence.
    const dupeKey = `${item.venueSlug}|${slugify(item.name)}|${price}`;
    if (seenDupeKeys.has(dupeKey)) {
      duplicatesDropped.push(`${item.venue} / ${item.name} (${item._batch}, dup of ${seenDupeKeys.get(dupeKey)})`);
      continue;
    }
    seenDupeKeys.set(dupeKey, item._batch);

    let baseId = `${item.venueSlug}-${slugify(item.name)}`;
    let id = baseId;
    let n = 2;
    while (seenIds.has(id)) {
      id = `${baseId}-${n++}`;
    }
    seenIds.set(id, true);

    if (item.sourceImage) {
      const localPath = path.join(IMAGES_DIR, item.sourceImage.replace(/^images\//, ''));
      if (existsSync(IMAGES_DIR) && !existsSync(localPath)) missingImages.add(item.sourceImage);
    }

    items.push({
      id,
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
      package: item.package === 'plus' || item.package === 'premier' ? item.package : null,
      premium: Boolean(item.premium),
      alcoholic: item.alcoholic !== false,
      region: item.region || null,
      notes: item.notes || null,
      sourceImage: item.sourceImage || null,
    });
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2));

  console.log(`\nWrote ${items.length} items to ${path.relative(ROOT, OUTPUT_PATH)}`);

  const byVenue = new Map();
  for (const it of items) byVenue.set(it.venue, (byVenue.get(it.venue) || 0) + 1);
  console.log(`\nVenues (${byVenue.size}):`);
  for (const [v, c] of [...byVenue.entries()].sort()) console.log(`  ${v}: ${c}`);

  if (duplicatesDropped.length) {
    console.log(`\n${duplicatesDropped.length} duplicate(s) dropped (same venue+name+price seen twice):`);
    duplicatesDropped.forEach((d) => console.log(`  - ${d}`));
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
