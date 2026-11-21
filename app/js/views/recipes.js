// Recipes: ideas that use up several expiring things at once, plus the built-in recipe book
// ranked by what's in your pantry.
import { RECIPES } from '../recipe-data.js';
import { pantryItemsForBuiltIn, useItUpIdeas } from '../recipes.js';
import { getSettings } from '../settings.js';
import { activeItems } from '../store.js';
import { $, daysLeftOf, html, icon, mount, setHeader } from '../ui.js';
import { recipeCard, skeletons } from './shared.js';

let search = '';

export function render(el, { signal }) {
  setHeader({ title: 'Recipes' });
  const settings = getSettings();
  const pantry = activeItems();
  const days = (item) => daysLeftOf(item) ?? Infinity;
  const soon = pantry.filter((i) => days(i) <= 7).sort((a, b) => days(a) - days(b));

  const book = RECIPES.map((recipe) => {
    const items = pantryItemsForBuiltIn(recipe.id, pantry).sort((a, b) => days(a) - days(b));
    return {
      key: `b:${recipe.id}`,
      name: recipe.name,
      emoji: recipe.emoji,
      minutes: recipe.minutes,
      source: 'builtin',
      items,
      soonest: items.length ? days(items[0]) : Infinity,
      text: `${recipe.name} ${recipe.ingredients.join(' ')}`.toLowerCase(),
    };
  }).sort(
    (a, b) =>
      Math.max(a.soonest, -1) - Math.max(b.soonest, -1) || b.items.length - a.items.length || a.name.localeCompare(b.name),
  );

  mount(
    el,
    html`${soon.length >= 2
        ? html`<section id="combos">
            <h2>Use up together</h2>
            <p class="hint">Recipes that use more than one thing expiring this week.</p>
            <div class="recipes scroller" id="combo-list">${skeletons(3)}</div>
          </section>`
        : ''}
      <h2>Recipe book</h2>
      <div class="search">${icon('search')}<input type="search" id="recipe-search" placeholder="Search recipes or ingredients" aria-label="Search recipes" value="${search}" autocomplete="off"></div>
      <div class="recipes" id="book"></div>`,
  );

  const drawBook = () => {
    const q = search.trim().toLowerCase();
    const shown = book.filter((r) => !q || r.text.includes(q));
    mount($('#book', el), shown.length ? shown.map((r) => recipeCard(r)) : html`<p class="hint">No recipes match.</p>`);
  };
  drawBook();
  $('#recipe-search', el).addEventListener('input', (event) => {
    search = event.target.value;
    drawBook();
  });

  if (soon.length >= 2) {
    useItUpIdeas(soon.slice(0, 8), { online: settings.recipesOnline })
      .then((ideas) => {
        if (signal.aborted) return;
        if (ideas.length) mount($('#combo-list', el), ideas.map((r) => recipeCard(r)));
        else $('#combos', el).remove();
      })
      .catch(() => !signal.aborted && $('#combos', el)?.remove());
  }
}
