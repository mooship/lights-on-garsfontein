// Renders the 1200x630 social card into public/og/card.png with Playwright. It is status-neutral
// (a shared link shows the same card whatever the power is doing); /og.png in the Worker serves it.
// The brand is from site.config.ts; the copy is in the default locale, with the second locale (if
// any) below. The icon path is Lucide's zap (ISC licence).
// Usage: npm run og   (needs `npx playwright install chromium` once)
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { escapeHtml } from '../build/html.ts';
import { site } from '../site.config.ts';
import { DICTIONARIES } from '../src/i18n/index.ts';
import { FONT_FILES } from '../src/styles/fonts.ts';
import { PALETTE } from '../src/styles/palette.ts';

const light = PALETTE.light;
const [PRIMARY, SECONDARY] = site.locales.map((locale) => ({ locale, m: DICTIONARIES[locale] }));
if (!PRIMARY) throw new Error('site.locales is empty');

// The same font files the site bundles, inlined so the page needs no server.
const fontUrl = (file: string) =>
  `data:font/woff2;base64,${readFileSync(new URL(import.meta.resolve(file))).toString('base64')}`;
const DISPLAY_FONT = fontUrl(FONT_FILES.display);
const BODY_FONT = fontUrl(FONT_FILES.body);

const ZAP =
  'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z';

const cta = [PRIMARY, SECONDARY].flatMap((l) => (l ? [l.m.og.cta] : [])).join(' · ');

const html = `<!doctype html>
<html lang="${PRIMARY.locale}"><head><style>
@font-face { font-family: Fraunces; src: url(${DISPLAY_FONT}); font-weight: 100 900; }
@font-face { font-family: Jakarta; src: url(${BODY_FONT}); font-weight: 200 800; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; background: ${light.bg}; color: ${light.text}; font-family: Jakarta, sans-serif;
  padding: 64px 80px; display: flex; flex-direction: column; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: 20px; font-size: 34px; font-weight: 700; color: ${light.muted}; }
.icon { width: 64px; height: 64px; border-radius: 999px; display: grid; place-items: center;
  background: ${light.card}; border: 2px solid ${light.border}; color: ${light.text}; }
h1 { font-family: Fraunces, serif; font-size: 80px; font-weight: 700; line-height: 1.08; letter-spacing: -0.01em; }
.secondary { font-family: Fraunces, serif; font-size: 48px; font-weight: 600; color: ${light.muted}; margin-top: 16px; }
.cta { display: inline-block; font-size: 30px; font-weight: 650; padding: 18px 28px; border-radius: 20px;
  background: ${light.text}; color: ${light.bg}; }
.foot { font-size: 24px; color: ${light.muted}; margin-top: 24px; }
</style></head><body>
<div class="brand"><span class="icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="${ZAP}"/></svg></span>
  ${escapeHtml(site.brand.full)}</div>
<div><h1>${escapeHtml(PRIMARY.m.og.question)}</h1>${
  SECONDARY ? `<p class="secondary" lang="${SECONDARY.locale}">${escapeHtml(SECONDARY.m.og.question)}</p>` : ''
}</div>
<div><p class="cta">${escapeHtml(cta)}</p><p class="foot">${escapeHtml(PRIMARY.m.masthead.notice)}</p></div>
</body></html>`;

const outDir = new URL('../public/og/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: new URL('card.png', outDir).pathname.replace(/^\/(\w:)/, '$1') });
console.log('public/og/card.png');
await browser.close();
