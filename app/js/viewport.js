// Works around an iOS WebKit bug (iOS 26 and later). After the keyboard, a picker or a system sheet
// goes away, the viewport that position: fixed and sticky use can stay shifted or shrunk: the tab bar
// then floats mid-screen and the header slides off the top. Spot that state and make WebKit re-measure.
import { isIOS, isStandalone } from './platform.js';

const TYPING_INPUTS = /^(?:text|search|email|url|tel|password|number|date|datetime-local|month|week|time)$/;

/** Whether the element has the keyboard or a picker open, which shrinks the viewport for real. */
function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && TYPING_INPUTS.test(el.type);
}

/** Whether viewport measurements (CSS pixels) show the stuck state. `fullHeight` is the height it should be. */
export function looksStuck({ scale, offsetTop, visualHeight, innerHeight, fullHeight, typing }) {
  if (typing || Math.abs(scale - 1) > 0.01) return false; // keyboard up or pinch-zoomed: offsets are real
  return offsetTop > 1 || innerHeight - visualHeight > 4 || fullHeight - innerHeight > 4;
}

let enabled = false;
let trackTallest = false; // only an installed iPhone app has no browser bars to change its height
const tallest = new Map(); // innerWidth → tallest innerHeight seen at that width
let timer = 0;
let healing = false;
let lastFailure = '';

function measure() {
  const vv = window.visualViewport;
  const width = window.innerWidth;
  if (trackTallest && Math.abs(vv.scale - 1) <= 0.01) {
    tallest.set(width, Math.max(tallest.get(width) ?? 0, window.innerHeight));
  }
  return {
    scale: vv.scale,
    offsetTop: vv.offsetTop,
    visualHeight: vv.height,
    innerHeight: window.innerHeight,
    fullHeight: Math.max(document.documentElement.clientHeight, tallest.get(width) ?? 0),
    typing: isTyping(document.activeElement),
  };
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const stillStuck = () => new Promise((resolve) => setTimeout(() => resolve(looksStuck(measure())), 150));

async function heal() {
  // Scrolling a pixel and back is often enough for WebKit to re-measure...
  let { scrollX: x, scrollY: y } = window;
  window.scrollTo(x, y > 0 ? y - 1 : y + 1);
  await nextFrame();
  window.scrollTo(x, y);
  if (!(await stillStuck())) return true;

  // ...otherwise a full relayout is, without painting the page while it's out.
  ({ scrollX: x, scrollY: y } = window);
  const { body } = document;
  const focused = document.activeElement;
  const display = body.style.display;
  body.style.display = 'none';
  void body.offsetHeight;
  body.style.display = display;
  window.scrollTo(x, y);
  if (focused instanceof HTMLElement && document.activeElement !== focused) focused.focus({ preventScroll: true });
  return !(await stillStuck());
}

async function check() {
  if (healing || document.visibilityState !== 'visible') return;
  const state = measure();
  if (!looksStuck(state)) {
    lastFailure = '';
    return;
  }
  // Try once per stuck state, so a state this can't fix doesn't cause a loop.
  const signature = [window.innerWidth, state.innerHeight, state.visualHeight, state.offsetTop, state.fullHeight]
    .map(Math.round)
    .join();
  if (signature === lastFailure) return;
  healing = true;
  try {
    if (!(await heal())) lastFailure = signature;
  } finally {
    healing = false;
  }
}

/** Look for the stuck viewport once things settle, e.g. after a screen renders. */
export function checkViewportSoon(delay = 250) {
  if (!enabled) return;
  clearTimeout(timer);
  timer = setTimeout(check, delay);
}

export function initViewportFix() {
  if (!isIOS() || !window.visualViewport) return;
  enabled = true;
  trackTallest = isStandalone() && /iPhone|iPod/.test(navigator.userAgent);
  const soon = () => checkViewportSoon();
  document.addEventListener('focusout', () => checkViewportSoon(350)); // after the keyboard animates away
  window.visualViewport.addEventListener('resize', soon);
  window.visualViewport.addEventListener('scroll', soon);
  for (const type of ['resize', 'scroll', 'pageshow']) window.addEventListener(type, soon, { passive: true });
  document.addEventListener('visibilitychange', soon);
  measure();
}
