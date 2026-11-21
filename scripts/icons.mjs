// Generates the app icons in app/icons from the SVG artwork below (uses Chrome via playwright-core).
//   npm run icons            (set CHROME_PATH if Chrome isn't at the default location)
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const OUT = new URL('../app/icons/', import.meta.url);
const BRAND = '#0f766e';

// Apple with a leaf, plus a small clock: "food" + "time". Drawn on a 512 x 512 grid.
const APPLE =
  'M236 168c-26-20-86-25-116 20-35 55-15 140 25 185 25 28 50 35 73 23 12-6 24-6 36 0 23 12 48 5 73-23 40-45 60-130 25-185-30-45-90-40-116-20z';
const LEAF = 'M244 160c0-42 30-70 76-72-2 42-32 70-76 72z';
const STEM = 'M236 172c-2-22-6-36-16-50';

function artwork({ fg = '#fff', leaf = '#86efac', stem = '#7c4a1e', clock = true } = {}) {
  return `
    <path d="${STEM}" fill="none" stroke="${stem}" stroke-width="14" stroke-linecap="round"/>
    <path d="${APPLE}" fill="${fg}"/>
    <path d="${LEAF}" fill="${leaf}"/>
    ${
      clock
        ? `<circle cx="360" cy="352" r="86" fill="#f59e0b" stroke="${BRAND}" stroke-width="16"/>
           <path d="M360 302v52l32 20" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`
        : ''
    }`;
}

const svg = (body, { rounded = true, scale = 1 } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="${BRAND}"/>
  <g transform="translate(${256 - 256 * scale} ${256 - 256 * scale}) scale(${scale})">${body}</g>
</svg>`;

const ICONS = {
  // Regular icon: rounded square (browsers show it as-is).
  'icon.svg': { svg: svg(artwork()) },
  'icon-192.png': { svg: svg(artwork()), size: 192, transparent: true },
  'icon-512.png': { svg: svg(artwork()), size: 512, transparent: true },
  // Maskable/iOS: full-bleed square, artwork inside the central safe zone.
  'maskable-512.png': { svg: svg(artwork(), { rounded: false, scale: 0.72 }), size: 512 },
  'apple-touch-icon.png': { svg: svg(artwork(), { rounded: false, scale: 0.86 }), size: 180 },
  // Android status-bar badge: white silhouette on transparent.
  'badge-96.png': {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${artwork({ leaf: '#fff', stem: '#fff', clock: false })}</svg>`,
    size: 96,
    transparent: true,
  },
};

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
try {
  const page = await browser.newPage();
  for (const [name, icon] of Object.entries(ICONS)) {
    if (!icon.size) {
      await writeFile(new URL(name, OUT), `${icon.svg.trim()}\n`);
      continue;
    }
    await page.setViewportSize({ width: icon.size, height: icon.size });
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(icon.svg).toString('base64')}`;
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}img{display:block;width:${icon.size}px;height:${icon.size}px}</style><img src="${dataUrl}">`,
    );
    await page.locator('img').evaluate((img) => img.decode());
    await page.screenshot({ path: new URL(name, OUT).pathname, omitBackground: Boolean(icon.transparent) });
    console.log(`wrote app/icons/${name}`);
  }
} finally {
  await browser.close();
}
