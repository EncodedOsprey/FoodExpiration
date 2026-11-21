// Small text-matching helpers used to recognise foods in product names.

export function singular(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (/(ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word)) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singular);
}

export const normalizePhrase = (text) => tokenize(text).join(' ');

/** Pre-tokenise a list of { text, value } terms for repeated matching. */
export function compileTerms(terms) {
  return terms
    .map(({ text, value }, order) => ({ value, order, tokens: tokenize(text) }))
    .filter((t) => t.tokens.length > 0);
}

/**
 * Every term found in `tokens`, best first. English food names put the head noun last
 * ("strawberry yogurt" is a yogurt), so right-most matches rank first, then the longest,
 * then earlier terms in the list.
 */
export function allMatches(tokens, compiled) {
  const found = [];
  for (const term of compiled) {
    const n = term.tokens.length;
    for (let i = tokens.length - n; i >= 0; i--) {
      let hit = true;
      for (let j = 0; j < n; j++) {
        if (tokens[i + j] !== term.tokens[j]) {
          hit = false;
          break;
        }
      }
      if (hit) {
        found.push({ value: term.value, end: i + n, len: n, order: term.order });
        break;
      }
    }
  }
  return found.sort((a, b) => b.end - a.end || b.len - a.len || a.order - b.order);
}

export const bestMatch = (tokens, compiled) => allMatches(tokens, compiled)[0] ?? null;
