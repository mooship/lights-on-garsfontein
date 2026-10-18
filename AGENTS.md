# AGENTS.md

Instructions for anyone, human or AI, changing this repository. `CLAUDE.md` and `GEMINI.md` import this file; edit only this one. Setup, deployment and the public API are in [README.md](README.md); this file holds the rules for working on the code.

## What this is

**Lights On, Garsfontein?** shows the state of the electricity supply in Garsfontein, Pretoria, and keeps a record of outages. It is measured at one home in Garsfontein Extension 16 (Ward 45), near Mediclinic Denmar, by a heartbeat sensor and an admin punch clock.

- **Ultra-local, and nothing more.** It exists only to show the supply in Garsfontein. It is not a load-shedding app and must never try to replicate one; do not name other outage products anywhere.
- **Trust comes first.** Residents must find it reliable. Copy never claims more than is measured or than the code does: the reading is one point and some streets can differ, and statements such as how often figures refresh must match the code (`STATS_POLL_MS`). Unless a sensor heartbeat is within `HEARTBEAT_THRESHOLD_MS` (`shared/api.ts`), the status reads "No outage reported", not "on".
- **Independent and neutral.** Not affiliated with or endorsed by the City of Tshwane or Eskom. Copy states facts and never assigns blame ("failed", "neglect"), implies official status, or uses their logos or branding.

## Principles

1. **The best code is the code we don't write.** Before adding anything, ask whether the platform, an existing helper or a config value already does it, and whether it needs to exist at all. Deleting dead code, unused options and speculative abstractions is progress. No dependency for what a few lines do; no abstraction before a second real use.
2. **Test-driven.** Red, green, refactor: write a failing test that captures the behaviour or the bug, make it pass with the smallest change, then clean up. A bug fix starts with a test that reproduces it. If a reported bug does not reproduce, inject it briefly to prove the test would catch it; keep the test only if it fails where the existing tests pass, and prefer extending an existing test.
3. **One home per fact.** Deployment identity lives in `site.config.ts`, copy in `src/i18n/`, shared paths and types in `shared/`. Import them; do not repeat literals.
4. **Constants.** Error codes, paths, storage keys, header and cookie names, actions and durations each live in one dedicated module: `shared/` when both the app and the Worker use them (`errors.ts`, `paths.ts`, `api.ts`), otherwise next to their owner (`src/lib/storage.ts`, `worker/crons.ts`). Use an `as const` object or array with a union type derived from it, never a TypeScript `enum`, and build durations from `MINUTE_MS`, `HOUR_MS` and `DAY_MS`. A literal used once, where its meaning is obvious, may stay inline.
5. **Small, focused changes.** Commit summaries are short, sentence case and imperative, with no prefix or full stop (for example "Fix horizontal scroll on the privacy page on phones"). Commit each finished task (the hooks run). Push straight to `main` once the definition of done passes; CI runs on every push and must stay green. Push only when asked. Never skip hooks (`--no-verify`) or leave `test.only` or `skip` behind.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server for the UI; run `npm run dev:worker` alongside for the API (run `npm run build` once first, as the Worker serves `dist/`) |
| `npm run lint` / `lint:fix` / `lint:ci` | Biome |
| `npm run typecheck` | All tsconfigs: app, service worker, Worker, tests, Node |
| `npm run build` | Production build into `dist/` |
| `npm test` | Vitest: the `worker` project (workerd + D1) and the `node` project (`test/node/`); `CHECK_DIST=1` also checks `dist/` (CI does) |
| `npm run test:e2e` | Playwright against `wrangler dev --env e2e` |
| `npm run test:coverage` | Istanbul coverage for the Worker, on demand |
| `npm run db:generate` | New migration from `worker/db/schema.ts` |
| `npm run db:migrate:local` | Apply migrations to the local D1 |
| `npm run cf-typegen` | Regenerate `worker/worker-configuration.d.ts` after a `wrangler.toml` or `.dev.vars.example` change |
| `npm run og` / `icons` | Regenerate the social card and icons |

Lefthook runs Biome and the typecheck on commit and `npm test` on push. CI runs lint, typecheck, build, both Vitest projects (with `dist/` checks) and e2e, and fails if `wrangler types` or `drizzle-kit generate` would change a committed file.

## Definition of done

- Tests added or updated first, and they fail without the change.
- Before the first e2e run, `cp .dev.vars.example .dev.vars` (copying the example is allowed); without it the Turnstile and admin tests fail.
- `npm run lint:ci`, `npm run typecheck`, `npm run build`, `CHECK_DIST=1 npm test` and `npm run test:e2e` all pass, in that order.
- Both languages updated; zero layout shift and no horizontal scroll at 320px still hold.
- README updated when behaviour, configuration or the public API changes.

## Map

| Path | What lives there |
|---|---|
| `site.config.ts` | Deployment identity: brand, URL, area, landmark, start date, time zone and fixed offset, locales, data licence, fault-reporting link |
| `src/` | SolidJS app; `src/i18n/` dictionaries, `src/sw/` service worker, `src/banners.ts` dated notices |
| `worker/` | Cloudflare Worker: `index.ts` (routes, crons), `crons.ts` (cron strings), `lib/` (router, grid, stats, auth, Turnstile), `routes/`, `db/schema.ts` |
| `shared/` | Types and constants used by both the app and the Worker (`api.ts`, `errors.ts`, `paths.ts`, `locale.ts`) |
| `build/html.ts`, `vite.config.ts` | Build plugins: placeholders, static shell copy, per-locale pages, locale CSS, font preload, service worker |
| `index.html`, `privacy.html`, `templates/` | Static pages and generated files, filled from `site.config.ts` |
| `test/`, `test/node/`, `e2e/` | Worker tests, Node tests (pure logic, build helpers, built output), Playwright |
| `drizzle/` | Migrations (generated) |

To add an endpoint or a language, follow "Adding an endpoint" and "Adding a language" in the README. Public reads use `limiter: 'STATUS_LIMITER'` and `cors: true`; update the README API table with them. A new banner gets a test in `test/node/banners.test.ts` that it shows from `from` and is gone at `until` (e2e covers only the first entry).

## Hard rules

- **Never reveal how an outage was recorded** in public copy or public API responses; only the admin API exposes `source`. `test/node/dictionaries.test.ts` and `e2e/app.spec.ts` (`RECORDING_METHOD`) forbid words such as sensor, by hand, voeler and handmatig; admin copy is exempt.
- **Afrikaans is the default.** `src/i18n/af.ts` is the source and defines `Messages`; `en.ts` must `satisfy` it. Every user-facing string goes in both (banners may omit English, which falls back to Afrikaans; still write it). The one exception is the Atom feed (`worker/routes/history.ts`), which is English-only because feeds are read by software. Afrikaans must be natural, professional and AWS-correct.
- **Public contracts are stable.** CSV columns are only ever appended; API response fields are only added. Document changes in the README.
- **Placeholders.** Static files use `%site.<path>%` and `%since.<locale>%`, and `index.html` also uses `%page.*%` (`build/html.ts`, `vite.config.ts`). An unknown or leftover placeholder fails the build.
- **Inline scripts are frozen.** The boot scripts in `index.html` and `privacy.html` are CSP-hashed in `public/_headers`. Any edit, comments included, needs the hash updated (`test/csp.test.ts` fails otherwise). They must stay static: values reach them through `<html lang>` and `<html data-locales>`, never placeholders.
- **Zero layout shift.** The `index.html` shell mirrors the app box for box, and its copy comes from the dictionaries at build time (`data-i18n`). Change the shell, `src/components/Skeletons.tsx` and the app together. Shell copy must be a plain string or take only `site.*` arguments (`data-i18n-args`); copy tied to a code constant needs a coupling note at both ends.
- **Migrations.** Generate them with `npm run db:generate`; never hand-write schema SQL, and commit the schema and `drizzle/` together. `deploy:ci` migrates seconds before the new code is live, so each migration must work with both the old and the new code: add a column before using it, stop using it before dropping it, give new columns a default or make them nullable, and never rename in place. Read the generated SQL, because a SQLite table rebuild can cascade-delete rows (see `drizzle/0003_boolean_flags.sql`). Run `npm run db:migrate:local` and the tests.
- **Wrangler bindings.** A new var, binding or rate limit goes in the top level of `wrangler.toml` and in `[env.e2e]` (bindings are not inherited), and in `wrangler.example.toml`, with a `namespace_id` unique in the account. A new secret goes in `.dev.vars.example`, keeping its order. Then run `npm run cf-typegen`. `[env.e2e]` is for the test suite only: never deploy it.
- **Edge cache.** A write that changes an edge-cached view declares `purges` (usually `OUTAGE_VIEWS` from `shared/paths.ts`). A new `edgeCache` route joins `EDGE_CACHED` in `test/helpers.ts`.
- **Service worker safety.** It never writes pages or assets at runtime, never caches admin, POSTs, Turnstile, the CSV or the feed, and must never show a cached status without the dated "No connection" label. A kill switch is in `scripts/sw-kill-switch.js`.
- **Privacy.** Store no IP addresses or other data that identifies a visitor; rate limiting happens in Cloudflare, not in D1. Never publish the measuring home's address: public copy names only `site.landmark`. Keep `privacy.html` (both languages) accurate whenever data handling changes.
- **Secrets** live in Wrangler secrets or `.dev.vars` (git-ignored), never in the repo. Never open, print or paste `.env`, `.dev.vars` or secret values; only `.dev.vars.example` may be read. The contact email is the `CONTACT_EMAIL` secret.

## Tests

- Assert behaviour, not wording: take copy from `src/i18n`, `src/banners.ts` and `site.config.ts` rather than hard-coding it, with one literal smoke string per language.
- Worker tests run in workerd with real D1. Use the helpers in `test/helpers.ts`: `call`, `createSession`, `login`, `insertOutage`, `runCron`, `uniqueIp` for a fresh rate-limit bucket, and `sameWindow` before a rate-limit loop.
- e2e uses `e2e/fixtures.ts`, which deletes every outage before each test. Rate-limit counts carry over, so never assume they are empty. Pages default to English; use `test.use({ appLocale: 'af' })` for Afrikaans, and cover both languages.
- Never weaken an assertion, add a fixed wait or skip a test to make it pass; fix the cause.
- Playwright planner, generator and healer agents are in `.claude/agents/`; plans go in `specs/`, generated tests in `e2e/`, starting from `e2e/seed.spec.ts`. `.mcp.json` runs the Playwright MCP server with `cmd /c` for Windows; on macOS or Linux use `"command": "npx"` with the same arguments.

## Code comments

- **Say why, not what.** A comment earns its place by explaining what the code cannot: a constraint, a trade-off, a security, CSP or privacy reason, or a platform quirk.
- **Prefer a clearer name to a comment.** Delete comments that restate a name, a type or the next line.
- **One home per explanation.** Document a rule where it is defined, not at every caller.
- **Name the constant, not its value** (`HEARTBEAT_THRESHOLD_MS`, not "3 minutes"), so the comment cannot drift.
- **No history** ("now", "used to", "no longer"); that belongs in commit messages. No commented-out code, and no TODO without an issue link.
- **JSDoc on exports is one line**, only where the name and type do not already say it: contracts, units, what `null` means.
- **Keep coupling notes** where two places must change together, naming the file and symbol, never line numbers.
- **Every empty `catch` gets a one-line reason.**
- **Update or delete a comment in the same change that makes it wrong.**

## Style

TypeScript strict, Biome formatting (single quotes), named exports, small modules. Dependencies use caret ranges; ask the owner before adding one. British spelling in English copy and comments; plain, short sentences.
