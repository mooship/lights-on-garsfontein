// Renders the two 1200x630 social cards into public/og/ with Playwright.
// /og.png in the Worker serves the one matching the live status.
// Icon paths are Lucide's zap and zap-off (ISC licence).
// Usage: npm run og   (needs `npx playwright install chromium` once)
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const font = (file: string) =>
  `data:font/woff2;base64,${readFileSync(new URL(`../public/fonts/${file}`, import.meta.url)).toString('base64')}`;

const CARDS = {
  on: {
    label: 'Die krag is aan',
    english: 'Power is on',
    color: '#2D5A27',
    soft: '#E6EEE3',
    glyph:
      'M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z',
  },
  off: {
    label: 'Die krag is af',
    english: 'Power is off',
    color: '#B33A2B',
    soft: '#F7E5E1',
    glyph:
      'M10.768 5.111 13.44 2.44a1.5 1.5 0 012.474 1.561l-1.633 4.625M18.889 13.232l.672-.672A1.5 1.5 0 0018.5 10h-2.844M2 2l20 20M7.94 7.94l-3.5 3.499A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l5.5-5.5',
  },
} as const;

const html = (card: (typeof CARDS)[keyof typeof CARDS]) => `<!doctype html>
<html lang="af"><head><style>
@font-face { font-family: Fraunces; src: url(${font('fraunces-latin-wght.woff2')}); font-weight: 100 900; }
@font-face { font-family: Jakarta; src: url(${font('plus-jakarta-sans-latin-wght.woff2')}); font-weight: 200 800; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; background: #F6F4EF; color: #1F2120; font-family: Jakarta, sans-serif;
  padding: 72px 80px; display: flex; flex-direction: column; justify-content: space-between; }
.eyebrow { font-size: 28px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #5C5850; }
h1 { font-family: Fraunces, serif; font-size: 88px; font-weight: 700; margin-top: 12px; letter-spacing: -0.01em; }
.status { display: flex; align-items: center; gap: 32px; background: #fff; border: 2px solid #E4DFD4;
  border-radius: 32px; padding: 32px 40px; }
.icon { width: 120px; height: 120px; border-radius: 999px; display: grid; place-items: center;
  background: ${card.soft}; color: ${card.color}; }
.label { font-family: Fraunces, serif; font-size: 72px; font-weight: 650; line-height: 1.1; color: ${card.color}; }
.english { font-size: 30px; font-weight: 600; color: #5C5850; margin-top: 8px; }
.foot { font-size: 26px; color: #5C5850; }
</style></head><body>
<div><p class="eyebrow">Garsfontein Uitb. 16 · Wyk 45 · Pretoria</p><h1>Lights On?</h1></div>
<div class="status"><div class="icon"><svg width="64" height="64" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="${card.glyph}"/></svg></div>
  <div><p class="label">${card.label}</p><p class="english" lang="en">${card.english}</p></div></div>
<p class="foot">Deur ’n inwoner van Garsfontein · nie die Stad Tshwane of Eskom nie</p>
</body></html>`;

const outDir = new URL('../public/og/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [name, card] of Object.entries(CARDS)) {
  await page.setContent(html(card), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(`${name}.png`, outDir).pathname.replace(/^\/(\w:)/, '$1') });
  console.log(`public/og/${name}.png`);
}
await browser.close();
