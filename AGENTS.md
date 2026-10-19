# AGENTS.md

Instructions for anyone, human or AI, changing this repository. `CLAUDE.md` and `GEMINI.md` import this file; put every shared rule here, and in them only what is specific to that tool. Setup, deployment, the public API, the commands, the directory map and the how-tos are in [README.md](README.md); this file holds the rules for working on the code.

## What this is

**Lights On, Garsfontein?** shows the state of the electricity supply in Garsfontein, Pretoria, and keeps a record of outages. It is measured at one home in Garsfontein Extension 16 (Ward 45), near Mediclinic Denmar, by a heartbeat sensor and an admin punch clock.

- **Ultra-local, and nothing more.** It exists only to show the supply in Garsfontein. It is not a load-shedding app and must never try to replicate one; do not name other outage products anywhere.
- **Trust comes first.** Residents must find it reliable. Copy never claims more than is measured or than the code does: the reading is one point that speaks only for Extension 16, and some streets can differ. Statements such as how often the page refreshes must match the code (`POLL_MS` and `STATS_POLL_MS` in `src/lib/poll.ts`). Unless a sensor heartbeat is within `HEARTBEAT_THRESHOLD_MS` (`shared/api.ts`) and the sensor is not paused, the status reads "No outage reported", not "on".
- **Independent and neutral.** Not affiliated with or endorsed by the City of Tshwane or Eskom. Copy states facts and never assigns blame ("failed", "neglect"), implies official status, or uses their logos or branding.

## Principles

1. **The best code is the code we don't write.** Before adding anything, ask whether the platform, an existing helper or a config value already does it, and whether it needs to exist at all. Deleting dead code, unused options and speculative abstractions is progress. No dependency for what a few lines do; no abstraction before a second real use.
2. **Test-driven.** Red, green, refactor: write a failing test that captures the behaviour or the bug, make it pass with the smallest change, then clean up. A bug fix starts with a test that reproduces it. If a reported bug does not reproduce, inject it briefly to prove the test would catch it; keep the test only if it fails where the existing tests pass, and prefer extending an existing test.
3. **One home per fact.** Deployment identity lives in `site.config.ts`, public copy in `src/i18n/`, admin copy in `src/admin/copy.ts`, colours in `src/styles/palette.ts`, shared paths and types in `shared/`. Import them; do not repeat literals. The same holds for documents: each topic has one home, and the others link to it.
4. **Constants.** Error codes, paths, storage keys, header and cookie names, actions and durations each live in one dedicated module: `shared/` when both the app and the Worker use them (`errors.ts`, `paths.ts`, `api.ts`), otherwise next to their owner (`src/lib/storage.ts`, `worker/crons.ts`). Use an `as const` object or array with a union type derived from it, never a TypeScript `enum`, and build durations from `MINUTE_MS`, `HOUR_MS` and `DAY_MS`. A literal used once, where its meaning is obvious, may stay inline.
5. **Small, focused changes.** Commit summaries follow [Conventional Commits](https://www.conventionalcommits.org): a type (`feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `ci` or `chore`), an optional scope, then a short, imperative summary in lower case with no full stop (for example "fix: stop horizontal scroll on the privacy page on phones", or Dependabot's "chore(deps): …"). Commit each finished task (the hooks run). Never commit to `main` directly: run `git switch main && git pull --ff-only`, then branch from the up-to-date `main` for each change. Once the definition of done passes, push the branch and open a pull request into `main`; CI must pass before it is merged. Use the GitHub CLI (`gh pr create`, `gh pr checks --watch`, `gh pr merge`) for pull requests, checks and issues. Push only when asked. Never skip hooks (`--no-verify`) or leave `test.only` or `skip` behind.

## Commands

The commands, the Lefthook hooks and what CI runs are in [README, Local development](README.md#local-development).

## Definition of done

- Tests added or updated first, and they fail without the change.
- `npm run lint:ci`, `npm run typecheck`, `npm run build`, `CHECK_DIST=1 npm test` and `npm run test:e2e` all pass, in that order.
- Both languages updated; zero layout shift and no horizontal scroll at 320px still hold.
- README updated when behaviour, configuration or the public API changes.

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
- **Wrangler bindings.** A new var, binding or rate limit goes in the top level of `wrangler.toml` and in `[env.e2e]` (bindings are not inherited), and in `wrangler.example.toml`, with a `namespace_id` unique in the account. A new secret goes in `.dev.vars.example`, keeping its order. Then run `npm run cf-typegen`. `[env.e2e]` is for the test suite only: never deploy it.
- **Edge cache.** A write that changes an edge-cached view declares `purges` (usually `OUTAGE_VIEWS` from `shared/paths.ts`). `EDGE_CACHED` in `test/helpers.ts` is derived from the routes, and `test/edge-cache.test.ts` fails if an edge-cached path is missing from `OUTAGE_VIEWS`.
- **Privacy.** Store no IP addresses or other data that identifies a visitor; rate limiting happens in Cloudflare, not in D1. Never publish the measuring home's address: public copy names only `site.landmark`. Keep `privacy.html` (both languages) accurate whenever data handling changes.
- **Secrets** live in Wrangler secrets or `.dev.vars` (git-ignored), never in the repo. Never open, print or paste `.env`, `.dev.vars` or secret values; only `.dev.vars.example` and its copy `.dev.vars.e2e` may be read. The contact email is the `CONTACT_EMAIL` secret.

## Tests

- Assert behaviour, not wording: take copy from `src/i18n`, `src/admin/copy.ts`, `src/banners.ts` and `site.config.ts` rather than hard-coding it, with one literal smoke string per language.
- Worker tests run in workerd with real D1. Use the helpers in `test/helpers.ts`: `call`, `createSession`, `login`, `loginAttempt` and `ADMIN_PASSWORD`, `asAdmin`, `heartbeat`, `insertOutage`, `runCron`, `uniqueIp` for a fresh rate-limit bucket, and `stubLimiter` for rate-limit tests, passed in with `call(..., { env })`.
- e2e uses `e2e/fixtures.ts`, which deletes every outage before each test. `npm run test:e2e` writes `.dev.vars.e2e` from `.dev.vars.example` on every run, and `wrangler --env e2e` reads it instead of `.dev.vars`, so no setup is needed. Rate-limit counts carry over, so never assume they are empty. Pages default to English; use `test.use({ appLocale: 'af' })` for Afrikaans, and cover both languages.
- Never weaken an assertion, add a fixed wait or skip a test to make it pass; fix the cause.

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
