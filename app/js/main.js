// Start-up: loads data, routes between screens, keeps them live and registers the service worker.
import { cachePrune } from './db.js';
import { on } from './events.js';
import { go, replace, startRouter } from './nav.js';
import { startAlerts } from './notify.js';
import { initInstallPrompt, isStandalone } from './platform.js';
import { loadSettings } from './settings.js';
import { loadItems } from './store.js';
import { $, $$, html, icon, mount, toast } from './ui.js';
import { checkViewportSoon, initViewportFix } from './viewport.js';
import * as alertsView from './views/alerts.js';
import * as editView from './views/edit.js';
import * as itemView from './views/item.js';
import * as pantryView from './views/pantry.js';
import * as recipeView from './views/recipe.js';
import * as recipesView from './views/recipes.js';
import * as scanView from './views/scan.js';
import * as settingsView from './views/settings.js';

// `live` screens redraw when items, settings or the date change.
const ROUTES = [
  { path: /^\/pantry$/, view: pantryView, tab: 'pantry', live: true },
  { path: /^\/alerts$/, view: alertsView, tab: 'alerts', live: true },
  { path: /^\/scan$/, view: scanView, tab: 'scan' },
  { path: /^\/add$/, view: editView, tab: 'scan' },
  { path: /^\/edit\/([^/]+)$/, view: editView, tab: 'pantry' },
  { path: /^\/item\/([^/]+)$/, view: itemView, tab: 'pantry', live: true },
  { path: /^\/recipes$/, view: recipesView, tab: 'recipes', live: true },
  { path: /^\/recipe\/([^/]+)$/, view: recipeView, tab: 'recipes' },
  { path: /^\/settings$/, view: settingsView, tab: 'settings' },
];

const TABS = [
  { id: 'pantry', icon: 'fridge', label: 'Pantry' },
  { id: 'alerts', icon: 'bell', label: 'Alerts' },
  { id: 'scan', icon: 'scan', label: 'Scan' },
  { id: 'recipes', icon: 'pot', label: 'Recipes' },
  { id: 'settings', icon: 'sliders', label: 'Settings' },
];

function renderTabbar() {
  mount(
    $('#tabbar'),
    TABS.map(
      (t) => html`<a href="#/${t.id}" data-tab="${t.id}" class="${t.id === 'scan' ? 'scan-tab' : ''}">
        ${icon(t.icon)}<span>${t.label}</span>${t.id === 'alerts' ? html`<span class="badge" id="alert-badge" hidden></span>` : ''}
      </a>`,
    ),
  );
  // Tapping the tab you're already on scrolls back to the top.
  $('#tabbar').addEventListener('click', (event) => {
    if (event.target.closest('a')?.getAttribute('aria-current') === 'page') window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function decodeParams(match) {
  try {
    return match.slice(1).map(decodeURIComponent);
  } catch {
    return null;
  }
}

let current = null; // { route, where, controller, cleanup }
let sequence = 0;

function teardown() {
  if (!current) return;
  current.controller.abort();
  try {
    current.cleanup?.();
  } catch (err) {
    console.warn(err);
  }
  current = null;
}

async function show(where, { keepScroll = false } = {}) {
  let route = null;
  let params = null;
  for (const candidate of ROUTES) {
    const match = candidate.path.exec(where.path);
    if (match && (params = decodeParams(match))) {
      route = candidate;
      break;
    }
  }
  if (!route) {
    replace('/pantry');
    return;
  }

  const id = ++sequence;
  const scrollY = window.scrollY;
  teardown();
  const controller = new AbortController();
  current = { route, where, controller, cleanup: null };

  // A fresh element per render: listeners a screen adds go away with it.
  const host = document.createElement('div');
  host.className = 'page';
  const view = $('#view');
  view.replaceChildren(host);
  for (const tab of $$('#tabbar a')) {
    if (tab.dataset.tab === route.tab) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (!keepScroll) {
    window.scrollTo(0, 0);
    view.focus({ preventScroll: true });
  }

  let cleanup;
  try {
    cleanup = await route.view.render(host, {
      params,
      query: where.query,
      signal: controller.signal,
      refresh: () => id === sequence && show(where, { keepScroll: true }),
    });
  } catch (err) {
    console.error(err);
    if (id === sequence) {
      mount(
        host,
        html`<div class="empty"><div class="art" aria-hidden="true">😵</div><h2>Something went wrong</h2>
          <p>${err.message}</p><a class="btn" href="#/pantry">Back to pantry</a></div>`,
      );
    }
  }
  if (id !== sequence) {
    if (typeof cleanup === 'function') cleanup(); // already navigated away
    return;
  }
  current.cleanup = typeof cleanup === 'function' ? cleanup : null;
  if (keepScroll) window.scrollTo(0, scrollY);
  checkViewportSoon();
}

let redrawTimer = 0;
/** Redraw the current screen if it's a live one, coalescing bursts of changes. */
function redrawSoon() {
  if (redrawTimer || !current?.route.live) return;
  redrawTimer = setTimeout(() => {
    redrawTimer = 0;
    if (current?.route.live) show(current.where, { keepScroll: true });
  }, 30);
}

function showBadge(count) {
  const badge = $('#alert-badge');
  if (!badge) return;
  badge.hidden = !count;
  badge.textContent = count > 99 ? '99+' : String(count);
  $('[data-tab="alerts"]').setAttribute('aria-label', count ? `Alerts, ${count} need attention` : 'Alerts');
}

// Broken product/recipe photos fall back to the item's emoji.
function imageFallbacks() {
  document.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || img.dataset.fallback === undefined) return;
      const fallback = document.createElement('span');
      fallback.className = img.dataset.fallbackClass ?? '';
      fallback.setAttribute('aria-hidden', 'true');
      fallback.textContent = img.dataset.fallback;
      img.replaceWith(fallback);
    },
    true,
  );
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let updating = false;
  sw.addEventListener('controllerchange', () => {
    if (updating) location.reload();
  });
  sw.addEventListener('message', (event) => {
    if (event.data?.type === 'navigate' && typeof event.data.url === 'string') go(event.data.url);
  });
  sw.startMessages?.();

  const offerUpdate = (worker) => {
    if (!sw.controller) return; // first install: nothing to update yet
    toast('A new version of Pantry Pal is ready.', {
      action: 'Update',
      timeout: 60_000,
      onAction: () => {
        updating = true;
        worker.postMessage({ type: 'skip-waiting' });
      },
    });
  };
  try {
    const reg = await sw.register('sw.js', { type: 'module', updateViaCache: 'none' });
    if (reg.waiting) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') offerUpdate(worker);
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

async function start() {
  renderTabbar();
  imageFallbacks();
  initViewportFix();
  initInstallPrompt();
  try {
    await Promise.all([loadSettings(), loadItems()]);
  } catch (err) {
    console.error(err);
    mount(
      $('#view'),
      html`<div class="empty"><div class="art" aria-hidden="true">🗄️</div><h2>Can’t open storage</h2>
        <p>Pantry Pal keeps your food list in this browser’s storage, which is blocked right now. Private browsing
        modes can do this.</p></div>`,
    );
    return;
  }

  for (const type of ['items-change', 'settings-change', 'day-change', 'permission-change']) on(type, redrawSoon);
  on('badge', showBadge);
  on('alerts-due', (notifications) => {
    const [first] = notifications;
    const more = notifications.length > 1 ? ` (+${notifications.length - 1} more)` : '';
    toast(`${first.title}${more}`, { action: 'View', timeout: 10_000, onAction: () => go(more ? '/alerts' : first.url) });
  });

  startRouter((where) => show(where));
  startAlerts();
  registerServiceWorker();
  cachePrune().catch(() => {});
  // Ask the browser not to clear the pantry under storage pressure (granted quietly to installed apps).
  if (isStandalone()) navigator.storage?.persist?.().catch(() => {});
}

start();
