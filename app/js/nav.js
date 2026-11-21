// Hash router. Each history entry remembers how deep into the app it is, so "back" buttons
// can return to the previous screen without ever leaving the app.
let depth = 0;
let onRoute = () => {};

export function currentRoute() {
  const hash = location.hash.replace(/^#/, '');
  const at = hash.indexOf('?');
  const path = (at === -1 ? hash : hash.slice(0, at)) || '/pantry';
  return { path, query: new URLSearchParams(at === -1 ? '' : hash.slice(at + 1)) };
}

const withHash = (target) => (target.startsWith('#') ? target : `#${target}`);

export function startRouter(handler) {
  onRoute = handler;
  depth = Number(history.state?.depth) || 0;
  history.replaceState({ ...history.state, depth }, '');
  window.addEventListener('hashchange', () => {
    if (typeof history.state?.depth === 'number') {
      depth = history.state.depth; // back / forward
    } else {
      depth += 1; // a link was followed
      history.replaceState({ depth }, '');
    }
    onRoute(currentRoute());
  });
  onRoute(currentRoute());
}

/** Open a screen, e.g. go('/item/123'). */
export function go(target) {
  const hash = withHash(target);
  if (location.hash === hash) onRoute(currentRoute());
  else location.hash = hash;
}

/** Swap the current screen for another without adding a history entry. */
export function replace(target) {
  history.replaceState({ depth }, '', withHash(target));
  onRoute(currentRoute());
}

/** Previous in-app screen, or `fallback` when the app was opened on this screen. */
export function back(fallback = '/pantry') {
  if (depth > 0) history.back();
  else replace(fallback);
}
