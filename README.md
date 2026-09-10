# Sip Ahoy

A small single-page app for finding drinks across every bar and restaurant menu on a Princess Cruises ship — search by name, ingredient, venue, drink type, price, alcohol content, or Princess Plus/Premier package inclusion.

The data was built by scraping the menu photos published at [shinecruise.com/princess-cruises-drinks-menu-prices](https://shinecruise.com/princess-cruises-drinks-menu-prices) (62 menu photos across 32 venues) and transcribing every item with vision — no OCR library, just careful reading of each photo into structured JSON.

> **AI disclaimer:** This app's code and this transcribed dataset were built with AI (Claude).
> Every drink's name, price, and ingredients were read off the source menu photos by an AI vision
> model, not typed in by hand or run through OCR software — so while it's been spot-checked and
> corrected where errors were found, occasional misreads are possible. Please verify anything that
> matters (price, allergens, availability) at the actual bar, and use the 🚩 **report** button on
> any drink to flag something wrong.

## Project layout

```
scripts/fetch-menus.mjs   scrapes the source page, downloads full-res menu photos into public/data/images/
data/extracted/*.json     raw per-batch vision transcriptions (one JSON array of drink items per batch)
scripts/build-drinks.mjs  merges data/extracted/*.json into public/data/drinks.json (validated, de-duplicated, id'd)
public/data/              served as-is by Vite/Pages: drinks.json, ships.json, sources.json, images/
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
npm run audit-names     # fuzzy-match drink names to catch spelling/formatting variants
                         # that should have merged across venues but didn't (e.g. "Cafe
                         # Latte" vs "Caffè Latte") -- add confirmed cases to build-drinks.mjs's
                         # NAME_ALIASES list, then re-run build-drinks
```

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. In the repo's Settings → Pages, set **Source** to **GitHub Actions**.
3. Push to `main` — `.github/workflows/deploy.yml` builds the app with Vite and publishes `dist/` to Pages automatically.

`vite.config.js`'s `base` is hardcoded to `/sip-ahoy/` to match this repo's Pages URL
(<https://sircharlo.github.io/sip-ahoy/>) — the PWA service worker needs a real absolute base for a
reliably-scoped cache. If you fork this under a different repo name, update `BASE` in
`vite.config.js` (and `GITHUB_REPO` in `src/main.js`) to match.

## Offline use (the point of this app on a ship)

This is an installable PWA (`vite-plugin-pwa`) that precaches the entire dataset — every drink
and all 62 menu photos, ~22MB — the first time it's opened. After that first load (do it on wifi
before you sail), it keeps working with zero connectivity: reopen it from your phone's home
screen ("Add to Home Screen" / "Install app") or just revisit the tab, even in airplane mode.
A toast confirms once everything is cached ("Saved for offline use"). `registerType: 'autoUpdate'`
means it silently pulls a newer version whenever it *does* have a connection, so there's nothing
to manually refresh.

## Data caveats

Prices and menu contents are illustrative — cruise line menus change without notice. Always confirm at the bar. A few items may carry a `notes` field flagging partially illegible text from the source photo.
