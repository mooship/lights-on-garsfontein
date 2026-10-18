// Renders every app icon from one SVG source into public/ with Playwright:
// favicon.ico (16/32/48), apple-touch-icon.png (180), icon-192/512.png and icon-maskable-512.png.
// Usage: npm run icons   (needs `npx playwright install chromium` once)
import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { PALETTE } from '../src/styles/palette.ts';

const BOLT = 'M36 8 16 36h14l-4 20 22-30H34z';

/** `inset` shrinks the bolt into the centre "safe zone" that maskable icons require. */
const svg = (rounded: boolean, inset = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${rounded ? 16 : 0}" fill="${PALETTE.light.on}"/>
  <g transform="translate(${inset} ${inset}) scale(${(64 - inset * 2) / 64})"><path d="${BOLT}" fill="${PALETTE.light.bg}"/></g>
</svg>`;

const out = (file: string) => new URL(`../public/${file}`, import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(size: number, source: string, transparent: boolean): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
  );
  return page.screenshot({ omitBackground: transparent });
}

// Apple ignores transparency and applies its own corner mask, so the touch icon is square and opaque.
writeFileSync(out('apple-touch-icon.png'), await render(180, svg(false, 6), false));
writeFileSync(out('icon-192.png'), await render(192, svg(true), true));
writeFileSync(out('icon-512.png'), await render(512, svg(true), true));
// Maskable: full-bleed background, artwork inside the central 80% circle.
writeFileSync(out('icon-maskable-512.png'), await render(512, svg(false, 13), false));

// ICO files may embed PNG data directly (supported since Windows Vista and in every browser).
// One at a time: render() resizes the one shared page, so parallel calls would all capture the last size.
const sizes = [16, 32, 48];
const images: Buffer[] = [];
for (const size of sizes) images.push(await render(size, svg(true), true));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((png, i) => {
  const entry = 6 + i * 16;
  const size = sizes[i] ?? 0;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4); // colour planes
  header.writeUInt16LE(32, entry + 6); // bits per pixel
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
writeFileSync(out('favicon.ico'), Buffer.concat([header, ...images]));

await browser.close();
console.log('Icons written to public/');
