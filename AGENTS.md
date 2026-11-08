# AGENTS.md

Instructions for anyone changing this repository, by hand or with a coding agent. This is the one set of agent instructions: `CLAUDE.md` imports it and adds only what is specific to Claude Code, so every shared rule goes here. Setup, deployment, the public API, the directory map and the how-tos are in [README.md](README.md); this file holds the rules for working on the code.

## About

**Lights On, Garsfontein?** shows the state of the electricity supply in Garsfontein, Pretoria, and keeps a record of outages. It is measured at one home in Garsfontein Extension 16 (Ward 45), near Mediclinic Denmar, by a heartbeat sensor and an admin punch clock.

- It covers Garsfontein and nothing more. It exists only to show the supply there. It is not a load-shedding app and must never try to replicate one; do not name other outage products anywhere.
- Residents must be able to rely on it. Copy never claims more than is measured or than the code does: the reading is one point that speaks only for Extension 16, and some streets can differ. Statements such as how often the page refreshes must match the code (`POLL_MS` and `STATS_POLL_MS` in `src/lib/poll.ts`). Unless a sensor heartbeat is within `HEARTBEAT_THRESHOLD_MS` (`shared/api.ts`) and the sensor is not paused, the status reads "No outage reported", not "on".
- It is independent and neutral: not affiliated with or endorsed by the City of Tshwane or Eskom. Copy states facts and never assigns blame ("failed", "neglect"), implies official status, or uses their logos or branding.

## Commands

The full table, the local setup and what CI runs are in [README, Local development](README.md#local-development). The ones you need while working:

- `npm run dev` and `npm run dev:worker`: the Vite dev server and the local Worker (build once first; the Worker serves `dist/`).
- `npm run build`: build to `dist/`. A production build must leave the working tree clean.
- `npm run typecheck`: the app, Worker, tests and Node scripts; it generates the Worker binding types first.
- `npm test`: both Vitest projects, `worker` (workerd with real D1, `test/*.test.ts`) and `node` (`test/node/`). `CHECK_DIST=1` also checks `dist/`, so build first.
- `npm run test:coverage`: the same two projects with Istanbul coverage; it fails below 95% on any of statements, branches, functions and lines (`thresholds` in `vitest.config.ts`). CI runs this instead of plain `npm test`.
- `npm run test:e2e`: Playwright against `wrangler dev --env e2e` with a fresh local database.
- `npm run lighthouse`: Lighthouse CI (mobile profile, median of three runs) on `/`, `/en/` and `/privacy`, against the built Worker started as e2e starts it, so build first. Accessibility, best practices and SEO must be 100 and performance at least 95 (`.github/lighthouserc.cjs`). CI measured 99 to 100 for performance; a busy laptop scores lower and noisier, so judge a failure by the CI run, whose reports are uploaded as the `lighthouse-reports` artifact. Do not lower a threshold or skip an audit to get green.
- `npm run lint`, `npm run lint:fix` and `npm run lint:ci`: Biome, check, write and check as CI does. Biome is the formatter too, so there is no separate format command: `lint:fix` formats and lints.
- `npm run db:generate`: create a migration after changing `worker/db/schema.ts`.

Node 24.22.1 or newer (24 and 26 are supported; `.node-version` says 24) and npm 11 or newer; `packageManager` pins npm 11.19.1.

Lefthook runs on commit: `biome check --write` on the staged files (format and lint, with the fixes staged) and the typecheck on staged TypeScript. It never runs tests, so run them yourself.

## Engineering principles

- **Test first.** For logic and for bug fixes, write the failing test, watch it fail for the right reason, make it pass with the smallest change, then clean up. A bug fix starts with a test that reproduces it. If a reported bug does not reproduce, inject it briefly to prove the test would catch it; keep the test only if it fails where the existing tests pass, and prefer extending an existing test. Unit tests cover the Worker (routes, grid, stats, alerts, crypto) and the pure logic and build helpers in Node. Layout, rendering and the static shell are covered by `npm run build`, `npm run test:e2e` and looking at the page. The coverage gate is 95% on all four metrics, aiming for 100%. Never weaken an assertion, add a fixed wait, skip a test, or add a coverage-ignore comment to make a number or a test pass.
- **Open for extension, closed for edits.** The project grows by adding data at known seams, not by editing unrelated modules: a route map spread into `routes` (`worker/routes/index.ts`) with its guards declared on the route and applied by `dispatch` (`worker/lib/router.ts`); a dictionary per language that `satisfies Messages` (`src/i18n/`); `OUTAGE_SOURCES` (`shared/api.ts`); an entry in `BANNERS`; a field in `site.config.ts`; a generated drizzle migration. One module has one reason to change: handlers hold only their own logic, the router holds the guards, `shared/` holds what both sides need. Handlers depend on `RouteContext` rather than on the runtime. Do not invent a seam that is not there.
- **One home per fact.** Deployment identity, public copy, admin copy, colours, paths, error codes and durations each live in one module (see Constants below), and everything else imports them. Where two places must agree, a test or generated copy keeps them honest: `EDGE_CACHED` in `test/helpers.ts` is derived from the routes, `test/csp.test.ts` checks the script hashes, the route table is checked against `WORKER_PAGES`, and the English dictionary must `satisfy` the Afrikaans one. Documents too: each topic has one home, and the others link to it. Do not merge code that only looks alike.
- **Keep it simple.** The best code is the code we don't write. Before adding anything, ask whether the platform, an existing helper or a config value already does it, and whether it needs to exist at all. Deleting dead code, unused options and speculative abstractions is progress. No dependency for what a few lines do, no abstraction before a second real use, plain functions over classes.
- **Stay on task.** Do not refactor what the change does not touch; mention a nearby problem instead of fixing it in passing. Keep changes small and focused.

## Conventions

### Commit messages

Summaries follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `<type>[optional scope][!]: <description>`. Use a recognised type (`feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci` or `chore`) and a short, imperative summary in lower case with no full stop (for example "fix: stop horizontal scroll on the privacy page on phones", or Dependabot's "chore(deps): …"). Mark breaking changes with `!` and explain them in the body or a `BREAKING CHANGE:` footer. Commit each finished task (the hooks run). Push only when asked. Never skip hooks (`--no-verify`) or leave `test.only` or `skip` behind.

### Dependencies and lockfiles

`package-lock.json` is the only npm lockfile (`skills-lock.json` belongs to agent skills, not npm).

- The lockfile must install under both npm 10 and npm 11. Cloudflare Workers Builds can run npm 10.9, while CI and laptops run npm 11, and npm 11 can write a lockfile that a real npm 10 `npm ci` rejects ("Missing: proxy-agent@8.0.2 from lock file") when it updates an existing one, as Dependabot does. An npm 10 lockfile also passes npm 11, so write it with `npx -y npm@10 install --package-lock-only --ignore-scripts`. Every CI job still runs `npm install --global npm@11` before `npm ci`, and `packageManager` pins npm 11.19.1.
- Commit `package.json` and `package-lock.json` together. After a range or an `overrides` change, `--package-lock-only` can keep stale nested entries, so check `npm ls` for `invalid` or `missing` lines; delete the stale entries from the lockfile and regenerate, never edit versions by hand.
- Verify with a real `npm ci --ignore-scripts` under both `npx -y npm@10` and npm 11 in a clean clone, not `--dry-run`, which has passed on a lockfile that then failed to install. Check that `@typescript/typescript-linux-x64` is in the lockfile, since CI and Cloudflare run Linux.
- Pin a prerelease exactly. A caret on one (such as `^7.1.0-beta`) resolves to nightly builds, and a prerelease does not satisfy a plain peer range such as `>=2.9`.
- Dependabot owns its own lockfile changes. Fix one only when a real `npm ci` fails under either npm, and push the fix to its branch.
- Run the project's binaries with `npm run` or `npx --no-install <tool>`, so a missing local binary cannot fetch an unrelated package of the same name.
- Do not install in a working tree someone else is using; use a throwaway clone.

### Constants

Error codes, paths, storage keys, header and cookie names, actions and durations each live in one dedicated module: `shared/` when both the app and the Worker use them (`errors.ts`, `paths.ts`, `api.ts`), otherwise next to their owner (`src/lib/storage.ts`, `worker/crons.ts`). Deployment identity lives in `site.config.ts`, public copy in `src/i18n/`, admin copy in `src/admin/copy.ts`, colours in `src/styles/palette.ts`. Use an `as const` object or array with a union type derived from it, never a TypeScript `enum`, and build durations from `MINUTE_MS`, `HOUR_MS` and `DAY_MS`. A literal used once, where its meaning is obvious, may stay inline.

### Tests

- Assert behaviour, not wording: take copy from `src/i18n`, `src/admin/copy.ts`, `src/banners.ts` and `site.config.ts` rather than hard-coding it, with one literal smoke string per language.
- Worker tests run in workerd with real D1. Use the helpers in `test/helpers.ts`: `call`, `createSession`, `login`, `loginAttempt` and `ADMIN_PASSWORD`, `asAdmin`, `heartbeat`, `insertOutage`, `runCron`, `uniqueIp` for a fresh rate-limit bucket, `stubLimiter` for rate-limit tests, passed in with `call(..., { env })`, and `d1FailingOn` for a database that fails on matching SQL.
- e2e uses `e2e/fixtures.ts`, which deletes every outage before each test. `npm run test:e2e` writes `.dev.vars.e2e` from `.dev.vars.example` on every run, and `wrangler --env e2e` reads it instead of `.dev.vars`, so no setup is needed. Rate-limit counts carry over, so never assume they are empty. Pages default to English; use `test.use({ appLocale: 'af' })` for Afrikaans, and cover both languages.
- Never weaken an assertion, add a fixed wait or skip a test to make it pass; fix the cause.

### Code comments

- **Say why, not what.** A comment earns its place by explaining what the code cannot: a constraint, a trade-off, a security, CSP or privacy reason, or a platform quirk.
- **Prefer a clearer name to a comment.** Delete comments that restate a name, a type or the next line.
- **One home per explanation.** Document a rule where it is defined, not at every caller.
- **Name the constant, not its value** (`HEARTBEAT_THRESHOLD_MS`, not "3 minutes"), so the comment cannot drift.
- **No history** ("now", "used to", "no longer"); that belongs in commit messages. No commented-out code, and no TODO without an issue link.
- **JSDoc on exports is one line**, only where the name and type do not already say it: contracts, units, what `null` means.
- **Keep coupling notes** where two places must change together, naming the file and symbol, never line numbers.
- **Every empty `catch` gets a one-line reason.**
- **Update or delete a comment in the same change that makes it wrong.**

### Style and writing

TypeScript strict, Biome formatting (single quotes), named exports, small modules. Dependencies use caret ranges; ask the owner before adding one. British spelling in English copy and comments; plain, short sentences.

Write docs, copy and comments the way a person would. No em dashes: use a comma, colon, full stop or brackets, and keep en dashes for numeric and time ranges ("18:00–19:00"). Avoid the usual signs of generated text: bold run-in labels on every bullet or paragraph, a punchy closing line that restates the paragraph, question hooks as headings, tagline words such as "ultra-local", "seamless" or "friendly", and narrating which person or tool made each decision. Say what the thing does and stop.

## Definition of done

- Tests added or updated first, and they fail without the change.
- `npm run lint:ci`, `npm run typecheck`, `npm run build`, `CHECK_DIST=1 npm run test:coverage` and `npm run test:e2e` all pass, in that order. A change to a page, the head, styles, fonts or scripts also needs `npm run lighthouse` (after the build) to pass; CI runs it as its own job. The coverage run is both Vitest projects and fails below 95% on statements, branches, functions and lines; it replaces plain `npm test`. A change to docs only needs `npm run lint:ci`.
- A dependency or `package.json` change follows [Dependencies and lockfiles](#dependencies-and-lockfiles): both files committed together, and a real `npm ci --ignore-scripts` under npm 10 and npm 11 in a clean clone.
- Both languages updated; zero layout shift and no horizontal scroll at 320px still hold.
- README updated when behaviour, configuration or the public API changes.
- Say in the hand-over which checks were skipped, and why.

## Safety

- **Deploys.** Cloudflare Workers Builds deploys `main` (`npm run build`, then `npm run deploy:ci`, which migrates the production database seconds before the new code is live), so a merge to `main` is a production release. Do not run `npm run deploy`, `deploy:ci`, `db:migrate:remote` or any other remote Cloudflare command by hand unless the owner asks. `[env.e2e]` is for the test suite only: never deploy it.
- **Ask first** before adding a dependency, changing a migration that has shipped, or touching the secrets, the rate limits or the Turnstile settings.
- **Secrets** live in Wrangler secrets or `.dev.vars` (git-ignored), never in the repo. Never open, print or paste `.env`, `.dev.vars` or secret values; only `.dev.vars.example` and its copy `.dev.vars.e2e` may be read. The contact email is the `CONTACT_EMAIL` secret.
- **Privacy.** Store no IP addresses or other data that identifies a visitor; rate limiting happens in Cloudflare, not in D1. Never publish the measuring home's address: public copy names only `site.landmark`. Keep `privacy.html` (both languages) accurate whenever data handling changes.

## Map

The directory map and the steps for adding an endpoint, a language, a banner or an outage source are in [README, Extending](README.md#extending). The route table is `routes` in `worker/routes/index.ts`. When following those steps:

- Public reads use `limiter: 'STATUS_LIMITER'` and `cors: true`; update the README API table with them.
- A new or changed endpoint gets a matching request with assertions in `bruno/`.
- A new banner needs no test of its own: `test/node/banners.test.ts` covers the date window, and e2e covers the first entry.

## Hard rules

- **Never reveal how an outage was recorded** in public copy or public API responses; only the admin API exposes `source`. `test/node/dictionaries.test.ts` checks every string in the dictionaries, `src/i18n/head.ts` and the public static files, and `e2e/app.spec.ts` the rendered pages (`RECORDING_METHOD`), for words such as sensor, by hand, voeler and handmatig. Admin copy may name the method only because it lives outside the dictionaries, in `src/admin/copy.ts`.
- **Afrikaans is the default.** `src/i18n/af.ts` is the source and defines `Messages`; `en.ts` must `satisfy` it. Every user-facing string goes in both (banners may omit English, which falls back to Afrikaans; still write it). There are two exceptions: the Atom feed (`worker/routes/history.ts`), English-only because feeds are read by software, and `/admin`, English-only with its copy in `src/admin/copy.ts` and no language switch. Afrikaans must be natural, professional and AWS-correct.
- **Public contracts are stable.** CSV columns are only ever appended; API response fields are only added. Document changes in the README.
- **Placeholders.** Static files use `%site.<path>%` and `%since.<locale>%`, and `index.html` also uses `%page.*%` (`build/html.ts`, `vite.config.ts`). An unknown or leftover placeholder fails the build.
- **Inline scripts are frozen.** The boot scripts in `index.html`, `privacy.html` and `404.html` are CSP-hashed in `public/_headers`. Any edit, comments included, needs the hash updated (`test/csp.test.ts` fails otherwise). They must stay static: values reach them through `<html lang>` and `<html data-locales>`, never placeholders. The `index.html` script repeats `ADMIN_PAGE_PATH` (`shared/paths.ts`) and the admin language `'en'` as literals; change them together.
- **Zero layout shift.** The `index.html` shell mirrors the app box for box, and its copy comes from the dictionaries at build time (`data-i18n`). Change the shell, `src/components/Skeletons.tsx` and the app together. Shell copy must be a plain string or take only `site.*` arguments (`data-i18n-args`); copy tied to a code constant needs a coupling note at both ends.
- **Migrations.** Generate them with `npm run db:generate`; never hand-write schema SQL, and commit the schema and `drizzle/` together. `deploy:ci` migrates seconds before the new code is live, so each migration must work with both the old and the new code: add a column before using it, stop using it before dropping it, give new columns a default or make them nullable, and never rename in place. Read the generated SQL, because a SQLite table rebuild can cascade-delete rows (see `drizzle/0003_boolean_flags.sql`). Run `npm run db:migrate:local` and the tests.
- **Wrangler bindings.** A new var, binding or rate limit goes in the top level of `wrangler.toml` and in `[env.e2e]` (bindings are not inherited), and in `wrangler.example.toml`, with a `namespace_id` unique in the account. A new secret goes in `.dev.vars.example`, keeping its order. Then run `npm run cf-typegen`.
- **Edge cache.** A write that changes an edge-cached view declares `purges` (usually `OUTAGE_VIEWS` from `shared/paths.ts`). `EDGE_CACHED` in `test/helpers.ts` is derived from the routes, and `test/edge-cache.test.ts` fails if an edge-cached path is missing from `OUTAGE_VIEWS`.
