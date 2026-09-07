import './style.css';

const DATA_URL = 'data/drinks.json';
const PAGE_SIZE = 60;

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
  premiumOnly: false,
  minPrice: null,
  maxPrice: null,
  sort: 'relevance',
  page: 1,
};

let ALL_ITEMS = [];
let dataMinPrice = 0;
let dataMaxPrice = 100;

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

function buildSearchIndex(item) {
  return [item.name, item.description, item.category, item.venue, (item.ingredients || []).join(' ')]
    .join(' ')
    .toLowerCase();
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
    _id: item.id || `${item.venueSlug}-${i}`,
    _search: buildSearchIndex(item),
  }));

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
        <div>
          <h1>🍹 Princess Drink Finder</h1>
          <div class="tagline">Search every bar &amp; restaurant drink menu on your Princess cruise</div>
        </div>
        <button class="filters-toggle" id="filtersToggle" type="button">Filters</button>
      </div>
      <div class="search-row">
        <input type="search" id="searchInput" placeholder="Search drinks, ingredients, venues&hellip;" autocomplete="off" />
      </div>
    </header>
    <div class="layout">
      <aside class="filters" id="filtersPanel">
        <button class="filters-close" id="filtersClose" type="button" aria-label="Close filters">✕</button>
        <div id="filtersBody"></div>
        <button class="reset-btn" id="resetBtn" type="button">Reset all filters</button>
      </aside>
      <main>
        <div class="results-header">
          <span id="resultCount"></span>
        </div>
        <div class="results-grid" id="results"></div>
        <div id="loadMoreWrap" style="text-align:center; margin-top:20px;"></div>
      </main>
    </div>
    <footer class="app-footer">
      Prices and menus are illustrative and subject to change onboard — always confirm at the bar.
      Source: shinecruise.com Princess Cruises drink menu photos.
    </footer>
    <div id="modalRoot"></div>
  `;
}

function buildFilters(items) {
  const typeCounts = new Map();
  const venueTypeCounts = new Map();
  const venueCounts = new Map(); // venue -> {count, venueType}
  const ingredientCounts = new Map();

  for (const item of items) {
    typeCounts.set(item.type, (typeCounts.get(item.type) || 0) + 1);
    venueTypeCounts.set(item.venueType, (venueTypeCounts.get(item.venueType) || 0) + 1);
    if (!venueCounts.has(item.venue)) venueCounts.set(item.venue, { count: 0, venueType: item.venueType });
    venueCounts.get(item.venue).count++;
    for (const ing of item.ingredients || []) {
      const key = ing.trim();
      if (!key || key.length < 3) continue;
      ingredientCounts.set(key, (ingredientCounts.get(key) || 0) + 1);
    }
  }

  const topIngredients = [...ingredientCounts.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 28)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const sortedVenues = [...venueCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const sortedTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const sortedVenueTypes = [...venueTypeCounts.entries()].sort((a, b) => b[1] - a[1]);

  const body = document.getElementById('filtersBody');
  body.innerHTML = `
    <h2>Drink type</h2>
    <div class="chip-row" id="typeChips">
      ${sortedTypes
        .map(
          ([t, c]) =>
            `<button class="chip" data-kind="type" data-value="${t}" type="button">${TYPE_LABELS[t] || t} <span class="count">${c}</span></button>`
        )
        .join('')}
    </div>

    <h2>Alcohol</h2>
    <div class="chip-row" id="alcoholChips">
      <button class="chip active" data-kind="alcoholic" data-value="all" type="button">All</button>
      <button class="chip" data-kind="alcoholic" data-value="yes" type="button">Alcoholic</button>
      <button class="chip" data-kind="alcoholic" data-value="no" type="button">Non-alcoholic</button>
    </div>

    <h2>Price</h2>
    <div class="price-row">
      <input type="number" id="minPrice" placeholder="$${dataMinPrice}" min="0" />
      <span>&ndash;</span>
      <input type="number" id="maxPrice" placeholder="$${dataMaxPrice}" min="0" />
    </div>

    <h2>Drink package</h2>
    <select id="pkgSelect">
      <option value="all">Any</option>
      <option value="plus">Included with Plus</option>
      <option value="premier">Included with Premier</option>
      <option value="none">À la carte (not in a package)</option>
    </select>

    <h2>Venue type</h2>
    <div class="chip-row" id="venueTypeChips">
      ${sortedVenueTypes
        .map(
          ([t, c]) =>
            `<button class="chip" data-kind="venueType" data-value="${t}" type="button">${escapeHtml(t)} <span class="count">${c}</span></button>`
        )
        .join('')}
    </div>

    <h2>Venue</h2>
    <div class="venue-list" id="venueList">
      ${sortedVenues
        .map(
          ([v, info]) => `
        <label>
          <input type="checkbox" data-kind="venue" value="${escapeHtml(v)}" />
          ${escapeHtml(v)} <span class="count">${info.count}</span>
        </label>`
        )
        .join('')}
    </div>

    <h2>Popular ingredients</h2>
    <div class="chip-row" id="ingredientChips">
      ${topIngredients
        .map(
          ([ing]) =>
            `<button class="chip" data-kind="ingredient" data-value="${escapeHtml(ing)}" type="button">${escapeHtml(ing)}</button>`
        )
        .join('')}
    </div>

    <h2>Special</h2>
    <div class="chip-row">
      <button class="chip" id="premiumChip" type="button">⭐ Premium / Love Line only</button>
    </div>

    <h2>Sort by</h2>
    <select id="sortSelect">
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
    const chip = e.target.closest('.chip[data-kind]');
    if (chip) {
      const { kind, value } = chip.dataset;
      if (kind === 'type') toggleSetChip(state.types, value, chip);
      else if (kind === 'venueType') toggleSetChip(state.venueTypes, value, chip);
      else if (kind === 'ingredient') toggleSetChip(state.ingredients, value, chip);
      else if (kind === 'alcoholic') {
        state.alcoholic = value;
        document.querySelectorAll('#alcoholChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.value === value));
      }
      state.page = 1;
      render();
      return;
    }
    if (e.target.id === 'premiumChip') {
      state.premiumOnly = !state.premiumOnly;
      e.target.classList.toggle('active', state.premiumOnly);
      state.page = 1;
      render();
    }
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

  document.getElementById('resetBtn').addEventListener('click', () => {
    state.query = '';
    state.types.clear();
    state.venueTypes.clear();
    state.venues.clear();
    state.ingredients.clear();
    state.alcoholic = 'all';
    state.pkg = 'all';
    state.premiumOnly = false;
    state.minPrice = null;
    state.maxPrice = null;
    state.sort = 'relevance';
    state.page = 1;
    document.getElementById('searchInput').value = '';
    document.getElementById('minPrice').value = '';
    document.getElementById('maxPrice').value = '';
    document.getElementById('pkgSelect').value = 'all';
    document.getElementById('sortSelect').value = 'relevance';
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    document.querySelector('#alcoholChips .chip[data-value="all"]')?.classList.add('active');
    document.querySelectorAll('#venueList input[type="checkbox"]').forEach((cb) => (cb.checked = false));
    render();
  });

  document.getElementById('filtersToggle').addEventListener('click', () => {
    document.getElementById('filtersPanel').classList.add('open');
  });
  document.getElementById('filtersClose').addEventListener('click', () => {
    document.getElementById('filtersPanel').classList.remove('open');
  });

  document.getElementById('results').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view-image]');
    if (btn) openImageModal(btn.dataset.viewImage, btn.dataset.viewCaption);
  });
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

function matchesFilters(item) {
  if (state.query) {
    const words = state.query.split(/\s+/).filter(Boolean);
    if (!words.every((w) => item._search.includes(w))) return false;
  }
  if (state.types.size && !state.types.has(item.type)) return false;
  if (state.venueTypes.size && !state.venueTypes.has(item.venueType)) return false;
  if (state.venues.size && !state.venues.has(item.venue)) return false;
  if (state.ingredients.size) {
    const ings = item.ingredients || [];
    let any = false;
    for (const wanted of state.ingredients) {
      if (ings.some((ing) => ing.includes(wanted))) {
        any = true;
        break;
      }
    }
    if (!any) return false;
  }
  if (state.alcoholic === 'yes' && !item.alcoholic) return false;
  if (state.alcoholic === 'no' && item.alcoholic) return false;
  if (state.pkg === 'plus' && item.package !== 'plus') return false;
  if (state.pkg === 'premier' && item.package !== 'premier') return false;
  if (state.pkg === 'none' && item.package) return false;
  if (state.premiumOnly && !item.premium) return false;
  if (state.minPrice !== null && (item.price === null || item.price < state.minPrice)) return false;
  if (state.maxPrice !== null && (item.price === null || item.price > state.maxPrice)) return false;
  return true;
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
      arr.sort((a, b) => a.venue.localeCompare(b.venue) || a.name.localeCompare(b.name));
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
  if (item.premium) badges.push(`<span class="badge premium">⭐ Premium</span>`);
  if (item.region) badges.push(`<span class="badge">${escapeHtml(item.region)} only</span>`);

  const imgUrl = `data/${item.sourceImage}`;
  const caption = `${item.venue} — ${item.category || ''}`;

  return `
    <article class="card">
      <div class="card__top">
        <div class="card__name">${escapeHtml(item.name)}</div>
        <div class="card__price">${escapeHtml(priceLabel(item))}</div>
      </div>
      <div class="card__venue">
        ${escapeHtml(item.venue)}${item.category ? ` · ${escapeHtml(item.category)}` : ''}
        &nbsp;&middot;&nbsp;
        <button type="button" data-view-image="${escapeHtml(imgUrl)}" data-view-caption="${escapeHtml(caption)}">view menu photo</button>
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

  const results = document.getElementById('results');
  if (!filtered.length) {
    results.innerHTML = `<div class="empty-state">No drinks match your filters. Try loosening a filter or clearing your search.</div>`;
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
        <button class="modal-close" id="modalClose" aria-label="Close">✕</button>
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

init();
