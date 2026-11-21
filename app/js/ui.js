// DOM helpers: auto-escaping templates, icons, toasts and small shared widgets.
import { urgencyOf } from './alerts.js';
import { daysUntil, describeDaysLeft, isValidISODate, shortDaysLeft } from './dates.js';
import { back as goBack } from './nav.js';

class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

/** Tagged template: interpolated values are escaped unless they are html`` results. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

export const raw = (markup) => new SafeHtml(String(markup));

export function mount(el, template) {
  el.innerHTML = render(template);
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ICONS = {
  fridge: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M6 10h12M9 6v2M9 13v3"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 8v8M11 8v8M13.5 8v8M16 8v8"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  flash: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  switch: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><path d="M9 13.5a3 3 0 0 1 5.6-1.5M15 12.5a3 3 0 0 1-5.6 1.5"/><path d="M14.8 10v2.2h-2.2M9.2 16v-2.2h2.2"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-9 8"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h1M11 10h2M16 10h1M7 14h10"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  pot: '<path d="M4 11h16v2a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7z"/><path d="M2 11h20M9 4.5c-1 1.5 1 2 0 3.5M14 4.5c-1 1.5 1 2 0 3.5"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7"/>',
};

export const icon = (name, label = '') =>
  raw(
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${
      label ? `role="img" aria-label="${escapeHtml(label)}"` : 'aria-hidden="true"'
    }>${ICONS[name] ?? ''}</svg>`,
  );

/** Title bar: screen title, optional back button (with a fallback route) and actions. */
export function setHeader({ title = 'Pantry Pal', back = '', actions = '' } = {}) {
  document.title = title === 'Pantry Pal' ? title : `${title} · Pantry Pal`;
  $('#title').textContent = title;
  const backHost = $('#top-back');
  mount(backHost, back ? html`<button type="button" class="icon-btn back" aria-label="Back">${icon('back')}</button>` : '');
  $('button', backHost)?.addEventListener('click', () => goBack(back));
  mount($('#top-actions'), actions);
}

export function daysLeftOf(item, now = new Date()) {
  return isValidISODate(item.expiryDate) ? daysUntil(item.expiryDate, now) : null;
}

/** Coloured "3 days" pill for an item. */
export function expiryPill(item, { long = false } = {}) {
  const days = daysLeftOf(item);
  if (days === null) return html`<span class="pill">No date</span>`;
  const text = long ? describeDaysLeft(days) : shortDaysLeft(days);
  return html`<span class="pill urgency-${urgencyOf(days)}">${text}</span>`;
}

/** Only http(s) URLs from stored or third-party data end up in src/href attributes. */
export const safeUrl = (url) => (/^https?:\/\//i.test(String(url ?? '')) ? String(url) : '');

export function thumb(item, size = '') {
  const image = safeUrl(item.image);
  if (image) {
    // Broken images fall back to the emoji (handled globally in main.js).
    return html`<span class="thumb ${size}"><img src="${image}" alt="" loading="lazy" referrerpolicy="no-referrer"
      data-fallback="${item.emoji || '🛒'}"></span>`;
  }
  return html`<span class="thumb ${size}" aria-hidden="true">${item.emoji || '🛒'}</span>`;
}

const LOCATION_NAMES = { fridge: 'Fridge', freezer: 'Freezer', pantry: 'Pantry', other: 'Other' };
export const locationName = (id) => LOCATION_NAMES[id] ?? '';

let toastTimer;
/** Short message at the bottom of the screen, with an optional action button. */
export function toast(message, { action, onAction, timeout = 4000 } = {}) {
  const host = $('#toasts');
  if (!host) return;
  clearTimeout(toastTimer);
  mount(host, html`<div class="toast" role="status"><span>${message}</span>${action ? html`<button type="button">${action}</button>` : ''}</div>`);
  const button = $('button', host);
  button?.addEventListener('click', () => {
    host.replaceChildren();
    onAction?.();
  });
  toastTimer = setTimeout(() => host.replaceChildren(), timeout);
}

/** Modal list of choices; resolves to the chosen value or null. */
export function choose(title, options) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'sheet';
    mount(
      dialog,
      html`<form method="dialog">
        <h2>${title}</h2>
        ${options.map((o, i) => html`<button class="btn block" value="${i}">${o.label}</button>`)}
        <button class="btn block ghost" value="">Cancel</button>
      </form>`,
    );
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const value = dialog.returnValue === '' ? null : options[Number(dialog.returnValue)]?.value ?? null;
      dialog.remove();
      resolve(value);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close('');
    });
    dialog.showModal();
  });
}

export function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
