import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { FontaineTransform } from 'fontaine';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const WORKER = 'http://localhost:8787';

export default defineConfig({
  plugins: [
    solid(),
    vanillaExtractPlugin(),
    // Adds metric-matched fallback @font-face rules ("<Family> fallback") so system fonts
    // occupy the same space as the web fonts before they load.
    FontaineTransform.vite({
      // Preference order, as in Fontaine's DEFAULT_CATEGORY_FALLBACKS (plus Roboto for Android).
      fallbacks: {
        Fraunces: ['Georgia', 'Times New Roman', 'Noto Serif'],
        Jakarta: ['Segoe UI', 'Helvetica Neue', 'Arial', 'Roboto', 'Noto Sans'],
      },
      resolvePath: (id) => new URL(`./public${id}`, import.meta.url),
    }),
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
  server: {
    // `npm run dev` serves the UI; run `npm run dev:worker` alongside for the API.
    proxy: {
      '/api': WORKER,
      '/og.png': WORKER,
      '/sitemap.xml': WORKER,
      '/robots.txt': WORKER,
    },
  },
});
