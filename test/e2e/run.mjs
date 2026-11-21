// End-to-end test in a real Chrome, at a GitHub Pages-style sub-path:
// scan a barcode with the camera -> look it up -> enter the expiry date -> alerts with recipe
// ideas -> notifications (in-app, test, and pushed) -> recipes -> settings exports -> offline.
//
//   npm run test:e2e                         (CHROME_PATH=/path/to/chrome to override)
//   SCREENSHOTS=/tmp/shots npm run test:e2e  (also saves phone-sized screenshots;
//                                             add COLOR_SCHEME=dark for dark mode)
//
// Open Food Facts and TheMealDB are mocked; a fake clock makes alerts fall due on demand.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createStaticServer } from '../../scripts/dev-server.mjs';
import { writeBarcodeVideo } from './barcode-video.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const PORT = Number(process.env.E2E_PORT) || 48733;
const BASE = '/FoodExpiration/';
const APP = `http://localhost:${PORT}${BASE}`;
const SHOTS = process.env.SCREENSHOTS || '';
const MILK_CODE = '4006381333931';
const START = Date.parse('2026-11-24T13:00:00Z'); // Tue 24 Nov 2026, 08:00 in New York

// ---- Mocked online services ----
const PNG = readFileSync(new URL('../../app/icons/icon-192.png', import.meta.url));
const OFF_PRODUCTS = {
  [MILK_CODE]: {
    product_name: 'Semi-Skimmed Milk',
    brands: 'Meadow Farm, Meadow',
    quantity: '1 L',
    categories_tags: ['en:dairies', 'en:milks', 'en:semi-skimmed-milks'],
    image_front_small_url: 'https://images.openfoodfacts.org/images/products/400/638/133/3931/front_en.200.jpg',
  },
};
const thumb = (id) => `https://www.themealdb.com/images/media/meals/${id}.jpg`;
const MEAL_LISTS = [
  [/milk/, [{ idMeal: '52854', strMeal: 'Pancakes' }, { idMeal: '52912', strMeal: 'Rice Pudding' }]],
  [/chicken/, [{ idMeal: '52940', strMeal: 'Brown Stew Chicken' }, { idMeal: '52850', strMeal: 'Chicken Couscous' }]],
  [/spinach/, [{ idMeal: '52850', strMeal: 'Chicken Couscous' }, { idMeal: '53001', strMeal: 'Spinach Pie' }]],
];
const PANCAKES = {
  idMeal: '52854',
  strMeal: 'Pancakes',
  strCategory: 'Dessert',
  strArea: 'American',
  strInstructions: 'Whisk the flour, eggs and milk into a smooth batter.\r\n\r\nRest it for 20 minutes.\r\n\r\nFry ladlefuls in a hot oiled pan until golden on both sides.',
  strMealThumb: thumb('pancakes'),
  strYoutube: 'https://www.youtube.com/watch?v=example',
  strSource: 'https://example.com/pancakes',
  strIngredient1: 'Flour',
  strMeasure1: '100g',
  strIngredient2: 'Eggs',
  strMeasure2: '2 large',
  strIngredient3: 'Milk',
  strMeasure3: '300ml',
  strIngredient4: 'Sunflower Oil',
  strMeasure4: '1 tbsp',
  strIngredient5: '',
};

const external = [];
async function mockInternet(context) {
  // Anything else on the internet is a bug: the app should only talk to these services.
  await context.route(/^https?:\/\/(?!localhost[:/])/, (route) => {
    external.push(`UNEXPECTED ${route.request().url()}`);
    return route.abort();
  });
  await context.route(/^https:\/\/(images\.openfoodfacts\.org|www\.themealdb\.com\/images)\//, (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );
  await context.route(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\//, (route) => {
    const url = new URL(route.request().url());
    external.push(`OFF ${url.pathname.split('/').pop()}`);
    const code = url.pathname.split('/').pop().replace('.json', '');
    const product = OFF_PRODUCTS[code];
    return route.fulfill({
      status: product ? 200 : 404,
      json: product ? { code, status: 1, product } : { code, status: 0, status_verbose: 'product not found' },
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  await context.route(/^https:\/\/www\.themealdb\.com\/api\/json\/v1\/1\//, (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('i') ?? '';
    external.push(`MealDB ${url.pathname.split('/').pop()}?i=${query}`);
    let meals = null;
    if (url.pathname.endsWith('/filter.php')) {
      const name = query.toLowerCase().replace(/_/g, ' ');
      const list = MEAL_LISTS.find(([pattern]) => pattern.test(name))?.[1];
      meals = list?.map((m) => ({ ...m, strMealThumb: thumb(m.idMeal) })) ?? null;
    } else if (url.pathname.endsWith('/lookup.php') && query === PANCAKES.idMeal) {
      meals = [PANCAKES];
    }
    return route.fulfill({ json: { meals }, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}

// ---- Tiny test runner ----
let page;
let shotCount = 0;
async function shot(name) {
  if (!SHOTS) return;
  await page.waitForTimeout(250); // let images and transitions settle
  await page.screenshot({ path: join(SHOTS, `${String(++shotCount).padStart(2, '0')}-${name}.png`) });
}
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    console.log(`  ✔ ${name} (${Date.now() - started} ms)`);
  } catch (err) {
    console.log(`  ✘ ${name}`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `FAILED-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {});
    throw err;
  }
}
const PANTRY = /^(#\/pantry)?$/; // the app opens on the pantry without a #route
const waitForHash = (pattern, timeout = 10_000) =>
  page.waitForFunction((source) => new RegExp(source).test(location.hash), pattern.source, { timeout });
const waitForToast = (text) => page.locator('#toasts .toast', { hasText: text }).waitFor({ timeout: 5000 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The system notification with this tag, once it's showing. */
async function waitForNotification(tag, timeout = 5000) {
  for (const until = Date.now() + timeout; Date.now() < until; await sleep(100)) {
    const shown = await page.evaluate(async (wanted) => {
      const reg = await navigator.serviceWorker.ready;
      const [n] = await reg.getNotifications({ tag: wanted });
      return n && { title: n.title, body: n.body, tag: n.tag, url: n.data?.url };
    }, tag);
    if (shown) return shown;
  }
  throw new Error(`No notification tagged ${tag} was shown.`);
}

async function addByHand({ name, expiry, location }) {
  await page.goto(`${APP}#/add`);
  await page.fill('input[name=name]', name);
  if (location) await page.locator(`.segmented input[value=${location}]`).check({ force: true });
  await page.fill('input[name=expiryDate]', expiry);
  await page.click('button[type=submit][value=done]');
  await waitForHash(PANTRY);
  await page.locator('.list .row .title', { hasText: name }).waitFor();
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'pantry-pal-e2e-'));
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const video = join(dir, 'barcode.y4m');
  writeBarcodeVideo(video, MILK_CODE);

  const server = createStaticServer({ base: BASE });
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${video}`,
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    permissions: ['camera', 'notifications'],
    colorScheme: process.env.COLOR_SCHEME === 'dark' ? 'dark' : 'light',
  });
  await mockInternet(context);
  await context.clock.install({ time: START });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource|ERR_FAILED|ERR_INTERNET_DISCONNECTED/.test(msg.text())) {
      errors.push(`console: ${msg.text()}`);
    }
  });

  const ids = {};
  try {
    console.log('Pantry Pal end-to-end test');

    await step('opens on an empty pantry and installs the service worker', async () => {
      await page.goto(APP);
      await page.getByRole('heading', { name: 'Nothing tracked yet' }).waitFor();
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
      await shot('empty');
    });

    await step('scans a barcode with the camera and looks the product up', async () => {
      await page.getByRole('link', { name: 'Scan an item' }).click();
      await waitForHash(/^#\/scan$/);
      await waitForHash(new RegExp(`^#/add\\?code=${MILK_CODE}$`), 20_000);
      await page.locator('#lookup', { hasText: 'Found on Open Food Facts' }).waitFor();
      assert.equal(await page.inputValue('input[name=name]'), 'Semi-Skimmed Milk');
      assert.equal(await page.inputValue('input[name=brand]'), 'Meadow Farm');
      assert.ok(await page.locator('.segmented input[value=fridge]').isChecked(), 'milk goes in the fridge');
      assert.match(await page.textContent('#expiry-hint'), /Estimate/);
      assert.ok(await page.inputValue('input[name=expiryDate]'), 'an estimated date is filled in');
    });

    await step('takes a manually entered expiry date and previews the alerts', async () => {
      await page.fill('input[name=expiryDate]', '2026-11-25');
      assert.equal(await page.textContent('#expiry-hint'), '');
      assert.equal(await page.textContent('#alert-preview'), 'Alerts: Tue, Nov 24 · Wed, Nov 25 · Thu, Nov 26');
      await shot('add-scanned');
      await page.click('button[type=submit][value=done]');
      await waitForHash(PANTRY);
      await waitForToast('Added Semi-Skimmed Milk.');
      await page.getByRole('heading', { name: 'Expires tomorrow' }).waitFor();
      ids.milk = decodeURIComponent((await page.getAttribute('.list a.row', 'href')).split('/').pop());
    });

    await step('adds items without a barcode', async () => {
      await addByHand({ name: 'Chicken breast', expiry: '2026-11-24' });
      await addByHand({ name: 'Baby spinach', expiry: '2026-11-26', location: 'fridge' });
      const spinachHref = await page.locator('.list a.row', { hasText: 'Baby spinach' }).getAttribute('href');
      ids.spinach = decodeURIComponent(spinachHref.split('/').pop());
      await page.getByRole('heading', { name: 'Expires today' }).waitFor();
      assert.equal((await page.textContent('.summary')).replace(/\s+/g, ' ').trim(), '3 items 3 expiring this week');
      await shot('pantry');
    });

    await step('lists what needs using up, with recipe ideas', async () => {
      await page.locator('#alert-badge', { hasText: /^3$/ }).waitFor();
      await page.click('[data-tab=alerts]');
      await waitForHash(/^#\/alerts$/);
      const cards = page.locator('.alert-card');
      await cards.first().waitFor();
      assert.equal(await cards.count(), 3);
      assert.match(await cards.nth(0).textContent(), /Chicken breast\s*expires today/);
      assert.match(await cards.nth(1).textContent(), /Semi-Skimmed Milk\s*expires tomorrow/);
      await page.locator(`[data-ideas="${ids.milk}"]`, { hasText: 'Pancakes' }).waitFor();
      await page.locator('#upcoming .row').first().waitFor();
      assert.match(await page.textContent('#upcoming'), /Semi-Skimmed Milk\s*Tue, Nov 24, 9:00\sAM · 1 day before/);
      await shot('alerts');
    });

    await step('alerts when items fall due', async () => {
      await page.clock.fastForward('01:01:00'); // 09:01, the default alert time is 09:00
      await waitForToast('🍗 Chicken breast expires today (+1 more)');
      await page.waitForTimeout(500);
      // The alerts already shown are remembered, so they don't appear (or get pushed) again.
      const notified = await page.evaluate(async () => (await import('./js/kv.js')).kvGet('notified', []));
      assert.equal(notified.length, 2);
      assert.ok(notified.includes(`${ids.milk}|1|2026-11-25`));
    });

    await step('shows an item with its alerts and recipe ideas', async () => {
      await page.locator(`.alert-card[data-id="${ids.milk}"] a.top`).click();
      await waitForHash(new RegExp(`^#/item/${ids.milk}$`));
      await page.getByRole('heading', { name: 'Ideas with Semi-skimmed Milk' }).waitFor();
      const text = await page.textContent('#view');
      assert.match(text, /Pancakes/);
      assert.match(text, /Rice Pudding/);
      assert.match(text, /Quick ideas/);
      assert.match(text, /Meadow Farm/);
      await shot('item');
    });

    await step('opens an online recipe that marks what you have', async () => {
      await page.locator('a.recipe-card[href^="#/recipe/m%3A52854"]').click();
      await waitForHash(new RegExp(`^#/recipe/m%3A52854\\?item=${ids.milk}$`));
      await page.getByRole('heading', { name: 'Ingredients' }).waitFor();
      assert.equal(await page.locator('li', { hasText: '300ml' }).locator('.have').textContent(), '✓ Milk');
      assert.equal(await page.locator('li', { hasText: '100g' }).locator('.have').count(), 0, 'no flour in the pantry');
      assert.equal(await page.locator('ol.steps li').count(), 3);
      await shot('recipe');
      await page.locator(`[data-used="${ids.milk}"]`).click();
      await waitForToast('Nice, Semi-Skimmed Milk didn’t go to waste.');
    });

    await step('suggests recipes that use up several items together', async () => {
      await page.click('[data-tab=recipes]');
      await page.locator('#combos', { hasText: 'Chicken Couscous' }).waitFor();
      assert.match(await page.textContent('#combos'), /Uses\s+Chicken breast, Baby spinach/);
      await page.locator('#book .recipe-card').first().waitFor();
      await shot('recipes');
    });

    await step('changes alert intervals and sends a test notification', async () => {
      await page.click('[data-tab=settings]');
      await page.locator('[data-interval="14"]').click();
      await page.locator('#alert-summary', { hasText: 'alerted 2 weeks before, 1 week before,' }).waitFor();
      await page.click('[data-act=test-notification]');
      assert.match((await waitForNotification('test-alert')).title, /Milk expires tomorrow/);
      await shot('settings');
    });

    await step('exports a calendar with alarms and a backup', async () => {
      const [ics] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=ics]')]);
      const calendar = readFileSync(await ics.path(), 'utf8');
      assert.match(ics.suggestedFilename(), /\.ics$/);
      assert.match(calendar, /^BEGIN:VCALENDAR\r\n/);
      assert.match(calendar, /SUMMARY:.*Chicken breast/);
      assert.doesNotMatch(calendar, /Semi-Skimmed Milk/, 'used items are left out');
      assert.match(calendar, /BEGIN:VALARM/);
      const [backup] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]')]);
      const data = JSON.parse(readFileSync(await backup.path(), 'utf8'));
      assert.equal(data.app, 'pantry-pal');
      assert.equal(data.items.length, 3);
      assert.equal(data.settings.push, undefined, 'push server details stay out of backups');
    });

    await step('shows alerts sent by the push server', async () => {
      const cdp = await context.newCDPSession(page);
      const registration = new Promise((resolve) =>
        cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
          const reg = registrations.find((r) => r.scopeURL === APP && !r.isDeleted);
          if (reg) resolve(reg.registrationId);
        }),
      );
      await cdp.send('ServiceWorker.enable');
      // What the server sends for the spinach's "1 day before" alert.
      const tag = `item-${ids.spinach}`;
      const payload = {
        notifications: [{ title: '🥬 Baby spinach expires tomorrow', body: 'Recipe ideas: Spinach Pie', tag, url: `#/item/${ids.spinach}` }],
        keys: [`${ids.spinach}|1|2026-11-26`],
      };
      await cdp.send('ServiceWorker.deliverPushMessage', {
        origin: new URL(APP).origin,
        registrationId: await registration,
        data: JSON.stringify(payload),
      });
      assert.deepEqual(await waitForNotification(tag), payload.notifications[0]);
      const notified = await page.evaluate(async () => (await import('./js/kv.js')).kvGet('notified', []));
      assert.ok(notified.includes(payload.keys[0]), 'pushed alerts are remembered');
    });

    await step('works offline, including scanning products you have bought before', async () => {
      await context.setOffline(true);
      await page.goto(`${APP}#/pantry`);
      await page.locator('.list .row .title', { hasText: 'Chicken breast' }).waitFor();
      await shot('offline');
      await page.goto(`${APP}#/scan`);
      await waitForHash(new RegExp(`^#/add\\?code=${MILK_CODE}$`), 20_000);
      await page.locator('#lookup', { hasText: 'You’ve added this before' }).waitFor();
      assert.equal(await page.inputValue('input[name=name]'), 'Semi-Skimmed Milk');
      assert.equal(await page.inputValue('input[name=expiryDate]'), '2026-11-25', 'remembers how long it keeps');
      await context.setOffline(false);
    });

    const unexpected = external.filter((e) => e.startsWith('UNEXPECTED'));
    assert.deepEqual(unexpected, [], 'no other internet requests');
    assert.deepEqual(errors, [], 'no errors in the page');
    console.log(`All passed. Requests to online services: ${external.length}.`);
  } finally {
    await browser.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
