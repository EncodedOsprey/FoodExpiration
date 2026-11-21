// Recipe suggestions for items that need using up: built-in recipes (offline) plus
// TheMealDB (https://www.themealdb.com), cached in IndexedDB so repeat views work offline.
import { isValidISODate, daysUntil } from './dates.js';
import { cacheGet, cacheSet } from './db.js';
import { itemTagTokens } from './foods.js';
import { ingredientQueries } from './ingredients.js';
import { RECIPES, recipeById } from './recipe-data.js';
import { normalizePhrase, tokenize } from './text.js';

const MEALDB = 'https://www.themealdb.com/api/json/v1/1/';
const DAY = 86_400_000;
const LIST_TTL = 14 * DAY;
const MEAL_TTL = 60 * DAY;

const COMPILED = RECIPES.map((recipe) => ({
  recipe,
  uses: recipe.uses.map((u) => (u.startsWith('t:') ? { type: u.slice(2) } : { tokens: tokenize(u) })),
}));

/** Position of the first `uses` entry an item satisfies, or -1. */
function matchIndex(compiled, item, tokens) {
  return compiled.uses.findIndex((u) => (u.type ? u.type === item.typeId : u.tokens.every((t) => tokens.has(t))));
}

const builtInSummary = (recipe) => ({
  key: `b:${recipe.id}`,
  name: recipe.name,
  emoji: recipe.emoji,
  minutes: recipe.minutes,
  source: 'builtin',
});

const mealSummary = (meal) => ({ key: `m:${meal.id}`, name: meal.name, thumb: meal.thumb, source: 'mealdb' });

const daysLeft = (item, now) => (isValidISODate(item.expiryDate) ? daysUntil(item.expiryDate, now) : Infinity);

/** Built-in recipes for an item, favouring ones that also use other things you have. */
export function builtInFor(item, pantry = [], now = new Date()) {
  const mine = itemTagTokens(item);
  const others = pantry
    .filter((p) => p.id !== item.id && p.status === 'active')
    .map((p) => ({ item: p, tokens: itemTagTokens(p), soon: daysLeft(p, now) <= 7 }));
  const out = [];
  for (const compiled of COMPILED) {
    const index = matchIndex(compiled, item, mine);
    if (index < 0) continue;
    const also = others.filter((o) => matchIndex(compiled, o.item, o.tokens) >= 0);
    out.push({
      ...builtInSummary(compiled.recipe),
      core: index < 3,
      soon: also.filter((o) => o.soon).length,
      also: also.map((o) => o.item),
    });
  }
  return out.sort((a, b) => b.core - a.core || b.soon - a.soon || b.also.length - a.also.length);
}

async function getJSON(url, timeout = 10_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Fresh cache hit, else network (falling back to a stale hit). `cacheOnly` never fetches. */
async function cached(key, ttl, load, { cacheOnly = false } = {}) {
  const hit = await cacheGet(key);
  if (hit && (hit.fresh || cacheOnly)) return hit.value;
  if (cacheOnly) return null;
  try {
    const value = await load();
    cacheSet(key, value, ttl).catch(() => {});
    return value;
  } catch (err) {
    if (hit) return hit.value;
    throw err;
  }
}

export function mealsWithIngredient(name, options) {
  return cached(
    `mealdb:i:${normalizePhrase(name)}`,
    LIST_TTL,
    async () => {
      const query = encodeURIComponent(name.trim().replace(/\s+/g, '_'));
      const data = await getJSON(`${MEALDB}filter.php?i=${query}`);
      return Array.isArray(data?.meals)
        ? data.meals.map((m) => ({ id: String(m.idMeal), name: m.strMeal, thumb: m.strMealThumb }))
        : [];
    },
    options,
  );
}

/** TheMealDB recipes for an item, or null if they couldn't be loaded (offline / not cached). */
export async function onlineRecipesFor(item, { cacheOnly = false } = {}) {
  const queries = ingredientQueries(item.ingredient);
  if (queries.length === 0) return [];
  const lists = await Promise.all(queries.map((q) => mealsWithIngredient(q, { cacheOnly }).catch(() => null)));
  if (lists.every((list) => list === null)) return null;
  const seen = new Set();
  const out = [];
  for (const meal of lists.flatMap((list) => list ?? [])) {
    if (seen.has(meal.id)) continue;
    seen.add(meal.id);
    out.push(meal);
  }
  return out;
}

/**
 * Suggestions for one item: { builtin, online } where online is null when TheMealDB
 * couldn't be reached. Online recipes that also use other soon-to-expire items come first.
 */
export async function suggestionsFor(item, pantry, { online = true, now = new Date() } = {}) {
  const builtin = builtInFor(item, pantry, now);
  if (!online) return { builtin, online: [] };
  const meals = await onlineRecipesFor(item);
  if (meals === null) return { builtin, online: null };
  const soonOthers = pantry
    .filter((p) => p.id !== item.id && p.status === 'active' && daysLeft(p, now) <= 7)
    .sort((a, b) => daysLeft(a, now) - daysLeft(b, now))
    .slice(0, 5);
  const otherLists = await Promise.all(soonOthers.map((p) => onlineRecipesFor(p, { cacheOnly: true })));
  const ranked = meals.map((meal, order) => {
    const also = soonOthers.filter((_, i) => otherLists[i]?.some((m) => m.id === meal.id));
    return { ...mealSummary(meal), also, order };
  });
  ranked.sort((a, b) => b.also.length - a.also.length || a.order - b.order);
  return { builtin, online: ranked };
}

/** Warm the recipe cache for an item so notifications can mention real recipe names. */
export function prefetchRecipes(item) {
  return onlineRecipesFor(item).catch(() => null);
}

/** A web search for recipes that use the item up ("recipes using …", not how to make it). */
export const webRecipeSearchUrl = (item) =>
  `https://www.google.com/search?q=${encodeURIComponent(`recipes using ${String(item.name ?? '').trim()}`)}`;

/** Up to three recipe names per item for notifications, from cached data only. */
export async function recipeHints(items, { online = true } = {}) {
  const hints = {};
  for (const item of items) {
    const meals = online ? ((await onlineRecipesFor(item, { cacheOnly: true }).catch(() => null)) ?? []) : [];
    const builtin = builtInFor(item, items).filter((r) => r.core);
    const names = [...meals.slice(0, 2).map((m) => m.name), ...builtin.map((r) => r.name), ...meals.slice(2).map((m) => m.name)];
    const unique = [...new Set(names)].slice(0, 3);
    if (unique.length) hints[item.id] = unique;
  }
  return hints;
}

const distinctFoods = (items) => new Set(items.map((i) => normalizePhrase(i.ingredient || i.name))).size;

/**
 * Recipes that use two or more of the given (soon-to-expire) items together, best first:
 * [{ key, name, thumb|emoji, source, items }].
 */
export async function useItUpIdeas(focus, { online = true } = {}) {
  const ideas = [];
  for (const compiled of COMPILED) {
    const hits = focus.filter((item) => matchIndex(compiled, item, itemTagTokens(item)) >= 0);
    if (distinctFoods(hits) >= 2) ideas.push({ ...builtInSummary(compiled.recipe), items: hits });
  }
  if (online) {
    const lists = await Promise.all(focus.map((item) => onlineRecipesFor(item).catch(() => null)));
    const byMeal = new Map();
    lists.forEach((list, i) => {
      for (const meal of list ?? []) {
        const entry = byMeal.get(meal.id) ?? { ...mealSummary(meal), items: [] };
        entry.items.push(focus[i]);
        byMeal.set(meal.id, entry);
      }
    });
    for (const entry of byMeal.values()) if (distinctFoods(entry.items) >= 2) ideas.push(entry);
  }
  const urgency = (idea) => Math.min(...idea.items.map((i) => focus.indexOf(i)));
  return ideas
    .sort((a, b) => distinctFoods(b.items) - distinctFoods(a.items) || urgency(a) - urgency(b))
    .slice(0, 8);
}

function normalizeMeal(m) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = String(m[`strIngredient${i}`] ?? '').trim();
    if (name) ingredients.push({ name, measure: String(m[`strMeasure${i}`] ?? '').trim() });
  }
  const steps = String(m.strInstructions ?? '')
    .split(/\r?\n+/)
    .map((s) => s.replace(/^\s*(step\s*)?\d+[.):]?\s+/i, '').trim())
    .filter((s) => s && !/^step\s*\d+$/i.test(s));
  return {
    key: `m:${m.idMeal}`,
    name: m.strMeal,
    thumb: m.strMealThumb,
    category: m.strCategory || '',
    area: m.strArea || '',
    ingredients,
    steps,
    youtube: m.strYoutube || '',
    sourceUrl: m.strSource || '',
    source: 'mealdb',
  };
}

/** Full recipe for a key from the lists above ("b:<id>" built in, "m:<id>" TheMealDB). */
export async function getRecipe(key) {
  const [kind, id] = [key.slice(0, 1), key.slice(2)];
  if (kind === 'b') {
    const recipe = recipeById(id);
    return recipe && { ...builtInSummary(recipe), ingredients: recipe.ingredients, steps: recipe.steps };
  }
  if (kind !== 'm' || !/^\d+$/.test(id)) return null;
  return cached(`mealdb:meal:${id}`, MEAL_TTL, async () => {
    const data = await getJSON(`${MEALDB}lookup.php?i=${id}`);
    const meal = Array.isArray(data?.meals) ? data.meals[0] : null;
    return meal ? normalizeMeal(meal) : null;
  });
}

/** Pantry items a built-in recipe would use up. */
export function pantryItemsForBuiltIn(recipeId, pantry) {
  const compiled = COMPILED.find((c) => c.recipe.id === recipeId);
  if (!compiled) return [];
  return pantry.filter((item) => item.status === 'active' && matchIndex(compiled, item, itemTagTokens(item)) >= 0);
}

/** The active pantry item matching a recipe ingredient name ("Eggs", "Whole Milk"), if any. */
export function pantryMatcher(pantry) {
  const index = pantry
    .filter((item) => item.status === 'active')
    .map((item) => ({
      item,
      tokens: itemTagTokens(item),
      names: new Set(ingredientQueries(item.ingredient, 5).map(normalizePhrase)),
    }));
  return (name) => {
    const phrase = normalizePhrase(name);
    const tokens = tokenize(name);
    if (!tokens.length) return null;
    return (
      index.find((e) => e.names.has(phrase))?.item ??
      index.find((e) => tokens.every((t) => e.tokens.has(t)))?.item ??
      null
    );
  };
}
