# Reading Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each `/api/stats` window says what share of its time had a live reading, and the statistics card says "Last 30 days. 96% measured." when that share is known.

**Architecture:** A new `sensor_pauses` history table, written by `pauseSensor` (the only place a pause starts or ends). The stats handler merges pauses with false-positive sensor outages into gaps, and `windowStats` turns the gaps into `coverage` for windows that start on or after `site.coverageSince`. The page appends one sentence to the existing subtitle.

**Tech Stack:** Cloudflare Workers, D1 with Drizzle (`npm run db:generate`), Solid, Vitest in workerd, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-reading-coverage-design.md`

## Global Constraints

- Public contract: fields are only added (`WindowStats.coverage`, `StatsResponse.coverageSince`); no existing figure changes.
- Never reveal how an outage was recorded: no "sensor", "manual", "by hand", "voeler", "handmatig" in public copy or responses (the dictionaries test enforces it).
- `coverage` is a 0–1 share, **rounded down** to four decimals; the page floors it to a whole percent.
- A window whose `max(from, trackingSince)` is before `coverageSince` gets `coverage: null`.
- Not measured = every pause (set → its end) ∪ every outage with `source = 'sensor'` and `isFalsePositive`, whoever dismissed it. Manual false positives are not gaps.
- Copy (verbatim): English subtitle sentence `${percent}% measured.`, Afrikaans `${percent}% gemeet.`; "How we measure" bullet EN "‘Measured’ is the share of the period with a live reading; time without one counts as neither on nor off.", AF "‘Gemeet’ is die deel van die tydperk met ’n lewendige lesing; tyd sonder een tel as nóg aan nóg af."
- `site.coverageSince` for this deployment: `'2026-10-25T00:00:00+02:00'`. It must not be earlier than the deploy, so if the merge slips past that, move it to the next local midnight.
- Migration generated with `npm run db:generate`, never hand-written; it only adds a table.
- Durations from `MINUTE_MS`/`HOUR_MS`/`DAY_MS`; constants as `as const` with derived types; one-line JSDoc on exports; British spelling.

## Review Focus

- A pause set after an earlier one has already run out must insert a **new** row, not stretch the old one over the time between (Task 1 test).
- A gap covering the whole window gives `coverage` 0, never negative (Task 2 test).
- A window with no tracked time (`to <= start`) gives `null`, not a division by zero (Task 2 test).
- A resume when no pause is running writes nothing (Task 1 test).
- The subtitle with the sentence stays one line at 320px in Afrikaans, the longer language (Task 3 e2e).

---

### Task 1: Pause history

**Files:**
- Modify: `worker/db/schema.ts` (add `sensorPauses` after `heartbeats`)
- Create: `drizzle/0012_*.sql` and `drizzle/meta/*` (generated)
- Modify: `worker/lib/grid.ts` (`pauseSensor`)
- Modify: `test/setup.ts` (add `'sensor_pauses'` to `TABLES`)
- Test: `test/status.test.ts` (inside `describe('POST /api/heartbeat/pause')`), `test/telegram-commands.test.ts` (inside `describe('/pause')`)

**Interfaces:**
- Produces: table `sensorPauses` (`id`, `startTime: string`, `endTime: string`), exported from `worker/db/schema.ts`. `pauseSensor(db, until, now)` keeps its signature and return value.

- [ ] **Step 1: Add `sensorPauses` to the schema exactly as in the spec's "Data" section, then run `npm run db:generate` and `npm run db:migrate:local`.** Read the generated SQL: it must be a single `CREATE TABLE` with no table rebuild. Add `'sensor_pauses'` to `TABLES` in `test/setup.ts`.

- [ ] **Step 2: Write the failing tests** in `test/status.test.ts`, with a helper `const pauses = async () => (await env.DB.prepare('SELECT start_time, end_time FROM sensor_pauses ORDER BY id').all<{ start_time: string; end_time: string }>()).results;`

```ts
it('records each pause in the history', async () => {
  await setHeartbeat(30);
  const until = fromNow(HOUR_MS);
  await requestPause(until);
  const [row, ...rest] = await pauses();
  expect(rest).toEqual([]);
  expect(row?.end_time).toBe(new Date(until).toISOString());
  expect(Date.parse(row?.start_time ?? '')).toBeLessThanOrEqual(Date.now());
});

it('extends a running pause rather than adding another', async () => {
  await setHeartbeat(30);
  await requestPause(fromNow(HOUR_MS));
  const { pausedUntil } = (await (await requestPause(fromNow(2 * HOUR_MS))).json()) as { pausedUntil: string };
  const rows = await pauses();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.end_time).toBe(pausedUntil);
});
```

```ts
it('starts a new row once the earlier pause has run out', async () => {
  await setHeartbeat(30);
  await env.DB.prepare("INSERT INTO sensor_pauses (start_time, end_time) VALUES ('2026-10-20T08:00:00.000Z', '2026-10-20T09:00:00.000Z')").run();
  await requestPause(fromNow(HOUR_MS));
  const rows = await pauses();
  expect(rows).toHaveLength(2);
  expect(rows[0]?.end_time).toBe('2026-10-20T09:00:00.000Z');
});

it('ends the running pause at the moment of a resume', async () => {
  await setHeartbeat(30);
  await requestPause(fromNow(HOUR_MS));
  const before = Date.now();
  await requestPause(null);
  const end = Date.parse((await pauses())[0]?.end_time ?? '');
  expect(end).toBeGreaterThanOrEqual(before);
  expect(end).toBeLessThanOrEqual(Date.now());
});

it('writes nothing for a resume with no pause running', async () => {
  await setHeartbeat(30);
  await requestPause(null);
  expect(await pauses()).toEqual([]);
});
```

In `test/telegram-commands.test.ts`, extend `'pauses for the duration and says until when'` to assert one `sensor_pauses` row whose `end_time` equals the `paused_until` it already checks.

- [ ] **Step 3: Run** `npx vitest run --project worker test/status.test.ts test/telegram-commands.test.ts`. Expected: the new tests FAIL (no rows written).

- [ ] **Step 4: Implement in `pauseSensor`.** After the existing `heartbeats` update, and only when it changed a row (`row` is defined): for a pause, update the row with `end_time > now` to `end_time = until`, or insert `(now, until)` when none matched; for a resume, set `end_time = now` on the row with `end_time > now`. Run both statements in one `db.batch` with the heartbeats update if Drizzle's batch allows the conditional insert; otherwise run them in sequence, since the heartbeats row stays the source of truth for detection.

- [ ] **Step 5: Run** the same command. Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 6: Commit** `feat: keep a history of sensor pauses` (schema, `drizzle/`, `grid.ts`, tests, `test/setup.ts`).

### Task 2: Coverage in the statistics API

**Files:**
- Modify: `site.config.ts` (`coverageSince` after `trackingSince`, with a JSDoc saying forks set it equal to `trackingSince`)
- Modify: `shared/api.ts` (`COVERAGE_SINCE = site.coverageSince` beside `TRACKING_SINCE`; `WindowStats.coverage`; `StatsResponse.coverageSince`)
- Modify: `worker/lib/stats.ts` (export `Interval`; `windowStats` gains an options argument)
- Modify: `worker/routes/history.ts` (`getStats` reads gaps)
- Modify: `README.md` (API table, `site.config.ts` field table, one sentence on "measured"), `bruno/public/stats.bru`, `templates/llms.txt`
- Test: `test/stats.test.ts`

**Interfaces:**
- Consumes: `sensorPauses` from Task 1.
- Produces: `WindowStats.coverage: number | null` (JSDoc: "Share of the window with a live reading (0–1, rounded down to four decimals); null when it starts before COVERAGE_SINCE."), `StatsResponse.coverageSince: string`, and
  `windowStats(intervals, from, to, trackingSince, planned = [], coverage?: { gaps: Interval[]; since: number }): WindowStats`, `coverage` being `null` when the option is absent.

- [ ] **Step 1: Write the failing `windowStats` tests** in `describe('windowStats')`, using the file's `t()` and `since`, a window `t('2026-11-01T00:00:00Z')` to `t('2026-11-02T00:00:00Z')`, and `const cov = (gaps, coverageSince = since) => windowStats([], from, to, since, [], { gaps, since: coverageSince }).coverage;`

  - `cov([])` → `1`
  - a 6 h gap and an overlapping gap that together cover 08:00–14:00 (pass them through `mergeOutages`) → `0.75`
  - a gap from `2026-10-31T18:00:00Z` to `2026-11-01T06:00:00Z` (clipped to 6 h) → `0.75`
  - a gap covering the whole day and more → `0`
  - a 1 ms gap → `0.9999`
  - `coverageSince` = `t('2026-11-01T12:00:00Z')` → `null`
  - no `coverage` option → `null`
  - `from === to` → `null`

- [ ] **Step 2: Write the failing handler tests** in `describe('GET /api/stats over time')`, which fakes the clock with `daysTracked`. Set the clock to `Date.parse(COVERAGE_SINCE) + 10 * DAY_MS` with `vi.setSystemTime` (same pattern as `daysTracked`), so `last7` starts after `coverageSince` whatever today's date is.
  - Insert a closed false positive with `source: 'sensor'` lasting 1 h, one with `source: 'manual'` lasting 1 h, and a `sensor_pauses` row of 1 h, all inside the last 7 days and none overlapping. Expect `last7.coverage` to be `Math.floor((1 - 2 / (7 * 24)) * 10_000) / 10_000`, and `last30.coverage` to be `null` (it starts before `coverageSince`).
  - Expect `coverageSince` in the body to equal `new Date(COVERAGE_SINCE).toISOString()`.
  - Add `coverage` to the shape test's `last30` key list and `coverageSince` to its response key list.

- [ ] **Step 3: Run** `npx vitest run --project worker test/stats.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement.** In `windowStats`, with `start = max(from, trackingSince)`: `null` when the option is absent, `to <= start` or `start < since`; otherwise `Math.floor((1 - Σ overlap(gap, start, to) / (to - start)) * 10_000) / 10_000`. In `getStats`, read pauses with `end_time >= earliest` and sensor false positives with `end_time >= earliest`, map both to `{ startTime, endTime }`, `mergeOutages` them into `gaps`, and pass `{ gaps, since: Date.parse(COVERAGE_SINCE) }` to the four windows (not `weeklyStats`). Add `coverageSince` to the body.

- [ ] **Step 5: Run** the same command and `npm run typecheck`. Expected: PASS.

- [ ] **Step 6: Docs.** Update the README `GET /api/stats` row ("`coverage`, the share of the window with a live reading (0–1, rounded down to four decimals; `null` for a window that starts before `coverageSince`)") and add `coverageSince` to it. Add `coverageSince` to the `site.config.ts` table ("When pause history begins; a window starting earlier has no coverage. Set it to `trackingSince` for a new deployment"). In Bruno, assert `last30` includes `coverage` and the body includes `coverageSince`. In `llms.txt`, add "and the share of each period with a live reading" to the statistics line.

- [ ] **Step 7: Commit** `feat: give each statistics window its reading coverage`.

### Task 3: The measured sentence on the page

**Files:**
- Modify: `src/i18n/af.ts`, `src/i18n/en.ts` (`trends.measured`, one more `trends.how` bullet)
- Modify: `src/components/Trends.tsx` (`subtitle`)
- Test: `e2e/app.spec.ts` (inside the per-locale `${locale} figures` describe)

**Interfaces:**
- Consumes: `WindowStats.coverage` from Task 2.
- Produces: `trends.measured: (percent: number) => string` in `Messages`.

- [ ] **Step 1: Write the failing e2e tests** in the `${locale} figures` describe, using `withOutages(page, undefined, change)`:
  - with `last30.coverage: 0.9637`, `.gg-trends-body` contains `m.trends.measured(96)`;
  - with `last30.coverage: null`, it does not contain `m.trends.measured(96)`;
  - at viewport 320×800 with `coverage: 0.9637`, the subtitle paragraph (the first `p` in `.gg-trends-body`) is one line: its `boundingBox().height` is at most 1.5 × its computed `line-height`.

- [ ] **Step 2: Run** `npx playwright test -g "measured"`. Expected: FAIL (`measured` is not defined).

- [ ] **Step 3: Implement.** Add the copy from Global Constraints. Put the "How we measure" bullet last. In `af.ts`, add a coupling note on `measured` naming the README `GET /api/stats` row. In `Trends.tsx`, `subtitle()` returns `${base} ${t().trends.measured(Math.floor(s().coverage * 100))}` when `s().coverage !== null`, else `base`, where `base` is today's subtitle.

- [ ] **Step 4: Run** the same command. Expected: PASS in both languages.

- [ ] **Step 5: Commit** `feat: say how much of the period was measured`.

### Task 4: Finish

- [ ] **Step 1:** Run the definition of done in order: `npm run lint:ci`, `npm run typecheck`, `npm run build`, `CHECK_DIST=1 npm test`, `npm run test:e2e`. All pass.
- [ ] **Step 2:** Independent review of `git diff main...HEAD` against AGENTS.md and the spec; fix what it finds, with tests, and rerun Step 1.
- [ ] **Step 3:** Push, open the PR (noting the migration), watch CI, and merge. After the deploy, check that `GET /api/stats` has `coverageSince` and that `last7.coverage` is `null` until 7 days after `coverageSince`.
