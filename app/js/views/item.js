// One item: expiry details, its alert schedule, actions and recipes to use it up.
import { attentionList, buildSchedule } from '../alerts.js';
import { formatDate, toISODate } from '../dates.js';
import { kvGet } from '../kv.js';
import { back } from '../nav.js';
import { suggestionsFor } from '../recipes.js';
import { getSettings } from '../settings.js';
import { allItems, deleteItem, findItem, setStatus } from '../store.js';
import { $, choose, expiryPill, html, icon, locationName, mount, setHeader, thumb, toast } from '../ui.js';
import { dismissAlert, finishItem, recipeCard, skeletons, snoozeItem } from './shared.js';

const when = (ms) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
    new Date(ms),
  );

async function upcomingAlerts(item, settings) {
  const notified = new Set(await kvGet('notified', []));
  const now = Date.now();
  return buildSchedule([item], settings).filter((e) => e.fireAt > now && !notified.has(e.key));
}

function recipesMarkup(item, { builtin, online }, settings) {
  const ideas = [];
  if (online?.length) {
    ideas.push(html`<h3 class="group-title">Ideas with ${item.ingredient || item.name}</h3>
      <div class="recipes scroller">${online.slice(0, 15).map((r) => recipeCard(r, { itemId: item.id }))}</div>`);
  }
  if (builtin.length) {
    ideas.push(html`<h3 class="group-title">Quick ideas</h3>
      <div class="recipes scroller">${builtin.slice(0, 12).map((r) => recipeCard(r, { itemId: item.id }))}</div>`);
  }
  if (online === null && settings.recipesOnline) {
    ideas.push(html`<p class="hint">Connect to the internet for more recipe ideas.</p>`);
  }
  if (!builtin.length && !online?.length) {
    ideas.push(html`<p class="hint">No recipe ideas for this yet. Try setting its main ingredient (Edit → More details).</p>`);
  }
  return ideas;
}

export function render(el, { params, signal }) {
  const item = findItem(params[0]);
  if (!item) {
    setHeader({ title: 'Item', back: '/pantry' });
    mount(el, html`<div class="empty"><h2>This item is gone</h2><p>It was deleted.</p><a class="btn" href="#/pantry">Back to pantry</a></div>`);
    return;
  }
  const settings = getSettings();
  const active = item.status === 'active';
  const alert = active ? attentionList([item], settings)[0] : null;
  setHeader({
    title: item.name,
    back: '/pantry',
    actions: html`<a class="icon-btn" href="#/edit/${encodeURIComponent(item.id)}" aria-label="Edit">${icon('edit')}</a>`,
  });

  const finished = html`<div class="banner">${icon(item.status === 'used' ? 'check' : 'trash')}<div>
      <p>${item.status === 'used' ? 'Used' : 'Tossed'} on ${formatDate(toISODate(new Date(item.finishedAt ?? item.updatedAt)))}.</p>
      <button class="btn small" type="button" data-act="restore">Put back in pantry</button></div></div>`;

  mount(
    el,
    html`<div class="hero">
        ${thumb(item, 'lg')}
        <div>
          <h2>${item.name}</h2>
          ${item.brand || item.quantity ? html`<p class="sub">${[item.brand, item.quantity].filter(Boolean).join(' · ')}</p>` : ''}
          ${active ? expiryPill(item, { long: true }) : ''}
        </div>
      </div>
      ${active
        ? html`<div class="actions grid">
            <button class="btn primary" type="button" data-act="used">${icon('check')} Used it</button>
            <button class="btn" type="button" data-act="tossed">${icon('trash')} Tossed it</button>
            ${alert && !alert.snoozed ? html`<button class="btn" type="button" data-act="snooze">${icon('clock')} Snooze</button>` : ''}
            ${alert && !alert.acknowledged && !alert.snoozed ? html`<button class="btn" type="button" data-act="dismiss">${icon('x')} Dismiss alert</button>` : ''}
          </div>`
        : finished}
      <div class="card">
        <dl class="facts">
          <dt>Expires</dt><dd>${formatDate(item.expiryDate)}${item.expirySource === 'estimate' ? ' (estimated)' : ''}</dd>
          <dt>Kept in</dt><dd>${locationName(item.location) || '—'}</dd>
          ${item.purchaseDate ? html`<dt>Bought</dt><dd>${formatDate(item.purchaseDate)}</dd>` : ''}
          ${item.barcode ? html`<dt>Barcode</dt><dd>${item.barcode}</dd>` : ''}
          ${item.notes ? html`<dt>Notes</dt><dd>${item.notes}</dd>` : ''}
          ${active ? html`<dt>Alerts</dt><dd id="alerts">…</dd>` : ''}
        </dl>
      </div>
      <h2>Recipes to use it up</h2>
      <div id="recipes"><div class="recipes scroller">${skeletons(3)}</div></div>
      <button class="btn block ghost danger" type="button" data-act="delete">${icon('trash')} Delete (added by mistake)</button>`,
  );

  if (active) {
    upcomingAlerts(item, settings).then((entries) => {
      if (signal.aborted) return;
      const text = item.snoozedUntil > Date.now() ? `Snoozed until ${when(item.snoozedUntil)}` : '';
      const list = entries.map((e) => when(e.fireAt)).join(' · ');
      $('#alerts', el).textContent = [text, list || 'No more alerts scheduled'].filter(Boolean).join('. ');
    });
  }

  suggestionsFor(item, allItems(), { online: settings.recipesOnline })
    .then((suggestions) => {
      if (!signal.aborted) mount($('#recipes', el), recipesMarkup(item, suggestions, settings));
    })
    .catch((err) => {
      console.warn(err);
      if (!signal.aborted) mount($('#recipes', el), html`<p class="hint">Couldn’t load recipes.</p>`);
    });

  el.addEventListener('click', async (event) => {
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'used' || act === 'tossed') await finishItem(item, act);
    else if (act === 'snooze') await snoozeItem(item);
    else if (act === 'dismiss') await dismissAlert(alert);
    else if (act === 'restore') {
      await setStatus(item.id, 'active');
      toast(`${item.name} is back in your pantry.`);
    } else if (act === 'delete') {
      const ok = await choose(`Delete ${item.name}?`, [{ label: 'Delete', value: true }]);
      if (!ok) return;
      await deleteItem(item.id);
      toast(`Deleted ${item.name}.`);
      back('/pantry');
    }
  });
}
