// Lighthouse CI, mobile profile (Lighthouse's default: simulated slow 4G, 4x CPU slowdown).
//
// `npm run lighthouse` starts the built Worker the way playwright.config.ts does (the e2e environment and a
// throwaway local D1; run `npm run build` first) and audits every public page. Each URL runs three times
// and the median is asserted, because a single run is noisy on shared runners. Admin and API routes are not audited.
const PORT = 8789;
const STATE = '.wrangler/lighthouse-state';
const BASE = `http://127.0.0.1:${PORT}`;
// The default locale at /, each other locale at /<code>/ (shared/locale.ts), and the privacy page, which holds
// both languages. Add a locale here when site.config.ts gains one.
const PAGES = ['/', '/en/', '/privacy'];

module.exports = {
  ci: {
    collect: {
      // The same steps as webServer.command in playwright.config.ts, minus the build, so keep them in step.
      startServerCommand: [
        `node -e "require('node:fs').rmSync('${STATE}',{recursive:true,force:true})"`,
        `node -e "require('node:fs').copyFileSync('.dev.vars.example','.dev.vars.e2e')"`,
        `npx wrangler d1 migrations apply DB --local --env e2e --persist-to ${STATE}`,
        `npx wrangler dev --env e2e --port ${PORT} --ip 127.0.0.1 --persist-to ${STATE}`,
      ].join(' && '),
      startServerReadyPattern: 'Ready on',
      startServerReadyTimeout: 120_000,
      url: PAGES.map((path) => BASE + path),
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--no-sandbox --headless=new',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.95, aggregationMethod: 'median' }],
        'categories:accessibility': ['warn', { minScore: 1, aggregationMethod: 'median' }],
        'categories:best-practices': ['warn', { minScore: 1, aggregationMethod: 'median' }],
        'categories:seo': ['warn', { minScore: 1, aggregationMethod: 'median' }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
};
