import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { DEFAULT_ALERT_SETTINGS, buildSchedule } from '../app/js/alerts.js';
import { kvGet, kvSet } from '../app/js/kv.js';
import { claimDue } from '../app/js/notify-core.js';
import { lookupProduct, rememberProduct } from '../app/js/products.js';
import { getRecipe, suggestionsFor, useItUpIdeas } from '../app/js/recipes.js';

let routes;
let calls;
beforeEach(() => {
  routes = new Map();
  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    for (const [pattern, reply] of routes) {
      if (String(url).includes(pattern)) {
        if (reply instanceof Error) throw reply;
        return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
      }
    }
    throw new TypeError('Failed to fetch');
  };
});

const meal = (id, name) => ({ idMeal: id, strMeal: name, strMealThumb: `https://img/${id}.jpg` });

test('looks products up on Open Food Facts, trying the EAN-13 form of a UPC', async () => {
  routes.set('/product/036000291452.json', { status: 404, body: { status: 0 } });
  routes.set('/product/0036000291452.json', {
    body: {
      status: 1,
      product: {
        product_name: 'Whole Milk',
        brands: 'Happy Farm, Some Group',
        quantity: '1 gal',
        categories_tags: ['en:dairies', 'en:milks', 'fr:laits'],
      },
    },
  });
  const result = await lookupProduct('036000291452');
  assert.equal(result.status, 'found');
  assert.equal(result.product.brand, 'Happy Farm');
  assert.deepEqual(result.product.categories, ['dairies', 'milks']);

  // Saved locally: the next scan works without the network.
  routes.clear();
  assert.equal((await lookupProduct('036000291452')).product.name, 'Whole Milk');
  assert.equal((await lookupProduct('4006381333931')).status, 'error');
});

test('remembers what you entered for a barcode, including how long it lasted', async () => {
  await rememberProduct({
    barcode: '4006381333931',
    name: 'Oat milk',
    location: 'fridge',
    typeId: 'plant-milk',
    purchaseDate: '2026-03-01',
    expiryDate: '2026-03-11',
    expirySource: 'manual',
  });
  const { status, product, remembered } = await lookupProduct('4006381333931', { online: false });
  assert.equal(status, 'found');
  assert.equal(remembered, true);
  assert.equal(product.shelfDays, 10);
});

test('suggests online recipes, ranking ones that use other expiring items first', async () => {
  routes.set('filter.php?i=Whole_Milk', { body: { meals: [meal('1', 'Milk Tart')] } });
  routes.set('filter.php?i=Milk', { body: { meals: [meal('1', 'Milk Tart'), meal('2', 'Pancakes')] } });
  routes.set('filter.php?i=Egg', { body: { meals: [meal('2', 'Pancakes')] } });
  routes.set('filter.php?i=Eggs', { body: { meals: null } });
  const today = new Date();
  const soon = new Date(today.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  const milk = { id: 'm', name: 'Whole milk', typeId: 'milk', ingredient: 'Whole Milk', status: 'active', expiryDate: soon };
  const eggs = { id: 'e', name: 'Eggs', typeId: 'eggs', ingredient: 'Egg', status: 'active', expiryDate: soon };

  const ideas = await useItUpIdeas([milk, eggs]);
  assert.deepEqual(ideas.find((i) => i.key === 'm:2').items.map((i) => i.id), ['m', 'e']);

  const { online, builtin } = await suggestionsFor(milk, [milk, eggs]);
  assert.deepEqual(online.map((r) => [r.name, r.also.length]), [['Pancakes', 1], ['Milk Tart', 0]]);
  assert.ok(builtin.some((r) => r.name === 'Fluffy pancakes'));

  // Cached lists keep working offline; uncached ones report "unavailable".
  routes.clear();
  assert.equal((await suggestionsFor(milk, [milk])).online.length, 2);
  const cheese = { id: 'c', name: 'Brie', typeId: 'soft-cheese', ingredient: 'Brie', status: 'active', expiryDate: soon };
  assert.equal((await suggestionsFor(cheese, [cheese])).online, null);
});

test('normalises TheMealDB recipes', async () => {
  routes.set('lookup.php?i=52772', {
    body: {
      meals: [
        {
          idMeal: '52772',
          strMeal: 'Teriyaki Chicken',
          strInstructions: 'STEP 1\r\nHeat the oven.\r\n\r\n2. Mix the sauce.',
          strIngredient1: 'Soy Sauce',
          strMeasure1: '3/4 cup',
          strIngredient2: '',
          strIngredient3: null,
        },
      ],
    },
  });
  const recipe = await getRecipe('m:52772');
  assert.deepEqual(recipe.steps, ['Heat the oven.', 'Mix the sauce.']);
  assert.deepEqual(recipe.ingredients, [{ name: 'Soy Sauce', measure: '3/4 cup' }]);
});

test('page and service worker never both claim the same alert', async () => {
  const item = {
    id: 'x',
    name: 'Milk',
    status: 'active',
    expiryDate: '2026-03-05',
    createdAt: new Date(2026, 2, 1).getTime(),
  };
  await kvSet('schedule', buildSchedule([item], DEFAULT_ALERT_SETTINGS));
  const now = new Date(2026, 2, 4, 10).getTime();
  const [a, b] = await Promise.all([claimDue(now), claimDue(now)]);
  assert.equal(a.notifications.length + b.notifications.length, 1);
  assert.equal((await kvGet('notified')).length, 2);
});
