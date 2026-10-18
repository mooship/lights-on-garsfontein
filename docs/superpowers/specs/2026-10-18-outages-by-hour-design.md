# Outages by time of day: design

18 October 2026. The operator asked for a new chart or statistic and handed the choice to Claude while away ("work on your own, no questions"), so every decision below is Claude's call, made under the project's rules in AGENTS.md.

## Intent

The site is about to be shared with residents once a few outages are on record. Those residents already see how much time they spent without power and how often. They cannot see **when** outages tend to happen. "Mostly in the evenings" or "mostly overnight" is the pattern people talk about and plan around, and the data to show it already exists.

## Goals

- A second chart in the statistics card: hours without power in each hour of the day, over the same window as the tiles (the last 30 days, or since records began when that is shorter).
- It reads and works like the weekly chart: a readout line, keyboard and pointer movement between bars, and a screen reader label and announcements.
- The public API gains the figures, so others can use them too.

## Non-goals

- Day-of-week patterns, heatmaps or longer windows.
- Any change to the existing tiles or the weekly chart's behaviour.

## Anti-goals

- Layout shift. The loading shell must still match the loaded card box for box, with outages and without.
- Claiming a pattern from too little data. The chart shows plain totals, with no wording such as "outages usually happen at…".
- Revealing how outages were recorded.

## Behaviour

- **API.** `GET /api/stats` gains `last30ByHour`: 24 whole numbers, the minutes without power that fell in each clock hour of the configured zone (index 0 is 00:00 to 01:00), summed over `last30`'s window. Overlapping outages count once (`mergeOutages`), an open outage counts up to now, and time before tracking began never counts. Only fields are added, so the contract holds. The README API table and `templates/llms.txt` mention it.
- **Chart.** It sits below the weekly chart and has the same height. Its title names its window, which differs from the weekly chart's 26 weeks: "When outages happen (last 30 days)" / "Wanneer onderbrekings voorkom (afgelope 30 dae)". When the 30 days had no outages but the weeks did, the readout says so ("No outages in the last 30 days.") instead of opening on an empty hour. A response cached from before the field existed shows no hour chart rather than breaking the card. The bars are hours (minutes ÷ 60) on the same nice-maximum axis as the weekly chart. The x labels are "00:00" and "23:00". The readout reads "18:00–19:00: 2 h 10 min off", reusing the weekly readout's `off` word. It opens on the hour with the most time off; if several hours tie, the earliest one.
- **Shared component.** The weekly chart's SVG, readout, keyboard, pointer and announcement logic becomes one `BarChart`, and both charts use it. This is its second real use.
- **No outages.** As now, a single "No outages to chart yet." message replaces the charts. Its box takes the height of both charts, so the card keeps its size.
- **Zero layout shift.** `.gg-trends-body`'s `min-height` grows by one chart block. `index.html` and `TrendsCardSkeleton` each get a second chart placeholder. The e2e layout-shift test runs on an empty database; a second one, with an outage on record, guards the state with charts.
- **Copy.** Both languages, in `src/i18n/af.ts` and `en.ts`: the title and the chart's screen reader label. The hour range is plain digits and needs no translation.

## Constraints

- No new dependency.
- Tests first: the worker computation (unit), the API field (worker test), and the chart and layout shift (e2e, in both languages where copy is shown).
- No horizontal scroll at 320px. 24 bars in a phone-width plot gives each bar at least 2px (`barWidth` clamps at 2).

## Left open (not needed now)

- A table alternative for the hourly figures, like the weekly table. The keyboard readout and announcements make the chart usable without one.
