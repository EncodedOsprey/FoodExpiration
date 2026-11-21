// Add / edit an item. New items start from a barcode lookup (or a blank form); the expiry
// date can be typed, picked with quick buttons, read from a GS1 barcode or estimated.
import { buildSchedule } from '../alerts.js';
import { addDays, addMonths, daysBetween, formatDate, isValidISODate, todayISO } from '../dates.js';
import { FOOD_TYPES, LOCATIONS, classifyFood, estimateShelfLifeDays, foodTypeById, suggestLocation } from '../foods.js';
import { deriveIngredient } from '../ingredients.js';
import { MEALDB_INGREDIENTS } from '../mealdb-ingredients.js';
import { back, go, replace } from '../nav.js';
import { notificationPermission, requestPermission, scheduleSync } from '../notify.js';
import { lookupProduct, rememberProduct } from '../products.js';
import { prefetchRecipes } from '../recipes.js';
import { getSettings } from '../settings.js';
import { findItem, saveItem } from '../store.js';
import { $, $$, html, icon, mount, setHeader, thumb, toast } from '../ui.js';

const typeLabel = (type) => `${type.id[0].toUpperCase()}${type.id.slice(1).replaceAll('-', ' ')}`;

const QUICK_DATES = [
  ['+3 days', (d) => addDays(d, 3)],
  ['+1 week', (d) => addDays(d, 7)],
  ['+2 weeks', (d) => addDays(d, 14)],
  ['+1 month', (d) => addMonths(d, 1)],
  ['+3 months', (d) => addMonths(d, 3)],
  ['+6 months', (d) => addMonths(d, 6)],
  ['+1 year', (d) => addMonths(d, 12)],
];

const shortDate = (ms) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms));

/** "Alerts on Mon, Nov 24 · Thu, Nov 27" for the date being entered. */
function alertPreview(state, settings) {
  if (!isValidISODate(state.expiryDate)) return '';
  const now = Date.now();
  const entries = buildSchedule(
    [{ ...state, id: 'preview', name: state.name || 'item', status: 'active', expirySetAt: now, snoozedUntil: null }],
    settings,
  ).filter((e) => e.fireAt > now);
  if (!entries.length) return 'It’s already past your alert dates, so it will show straight away in Alerts.';
  return `Alerts: ${entries.map((e) => shortDate(e.fireAt)).join(' · ')}`;
}

function notFound(el) {
  setHeader({ title: 'Edit item', back: '/pantry' });
  mount(el, html`<div class="empty"><h2>Item not found</h2><p>It may have been deleted.</p><a class="btn" href="#/pantry">Back to pantry</a></div>`);
}

export function render(el, { params, query, signal }) {
  const editing = params[0] ? findItem(params[0]) : null;
  if (params[0] && !editing) return notFound(el);
  const settings = getSettings();
  const today = todayISO();
  const code = editing ? editing.barcode ?? '' : (query.get('code') ?? '').trim().slice(0, 64);
  const scannedExpiry = !editing && isValidISODate(query.get('exp')) ? query.get('exp') : '';

  const state = editing
    ? { ...editing, notes: editing.notes ?? '', ingredient: editing.ingredient ?? '' }
    : {
        barcode: code,
        name: '',
        brand: '',
        quantity: '',
        image: '',
        categories: [],
        typeId: null,
        emoji: '🛒',
        location: 'fridge',
        expiryDate: scannedExpiry,
        expirySource: scannedExpiry ? 'barcode' : '',
        purchaseDate: today,
        notes: '',
        ingredient: '',
      };
  // Fields the user (or a previous purchase) decided; smart defaults never overwrite them.
  const fixed = new Set(editing ? ['type', 'location', 'expiry', 'ingredient'] : scannedExpiry ? ['expiry'] : []);
  let remembered = null;

  setHeader({
    title: editing ? 'Edit item' : 'Add item',
    back: editing ? `/item/${encodeURIComponent(editing.id)}` : '/pantry',
  });

  mount(
    el,
    html`<form id="item-form" novalidate autocomplete="off">
      <div class="hero">
        <span id="thumb">${thumb(state, 'lg')}</span>
        <div>
          <p class="sub" id="lookup">${code ? html`Barcode ${code}` : 'No barcode'}</p>
        </div>
      </div>

      <label class="field"><span>Name</span>
        <input name="name" required maxlength="120" placeholder="e.g. Greek yogurt" enterkeyhint="done" value="${state.name}">
      </label>

      <div class="field">
        <span class="label" id="loc-label">Kept in</span>
        <div class="segmented" role="radiogroup" aria-labelledby="loc-label">
          ${LOCATIONS.map(
            (l) => html`<label><input type="radio" name="location" value="${l.id}" ${state.location === l.id ? 'checked' : ''}><span>${l.label}</span></label>`,
          )}
        </div>
      </div>

      <label class="field"><span>Expiry date</span>
        <input type="date" name="expiryDate" required value="${state.expiryDate}">
      </label>
      <div class="chips wrap" aria-label="Quick dates">
        ${QUICK_DATES.map(([label], i) => html`<button class="chip" type="button" data-quick="${i}">${label}</button>`)}
      </div>
      <p class="hint" id="expiry-hint"></p>
      <p class="hint" id="alert-preview"></p>

      <details class="card" ${editing ? 'open' : ''}>
        <summary>More details</summary>
        <label class="field"><span>Brand</span><input name="brand" maxlength="80" value="${state.brand ?? ''}"></label>
        <label class="field"><span>Quantity</span><input name="quantity" maxlength="40" placeholder="e.g. 1 L, 6 eggs" value="${state.quantity ?? ''}"></label>
        <label class="field"><span>Type of food</span>
          <select name="typeId">
            <option value="">🛒 Other / not sure</option>
            ${FOOD_TYPES.map((t) => html`<option value="${t.id}" ${state.typeId === t.id ? 'selected' : ''}>${t.emoji} ${typeLabel(t)}</option>`)}
          </select>
        </label>
        <label class="field"><span>Main ingredient for recipe ideas</span>
          <input name="ingredient" list="ingredient-list" maxlength="60" placeholder="e.g. Milk" value="${state.ingredient}">
          <datalist id="ingredient-list">${MEALDB_INGREDIENTS.map((n) => html`<option value="${n}"></option>`)}</datalist>
        </label>
        <label class="field"><span>Bought on</span><input type="date" name="purchaseDate" value="${state.purchaseDate ?? ''}"></label>
        <label class="field"><span>Notes</span><textarea name="notes" maxlength="500" rows="2">${state.notes}</textarea></label>
      </details>

      <div class="actions">
        <button class="btn primary" type="submit" value="done">${icon('check')} Save</button>
        ${editing ? '' : html`<button class="btn" type="submit" value="next">${icon('scan')} Save &amp; scan next</button>`}
      </div>
    </form>`,
  );

  const form = $('#item-form', el);
  const field = (name) => form.elements.namedItem(name);

  function expiryHint() {
    const type = foodTypeById(state.typeId);
    switch (state.expirySource) {
      case 'barcode':
        return ['ok', '✓ Read from the barcode.'];
      case 'remembered':
        return ['ok', `Based on last time you bought this (${remembered?.shelfDays} days). Check the package.`];
      case 'estimate': {
        const where = LOCATIONS.find((l) => l.id === state.location)?.label.toLowerCase();
        const typical = type ? ` (typical for ${typeLabel(type).toLowerCase()})` : '';
        return ['warn', `Estimate: about ${daysBetween(state.purchaseDate || today, state.expiryDate)} days in the ${where}${typical}. Check the package date.`];
      }
      default:
        if (!state.expiryDate) return ['', 'Enter the date printed on the package, or pick a quick option.'];
        if (state.expiryDate < today) return ['warn', `That date has passed (${formatDate(state.expiryDate)}).`];
        return ['', ''];
    }
  }

  /** Push state into the form (without touching what the user is typing). */
  function sync() {
    for (const name of ['name', 'brand', 'quantity', 'ingredient', 'expiryDate', 'purchaseDate']) {
      const input = field(name);
      const value = state[name] ?? '';
      if (input.value !== value) input.value = value;
    }
    field('typeId').value = state.typeId ?? '';
    for (const radio of $$('input[name="location"]', form)) radio.checked = radio.value === state.location;
    mount($('#thumb', el), thumb(state, 'lg'));
    const [tone, text] = expiryHint();
    const hint = $('#expiry-hint', el);
    hint.className = `hint ${tone}`;
    hint.textContent = text;
    $('#alert-preview', el).textContent = alertPreview(state, settings);
  }

  /** Fill in type, emoji, location, ingredient and an estimated date from what we know. */
  function smartDefaults() {
    const classification = classifyFood({ name: state.name, categories: state.categories });
    if (!fixed.has('type')) state.typeId = classification.type?.id ?? null;
    const type = foodTypeById(state.typeId);
    const info = { ...classification, type };
    if (!fixed.has('emoji')) state.emoji = type?.emoji ?? '🛒';
    if (!fixed.has('location') && (state.name || state.categories.length)) state.location = suggestLocation(info);
    if (!fixed.has('ingredient')) state.ingredient = deriveIngredient({ name: state.name, categories: state.categories }, type);
    if (!fixed.has('expiry')) {
      const base = state.purchaseDate || today;
      const days = remembered?.shelfDays ?? estimateShelfLifeDays(info, state.location);
      state.expiryDate = days ? addDays(base, days) : '';
      state.expirySource = days ? (remembered?.shelfDays ? 'remembered' : 'estimate') : '';
    }
  }

  form.addEventListener('input', (event) => {
    const { name, value } = event.target;
    if (name === 'location') {
      state.location = value;
      fixed.add('location');
    } else if (name === 'expiryDate') {
      state.expiryDate = value;
      state.expirySource = 'manual';
      fixed.add('expiry');
    } else if (name === 'typeId') {
      state.typeId = value || null;
      fixed.add('type');
      fixed.delete('emoji');
    } else if (name === 'ingredient') {
      state.ingredient = value;
      fixed.add('ingredient');
    } else if (name in state || ['brand', 'quantity', 'notes', 'purchaseDate'].includes(name)) {
      state[name] = value;
    }
    if (!editing && ['name', 'location', 'typeId', 'purchaseDate'].includes(name)) smartDefaults();
    else if (editing && name === 'typeId') state.emoji = foodTypeById(state.typeId)?.emoji ?? '🛒';
    sync();
  });

  form.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-quick]');
    if (!chip) return;
    state.expiryDate = QUICK_DATES[Number(chip.dataset.quick)][1](today);
    state.expirySource = 'manual';
    fixed.add('expiry');
    sync();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const action = event.submitter?.value ?? 'done';
    state.name = state.name.trim();
    if (!state.name) {
      toast('Give the item a name.');
      field('name').focus();
      return;
    }
    if (!isValidISODate(state.expiryDate)) {
      toast('Add the expiry date (or pick a quick option).');
      field('expiryDate').focus();
      return;
    }
    for (const button of $$('button[type="submit"]', form)) button.disabled = true;
    try {
      const item = await saveItem({
        id: editing?.id,
        name: state.name,
        brand: (state.brand ?? '').trim(),
        quantity: (state.quantity ?? '').trim(),
        notes: state.notes.trim(),
        image: state.image ?? '',
        barcode: state.barcode ?? '',
        typeId: state.typeId,
        emoji: state.emoji,
        location: state.location,
        expiryDate: state.expiryDate,
        expirySource: state.expirySource || 'manual',
        purchaseDate: isValidISODate(state.purchaseDate) ? state.purchaseDate : today,
        ingredient: state.ingredient.trim(),
      });
      rememberProduct(item).catch(() => {});
      if (settings.recipesOnline) prefetchRecipes(item).then(() => scheduleSync());
      afterSave(item, action);
    } catch (err) {
      console.error(err);
      toast('Couldn’t save. Is storage full or private browsing on?');
      for (const button of $$('button[type="submit"]', form)) button.disabled = false;
    }
  });

  function afterSave(item, action) {
    if (editing) {
      toast('Saved.');
      back(`/item/${encodeURIComponent(item.id)}`);
      return;
    }
    if (notificationPermission() === 'default') {
      toast(`Added ${item.name}. Want a notification before it expires?`, {
        action: 'Turn on',
        timeout: 8000,
        onAction: () => requestPermission(),
      });
    } else {
      toast(`Added ${item.name}.`, { action: 'View', onAction: () => go(`/item/${encodeURIComponent(item.id)}`) });
    }
    if (action === 'next') replace('/scan');
    else back('/pantry');
  }

  async function lookUp() {
    const status = $('#lookup', el);
    mount(status, html`<span class="spinner" aria-hidden="true"></span> Looking up ${code}…`);
    let result;
    try {
      result = await lookupProduct(code, { online: settings.lookupOnline, signal });
    } catch {
      return; // left the screen
    }
    if (signal.aborted) return;
    if (result.status === 'found') {
      const p = result.product;
      if (!state.name && p.name) state.name = p.name;
      state.brand ||= p.brand ?? '';
      state.quantity ||= p.quantity ?? '';
      state.image ||= p.image ?? '';
      state.categories = p.categories ?? [];
      if (result.remembered) {
        remembered = p;
        if (p.location && !fixed.has('location')) {
          state.location = p.location;
          fixed.add('location');
        }
        if (p.typeId !== undefined && !fixed.has('type')) {
          state.typeId = p.typeId;
          fixed.add('type');
        }
        if (p.emoji) {
          state.emoji = p.emoji;
          fixed.add('emoji');
        }
        if (p.ingredient && !fixed.has('ingredient')) {
          state.ingredient = p.ingredient;
          fixed.add('ingredient');
        }
      }
      status.textContent = result.remembered
        ? '✓ You’ve added this before'
        : p.name
          ? '✓ Found on Open Food Facts'
          : 'Found on Open Food Facts, but without a name. Add one below.';
    } else {
      status.textContent =
        result.status === 'not-found'
          ? `${code} isn’t in the product database yet. Type the name and it’ll be remembered next time.`
          : 'Couldn’t look the product up right now. Type the name below.';
    }
    smartDefaults();
    sync();
    if (!state.name) field('name').focus();
  }

  sync();
  if (!editing && code) lookUp();
  else if (!editing) field('name').focus();
}
