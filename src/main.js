import './style.css';
import { registerSW } from 'virtual:pwa-register';

const DATA_URL = 'data/drinks.json';
const PAGE_SIZE = 60;
// Where "report an issue" files a prepopulated GitHub issue against.
const GITHUB_REPO = 'sircharlo/sip-ahoy';

const TYPE_LABELS = {
  cocktail: 'Cocktail',
  mocktail: 'Mocktail',
  spirit: 'Spirit',
  wine: 'Wine',
  beer: 'Beer',
  cider: 'Cider',
  coffee: 'Coffee',
  tea: 'Tea',
  soda: 'Soda',
  dessert: 'Dessert',
  other: 'Other',
};

const state = {
  query: '',
  types: new Set(),
  venueTypes: new Set(),
  venues: new Set(),
  ingredients: new Set(),
  alcoholic: 'all', // all | yes | no
  pkg: 'all', // all | plus | premier | none
  minPrice: null,
  maxPrice: null,
  sort: 'relevance',
  page: 1,
};

let ALL_ITEMS = [];
let ITEMS_BY_ID = new Map();
let dataMinPrice = 0;
let dataMaxPrice = 100;
// Stable filter option lists, computed once from the full dataset — only their counts
// (see updateFacetCounts) change as filters are applied, so the lists themselves don't
// reorder or jump around while browsing.
const FACET_OPTIONS = { ingredients: [] };
// Every distinct ingredient (no frequency floor), for the ingredient search box — separate
// from FACET_OPTIONS.ingredients, which is just the top ~28 shown as default quick-pick chips.
let ALL_INGREDIENTS = [];

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function formatMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return `$${n.toFixed(2).replace(/\.00$/, '')}`;
}

function priceLabel(item) {
  if (item.priceBottle) {
    const g = formatMoney(item.price) ?? '?';
    const b = formatMoney(item.priceBottle);
    return `${g} gl / ${b} btl`;
  }
  if (item.price === null || item.price === undefined) return item.priceText || 'Price not listed';
  return formatMoney(item.price);
}

function hasAllIngredients(item, wantedIterable) {
  const ings = item.ingredients || [];
  for (const wanted of wantedIterable) {
    if (!ings.some((ing) => ing.includes(wanted))) return false;
  }
  return true;
}

function buildSearchIndex(item) {
  return [item.name, item.description, item.category, item.venues.map((v) => v.venue).join(' '), (item.ingredients || []).join(' ')]
    .join(' ')
    .toLowerCase();
}

function buildIssueUrl(item) {
  const imageUrl = new URL(`data/${item.venues[0].sourceImage}`, window.location.href).href;
  const venueNames = item.venues.map((v) => v.venue).join(', ');
  const title = `Data issue: "${item.name}" at ${venueNames}`;
  const { _id, _search, ...clean } = item;
  const body = [
    `**Drink:** ${item.name}`,
    `**Venue(s):** ${venueNames}${item.category ? ` (${item.category})` : ''}`,
    `**Price shown:** ${priceLabel(item)}`,
    `**Item ID:** \`${item.id}\``,
    `**Source menu photo:** ${imageUrl}`,
    '',
    '### What\'s wrong?',
    '<!-- e.g. wrong price, wrong ingredients, wrong venue, drink no longer offered, etc. -->',
    '',
    '',
    '<details><summary>Current data</summary>',
    '',
    '```json',
    JSON.stringify(clean, null, 2),
    '```',
    '</details>',
  ].join('\n');
  const params = new URLSearchParams({ title, body, labels: 'data-correction' });
  return `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
}

async function init() {
  const app = document.getElementById('app');
  app.innerHTML = shellHtml();

  const results = document.getElementById('results');
  results.innerHTML = `<div class="empty-state">Loading drink menu&hellip;</div>`;

  let items;
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    items = await res.json();
  } catch (err) {
    results.innerHTML = `<div class="empty-state">Couldn't load drink data (${escapeHtml(err.message)}).<br>Make sure <code>data/drinks.json</code> exists.</div>`;
    return;
  }

  ALL_ITEMS = items.map((item, i) => ({
    ...item,
    _id: item.id || `item-${i}`,
    _search: buildSearchIndex(item),
  }));
  ITEMS_BY_ID = new Map(ALL_ITEMS.map((item) => [item._id, item]));

  const prices = ALL_ITEMS.map((i) => i.price).filter((p) => typeof p === 'number');
  dataMinPrice = Math.floor(Math.min(...prices));
  dataMaxPrice = Math.ceil(Math.max(...prices));

  buildFilters(ALL_ITEMS);
  wireEvents();
  render();
}

function shellHtml() {
  return `
    <header class="app-header">
      <div class="app-header__top">
        <div class="app-header__brand">
          <img src="icons/icon-192.png" alt="" class="app-logo" width="36" height="36" />
          <div>
            <h1>Sip Ahoy</h1>
            <div class="tagline">Search every bar &amp; restaurant drink menu on your Princess cruise</div>
          </div>
        </div>
        <button class="filters-toggle" id="filtersToggle" type="button">Filters</button>
      </div>
      <div class="search-row">
        <input type="search" id="searchInput" placeholder="Search drinks, ingredients, venues&hellip;" autocomplete="off" aria-label="Search drinks, ingredients, venues" />
      </div>
    </header>
    <div class="layout">
      <aside class="filters" id="filtersPanel">
        <button class="filters-close" id="filtersClose" type="button" aria-label="Close filters">&times;</button>
        <div id="filtersBody"></div>
        <button class="reset-btn" id="resetBtn" type="button">Reset all filters</button>
      </aside>
      <main>
        <div class="results-header">
          <span id="resultCount" aria-live="polite"></span>
        </div>
        <div class="results-grid" id="results"></div>
        <div id="loadMoreWrap" style="text-align:center; margin-top:20px;"></div>
      </main>
    </div>
    <footer class="app-footer">
      This app was built with AI (Claude), which also read every drink off the source menu
      photos — occasional misreads are possible; use 🚩 report on any drink to flag one.<br>
      Prices and menus are illustrative and subject to change onboard — always confirm at the bar.
      Source: shinecruise.com Princess Cruises drink menu photos.
    </footer>
    <div id="modalRoot"></div>
  `;
}

function buildFilters(items) {
  const typeCounts = new Map();
  const venueTypeCounts = new Map();
  const venueSet = new Map(); // venue -> venueType (first seen), just to know which venues exist
  const ingredientCounts = new Map();

  for (const item of items) {
    typeCounts.set(item.type, (typeCounts.get(item.type) || 0) + 1);
    for (const v of item.venues) {
      venueTypeCounts.set(v.venueType, (venueTypeCounts.get(v.venueType) || 0) + 1);
      if (!venueSet.has(v.venue)) venueSet.set(v.venue, v.venueType);
    }
    for (const ing of item.ingredients || []) {
      const key = ing.trim();
      if (!key || key.length < 3) continue;
      ingredientCounts.set(key, (ingredientCounts.get(key) || 0) + 1);
    }
  }

  // These lists (which options exist, in what order) are fixed at load time — only their
  // counts (rendered as empty <span class="count"> here) update live, in updateFacetCounts.
  FACET_OPTIONS.ingredients = [...ingredientCounts.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 28)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ing]) => ing);
  // Unfiltered (no frequency floor) — backs the "search any ingredient" box, since plenty of
  // real ingredients (e.g. a specific liqueur) are too rare to make the top-28 quick-pick list.
  ALL_INGREDIENTS = [...ingredientCounts.keys()].sort((a, b) => a.localeCompare(b));

  const sortedVenues = [...venueSet.keys()].sort((a, b) => a.localeCompare(b));
  const sortedTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const sortedVenueTypes = [...venueTypeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);

  const body = document.getElementById('filtersBody');
  body.innerHTML = `
    <h2>Drink type</h2>
    <div class="chip-row" id="typeChips">
      ${sortedTypes
        .map(
          (t) =>
            `<button class="chip" data-kind="type" data-value="${t}" type="button">${TYPE_LABELS[t] || t} <span class="count"></span></button>`
        )
        .join('')}
    </div>

    <h2>Alcohol</h2>
    <div class="chip-row" id="alcoholChips">
      <button class="chip active" data-kind="alcoholic" data-value="all" type="button">All <span class="count"></span></button>
      <button class="chip" data-kind="alcoholic" data-value="yes" type="button">Alcoholic <span class="count"></span></button>
      <button class="chip" data-kind="alcoholic" data-value="no" type="button">Non-alcoholic <span class="count"></span></button>
    </div>

    <h2>Price</h2>
    <div class="price-row">
      <input type="number" id="minPrice" placeholder="$${dataMinPrice}" min="0" aria-label="Minimum price" />
      <span>&ndash;</span>
      <input type="number" id="maxPrice" placeholder="$${dataMaxPrice}" min="0" aria-label="Maximum price" />
    </div>

    <h2>Drink package</h2>
    <select id="pkgSelect" aria-label="Drink package filter">
      <option value="all">Any</option>
      <option value="plus">Included with Plus</option>
      <option value="premier">Included with Premier</option>
      <option value="none">Not included in a package</option>
    </select>

    <h2>Venue type</h2>
    <div class="chip-row" id="venueTypeChips">
      ${sortedVenueTypes
        .map(
          (t) =>
            `<button class="chip" data-kind="venueType" data-value="${t}" type="button">${escapeHtml(t)} <span class="count"></span></button>`
        )
        .join('')}
    </div>

    <h2>Venue</h2>
    <div class="venue-list" id="venueList">
      ${sortedVenues
        .map(
          (v) => `
        <label>
          <input type="checkbox" data-kind="venue" value="${escapeHtml(v)}" />
          ${escapeHtml(v)} <span class="count"></span>
        </label>`
        )
        .join('')}
    </div>

    <h2>Ingredients</h2>
    <div class="ingredient-search">
      <input type="text" id="ingredientSearchInput" placeholder="Search any ingredient&hellip;" autocomplete="off" aria-label="Search ingredients" />
      <div class="ingredient-suggestions" id="ingredientSuggestions" hidden></div>
    </div>
    <div class="chip-row" id="selectedIngredientChips"></div>
    <div class="chip-row" id="ingredientChips"></div>

    <h2>Sort by</h2>
    <select id="sortSelect" aria-label="Sort results by">
      <option value="relevance">Relevance</option>
      <option value="name">Name A&ndash;Z</option>
      <option value="price-asc">Price: low to high</option>
      <option value="price-desc">Price: high to low</option>
      <option value="venue">Venue A&ndash;Z</option>
    </select>
  `;
}

function wireEvents() {
  document.getElementById('searchInput').addEventListener(
    'input',
    debounce((e) => {
      state.query = e.target.value.trim().toLowerCase();
      state.page = 1;
      render();
    }, 150)
  );

  document.getElementById('filtersBody').addEventListener('click', (e) => {
    const chip = e.target.closest('button[data-kind]');
    if (chip) {
      const { kind, value } = chip.dataset;
      if (kind === 'type') toggleSetChip(state.types, value, chip);
      else if (kind === 'venueType') toggleSetChip(state.venueTypes, value, chip);
      else if (kind === 'ingredient') {
        toggleSetChip(state.ingredients, value, chip);
        // Selecting a suggestion: clear the search box so it's ready for the next ingredient.
        if (chip.closest('#ingredientSuggestions')) {
          document.getElementById('ingredientSearchInput').value = '';
          renderIngredientSuggestions('');
        }
      } else if (kind === 'alcoholic') {
        state.alcoholic = value;
        document.querySelectorAll('#alcoholChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.value === value));
      }
      state.page = 1;
      render();
    }
  });

  const ingredientSearchInput = document.getElementById('ingredientSearchInput');
  ingredientSearchInput.addEventListener(
    'input',
    debounce((e) => renderIngredientSuggestions(e.target.value.trim().toLowerCase()), 120)
  );
  ingredientSearchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    document.querySelector('#ingredientSuggestions button')?.click();
  });
  ingredientSearchInput.addEventListener('blur', () => {
    // Delay so a click on a suggestion registers before the dropdown disappears.
    setTimeout(() => renderIngredientSuggestions(''), 150);
  });

  document.getElementById('filtersBody').addEventListener('change', (e) => {
    if (e.target.matches('[data-kind="venue"]')) {
      if (e.target.checked) state.venues.add(e.target.value);
      else state.venues.delete(e.target.value);
      state.page = 1;
      render();
    }
    if (e.target.id === 'pkgSelect') {
      state.pkg = e.target.value;
      state.page = 1;
      render();
    }
    if (e.target.id === 'sortSelect') {
      state.sort = e.target.value;
      state.page = 1;
      render();
    }
  });

  const priceHandler = debounce(() => {
    const min = document.getElementById('minPrice').value;
    const max = document.getElementById('maxPrice').value;
    state.minPrice = min === '' ? null : Number(min);
    state.maxPrice = max === '' ? null : Number(max);
    state.page = 1;
    render();
  }, 250);
  document.getElementById('filtersBody').addEventListener('input', (e) => {
    if (e.target.id === 'minPrice' || e.target.id === 'maxPrice') priceHandler();
  });

  document.getElementById('resetBtn').addEventListener('click', resetFilters);

  const openFilters = () => {
    document.getElementById('filtersPanel').classList.add('open');
    document.body.classList.add('no-scroll');
  };
  const closeFilters = () => {
    document.getElementById('filtersPanel').classList.remove('open');
    document.body.classList.remove('no-scroll');
  };
  document.getElementById('filtersToggle').addEventListener('click', openFilters);
  document.getElementById('filtersClose').addEventListener('click', closeFilters);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFilters();
  });

  document.getElementById('results').addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-view-image]');
    if (viewBtn) {
      openImageModal(viewBtn.dataset.viewImage, viewBtn.dataset.viewCaption);
      return;
    }
    const flagBtn = e.target.closest('[data-flag-id]');
    if (flagBtn) {
      const item = ITEMS_BY_ID.get(flagBtn.dataset.flagId);
      if (item) window.open(buildIssueUrl(item), '_blank', 'noopener');
      return;
    }
    if (e.target.id === 'emptyStateReset') resetFilters();
  });
}

function resetFilters() {
  state.query = '';
  state.types.clear();
  state.venueTypes.clear();
  state.venues.clear();
  state.ingredients.clear();
  state.alcoholic = 'all';
  state.pkg = 'all';
  state.minPrice = null;
  state.maxPrice = null;
  state.sort = 'relevance';
  state.page = 1;
  document.getElementById('searchInput').value = '';
  document.getElementById('minPrice').value = '';
  document.getElementById('maxPrice').value = '';
  document.getElementById('pkgSelect').value = 'all';
  document.getElementById('sortSelect').value = 'relevance';
  document.getElementById('ingredientSearchInput').value = '';
  renderIngredientSuggestions('');
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  document.querySelector('#alcoholChips .chip[data-value="all"]')?.classList.add('active');
  document.querySelectorAll('#venueList input[type="checkbox"]').forEach((cb) => (cb.checked = false));
  render();
}

function toggleSetChip(set, value, chipEl) {
  if (set.has(value)) {
    set.delete(value);
    chipEl.classList.remove('active');
  } else {
    set.add(value);
    chipEl.classList.add('active');
  }
}

// `except` skips one dimension's own constraint so callers can ask "how many results would
// match if I also picked option X in dimension D" — i.e. all filters EXCEPT D itself. Used both
// for the real result set (except: null) and for live per-option facet counts.
function matchesFiltersExcept(item, except) {
  if (except !== 'query' && state.query) {
    const words = state.query.split(/\s+/).filter(Boolean);
    if (!words.every((w) => item._search.includes(w))) return false;
  }
  if (except !== 'types' && state.types.size && !state.types.has(item.type)) return false;
  if (except !== 'venueTypes' && state.venueTypes.size && !item.venues.some((v) => state.venueTypes.has(v.venueType))) return false;
  if (except !== 'venues' && state.venues.size && !item.venues.some((v) => state.venues.has(v.venue))) return false;
  // Ingredients are AND-within-group (select ginger, then mint -> drinks with BOTH), unlike
  // every other facet here, because ingredients describe a single drink's composition: picking
  // two ingredients is a recipe search ("has X and Y"), not "show me either category."
  if (except !== 'ingredients' && state.ingredients.size && !hasAllIngredients(item, state.ingredients)) return false;
  if (except !== 'alcoholic') {
    if (state.alcoholic === 'yes' && !item.alcoholic) return false;
    if (state.alcoholic === 'no' && item.alcoholic) return false;
  }
  if (except !== 'pkg') {
    // Premier includes everything Plus does, plus $15.01-$20 — so "Included with Premier"
    // must match package "plus" too, not just the premier-only bracket.
    if (state.pkg === 'plus' && item.package !== 'plus') return false;
    if (state.pkg === 'premier' && item.package !== 'plus' && item.package !== 'premier') return false;
    if (state.pkg === 'none' && item.package) return false;
  }
  if (except !== 'price') {
    if (state.minPrice !== null && (item.price === null || item.price < state.minPrice)) return false;
    if (state.maxPrice !== null && (item.price === null || item.price > state.maxPrice)) return false;
  }
  return true;
}

function matchesFilters(item) {
  return matchesFiltersExcept(item, null);
}

function updateFacetCounts() {
  const typeCounts = new Map();
  const venueTypeCounts = new Map();
  const venueCounts = new Map();
  let alcYes = 0, alcNo = 0, alcAll = 0;
  let pkgPlus = 0, pkgPremier = 0, pkgNone = 0, pkgAll = 0;

  for (const item of ALL_ITEMS) {
    if (matchesFiltersExcept(item, 'types')) typeCounts.set(item.type, (typeCounts.get(item.type) || 0) + 1);
    if (matchesFiltersExcept(item, 'venueTypes')) {
      for (const v of item.venues) venueTypeCounts.set(v.venueType, (venueTypeCounts.get(v.venueType) || 0) + 1);
    }
    if (matchesFiltersExcept(item, 'venues')) {
      for (const v of item.venues) venueCounts.set(v.venue, (venueCounts.get(v.venue) || 0) + 1);
    }
    if (matchesFiltersExcept(item, 'alcoholic')) {
      alcAll++;
      if (item.alcoholic) alcYes++;
      else alcNo++;
    }
    if (matchesFiltersExcept(item, 'pkg')) {
      pkgAll++;
      if (item.package === 'plus') pkgPlus++;
      if (item.package === 'plus' || item.package === 'premier') pkgPremier++;
      if (!item.package) pkgNone++;
    }
  }

  const setCount = (chip, n) => {
    const span = chip.querySelector('.count');
    if (span) span.textContent = (n || 0).toLocaleString();
  };
  document.querySelectorAll('#typeChips .chip').forEach((chip) => setCount(chip, typeCounts.get(chip.dataset.value)));
  document.querySelectorAll('#venueTypeChips .chip').forEach((chip) => setCount(chip, venueTypeCounts.get(chip.dataset.value)));
  renderIngredientFilters();
  document.querySelectorAll('#venueList label').forEach((label) => {
    const input = label.querySelector('input[type="checkbox"]');
    const span = label.querySelector('.count');
    if (input && span) span.textContent = (venueCounts.get(input.value) || 0).toLocaleString();
  });
  setCount(document.querySelector('#alcoholChips .chip[data-value="all"]'), alcAll);
  setCount(document.querySelector('#alcoholChips .chip[data-value="yes"]'), alcYes);
  setCount(document.querySelector('#alcoholChips .chip[data-value="no"]'), alcNo);

  const pkgSelect = document.getElementById('pkgSelect');
  if (pkgSelect) {
    pkgSelect.querySelector('option[value="all"]').textContent = `Any (${pkgAll.toLocaleString()})`;
    pkgSelect.querySelector('option[value="plus"]').textContent = `Included with Plus (${pkgPlus.toLocaleString()})`;
    pkgSelect.querySelector('option[value="premier"]').textContent = `Included with Premier (${pkgPremier.toLocaleString()})`;
    pkgSelect.querySelector('option[value="none"]').textContent = `Not included in a package (${pkgNone.toLocaleString()})`;
  }
}

// Rebuilds (not just re-counts) both ingredient rows: selected ingredients float to their own
// row up top with a remove affordance, and the popular-picks row shows only the rest, each
// counted as "how many drinks would match if I added this too" (AND-ed with what's already
// selected and every other active filter).
function renderIngredientFilters() {
  const selected = [...state.ingredients];

  const selectedRow = document.getElementById('selectedIngredientChips');
  selectedRow.innerHTML = selected
    .map(
      (ing) =>
        `<button class="chip active" data-kind="ingredient" data-value="${escapeHtml(ing)}" type="button">${escapeHtml(ing)} <span class="chip-x">&times;</span></button>`
    )
    .join('');

  const popularRow = document.getElementById('ingredientChips');
  const candidates = FACET_OPTIONS.ingredients.filter((ing) => !state.ingredients.has(ing));
  popularRow.innerHTML = candidates
    .map((ing) => {
      const count = ALL_ITEMS.filter(
        (item) => matchesFiltersExcept(item, 'ingredients') && hasAllIngredients(item, [...selected, ing])
      ).length;
      return `<button class="chip" data-kind="ingredient" data-value="${escapeHtml(ing)}" type="button">${escapeHtml(ing)} <span class="count">${count.toLocaleString()}</span></button>`;
    })
    .join('');
}

function renderIngredientSuggestions(query) {
  const box = document.getElementById('ingredientSuggestions');
  // The popular-picks row sits directly under the dropdown in normal flow (the dropdown is
  // absolutely positioned, so it doesn't push anything down) — hide it while suggestions are
  // showing so it can't visibly peek out from under the dropdown's rounded corners.
  const popularRow = document.getElementById('ingredientChips');
  if (!query) {
    box.hidden = true;
    box.innerHTML = '';
    popularRow.hidden = false;
    return;
  }
  // Rank an exact match, then a prefix match, then shorter strings first — so searching "mint"
  // surfaces plain "mint" before compound ingredients like "cucumber mint" that merely contain it.
  const matches = ALL_INGREDIENTS.filter((ing) => ing.includes(query) && !state.ingredients.has(ing))
    .sort((a, b) => {
      if ((a === query) !== (b === query)) return a === query ? -1 : 1;
      if (a.startsWith(query) !== b.startsWith(query)) return a.startsWith(query) ? -1 : 1;
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    })
    .slice(0, 10);
  if (!matches.length) {
    box.hidden = true;
    box.innerHTML = '';
    popularRow.hidden = false;
    return;
  }
  box.hidden = false;
  popularRow.hidden = true;
  box.innerHTML = matches
    .map((ing) => `<button type="button" data-kind="ingredient" data-value="${escapeHtml(ing)}">${escapeHtml(ing)}</button>`)
    .join('');
}

function sortItems(items) {
  const arr = [...items];
  switch (state.sort) {
    case 'name':
      arr.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'price-asc':
      arr.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
      break;
    case 'price-desc':
      arr.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
      break;
    case 'venue':
      arr.sort((a, b) => a.venues[0].venue.localeCompare(b.venues[0].venue) || a.name.localeCompare(b.name));
      break;
    default:
      arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  return arr;
}

function cardHtml(item) {
  const badges = [];
  badges.push(`<span class="badge ${item.alcoholic ? 'alcoholic' : 'nonalcoholic'}">${item.alcoholic ? 'Alcoholic' : 'Non-alcoholic'}</span>`);
  badges.push(`<span class="badge">${TYPE_LABELS[item.type] || item.type}</span>`);
  if (item.package === 'plus') badges.push(`<span class="badge plus">Princess Plus</span>`);
  if (item.package === 'premier') badges.push(`<span class="badge premier">Princess Premier</span>`);
  if (item.region) badges.push(`<span class="badge">${escapeHtml(item.region)} only</span>`);

  const venueLinks = item.venues
    .map((v) => {
      const imgUrl = `data/${v.sourceImage}`;
      const caption = `${v.venue} — ${item.category || ''}`;
      const label = `View menu photo from ${v.venue}`;
      return `<button type="button" data-view-image="${escapeHtml(imgUrl)}" data-view-caption="${escapeHtml(caption)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${escapeHtml(v.venue)}</button>`;
    })
    .join(', ');

  const priceKnown = item.price !== null && item.price !== undefined;

  return `
    <article class="card">
      <div class="card__top">
        <h3 class="card__name">${escapeHtml(item.name)}</h3>
        <div class="card__price${priceKnown ? '' : ' card__price--unknown'}">${escapeHtml(priceLabel(item))}</div>
      </div>
      <div class="card__venue">
        ${item.category ? `${escapeHtml(item.category)} · ` : ''}${venueLinks}
        &nbsp;&middot;&nbsp;
        <button type="button" class="flag-btn" data-flag-id="${escapeHtml(item._id)}" aria-label="Report incorrect info for ${escapeHtml(item.name)}" title="Report incorrect info for this drink">🚩 report</button>
      </div>
      ${item.description ? `<div class="card__desc">${escapeHtml(item.description)}</div>` : ''}
      ${item.notes ? `<div class="card__desc"><em>${escapeHtml(item.notes)}</em></div>` : ''}
      <div class="card__badges">${badges.join('')}</div>
    </article>
  `;
}

function render() {
  const filtered = ALL_ITEMS.filter(matchesFilters);
  const sorted = sortItems(filtered);
  const visible = sorted.slice(0, state.page * PAGE_SIZE);

  const countEl = document.getElementById('resultCount');
  countEl.textContent = `${filtered.length.toLocaleString()} of ${ALL_ITEMS.length.toLocaleString()} drinks`;

  updateFacetCounts();

  const results = document.getElementById('results');
  if (!filtered.length) {
    results.innerHTML = `
      <div class="empty-state">
        No drinks match your filters. Try loosening a filter or clearing your search.
        <div><button class="reset-btn empty-state__reset" id="emptyStateReset" type="button">Clear all filters</button></div>
      </div>`;
  } else {
    results.innerHTML = visible.map(cardHtml).join('');
  }

  const loadMoreWrap = document.getElementById('loadMoreWrap');
  if (visible.length < filtered.length) {
    loadMoreWrap.innerHTML = `<button class="reset-btn" id="loadMoreBtn" style="width:auto; padding:10px 24px;" type="button">Show more (${filtered.length - visible.length} left)</button>`;
    document.getElementById('loadMoreBtn').addEventListener('click', () => {
      state.page++;
      render();
    });
  } else {
    loadMoreWrap.innerHTML = '';
  }
}

function openImageModal(src, caption) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal-backdrop" id="modalBackdrop">
      <div class="modal">
        <button class="modal-close" id="modalClose" aria-label="Close">&times;</button>
        <img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}" />
        <div class="modal-caption">${escapeHtml(caption)}</div>
      </div>
    </div>
  `;
  const close = () => (root.innerHTML = '');
  document.getElementById('modalClose').addEventListener('click', close);
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') close();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  });
}

function showToast(message) {
  // Don't cover the open mobile filter sheet (its Reset button and venue list sit right where
  // the toast would land).
  if (document.body.classList.contains('no-scroll')) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('toast--visible'), 10);
  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 400);
  }, 5000);
}

registerSW({
  immediate: true,
  onOfflineReady() {
    showToast('✓ Saved for offline use — this app now works without wifi.');
  },
});

init();
