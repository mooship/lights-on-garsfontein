# Outages by time of day: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second statistics chart, showing hours without power in each hour of the day over the last 30 days.

**Architecture:** The Worker computes 24 per-hour minute totals from the merged outage intervals that `/api/stats` already builds, and returns them as `last30ByHour`. In the app, the weekly chart's SVG, readout, keyboard and pointer code becomes a generic `BarChart` that both charts use. The loading shell gains a second chart placeholder, and `.gg-trends-body` grows by one chart block.

**Tech stack:** Cloudflare Worker with D1, SolidJS, vanilla-extract, Vitest (workerd), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-outages-by-hour-design.md`

## Global constraints

- AGENTS.md applies throughout: tests first; both languages; zero layout shift; no horizontal scroll at 320px; public contracts only gain fields; no recording method in public copy.
- `last30ByHour`: exactly 24 whole numbers (minutes), index 0 = 00:00–01:00 in `site.timeZone` (fixed offset `UTC_OFFSET_MS`).
- Copy keys: `trends.byHourTitle`, `trends.byHourLabel` in `af.ts` and `en.ts`.

## Review focus

1. An outage crossing local midnight, or crossing the 30-day window edge, splits into the right buckets.
2. Overlapping outage records count once (use the merged intervals).
3. The weekly chart behaves exactly as before after the refactor (existing e2e tests).
4. Zero layout shift in both states: empty database, and with an outage on record.
5. 24 bars at 320px: no horizontal scroll, and the bars stay visible.

## Task 1: the API field

**Files:** `worker/lib/stats.ts`, `worker/routes/history.ts`, `shared/api.ts`, `test/stats.test.ts`, `README.md`, `templates/llms.txt`, `bruno/public/stats.bru`.

- [ ] Write failing unit tests for `hourlyMinutes(intervals, from, to, trackingSince): number[]`:
  - local 17:30–19:15 gives `[17] = 30`, `[18] = 60`, `[19] = 15`, and 0 elsewhere;
  - local 23:30–00:30 splits 30 and 30 across `[23]` and `[0]`;
  - time before `trackingSince` or `from` is not counted;
  - the result always has length 24.
- [ ] Write a failing worker test: `GET /api/stats` returns `last30ByHour` with 24 entries, counting an inserted outage and leaving out false positives.
- [ ] Run them and see them fail.
- [ ] Implement `hourlyMinutes`. Walk each clipped interval across local hour boundaries and add whole milliseconds; round to minutes at the end.
- [ ] Add `last30ByHour` to `StatsResponse`, with one line of JSDoc, and fill it in `getStats` over `last30`'s window.
- [ ] Run the tests and see them pass. Update the README API table row for `/api/stats`, `templates/llms.txt` and the Bruno shape test.
- [ ] Commit.

## Task 2: the chart

**Files:** `src/components/Trends.tsx`, `src/components/Trends.css.ts`, `src/i18n/af.ts`, `src/i18n/en.ts`, `src/styles/global.css.ts`, `index.html`, `src/components/Skeletons.tsx`, `e2e/app.spec.ts`.

- [ ] Write failing e2e tests:
  - with an outage on record, the hour chart's title (from the dictionaries) is visible, the readout shows the peak hour, and ArrowRight moves the readout to the next hour (in `en`, plus a smoke check in `af`);
  - zero cumulative layout shift while loading, with an outage on record.
- [ ] Run them and see them fail.
- [ ] Extract `BarChart` (props: `title`, `label`, `values` in hours, `readout(index)` giving `{ lead, value, rest }`, `initial` index, `xLabels: [string, string]`). Port `WeeklyChart` to it with no change in behaviour.
- [ ] Add the hourly chart below the weekly one. It opens on the earliest hour with the most minutes, and its readout reads `HH:00–HH+1:00: <duration> off`.
- [ ] Copy: `byHourTitle` and `byHourLabel` in both dictionaries.
- [ ] Layout: grow `.gg-trends-body`'s `min-height` by one chart block on phones; give the empty-state box the height of both charts; add a second `gg-skel gg-skel-chart` in `index.html` and `TrendsCardSkeleton`.
- [ ] Run lint, typecheck, build, `CHECK_DIST=1 npm test` and `test:e2e`; all must pass.
- [ ] Commit.
