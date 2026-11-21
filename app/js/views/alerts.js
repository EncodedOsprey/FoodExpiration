// Alerts: everything that needs using up, with recipe ideas, plus what's coming next.
import { EXPIRED_STAGE, attentionList, buildSchedule, phraseFor, urgencyOf } from '../alerts.js';
import { kvGet } from '../kv.js';
import { notificationPermission, requestPermission } from '../notify.js';
import { isIOS, isStandalone } from '../platform.js';
import { builtInFor, suggestionsFor } from '../recipes.js';
import { getSettings } from '../settings.js';
import { activeItems, allItems } from '../store.js';
import { $, $$, expiryPill, html, icon, locationName, mount, setHeader, thumb } from '../ui.js';
import { alertSummary, dismissAlert, finishItem, itemHref, itemRow, recipeHref, snoozeItem } from './shared.js';

const MAX_IDEAS = 3;

function stageText(stage) {
  if (typeof stage !== 'number') return 'reminder';
  if (stage === EXPIRED_STAGE) return 'day after expiry';
  if (stage === 0) return 'on the day';
  return stage === 1 ? '1 day before' : `${stage} days before`;
}

const when = (ms) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
    new Date(ms),
  );

function permissionBanner() {
  const permission = notificationPermission();
  if (permission === 'granted') return '';
  if (permission === 'unsupported') {
    if (isIOS() && !isStandalone()) {
      return html`<div class="banner">${icon('share')}<div><p><strong>Alerts on iPhone:</strong> tap Share, then “Add to Home Screen”. Open Pantry Pal from your Home Screen and turn on notifications.</p></div></div>`;
    }
    return html`<div class="banner warn">${icon('bell')}<div><p>This browser can’t show notifications. Alerts appear here when you open the app, and you can add expiry dates to your calendar in Settings.</p></div></div>`;
  }
  if (permission === 'denied') {
    return html`<div class="banner warn">${icon('bell')}<div><p>Notifications are blocked for this site. Allow them in your browser’s site settings to get alerts.</p></div></div>`;
  }
  return html`<div class="banner">${icon('bell')}<div><p><strong>Get notified</strong> before food expires, with recipe ideas.</p>
    <button class="btn small primary" type="button" data-act="enable">Turn on notifications</button></div></div>`;
}

function ideaLinks(item, ideas) {
  if (!ideas.length) return html`<a href="${itemHref(item)}">Find recipes</a>`;
  return ideas.map((r, i) => html`${i ? ' · ' : ''}<a href="${recipeHref(r, item.id)}">${r.name}</a>`);
}

/** Online recipes that also use other expiring food, then the best built-in ones, keeping room for an online idea. */
function pickIdeas({ builtin, online }) {
  const core = builtin.filter((r) => r.core);
  const web = online ?? [];
  const ordered = [...web.filter((r) => r.also.length), ...core.slice(0, MAX_IDEAS - 1), ...web, ...core, ...builtin];
  const seen = new Set();
  return ordered.filter((r) => !seen.has(r.key) && seen.add(r.key)).slice(0, MAX_IDEAS);
}

function alertCard(alert, pantry) {
  const { item, daysLeft } = alert;
  const where = locationName(item.location);
  const quick = builtInFor(item, pantry).filter((r) => r.core).slice(0, MAX_IDEAS);
  return html`<article class="card alert-card urgency-${urgencyOf(daysLeft)}" data-id="${item.id}">
    <a class="top" href="${itemHref(item)}">
      ${thumb(item)}
      <span class="main">
        <span class="title">${item.name}</span>
        <span class="sub">${phraseFor(daysLeft)}${where ? ` · ${where}` : ''}</span>
      </span>
      ${expiryPill(item)}
    </a>
    <p class="ideas">${icon('pot')} <span data-ideas="${item.id}">${ideaLinks(item, quick)}</span></p>
    <div class="actions">
      <button class="btn small" type="button" data-act="used">${icon('check')} Used</button>
      <button class="btn small" type="button" data-act="tossed">${icon('trash')} Tossed</button>
      <button class="btn small" type="button" data-act="snooze">${icon('clock')} Snooze</button>
      <button class="btn small ghost" type="button" data-act="dismiss">${icon('x')} Dismiss</button>
    </div>
  </article>`;
}

export function render(el, { signal }) {
  setHeader({ title: 'Alerts' });
  const settings = getSettings();
  const pantry = allItems();
  const list = attentionList(activeItems(), settings);
  const pending = list.filter((a) => !a.acknowledged && !a.snoozed);
  const quiet = list.filter((a) => a.acknowledged || a.snoozed);

  mount(
    el,
    html`${permissionBanner()}
      ${pending.length
        ? pending.map((a) => alertCard(a, pantry))
        : html`<div class="empty"><div class="art" aria-hidden="true">✅</div><h2>All clear</h2>
            <p>Nothing needs using up right now. Alerts appear here (and as notifications) as things get close to their date.</p></div>`}
      ${quiet.length
        ? html`<details class="card"><summary>Dismissed or snoozed (${quiet.length})</summary>
            <ul class="list">${quiet.map((a) => itemRow(a.item))}</ul></details>`
        : ''}
      <h2>Upcoming alerts</h2>
      <p class="hint">${alertSummary(settings) || 'Alerts are off.'} <a href="#/settings">Change</a></p>
      <div id="upcoming"></div>`,
  );

  // Upcoming notifications, straight from the schedule the notifications use.
  kvGet('notified', []).then((notified) => {
    if (signal.aborted) return;
    const shown = new Set(notified);
    const now = Date.now();
    const next = buildSchedule(activeItems(), settings)
      .filter((e) => e.fireAt > now && !shown.has(e.key))
      .slice(0, 8);
    mount(
      $('#upcoming', el),
      next.length
        ? html`<ul class="list">${next.map(
            (e) => html`<li><a class="row" href="${e.url}">
              <span class="thumb" aria-hidden="true">${e.emoji}</span>
              <span class="main"><span class="title">${e.name}</span><span class="sub">${when(e.fireAt)} · ${stageText(e.stage)}</span></span>
            </a></li>`,
          )}</ul>`
        : html`<p class="hint">No alerts scheduled.</p>`,
    );
  });

  // Swap in better recipe ideas (including online ones) as they load.
  (async () => {
    for (const alert of pending.slice(0, 10)) {
      const suggestions = await suggestionsFor(alert.item, pantry, { online: settings.recipesOnline }).catch(() => null);
      if (signal.aborted) return;
      const host = $$('[data-ideas]', el).find((n) => n.dataset.ideas === alert.item.id);
      if (suggestions && host) mount(host, ideaLinks(alert.item, pickIdeas(suggestions)));
    }
  })();

  el.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const act = button.dataset.act;
    if (act === 'enable') {
      await requestPermission(); // the screen refreshes on 'permission-change'
      return;
    }
    const id = button.closest('[data-id]')?.dataset.id;
    const alert = pending.find((a) => a.item.id === id);
    if (!alert) return;
    if (act === 'used' || act === 'tossed') await finishItem(alert.item, act);
    else if (act === 'snooze') await snoozeItem(alert.item);
    else if (act === 'dismiss') await dismissAlert(alert);
  });
}
