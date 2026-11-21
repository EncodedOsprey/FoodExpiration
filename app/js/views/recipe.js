// One recipe, with the ingredients you already have ticked off and a quick way to mark
// pantry items as used once you've cooked it.
import { on } from '../events.js';
import { getRecipe, pantryItemsForBuiltIn, pantryMatcher } from '../recipes.js';
import { activeItems, findItem } from '../store.js';
import { $$, daysLeftOf, html, icon, mount, safeUrl, setHeader } from '../ui.js';
import { finishItem, itemRow } from './shared.js';

function ingredientRow(ingredient, match) {
  if (typeof ingredient === 'string') return html`<li><span>${ingredient}</span></li>`;
  const have = match(ingredient.name);
  return html`<li>
    <span class="${have ? 'have' : ''}">${have ? '✓ ' : ''}${ingredient.name}</span>
    <span class="measure">${ingredient.measure}</span>
  </li>`;
}

export async function render(el, { params, query, signal }) {
  const key = params[0];
  const focusId = query.get('item') ?? '';
  const backTo = focusId && findItem(focusId) ? `/item/${encodeURIComponent(focusId)}` : '/recipes';
  setHeader({ title: 'Recipe', back: backTo });
  mount(el, html`<div class="skeleton"></div>`);

  let recipe = null;
  let failed = false;
  try {
    recipe = await getRecipe(key);
  } catch {
    failed = true;
  }
  if (signal.aborted) return;
  if (!recipe) {
    mount(
      el,
      html`<div class="empty"><div class="art" aria-hidden="true">📡</div>
        <h2>${failed ? 'Couldn’t load this recipe' : 'Recipe not found'}</h2>
        <p>${failed ? 'Check your internet connection and try again.' : ''}</p></div>`,
    );
    return;
  }
  setHeader({ title: recipe.name, back: backTo });

  const pantry = activeItems();
  const match = pantryMatcher(pantry);
  const builtin = recipe.source === 'builtin';
  let uses = builtin
    ? pantryItemsForBuiltIn(key.slice(2), pantry)
    : [...new Set(recipe.ingredients.map((i) => match(i.name)).filter(Boolean))];
  const focus = pantry.find((i) => i.id === focusId);
  if (focus && !uses.includes(focus)) uses = [focus, ...uses];
  uses.sort((a, b) => (a === focus ? -1 : b === focus ? 1 : (daysLeftOf(a) ?? 1e9) - (daysLeftOf(b) ?? 1e9)));
  const anyExpired = uses.some((i) => (daysLeftOf(i) ?? 0) < 0);

  const image = safeUrl(recipe.thumb);
  const meta = [recipe.minutes && `${recipe.minutes} min`, recipe.category, recipe.area].filter(Boolean).join(' · ');
  const links = [
    safeUrl(recipe.youtube) && html`<a class="btn" href="${safeUrl(recipe.youtube)}" target="_blank" rel="noopener">${icon('external')} Video</a>`,
    safeUrl(recipe.sourceUrl) && html`<a class="btn" href="${safeUrl(recipe.sourceUrl)}" target="_blank" rel="noopener">${icon('external')} Original recipe</a>`,
  ].filter(Boolean);

  mount(
    el,
    html`${image
        ? html`<img class="recipe-hero" src="${image}" alt="" referrerpolicy="no-referrer" data-fallback="${recipe.emoji || '🍽️'}" data-fallback-class="recipe-emoji">`
        : html`<div class="recipe-emoji" aria-hidden="true">${recipe.emoji || '🍽️'}</div>`}
      <h2>${recipe.name}</h2>
      ${meta ? html`<p class="hint">${meta}</p>` : ''}
      ${uses.length
        ? html`<div class="card">
            <h3>Uses from your pantry</h3>
            ${anyExpired ? html`<p class="hint warn">Some of these are past their date. Check they’re still good before cooking: “best before” is about quality, “use by” is about safety.</p>` : ''}
            <ul class="list flat">${uses.map((item) =>
              itemRow(item, { compact: true, action: html`<button class="btn small" type="button" data-used="${item.id}">${icon('check')} Used</button>` }),
            )}</ul>
          </div>`
        : ''}
      <h2>Ingredients</h2>
      <ul class="ingredients">${recipe.ingredients.map((i) => ingredientRow(i, match))}</ul>
      <h2>Method</h2>
      <ol class="steps">${recipe.steps.map((step) => html`<li>${step}</li>`)}</ol>
      ${links.length ? html`<div class="actions">${links}</div>` : ''}
      <p class="credits">${builtin
        ? 'A Pantry Pal recipe.'
        : html`Recipe from <a href="https://www.themealdb.com" target="_blank" rel="noopener">TheMealDB</a>.`}</p>`,
  );

  // Undo (from the toast) puts an item back, so keep the buttons in step with the store.
  const refreshButtons = () => {
    for (const button of $$('[data-used]', el)) {
      const done = findItem(button.dataset.used)?.status !== 'active';
      button.disabled = done;
      mount(button, html`${icon('check')} ${done ? 'Done' : 'Used'}`);
    }
  };
  el.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-used]');
    const item = button && !button.disabled && findItem(button.dataset.used);
    if (!item || item.status !== 'active') return;
    button.disabled = true;
    await finishItem(item, 'used');
  });
  return on('items-change', refreshButtons);
}
