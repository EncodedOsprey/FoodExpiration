// Settings: when to alert, how alerts reach you, online data sources and your data.
import { INTERVAL_CHOICES } from '../alerts.js';
import { todayISO } from '../dates.js';
import { buildICS } from '../ics.js';
import { notificationPermission, registerPeriodicSync, requestPermission, testNotification } from '../notify.js';
import { canPromptInstall, isIOS, isStandalone, promptInstall } from '../platform.js';
import { connect, disconnect, testPush } from '../push.js';
import { recipeHints } from '../recipes.js';
import { getSettings, updateSettings } from '../settings.js';
import { activeItems, allItems, clearHistory, importItems } from '../store.js';
import { $, choose, download, html, icon, mount, setHeader, toast } from '../ui.js';
import { INTERVAL_LABELS, alertSummary } from './shared.js';

const HIDE_INSTALL_KEY = 'pantry-pal:hide-install';

const summaryText = (s) => alertSummary(s) || 'Alerts are off. Pick at least one reminder above.';

const switchRow = (setting, label, detail = '') => html`<label class="switch">
    <span>${label}${detail ? html`<small>${detail}</small>` : ''}</span>
    <input type="checkbox" data-setting="${setting}" ${getSettings()[setting] ? 'checked' : ''}>
  </label>`;

function notificationsMarkup() {
  const permission = notificationPermission();
  if (permission === 'granted') {
    return html`<p class="hint ok">${icon('check')} Notifications are on.</p>
      <p class="hint" id="bg-status">Checking background alerts…</p>
      <div class="actions"><button class="btn small" type="button" data-act="test-notification">${icon('bell')} Send a test alert</button></div>`;
  }
  if (permission === 'denied') {
    return html`<p class="hint warn">Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.</p>`;
  }
  if (permission === 'unsupported') {
    return isIOS() && !isStandalone()
      ? html`<p class="hint">On iPhone and iPad, first tap ${icon('share')} Share → <strong>Add to Home Screen</strong>, then open Pantry Pal from your Home Screen to turn on notifications (iOS 16.4 or later).</p>`
      : html`<p class="hint">This browser can’t show notifications. Alerts still appear in the app, and you can add expiry dates to your calendar below.</p>`;
  }
  return html`<p class="hint">Get a notification with recipe ideas when food is about to expire.</p>
    <div class="actions"><button class="btn primary" type="button" data-act="enable">${icon('bell')} Turn on notifications</button></div>`;
}

function backgroundText(status) {
  if (getSettings().push.connected) return 'Your push server delivers alerts even when Pantry Pal is closed.';
  if (status === 'registered') {
    return 'This device also checks a few times a day while Pantry Pal is closed (the browser decides exactly when).';
  }
  if (status === 'not-installed') {
    return 'Alerts show while Pantry Pal is open. Install the app so Chrome can also check while it’s closed, or connect a push server below.';
  }
  return isIOS()
    ? 'On iPhone and iPad, alerts only arrive while the app is open unless you connect a push server below.'
    : 'This browser only checks while Pantry Pal is open. For alerts at any time, connect a push server below or use the calendar export.';
}

function pushMarkup() {
  const { push } = getSettings();
  if (push.connected) {
    return html`<p class="hint ok">${icon('check')} Connected to ${push.url}</p>
      <div class="actions">
        <button class="btn small" type="button" data-act="push-test">${icon('bell')} Send a test push</button>
        <button class="btn small ghost" type="button" data-act="push-disconnect">Disconnect</button>
      </div>`;
  }
  return html`<form id="push-form" novalidate>
    <label class="field"><span>Server address</span>
      <input type="url" name="url" required placeholder="https://push.example.com" value="${push.url}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <label class="field"><span>Access token (if your server uses one)</span>
      <input type="password" name="token" value="${push.token}" autocomplete="off"></label>
    <button class="btn" type="submit">Connect this device</button>
    <p class="hint" id="push-status" role="status"></p>
  </form>`;
}

function installMarkup() {
  if (isStandalone()) return '';
  if (canPromptInstall()) {
    return html`<section class="card"><h3>Install</h3>
      <p class="hint">Add Pantry Pal to your home screen or desktop. It works offline and opens straight to the scanner.</p>
      <div class="actions"><button class="btn" type="button" data-act="install">${icon('phone')} Install Pantry Pal</button></div></section>`;
  }
  if (isIOS()) {
    return html`<section class="card"><h3>Install</h3>
      <p class="hint">Tap ${icon('share')} Share → <strong>Add to Home Screen</strong>. On iPhone and iPad that’s needed for notifications.</p></section>`;
  }
  return '';
}

/** Save a file: the share sheet in an installed iPhone app (downloads don't work there), else a download. */
async function saveFile(name, content, type) {
  if (isIOS() && isStandalone() && navigator.canShare) {
    const file = new File([content], name, { type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
      } catch (err) {
        if (err.name !== 'AbortError') throw err;
      }
      return;
    }
  }
  download(name, content, type);
}

async function exportCalendar() {
  const settings = getSettings();
  const items = activeItems().filter((i) => i.expiryDate);
  if (!items.length) {
    toast('Add some food with expiry dates first.');
    return;
  }
  const hints = await recipeHints(items, { online: settings.recipesOnline }).catch(() => ({}));
  const ics = buildICS(items, settings, { appUrl: location.href.split('#')[0], hints });
  await saveFile('pantry-pal-expiry-dates.ics', ics, 'text/calendar');
}

async function exportBackup() {
  const { push, ...settings } = getSettings(); // the push token stays on this device
  const data = { app: 'pantry-pal', version: 1, exportedAt: new Date().toISOString(), items: allItems(), settings };
  await saveFile(`pantry-pal-backup-${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

async function importBackup(file, refresh) {
  let data = null;
  try {
    data = JSON.parse(await file.text());
  } catch {
    // handled below
  }
  if (data?.app !== 'pantry-pal' || !Array.isArray(data.items)) {
    toast('That file isn’t a Pantry Pal backup.');
    return;
  }
  const ok = await choose(`Restore ${data.items.length} items? Items already here are kept.`, [{ label: 'Restore', value: true }]);
  if (!ok) return;
  const count = await importItems(data.items);
  if (data.settings && typeof data.settings === 'object') {
    await updateSettings({ ...data.settings, push: getSettings().push });
  }
  toast(`Restored ${count} items.`);
  refresh();
}

const deleteDatabase = (name) =>
  new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });

async function eraseEverything() {
  const ok = await choose('Erase all food, history and settings on this device?', [
    { label: 'Erase everything', value: true },
  ]);
  if (!ok) return;
  if (getSettings().push.connected) await disconnect().catch(() => {});
  navigator.clearAppBadge?.().catch(() => {});
  localStorage.removeItem(HIDE_INSTALL_KEY);
  await Promise.all(['pantry-pal', 'pantry-pal-kv'].map(deleteDatabase));
  location.replace(`${location.pathname}${location.search}#/pantry`);
  location.reload();
}

export function render(el, { refresh }) {
  setHeader({ title: 'Settings' });
  const s = getSettings();
  mount(
    el,
    html`<section class="card">
        <h3>When to remind me</h3>
        <span class="label" id="interval-label">Before the expiry date</span>
        <div class="chips wrap" role="group" aria-labelledby="interval-label">${INTERVAL_CHOICES.map(
          (d) => html`<button class="chip" type="button" data-interval="${d}" aria-pressed="${s.intervals.includes(d)}">${INTERVAL_LABELS[d]}</button>`,
        )}</div>
        ${switchRow('expiredAlert', 'The day after it expires')}
        <label class="field"><span>Alert time</span><input type="time" name="notifyTime" value="${s.notifyTime}" required></label>
        <p class="hint" id="alert-summary">${summaryText(s)}</p>
      </section>
      <section class="card"><h3>Notifications</h3><div id="notifications"></div></section>
      <section class="card">
        <h3>Alerts when the app is closed</h3>
        <p class="hint">Optional. Connect your own Pantry Pal push server (instructions in the project’s README) and alerts arrive even when the app is closed. This is the only way on iPhone and iPad.</p>
        <div id="push"></div>
      </section>
      <section class="card">
        <h3>Calendar</h3>
        <p class="hint">Put expiry dates in your calendar, with reminders at your alert times. Export again after adding food.</p>
        <div class="actions"><button class="btn" type="button" data-act="ics">${icon('calendar')} Add to calendar (.ics)</button></div>
        <p class="hint">Apple Calendar and Outlook keep the reminders. Google Calendar imports the dates but not the reminders.</p>
      </section>
      <section class="card">
        <h3>Scanning &amp; online data</h3>
        ${switchRow('beep', 'Beep when a barcode is found')}
        ${'vibrate' in navigator ? switchRow('vibrate', 'Vibrate when a barcode is found') : ''}
        ${switchRow('lookupOnline', 'Look up products online', 'Names, photos and categories from Open Food Facts')}
        ${switchRow('recipesOnline', 'Online recipe ideas', 'Recipes with photos from TheMealDB')}
      </section>
      <section class="card">
        <h3>Your data</h3>
        <p class="hint">Your pantry is stored only on this device. Back it up to move it to another one.</p>
        <div class="actions">
          <button class="btn" type="button" data-act="export">${icon('download')} Back up</button>
          <button class="btn" type="button" data-act="import">${icon('upload')} Restore</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>
        <div class="actions">
          <button class="btn" type="button" data-act="clear-history">Clear used &amp; tossed history</button>
          <button class="btn ghost danger" type="button" data-act="erase">Erase everything</button>
        </div>
      </section>
      ${installMarkup()}
      <p class="credits">Product data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL).
        Recipes from <a href="https://www.themealdb.com" target="_blank" rel="noopener">TheMealDB</a>.
        Barcode reading by <a href="https://github.com/Sec-ant/zxing-wasm" target="_blank" rel="noopener">zxing-wasm</a> (ZXing-C++).</p>`,
  );

  const drawNotifications = () => {
    mount($('#notifications', el), notificationsMarkup());
    if (notificationPermission() !== 'granted') return;
    registerPeriodicSync().then((status) => {
      const host = $('#bg-status', el);
      if (host) host.textContent = backgroundText(status);
    });
  };
  const drawPush = () => mount($('#push', el), pushMarkup());
  const drawSummary = () => ($('#alert-summary', el).textContent = summaryText(getSettings()));
  drawNotifications();
  drawPush();

  // Runs an action, showing failures as a toast instead of an unhandled rejection.
  const attempt = async (action) => {
    try {
      await action();
    } catch (err) {
      console.warn(err);
      toast(err.message || 'Something went wrong.');
    }
  };

  el.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-interval]');
    if (chip) {
      const value = Number(chip.dataset.interval);
      const intervals = new Set(getSettings().intervals);
      if (intervals.has(value)) intervals.delete(value);
      else intervals.add(value);
      chip.setAttribute('aria-pressed', String(intervals.has(value)));
      updateSettings({ intervals: [...intervals].sort((a, b) => b - a) }).then(drawSummary);
      return;
    }
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    attempt(async () => {
      if (act === 'enable') {
        await requestPermission();
        drawNotifications();
      } else if (act === 'test-notification') {
        await testNotification();
      } else if (act === 'push-test') {
        await testPush();
        toast('Test sent. It should arrive in a few seconds.');
      } else if (act === 'push-disconnect') {
        await disconnect();
        drawPush();
        drawNotifications();
      } else if (act === 'ics') {
        await exportCalendar();
      } else if (act === 'export') {
        await exportBackup();
      } else if (act === 'import') {
        $('#import-file', el).click();
      } else if (act === 'clear-history') {
        const count = await clearHistory(0);
        toast(count ? `Cleared ${count} items from history.` : 'History is already empty.');
      } else if (act === 'erase') {
        await eraseEverything();
      } else if (act === 'install') {
        if (await promptInstall()) localStorage.setItem(HIDE_INSTALL_KEY, '1');
        refresh();
      }
    });
  });

  el.addEventListener('change', (event) => {
    const target = event.target;
    if (target.name === 'notifyTime') {
      const time = target.value.slice(0, 5);
      if (/^\d\d:\d\d$/.test(time)) updateSettings({ notifyTime: time }).then(drawSummary);
    } else if (target.dataset.setting) {
      updateSettings({ [target.dataset.setting]: target.checked }).then(drawSummary);
    } else if (target.id === 'import-file' && target.files[0]) {
      const file = target.files[0];
      target.value = '';
      attempt(() => importBackup(file, refresh));
    }
  });

  el.addEventListener('submit', (event) => {
    if (event.target.id !== 'push-form') return;
    event.preventDefault();
    const form = event.target;
    const status = $('#push-status', form);
    const button = $('button[type="submit"]', form);
    if (!form.elements.url.value.trim()) {
      status.className = 'hint warn';
      status.textContent = 'Enter your push server’s address.';
      return;
    }
    button.disabled = true;
    status.className = 'hint';
    status.textContent = 'Connecting…';
    // connect() asks for notification permission first, so it must start inside this event.
    connect(form.elements.url.value, form.elements.token.value).then(
      () => {
        drawPush();
        drawNotifications();
        toast('Connected. Alerts will arrive even when the app is closed.');
      },
      (err) => {
        status.className = 'hint warn';
        status.textContent = err.message;
        button.disabled = false;
      },
    );
  });
}
