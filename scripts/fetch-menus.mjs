// Scrapes the shinecruise.com Princess drinks menu page for source menu photos.
// Downloads full-resolution images into data/images/ and writes data/sources.json,
// which maps each image to its venue + caption for provenance and for the
// "view original menu photo" feature in the app.
//
// Re-run with `npm run fetch-menus` to refresh if the source page changes.
// This is a one-off scrape of a third-party page's current HTML structure —
// if shinecruise.com changes their markup, the regexes below will need updates.

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'public', 'data', 'images');
const SOURCES_PATH = path.join(ROOT, 'public', 'data', 'sources.json');

const PAGE_URL = 'https://shinecruise.com/princess-cruises-drinks-menu-prices';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#8217;/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/\s+/g, ' ').trim();
}

function bestFromSrcset(srcset) {
  const entries = srcset.split(',').map((e) => e.trim()).map((e) => {
    const m = e.match(/^(\S+)\s+(\d+)w$/);
    return m ? { url: m[1], w: parseInt(m[2], 10) } : null;
  }).filter(Boolean);
  entries.sort((a, b) => b.w - a.w);
  return entries.length ? entries[0].url : null;
}

function slugify(s) {
  return s.toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extractManifest(html) {
  const startIdx = html.indexOf('id="Princess_Bars_Menu_for_2026"');
  if (startIdx === -1) throw new Error('Could not locate the bars/menus section — page structure may have changed.');
  const afterStart = html.indexOf('</h2>', startIdx);
  const endIdx = html.indexOf('<h2', afterStart);
  const section = html.slice(startIdx, endIdx === -1 ? html.length : endIdx);

  const tokenRe = /<h3[^>]*>([\s\S]*?)<\/h3>|<p class="wp-block-paragraph">([\s\S]*?)<\/p>|<img[^>]*alt="([^"]*)"[^>]*data-lazy-srcset="([^"]*)"[^>]*>/g;

  let m;
  let currentVenue = null;
  let currentCaption = null;
  const manifest = [];
  while ((m = tokenRe.exec(section)) !== null) {
    if (m[1] !== undefined) {
      currentVenue = stripTags(m[1]);
      currentCaption = null;
    } else if (m[2] !== undefined) {
      currentCaption = stripTags(m[2]);
    } else if (m[3] !== undefined) {
      const url = bestFromSrcset(m[4]);
      if (url) manifest.push({ venue: currentVenue, caption: currentCaption, alt: stripTags(m[3]), url });
    }
  }
  return manifest;
}

async function main() {
  console.log(`Fetching ${PAGE_URL} ...`);
  const res = await fetch(PAGE_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();

  const manifest = extractManifest(html);
  console.log(`Found ${manifest.length} menu images across ${new Set(manifest.map((m) => m.venue)).size} venues.`);

  await mkdir(IMAGES_DIR, { recursive: true });

  const venueCounts = new Map();
  const sources = [];

  for (const entry of manifest) {
    const venueSlug = slugify(entry.venue);
    const n = (venueCounts.get(venueSlug) ?? 0) + 1;
    venueCounts.set(venueSlug, n);
    const ext = path.extname(new URL(entry.url).pathname) || '.jpg';
    const filename = `${venueSlug}-${String(n).padStart(2, '0')}${ext}`;
    const localPath = path.join(IMAGES_DIR, filename);

    if (!existsSync(localPath)) {
      process.stdout.write(`Downloading ${filename} ... `);
      const imgRes = await fetch(entry.url, { headers: { 'User-Agent': UA } });
      if (!imgRes.ok) {
        console.log(`FAILED (${imgRes.status})`);
        continue;
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      await writeFile(localPath, buf);
      console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
    } else {
      console.log(`Skipping ${filename} (already downloaded)`);
    }

    sources.push({
      id: path.basename(filename, ext),
      venue: entry.venue,
      caption: entry.caption,
      image: `images/${filename}`,
      sourceUrl: entry.url,
    });
  }

  await writeFile(SOURCES_PATH, JSON.stringify(sources, null, 2));
  console.log(`\nWrote ${sources.length} entries to ${path.relative(ROOT, SOURCES_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
