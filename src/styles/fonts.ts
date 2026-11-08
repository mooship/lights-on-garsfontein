// The two Fontsource files the site uses, Latin subset only: Public Sans (weight axis) for all text, and
// Barlow Semi Condensed at 600 for the status headline and the figures.
// src/styles/base.css declares the same files as @font-face (CSS cannot import this module);
// vite.config.ts preloads both and scripts/build-og.ts embeds both in the social card.
export const FONT_FILES = {
  display: '@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal.woff2',
  body: '@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2',
} as const;
