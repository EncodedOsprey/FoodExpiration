// Food knowledge base: recognises a product's food type from its name / Open Food Facts
// categories to pick an emoji, a default storage location and a typical shelf life.
// Shelf lives are conservative rules of thumb (roughly USDA FoodKeeper guidance) and are
// only used to suggest a date - the package date always wins.
import { bestMatch, compileTerms, tokenize } from './text.js';

export const LOCATIONS = [
  { id: 'fridge', label: 'Fridge' },
  { id: 'freezer', label: 'Freezer' },
  { id: 'pantry', label: 'Pantry' },
  { id: 'other', label: 'Other' },
];

// Extras: `ingredient` for recipe searches; `tags`, words to match built-in recipes;
// `flavoured`, other foods in the name are flavours ("Honey Nut Cheerios" is no honey);
// `snack`, a kind of snack the name can pin down when the categories only say "snacks".
const t = (id, emoji, location, days, keywords, extra = {}) => ({ id, emoji, location, days, keywords, ...extra });

export const FOOD_TYPES = [
  // Dairy & eggs
  t('ice-cream', '🍨', 'freezer', { freezer: 60 }, ['ice cream', 'gelato', 'sorbet', 'frozen yogurt', 'popsicle'], { ingredient: 'Ice Cream', flavoured: true }),
  t('plant-milk', '🥛', 'fridge', { fridge: 7, pantry: 180 }, ['almond milk', 'oat milk', 'soy milk', 'soya milk', 'rice milk', 'cashew milk', 'oat drink', 'almond drink', 'soy drink', 'plant based drink', 'oat based drink', 'almond based drink', 'soy based drink', 'rice based drink', 'plant based milk', 'non dairy milk', 'dairy free milk'], { ingredient: 'Almond Milk', tags: ['milk'] }),
  t('coconut-milk', '🥥', 'pantry', { pantry: 365, fridge: 5 }, ['coconut milk', 'coconut cream'], { ingredient: 'Coconut Milk' }),
  t('milk', '🥛', 'fridge', { fridge: 7, freezer: 90 }, ['milk', 'whole milk', 'skim milk', 'semi skimmed milk', 'lactose free milk', 'chocolate milk', 'buttermilk', 'milks'], { ingredient: 'Milk', tags: ['milk'] }),
  t('cream', '🥛', 'fridge', { fridge: 10, freezer: 90 }, ['cream', 'heavy cream', 'whipping cream', 'double cream', 'single cream', 'half and half', 'creme fraiche', 'creamer'], { ingredient: 'Heavy Cream', tags: ['cream'] }),
  t('sour-cream', '🥣', 'fridge', { fridge: 14 }, ['sour cream'], { ingredient: 'Sour Cream', tags: ['sour cream'] }),
  t('cream-cheese', '🧀', 'fridge', { fridge: 14 }, ['cream cheese'], { ingredient: 'Cream Cheese', tags: ['cream cheese'] }),
  t('yogurt', '🥣', 'fridge', { fridge: 14, freezer: 60 }, ['yogurt', 'yoghurt', 'yogourt', 'skyr', 'kefir'], { ingredient: 'Yogurt', tags: ['yogurt'], flavoured: true }),
  t('butter', '🧈', 'fridge', { fridge: 60, freezer: 270 }, ['butter', 'margarine'], { ingredient: 'Butter' }),
  t('soft-cheese', '🧀', 'fridge', { fridge: 7, freezer: 60 }, ['mozzarella', 'ricotta', 'brie', 'camembert', 'feta', 'goat cheese', 'goats cheese', 'cottage cheese', 'burrata', 'mascarpone', 'paneer', 'fresh cheese'], { ingredient: 'Cheese', tags: ['cheese'] }),
  t('cheese', '🧀', 'fridge', { fridge: 28, freezer: 180 }, ['cheese', 'cheddar', 'parmesan', 'parmigiano', 'gouda', 'swiss cheese', 'emmental', 'gruyere', 'monterey jack', 'colby', 'provolone', 'pecorino', 'manchego', 'havarti', 'halloumi', 'cheeses'], { ingredient: 'Cheese', tags: ['cheese'] }),
  t('eggs', '🥚', 'fridge', { fridge: 28 }, ['egg', 'eggs', 'egg whites'], { ingredient: 'Eggs', tags: ['egg'] }),

  // Meat, fish & protein
  t('deli', '🥪', 'fridge', { fridge: 5, freezer: 60 }, ['ham', 'deli', 'sliced turkey', 'sliced turkey breast', 'turkey breast slices', 'turkey slices', 'chicken breast slices', 'sliced chicken', 'sliced ham', 'ham slices', 'deli meat', 'salami', 'pepperoni', 'prosciutto', 'bologna', 'pastrami', 'cold cuts', 'lunch meat', 'chorizo'], { ingredient: 'Ham', tags: ['ham'] }),
  t('bacon', '🥓', 'fridge', { fridge: 7, freezer: 30 }, ['bacon', 'pancetta'], { ingredient: 'Bacon' }),
  t('sausage', '🌭', 'fridge', { fridge: 7, freezer: 60 }, ['sausage', 'hot dog', 'frankfurter', 'bratwurst', 'kielbasa', 'wiener', 'sausages'], { ingredient: 'Sausages', tags: ['sausage'] }),
  t('ground-meat', '🥩', 'fridge', { fridge: 2, freezer: 120 }, ['ground beef', 'minced beef', 'mince', 'ground turkey', 'ground pork', 'ground chicken', 'ground meat', 'hamburger', 'burger patties', 'burgers'], { ingredient: 'Minced Beef', tags: ['ground beef'] }),
  t('poultry', '🍗', 'fridge', { fridge: 2, freezer: 270 }, ['chicken', 'turkey', 'duck', 'chicken breast', 'chicken thighs', 'drumsticks', 'chicken wings', 'poultry', 'poultries'], { ingredient: 'Chicken', tags: ['chicken'] }),
  t('meat', '🥩', 'fridge', { fridge: 4, freezer: 180 }, ['beef', 'steak', 'pork', 'lamb', 'veal', 'roast', 'pork chops', 'ribs', 'brisket', 'tenderloin', 'sirloin'], { ingredient: 'Beef' }),
  t('shellfish', '🦐', 'fridge', { fridge: 2, freezer: 120 }, ['shrimp', 'prawn', 'prawns', 'scallops', 'crab', 'lobster', 'mussels', 'clams', 'oysters'], { ingredient: 'Prawns', tags: ['shrimp'] }),
  t('smoked-fish', '🐟', 'fridge', { fridge: 10 }, ['smoked salmon', 'lox', 'smoked fish', 'smoked trout'], { ingredient: 'Smoked Salmon', tags: ['salmon'] }),
  t('fish', '🐟', 'fridge', { fridge: 2, freezer: 180 }, ['fish', 'salmon', 'cod', 'tilapia', 'tuna steak', 'haddock', 'trout', 'halibut', 'sea bass', 'mackerel', 'fish fillets', 'fishes'], { ingredient: 'Salmon', tags: ['fish'] }),
  t('tofu', '🍱', 'fridge', { fridge: 7 }, ['tofu', 'tempeh', 'seitan'], { ingredient: 'Tofu' }),

  // Produce
  t('salad', '🥗', 'fridge', { fridge: 5 }, ['lettuce', 'salad', 'spring mix', 'mixed greens', 'salad greens', 'arugula', 'rocket', 'romaine', 'iceberg', 'coleslaw mix'], { ingredient: 'Lettuce', tags: ['lettuce'] }),
  t('greens', '🥬', 'fridge', { fridge: 5, freezer: 240 }, ['spinach', 'kale', 'chard', 'collard greens', 'bok choy', 'pak choi'], { ingredient: 'Spinach', tags: ['spinach'] }),
  t('herbs', '🌿', 'fridge', { fridge: 7 }, ['basil', 'cilantro', 'coriander', 'parsley', 'dill', 'mint', 'chives', 'rosemary', 'thyme', 'fresh herbs'], { ingredient: 'Parsley', tags: ['herb'] }),
  t('scallions', '🌱', 'fridge', { fridge: 7 }, ['green onion', 'green onions', 'scallion', 'scallions', 'spring onion', 'spring onions'], { ingredient: 'Spring Onions' }),
  t('berries', '🍓', 'fridge', { fridge: 4, freezer: 240 }, ['strawberry', 'strawberries', 'blueberries', 'raspberries', 'blackberries', 'berries', 'cherries'], { ingredient: 'Strawberries', tags: ['berry'] }),
  t('grapes', '🍇', 'fridge', { fridge: 10 }, ['grapes'], { tags: ['grape', 'fruit'] }),
  t('banana', '🍌', 'pantry', { pantry: 5, freezer: 90 }, ['banana', 'bananas', 'plantain'], { ingredient: 'Banana' }),
  t('avocado', '🥑', 'pantry', { pantry: 4, fridge: 7 }, ['avocado', 'avocados'], { ingredient: 'Avocado' }),
  t('apples', '🍎', 'fridge', { fridge: 30, pantry: 7 }, ['apple', 'apples', 'pear', 'pears'], { ingredient: 'Apples', tags: ['fruit'] }),
  t('citrus', '🍋', 'fridge', { fridge: 21, pantry: 7 }, ['lemon', 'lemons', 'lime', 'limes', 'orange', 'oranges', 'clementine', 'clementines', 'mandarin', 'grapefruit', 'tangerine'], { ingredient: 'Lemon', tags: ['fruit'] }),
  t('fruit', '🍑', 'pantry', { pantry: 4, fridge: 5 }, ['peach', 'peaches', 'nectarine', 'plum', 'plums', 'apricot', 'mango', 'kiwi', 'pineapple', 'melon', 'watermelon', 'cantaloupe'], { ingredient: 'Peaches', tags: ['fruit'] }),
  t('tomatoes', '🍅', 'pantry', { pantry: 5, fridge: 7 }, ['tomato', 'tomatoes', 'cherry tomatoes', 'grape tomatoes'], { ingredient: 'Tomatoes' }),
  t('cucumber', '🥒', 'fridge', { fridge: 7 }, ['cucumber', 'cucumbers'], { ingredient: 'Cucumber' }),
  t('peppers', '🫑', 'fridge', { fridge: 10 }, ['pepper', 'peppers', 'bell pepper', 'bell peppers', 'capsicum', 'jalapeno', 'chili pepper'], { ingredient: 'Red Pepper', tags: ['pepper'] }),
  t('green-veg', '🥦', 'fridge', { fridge: 5, freezer: 240 }, ['broccoli', 'cauliflower', 'brussels sprouts', 'green beans', 'asparagus', 'snap peas', 'snow peas', 'corn on the cob', 'sweet corn', 'eggplant', 'aubergine', 'zucchini', 'courgette', 'courgettes', 'summer squash'], { ingredient: 'Broccoli' }),
  t('mushrooms', '🍄', 'fridge', { fridge: 5 }, ['mushroom', 'mushrooms'], { ingredient: 'Mushrooms' }),
  t('roots', '🥕', 'fridge', { fridge: 21 }, ['carrot', 'carrots', 'celery', 'beets', 'beetroot', 'parsnip', 'radish', 'radishes', 'turnip', 'cabbage', 'leek', 'leeks', 'fennel'], { ingredient: 'Carrots' }),
  t('potatoes', '🥔', 'pantry', { pantry: 30 }, ['potato', 'potatoes', 'sweet potato', 'sweet potatoes', 'yams', 'squash', 'butternut squash', 'pumpkin'], { ingredient: 'Potatoes' }),
  t('onions', '🧅', 'pantry', { pantry: 30 }, ['onion', 'onions', 'shallot', 'shallots', 'garlic', 'red onion', 'yellow onion'], { ingredient: 'Onion' }),

  // Bakery
  t('bread', '🍞', 'pantry', { pantry: 5, fridge: 10, freezer: 90 }, ['bread', 'loaf', 'baguette', 'rolls', 'buns', 'bagel', 'bagels', 'english muffins', 'pita', 'naan', 'sourdough', 'brioche', 'croissant', 'croissants', 'ciabatta', 'flatbread', 'breads'], { ingredient: 'Bread' }),
  t('tortillas', '🌮', 'pantry', { pantry: 14, fridge: 30, freezer: 180 }, ['tortilla', 'tortillas', 'wraps'], { ingredient: 'Tortillas', tags: ['tortilla'] }),
  t('baked-goods', '🧁', 'pantry', { pantry: 4, freezer: 90 }, ['muffins', 'cake', 'cookies', 'pastries', 'donuts', 'doughnuts', 'pie', 'brownies', 'cakes', 'biscuits'], { flavoured: true }),

  // Prepared & refrigerated
  t('dips', '🥣', 'fridge', { fridge: 7 }, ['hummus', 'houmous', 'salsa', 'dip', 'guacamole', 'pesto', 'tzatziki'], { flavoured: true }),
  t('fresh-pasta', '🍝', 'fridge', { fridge: 5, freezer: 60 }, ['fresh pasta', 'ravioli', 'tortellini', 'gnocchi'], { tags: ['pasta'] }),
  t('leftovers', '🍲', 'fridge', { fridge: 4, freezer: 90 }, ['leftovers', 'leftover', 'meal prep', 'cooked rice']),
  t('soup', '🍲', 'pantry', { pantry: 365, fridge: 4 }, ['soup', 'broth', 'stock', 'soups']),
  t('juice', '🧃', 'fridge', { fridge: 7 }, ['juice', 'orange juice', 'apple juice', 'lemonade', 'smoothie', 'juices'], { flavoured: true }),
  t('pasta-sauce', '🥫', 'pantry', { pantry: 365, fridge: 5 }, ['pasta sauce', 'pasta sauces', 'tomato sauce', 'tomato sauces', 'marinara', 'pizza sauce', 'spaghetti sauce', 'arrabbiata', 'bolognese sauce', 'passata', 'pomodoro'], { ingredient: 'Tomato Sauce', flavoured: true }),
  t('jam', '🍓', 'pantry', { pantry: 365, fridge: 180 }, ['jam', 'jams', 'jelly', 'preserves', 'fruit preserves', 'fruit spread', 'marmalade', 'conserve'], { ingredient: 'Jam', flavoured: true }),
  t('nut-butter', '🥜', 'pantry', { pantry: 180 }, ['peanut butter', 'almond butter', 'cashew butter', 'nut butter', 'nut butters', 'peanut butters', 'sunflower butter', 'tahini'], { ingredient: 'Peanut Butter', flavoured: true }),
  t('condiments', '🫙', 'pantry', { pantry: 365, fridge: 180 }, ['sauce', 'ketchup', 'mayonnaise', 'mayo', 'mustard', 'dressing', 'salad dressing', 'pickles', 'relish', 'syrup', 'honey', 'spread', 'sauces', 'condiments'], { flavoured: true }),

  // Pantry staples
  t('canned', '🥫', 'pantry', { pantry: 730, fridge: 4 }, ['canned', 'tinned', 'beans', 'chickpeas', 'lentils', 'tuna', 'sardines', 'baked beans', 'diced tomatoes', 'crushed tomatoes', 'tomato paste', 'tomato puree', 'canned foods']),
  t('pasta', '🍝', 'pantry', { pantry: 365 }, ['pasta', 'spaghetti', 'penne', 'macaroni', 'noodles', 'linguine', 'fusilli', 'lasagna', 'pastas'], { ingredient: 'Spaghetti', tags: ['pasta'] }),
  t('grains', '🍚', 'pantry', { pantry: 365 }, ['rice', 'quinoa', 'oats', 'oatmeal', 'couscous', 'barley', 'flour'], { ingredient: 'Rice' }),
  t('cereal', '🥣', 'pantry', { pantry: 180 }, ['cereal', 'cereals', 'breakfast cereal', 'granola', 'muesli', 'cornflakes', 'corn flakes', 'bran flakes', 'cheerios', 'rice krispies', 'puffed rice'], { flavoured: true, snack: true }),
  t('snack-bars', '🌾', 'pantry', { pantry: 180 }, ['granola bars', 'granola bites', 'cereal bars', 'snack bars', 'protein bars', 'energy bars', 'breakfast bars', 'oat bars', 'nut bars', 'energy bites', 'protein bites', 'flapjack', 'flapjacks'], { flavoured: true, snack: true }),
  t('chips', '🥨', 'pantry', { pantry: 90 }, ['chips', 'crisps', 'potato chips', 'potato crisps', 'tortilla chips', 'corn chips', 'pita chips', 'crackers', 'pretzels', 'popcorn', 'doritos', 'pringles', 'tostitos', 'fritos', 'cheetos'], { flavoured: true, snack: true }),
  t('nuts', '🥜', 'pantry', { pantry: 180, fridge: 365, freezer: 365 }, ['nuts', 'mixed nuts', 'almonds', 'peanuts', 'cashews', 'cashew nuts', 'walnuts', 'pecans', 'pistachios', 'hazelnuts', 'macadamia', 'trail mix', 'sunflower seeds', 'pumpkin seeds'], { snack: true }),
  t('sweets', '🍫', 'pantry', { pantry: 180 }, ['chocolate', 'chocolates', 'chocolate bar', 'dark chocolate', 'milk chocolate', 'chocolate chips', 'candy', 'candies', 'sweets', 'gummy', 'gummies', 'jelly beans', 'marshmallows', 'toffee', 'fudge', 'caramels', 'confectioneries'], { flavoured: true, snack: true }),
  t('snacks', '🍿', 'pantry', { pantry: 120 }, ['snacks', 'snack', 'rice cakes'], { flavoured: true }),
  t('spices', '🧂', 'pantry', { pantry: 730 }, ['spice', 'spices', 'seasoning', 'salt', 'black pepper', 'cinnamon', 'paprika', 'cumin', 'sugar', 'baking soda', 'baking powder']),
  t('frozen', '🧊', 'freezer', { freezer: 180, fridge: 3 }, ['frozen', 'frozen meals', 'pizza', 'nuggets', 'fries', 'waffles', 'frozen vegetables', 'frozen peas', 'dumplings', 'burritos', 'frozen foods']),
  t('drinks', '🥤', 'pantry', { pantry: 270, fridge: 30 }, ['soda', 'water', 'sparkling water', 'beer', 'wine', 'coffee', 'tea', 'kombucha', 'sodas'], { flavoured: true }),
];

const TERMS = compileTerms(FOOD_TYPES.flatMap((type) => type.keywords.map((text) => ({ text, value: type }))));
const TYPE_BY_ID = new Map(FOOD_TYPES.map((type) => [type.id, type]));

export const foodTypeById = (id) => TYPE_BY_ID.get(id) ?? null;

/** Open Food Facts category tags ("en:fruit-yogurts") to plain English phrases. */
export function englishCategories(tags = []) {
  return tags
    .filter((tag) => typeof tag === 'string' && tag.startsWith('en:'))
    .map((tag) => tag.slice(3).replaceAll('-', ' '));
}

/**
 * Work out what kind of food a product is. Categories are checked most specific first
 * (Open Food Facts lists them general -> specific), then the product name.
 */
export function classifyFood({ name = '', categories = [] } = {}) {
  const allTokens = new Set(tokenize(`${name} ${categories.join(' ')}`));
  const frozen = allTokens.has('frozen');
  const canned = allTokens.has('canned') || allTokens.has('tinned');
  const dried = allTokens.has('dried') || allTokens.has('dehydrated');

  let type = null;
  // Skip broad groupings such as "fruits and vegetables based foods".
  const specific = categories.filter((c) => !/\band\b/.test(c));
  for (const category of specific.reverse()) {
    const match = bestMatch(tokenize(category), TERMS);
    if (match) {
      type = match.value;
      break;
    }
  }
  if (!type) type = bestMatch(tokenize(name), TERMS)?.value ?? null;
  // "Snacks" is too broad when the name says which kind ("granola bites", "pretzels").
  if (type?.id === 'snacks') {
    const named = bestMatch(tokenize(name), TERMS)?.value;
    if (named?.snack) type = named;
  }
  if (canned && type?.id !== 'soup') type = TYPE_BY_ID.get('canned');
  return { type, frozen, canned, dried };
}

export function suggestLocation({ type, frozen, canned, dried }) {
  if (frozen) return 'freezer';
  if (canned || dried) return 'pantry';
  return type?.location ?? 'fridge';
}

/** Typical days until a food goes off in a given location, or null when unknown. */
export function estimateShelfLifeDays({ type, frozen, dried }, location) {
  if (dried && location !== 'freezer') return 180;
  if (!type) return frozen && location === 'freezer' ? 180 : null;
  if (location === 'freezer' && !type.days.freezer) return 180;
  return type.days[location] ?? type.days[type.location] ?? null;
}

export const emojiFor = (classification) => classification?.type?.emoji ?? '🛒';

/** Words used to match an item against built-in recipes. */
export function itemTagTokens(item, type = foodTypeById(item.typeId)) {
  const tokens = new Set([...nameTokens(item.name, type), ...tokenize(item.ingredient)]);
  for (const tag of type?.tags ?? []) for (const tok of tokenize(tag)) tokens.add(tok);
  return tokens;
}

// For flavoured foods only the words naming the food count ("granola" in "Oats & Honey
// Granola"), so the flavours don't pull in recipes for honey or oats.
function nameTokens(name, type) {
  const tokens = tokenize(name);
  if (!type?.flavoured) return tokens;
  const head = bestMatch(tokens, TERMS);
  return head ? tokens.slice(head.end - head.len, head.end) : [];
}
