// The two Fontsource files the site uses: the Latin subset, weight axis only.
// src/styles/base.css declares the same files as @font-face (CSS cannot import this module);
// vite.config.ts preloads the body font and scripts/build-og.ts embeds both in the social cards.
export const FONT_FILES = {
  display: '@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2',
  body: '@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2',
} as const;
