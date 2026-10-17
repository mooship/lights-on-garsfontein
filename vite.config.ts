import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig, type IndexHtmlTransformContext, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';

const WORKER = 'http://localhost:8787';

/**
 * The Fontsource woff2 files are bundled into /assets/ with a hash. This preloads the body
 * font so font-display: optional can use it on first paint, and points the static
 * public/privacy.css at the same hashed files (its /fonts/<name>.woff2 urls).
 */
function hashedFonts(): Plugin {
  const fonts = new Map<string, string>();
  const collect = (bundle: NonNullable<IndexHtmlTransformContext['bundle']>) => {
    for (const file of Object.values(bundle)) {
      const name = file.type === 'asset' && /^assets\/(.+)-[\w-]+\.woff2$/.exec(file.fileName)?.[1];
      if (name) fonts.set(name, `/${file.fileName}`);
    }
  };
  let outDir = 'dist';
  return {
    name: 'hashed-fonts',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      collect(bundle);
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        if (bundle) collect(bundle);
        const href = fonts.get('plus-jakarta-sans-latin-wght-normal');
        if (!href) throw new Error('hashed-fonts: the Plus Jakarta Sans woff2 was not emitted');
        return [
          {
            tag: 'link',
            attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href },
            injectTo: 'head',
          },
        ];
      },
    },
    writeBundle() {
      const path = resolve(outDir, 'privacy.css');
      const css = readFileSync(path, 'utf8').replace(/\/fonts\/([\w-]+)\.woff2/g, (_url, name: string) => {
        const href = fonts.get(name);
        if (!href) throw new Error(`hashed-fonts: privacy.css uses ${name}.woff2, which was not emitted`);
        return href;
      });
      writeFileSync(path, css);
    },
  };
}

export default defineConfig({
  plugins: [solid(), vanillaExtractPlugin(), hashedFonts()],
  build: {
    target: 'es2022',
    outDir: 'dist',
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
