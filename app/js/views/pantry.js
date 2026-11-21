// Pantry: everything you're tracking, soonest to expire first.
import { groupLabel } from '../alerts.js';
import { on } from '../events.js';
import { LOCATIONS } from '../foods.js';
import { canPromptInstall, isIOS, isStandalone, promptInstall } from '../platform.js';
import { allItems, clearHistory } from '../store.js';
import { $, $$, daysLeftOf, html, icon, mount, setHeader, toast } from '../ui.js';
import { itemRow } from './shared.js';

const FILTERS = [{ id: 'all', label: 'All' }, ...LOCATIONS, { id: 'history', label: 'History' }];
const GROUP_ORDER = ['Expired', 'Expires today', 'Expires tomorrow', 'Within 3 days', 'This week', 'Coming up', 'No date'];
const INSTALL_KEY = 'pantry-pal:hide-install';

// Kept between visits so coming back from an item keeps your place.
let filter = 'all';
let search = '';

const matches = (item, q) =>
  !q || `${item.name} ${item.brand ?? ''} ${item.notes ?? ''}`.toLowerCase().includes(q.trim().toLowerCase());

function grouped(items) {
  const groups = new Map(GROUP_ORDER.map((g) => [g, []]));
  for (const item of items) {
    const days = daysLeftOf(item);
    groups.get(days === null ? 'No date' : groupLabel(days)).push(item);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (daysLeftOf(a) ?? 1e9) - (daysLeftOf(b) ?? 1e9) || a.name.localeCompare(b.name));
  }
  return [...groups].filter(([, list]) => list.length);
}

function listMarkup(items) {
  if (filter === 'history') {
    const done = items
      .filter((i) => i.status !== 'active' && matches(i, search))
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    if (!done.length) return html`<p class="empty">Items you mark as used or tossed show up here.</p>`;
    const used = done.filter((i) => i.status === 'used').length;
    return html`<p class="hint">${used} used, ${done.length - used} tossed.</p>
      <ul class="list">${done.map((i) => itemRow(i))}</ul>
      <button class="btn block ghost danger" type="button" data-act="clear-history">${icon('trash')} Clear history</button>`;
  }
  const active = items.filter(
    (i) => i.status === 'active' && (filter === 'all' || i.location === filter) && matches(i, search),
  );
  if (!active.length) return html`<p class="empty">${search ? 'Nothing matches your search.' : 'Nothing here.'}</p>`;
  return grouped(active).map(
    ([label, list]) => html`<h2 class="group-title">${label}</h2><ul class="list">${list.map((i) => itemRow(i))}</ul>`,
  );
}

function summary(active) {
  const days = active.map((item) => daysLeftOf(item)).filter((d) => d !== null);
  const expired = days.filter((d) => d < 0).length;
  const soon = days.filter((d) => d >= 0 && d <= 7).length;
  return html`<div class="summary">
    <span class="pill">${active.length} ${active.length === 1 ? 'item' : 'items'}</span>
    ${expired ? html`<span class="pill urgency-expired">${expired} expired</span>` : ''}
    ${soon ? html`<span class="pill urgency-week">${soon} expiring this week</span>` : ''}
  </div>`;
}

function installBanner() {
  if (isStandalone() || localStorage.getItem(INSTALL_KEY)) return '';
  const close = html`<button class="icon-btn" type="button" data-act="hide-install" aria-label="Hide">${icon('x')}</button>`;
  if (canPromptInstall()) {
    return html`<div class="banner">${icon('phone')}<div><p><strong>Install Pantry Pal</strong> on your home screen so expiry alerts can reach you.</p>
      <button class="btn small primary" type="button" data-act="install">Install</button></div>${close}</div>`;
  }
  if (isIOS()) {
    return html`<div class="banner">${icon('share')}<div><p><strong>Get alerts on iPhone:</strong> tap Share, then “Add to Home Screen”, and open Pantry Pal from there.</p></div>${close}</div>`;
  }
  return '';
}

function emptyState() {
  return html`${installBanner()}<div class="empty">
    <div class="art" aria-hidden="true">🧺</div>
    <h2>Nothing tracked yet</h2>
    <p>Scan the barcode on something you bought and add its expiry date. You’ll get a heads-up, with recipe ideas, before it goes off.</p>
    <div class="actions center">
      <a class="btn primary" href="#/scan">${icon('scan')} Scan an item</a>
      <a class="btn" href="#/add">${icon('edit')} Add by hand</a>
    </div>
  </div>`;
}

export function render(el) {
  setHeader({
    title: 'Pantry',
    actions: html`<a class="icon-btn" href="#/add" aria-label="Add without scanning">${icon('plus')}</a>`,
  });
  const items = allItems();
  const active = items.filter((i) => i.status === 'active');
  if (!items.length) mount(el, emptyState());
  else {
    mount(
      el,
      html`${installBanner()}
        ${summary(active)}
        <div class="search">${icon('search')}<input type="search" id="search" placeholder="Search your food" aria-label="Search your food" value="${search}" autocomplete="off"></div>
        <div class="chips" role="group" aria-label="Show">
          ${FILTERS.map((f) => html`<button class="chip" type="button" data-filter="${f.id}" aria-pressed="${String(f.id === filter)}">${f.label}</button>`)}
        </div>
        <div id="list"></div>`,
    );
  }
  const draw = () => {
    const list = $('#list', el);
    if (list) mount(list, listMarkup(items));
  };
  draw();

  $('#search', el)?.addEventListener('input', (event) => {
    search = event.target.value;
    draw();
  });
  el.addEventListener('click', onClick);
  async function onClick(event) {
    const chip = event.target.closest('[data-filter]');
    if (chip) {
      filter = chip.dataset.filter;
      for (const c of $$('[data-filter]', el)) c.setAttribute('aria-pressed', String(c === chip));
      draw();
      return;
    }
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'hide-install') {
      localStorage.setItem(INSTALL_KEY, '1');
      event.target.closest('.banner')?.remove();
    } else if (act === 'install') {
      await promptInstall();
      $('.banner', el)?.remove();
    } else if (act === 'clear-history') {
      const removed = await clearHistory(0);
      toast(`Cleared ${removed} ${removed === 1 ? 'item' : 'items'} from history.`);
    }
  }
  const offInstall = on('installable', () => {
    if (!$('.banner', el) && installBanner()) el.insertAdjacentHTML('afterbegin', String(installBanner()));
  });
  return () => {
    el.removeEventListener('click', onClick);
    offInstall();
  };
}
