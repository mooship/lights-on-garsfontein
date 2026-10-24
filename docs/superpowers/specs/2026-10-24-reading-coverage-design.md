# Reading coverage: design

**Status:** approved; amended 24 October 2026 (decision 2, show on the page only when low).

24 October 2026. The operator chose this from a shortlist and asked Claude to "handle this intelligently", so the decisions below are Claude's, made under the rules in AGENTS.md. Each says why.

## Intent

The statistics count every hour since records began as either off (inside an outage) or on. But some hours nobody was measuring. In those hours the sensor was paused (the MacBook was away from its charger), or it was silent and the outage that opened was later dismissed as a lost connection. Those hours count as "on" today. In a window with a long pause, "0 h without power" can mean "we were not watching". A resident cannot tell the two apart, which goes against "trust comes first": copy must never claim more than is measured.

## Goals

- Each statistics window in `/api/stats` says what share of its time was measured.
- The statistics card says it in a few words when it is known and below `COVERAGE_NOTE_BELOW` (95%): "Last 30 days. 82% measured."
- The share never rounds up: 99.6% shows as 99%.

## Non-goals

- Changing how `hoursOff`, `availability` or any other existing figure is counted. They stay as they are; the public contract only gains a field.
- Showing *when* the gaps were. Coverage is an aggregate.
- Backfilling pauses from before this ships (see decision 3).

## Anti-goals

- Revealing how an outage was recorded. Coverage is one number per window and never names the sensor. The dictionaries test already bans the words.
- Layout shift, or horizontal scroll at 320px.
- Overclaiming: time we cannot vouch for never counts as measured.

## Decisions

1. **What counts as not measured.** The union of:
   - every pause, from when it was set to when it ended (its `until`, or a resume, whichever came first);
   - every outage with `source = 'sensor'` that is a false positive, whoever dismissed it. The sensor was silent, and the power turned out to be on, so for that time nothing was measuring.

   A pause counts in full even if the operator punched out by hand during it. Nothing watched for the whole pause, so a short dip could have passed unrecorded, and the punch clock records only what someone noticed. A sensor outage that is open or confirmed is *measured*: silence while the power is off is the measurement.

2. **Where it shows, and when.** The API always carries the figure. The page shows it only below `COVERAGE_NOTE_BELOW` (0.95, in `src/components/Trends.tsx`). The operator asked for this after review: the sensor is a laptop that is sometimes paused or asleep, so an always-on figure would draw attention to every routine gap, while one shown only when it is low tells residents exactly when the figures deserve less weight. It is appended to the statistics subtitle as a short sentence: "Last 30 days. 96% measured." / "Afgelope 30 dae. 96% gemeet." The subtitle line already exists in the loading shell, and the addition is short enough to stay on one line at 320px in both languages, so nothing moves. An e2e test checks that it stays one line. It is not a tile, because a fifth tile would change the grid, nor a tile note, because the notes belong to their tiles' figures.

3. **No history before this ships.** Pauses are not recorded anywhere today; `heartbeats.paused_until` keeps only the current one. Coverage is therefore computed only for windows that begin on or after a new config value, `site.coverageSince`. For this deployment that is the day it deploys. For a fork it equals `trackingSince`, so coverage is available from day one. A window that starts earlier gets `coverage: null` and the card shows nothing. For this site, the last 30 days get a figure about 30 days after release, and the last 7 days after a week. Guessing those earlier days as measured would be exactly the overclaim this feature exists to remove.

4. **Rounding.** `coverage` is a 0–1 share to four decimals, like `availability`, rounded down at the fourth decimal. The card floors it to a whole percent.

5. **Wording.** "measured" / "gemeet", the plain word for what the figure is. "How we measure" gets one more bullet: "‘Measured’ is the share of the period with a live reading; time without one counts as neither on nor off." In Afrikaans: "‘Gemeet’ is die deel van die tydperk met ’n lewendige lesing; tyd sonder een tel as nóg aan nóg af."

## Design

### Data

A new table, generated with `npm run db:generate`:

```ts
export const sensorPauses = sqliteTable('sensor_pauses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** ISO 8601 UTC, when the pause was set. */
  startTime: text('start_time').notNull(),
  /** When it ends or ended: its `until`, moved earlier by a resume or later by a longer pause. */
  endTime: text('end_time').notNull(),
});
```

The migration only adds a table, so it works with both the old and the new code (`deploy:ci` migrates first). It holds no visitor data.

### Writes

`pauseSensor` in `worker/lib/grid.ts` is the only place a pause starts or ends. The heartbeat pause route and the Telegram `/pause` and `/resume` commands both call it. It gains one more statement in the same batch:

- **Pause until `T`:** if a pause row is still running (`end_time > now`), set its `end_time = T`. Otherwise insert `(now, T)`.
- **Resume:** set the running row's `end_time = now`. If none is running, do nothing, as today.

`heartbeats.paused_until` stays the source of truth for detection; the new table is history only.

### Computation

In `worker/routes/history.ts`, the stats handler already reads outages and merges them. It also reads the pauses and the false-positive sensor outages that overlap the last 365 days, merges them with `mergeOutages` (open-ended rows cannot occur: every pause has an end), and passes the gaps to `windowStats`. That gives:

```
start    = max(from, trackingSince)
coverage = start < coverageSince ? null : floor4(1 - overlap(gaps, start, to) / (to - start))
```

`windowStats` gains an optional `gaps` argument, and `coverage` is computed only when `coverageSince` is passed. Weekly entries do not get it.

### API

`WindowStats.coverage: number | null`, documented in the README API table: "the share of the window with a live reading (0–1, rounded down to four decimals), or `null` for a window that starts before such readings were recorded." `StatsResponse` gains `coverageSince` (ISO), like `trackingSince`. Bruno asserts both keys.

### Page

`Trends.tsx` appends `t().trends.measured(percent)` to the subtitle when `s().coverage !== null`, where `percent = Math.floor(coverage * 100)`. Copy in both dictionaries, with a coupling note to the README wording. Shell and skeleton need no change, since the subtitle line already exists there.

## Testing (tests first)

- `test/stats.test.ts`, `windowStats`:
  - coverage with no gaps is 1;
  - a pause and an overlapping false-positive sensor outage count once;
  - gaps are clipped to the window;
  - it is `null` when the window starts before `coverageSince`;
  - it rounds down (a gap of 1 ms in a day gives 0.9999, not 1).
- `test/status.test.ts` and `test/telegram-commands.test.ts`:
  - a pause inserts a row;
  - a second pause while running extends it rather than adding one;
  - a resume ends it at now;
  - a resume when not paused writes nothing.
- `GET /api/stats` (worker): a false positive with `source = 'manual'` does not count as a gap; one with `source = 'sensor'` does. Shape test gains `coverage` and `coverageSince`.
- e2e, both languages: the subtitle shows the measured sentence when `coverage` is set, and nothing when it is `null`. At 320px the subtitle is one line.

## Docs

- README: the API table, `coverageSince` in the `site.config.ts` field table, and one sentence under Statistics on what "measured" means.
- `privacy.html` needs no change: the table holds the operator's device pauses, not visitor data.
- `llms.txt`: add coverage to the statistics line.

## Rollout

One PR. Set `coverageSince` to the deploy date in the same PR. Run `npm run db:migrate:local` and the tests. Merging migrates first, then deploys.
