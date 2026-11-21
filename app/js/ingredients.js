// Maps grocery product names ("Organic Whole Milk 1 gal") to TheMealDB ingredient names
// ("Whole Milk", then "Milk") so recipe suggestions can be fetched for an item.
import { MEALDB_INGREDIENTS } from './mealdb-ingredients.js';
import { classifyFood } from './foods.js';
import { allMatches, bestMatch, compileTerms, normalizePhrase, tokenize } from './text.js';

// Vocabulary entries that would give silly suggestions ("recipes with water").
const IGNORED = new Set(
  ['Water', 'Salt', 'Pepper', 'Black Pepper', 'Oil', 'Boiling Water', 'Cold Water', 'Warm Water', 'Sea Salt', 'Kosher Salt']
    .map(normalizePhrase),
);
// Names TheMealDB uses interchangeably.
const SYNONYMS = [
  ['Minced Beef', 'Ground Beef'],
  ['Prawns', 'King Prawns'],
];

// Common grocery words that TheMealDB knows under another name.
const ALIASES = {
  shrimp: 'Prawns',
  eggplant: 'Aubergine',
  cilantro: 'Coriander',
  scallion: 'Spring Onions',
  'green onion': 'Spring Onions',
  'bell pepper': 'Red Pepper',
  capsicum: 'Red Pepper',
  yoghurt: 'Yogurt',
  skyr: 'Greek Yogurt',
  'whipping cream': 'Double Cream',
  'half and half': 'Single Cream',
  hamburger: 'Minced Beef',
  mince: 'Minced Beef',
  'ground turkey': 'Turkey Mince',
  'hot dog': 'Sausages',
  frankfurter: 'Sausages',
  bratwurst: 'Sausages',
  kielbasa: 'Polish Sausage',
  romaine: 'Lettuce',
  arugula: 'Rocket',
  garbanzo: 'Chickpeas',
  cheddar: 'Cheddar Cheese',
  parmigiano: 'Parmesan',
  steak: 'Beef',
  sirloin: 'Beef',
  pancetta: 'Bacon',
  bagel: 'Bread',
  sourdough: 'Bread',
  loaf: 'Bread',
  bun: 'Bread Rolls',
  wrap: 'Tortillas',
  'sweet corn': 'Sweetcorn',
  corn: 'Sweetcorn',
  'chicken drumstick': 'Chicken Legs',
  drumstick: 'Chicken Legs',
};

const canonicalByPhrase = new Map();
for (const name of MEALDB_INGREDIENTS) {
  const key = normalizePhrase(name);
  if (!canonicalByPhrase.has(key)) canonicalByPhrase.set(key, []);
  canonicalByPhrase.get(key).push(name);
}

const TERMS = compileTerms([
  ...MEALDB_INGREDIENTS.filter((name) => !IGNORED.has(normalizePhrase(name))).map((name) => ({
    text: name,
    value: name,
  })),
  ...Object.entries(ALIASES).map(([text, value]) => ({ text, value })),
]);

/** Best TheMealDB ingredient mentioned in a piece of text, or '' if none. */
export function matchIngredient(text) {
  return bestMatch(tokenize(text), TERMS)?.value ?? '';
}

/**
 * Recipe ingredient for a product: from its name, its food type, then its categories.
 * For "Greek Yogurt Strawberry" (a yogurt) the yogurt beats the flavour.
 */
export function deriveIngredient({ name = '', categories = [] } = {}, type = null) {
  const matches = allMatches(tokenize(name), TERMS).map((m) => m.value);
  if (matches.length) {
    const sameType = type && matches.find((value) => classifyFood({ name: value }).type?.id === type.id);
    return sameType || matches[0];
  }
  if (type?.ingredient) return type.ingredient;
  for (const category of [...categories].reverse()) {
    const match = matchIngredient(category);
    if (match) return match;
  }
  return '';
}

// Leading words that only describe a more general ingredient ("Greek Yogurt" -> "Yogurt").
const MODIFIERS = new Set(
  tokenize(
    'whole skim skimmed semi full fat low baby cherry grape plum vine red green yellow white brown black ' +
      'sweet smoked lean minced ground fresh frozen salted unsalted chopped diced canned tinned large small ' +
      'free range organic king tiger raw wild chestnut shiitake iceberg little gem floury charlotte yukon gold ' +
      'braeburn bramley basmati jasmine sushi paella cheddar goats gouda stilton monterey jack colby double ' +
      'single heavy natural plain greek extra virgin chilled',
  ),
);
// Trailing words naming a cut or part ("Chicken Thighs" -> "Chicken").
const CUTS = new Set(tokenize('breast breasts thigh thighs leg legs fillet fillets loin chops shoulder shin brisket wings'));

function canonical(text) {
  return canonicalByPhrase.get(normalizePhrase(text)) ?? [];
}

const usable = (name) => (name && !IGNORED.has(normalizePhrase(name)) ? name : '');

/** The more general vocabulary ingredient a name refines, or ''. */
function broader(name) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return '';
  const first = tokenize(words[0])[0];
  const last = tokenize(words.at(-1))[0];
  if (MODIFIERS.has(first)) {
    const rest = words.slice(1).join(' ');
    return usable(canonical(rest)[0]) || broader(rest);
  }
  if (CUTS.has(last)) return usable(canonical(words.slice(0, -1).join(' '))[0]);
  return '';
}

/**
 * TheMealDB only filters by exact ingredient name, so query the specific name and its
 * singular/plural twin ("Egg"/"Eggs") plus the broadest parent ("Whole Milk" -> "Milk").
 */
export function ingredientQueries(ingredient, max = 3) {
  const name = String(ingredient ?? '').trim();
  if (!name) return [];
  const levels = [];
  const seen = new Set();
  for (let current = name; current && !seen.has(current) && levels.length < 4; current = broader(current)) {
    seen.add(current);
    const names = canonical(current);
    levels.push(names.length ? names : [current]);
  }
  const synonyms = SYNONYMS.find((group) => group.some((n) => normalizePhrase(n) === normalizePhrase(name))) ?? [];
  const ordered = [
    ...levels[0],
    ...synonyms,
    ...(levels.length > 1 ? levels.at(-1) : []),
    ...levels.slice(1, -1).flat(),
  ];
  return [...new Set(ordered)].slice(0, max);
}
