import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyFood, englishCategories, estimateShelfLifeDays, suggestLocation } from '../app/js/foods.js';
import { deriveIngredient, ingredientQueries, matchIngredient } from '../app/js/ingredients.js';

function describe(name, tags = []) {
  const categories = englishCategories(tags);
  const food = classifyFood({ name, categories });
  const location = suggestLocation(food);
  return {
    type: food.type?.id ?? null,
    location,
    days: estimateShelfLifeDays(food, location),
    ingredient: deriveIngredient({ name, categories }, food.type),
  };
}

test('classifies common groceries with a storage place and shelf life', () => {
  assert.deepEqual(describe('Organic Whole Milk 1 gal'), { type: 'milk', location: 'fridge', days: 7, ingredient: 'Whole Milk' });
  assert.equal(describe('Frozen Strawberries').location, 'freezer');
  assert.deepEqual(describe('Canned Peaches in Syrup'), { type: 'canned', location: 'pantry', days: 730, ingredient: 'Peaches' });
  assert.equal(describe('Mystery Item').days, null);
});

test('product categories beat flavour words in the name', () => {
  const yogurt = describe('Chobani Greek Yogurt Strawberry', ['en:dairies', 'en:yogurts', 'en:fruit-yogurts', 'en:strawberry-yogurts']);
  assert.equal(yogurt.type, 'yogurt');
  assert.equal(yogurt.ingredient, 'Greek Yogurt');
  // Broad "x and y" groupings don't decide the type.
  assert.equal(describe('Bananas', ['en:fruits-and-vegetables-based-foods', 'en:bananas']).type, 'banana');
});

test('maps grocery names to recipe-database ingredients', () => {
  assert.equal(matchIngredient('Shrimp, raw, peeled'), 'Prawns');
  assert.equal(matchIngredient('Sparkling Water'), '');
  assert.deepEqual(ingredientQueries('Chicken Breast'), ['Chicken Breast', 'Chicken Breasts', 'Chicken']);
  assert.deepEqual(ingredientQueries('Whole Milk'), ['Whole Milk', 'Milk']);
  // Never broadens a vegetable into the seasoning "Pepper".
  assert.deepEqual(ingredientQueries('Red Pepper'), ['Red Pepper']);
});

test('packaged foods get their own kind, and flavours in the name are not the ingredient', () => {
  // The name pins down the kind of snack when the categories only say "snacks".
  assert.deepEqual(describe('Drizzled Granola Bites', ['en:snacks', 'en:sweet-snacks']), { type: 'snack-bars', location: 'pantry', days: 180, ingredient: '' });
  assert.deepEqual(describe('Honey Nut Cheerios', ['en:breakfast-cereals']), { type: 'cereal', location: 'pantry', days: 180, ingredient: '' });
  assert.deepEqual(describe('Nacho Cheese Doritos', ['en:snacks', 'en:corn-chips']), { type: 'chips', location: 'pantry', days: 90, ingredient: '' });
  assert.deepEqual(describe('Strawberry Preserves', ['en:spreads', 'en:jams']), { type: 'jam', location: 'pantry', days: 365, ingredient: 'Jam' });
  assert.equal(describe('Activia Strawberry', ['en:yogurts', 'en:fruit-yogurts']).ingredient, 'Yogurt');
  assert.equal(describe('Oat Milk', ['en:plant-based-beverages', 'en:oat-based-drinks']).type, 'plant-milk');
  assert.deepEqual(ingredientQueries('Jam'), ['Jam', 'Raspberry Jam', 'Apricot Jam']);
});
