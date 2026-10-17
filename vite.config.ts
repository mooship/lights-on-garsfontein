import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

const WORKER = 'http://localhost:8787';

export default defineConfig({
  plugins: [solid(), vanillaExtractPlugin()],
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
