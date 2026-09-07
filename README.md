# Princess Drink Finder

A small single-page app for finding drinks across every bar and restaurant menu on a Princess Cruises ship — search by name, ingredient, venue, drink type, price, alcohol content, or Princess Plus/Premier package inclusion.

The data was built by scraping the menu photos published at [shinecruise.com/princess-cruises-drinks-menu-prices](https://shinecruise.com/princess-cruises-drinks-menu-prices) (62 menu photos across 32 venues) and transcribing every item with vision — no OCR library, just careful reading of each photo into structured JSON.

## Project layout

```
scripts/fetch-menus.mjs   scrapes the source page, downloads full-res menu photos into public/data/images/
data/extracted/*.json     raw per-batch vision transcriptions (one JSON array of drink items per batch)
scripts/build-drinks.mjs  merges data/extracted/*.json into public/data/drinks.json (validated, de-duplicated, id'd)
public/data/              served as-is by Vite/Pages: drinks.json, sources.json, images/
src/                      the app itself (vanilla JS + CSS, no framework)
```

## Local development

```
npm install
npm run dev
```

## Rebuilding the data

If the source menus change, or you want to re-run/edit the transcription:

```
npm run fetch-menus     # re-scrape shinecruise.com and re-download any new/changed images
# ... regenerate or hand-edit the files under data/extracted/ ...
npm run build-drinks    # merge data/extracted/*.json -> public/data/drinks.json
```

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. In the repo's Settings → Pages, set **Source** to **GitHub Actions**.
3. Push to `main` — `.github/workflows/deploy.yml` builds the app with Vite and publishes `dist/` to Pages automatically.

The app has no client-side router and uses a relative Vite `base`, so it works whether it's served at the domain root or under a project-pages subpath (`https://<user>.github.io/<repo>/`) with no extra config.

## Data caveats

Prices and menu contents are illustrative — cruise line menus change without notice. Always confirm at the bar. A few items may carry a `notes` field flagging partially illegible text from the source photo.
