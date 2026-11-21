// Refreshes app/js/mealdb-ingredients.js from TheMealDB's public ingredient list.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const res = await fetch('https://www.themealdb.com/api/json/v1/1/list.php?i=list');
if (!res.ok) throw new Error(`TheMealDB responded ${res.status}`);
const { meals } = await res.json();
const names = [...new Set(meals.map((m) => m.strIngredient?.trim()).filter(Boolean))].sort((a, b) =>
  a.toLowerCase().localeCompare(b.toLowerCase()),
);

const lines = [];
let line = '';
for (const name of names) {
  const token = `${JSON.stringify(name)}, `;
  if (line.length + token.length > 96) {
    lines.push(`  ${line.trimEnd()}`);
    line = '';
  }
  line += token;
}
if (line) lines.push(`  ${line.trimEnd()}`);

const source = `// Ingredient names from TheMealDB (https://www.themealdb.com) used to map grocery product
// names to recipe-search ingredients offline. Refresh with \`npm run update-ingredients\`.
export const MEALDB_INGREDIENTS = [
${lines.join('\n')}
];
`;
await writeFile(path.join(root, 'app', 'js', 'mealdb-ingredients.js'), source);
console.log(`Wrote ${names.length} ingredients`);
