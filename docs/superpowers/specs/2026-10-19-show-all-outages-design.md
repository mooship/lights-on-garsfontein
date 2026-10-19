# Show all outages, with pages: design

**Status:** asked for in chat on 19 October 2026 ("Lets add 'Show all' and pagination"). The operator then asked for it to be built with no questions, so the details below are Claude's calls.

## Intent

The public page lists only the five latest outages; anything older is only in the CSV. The operator plans to share the site widely once a few outages are on record, and residents will want to look back ("how often was it off last month?") without opening a spreadsheet.

## Goals

- A "Show all outages" button under the recent outages, once there are more than fit there.
- Every outage (false positives excluded) in pages of ten, newest first, with Newer and Older buttons and "Page 1 of 3".
- A way back to the recent list.
- Both languages; usable by keyboard and screen reader; no horizontal scroll at 320px.

## Non-goals

- A separate page or URL per page of history. In-card is far less code (no new static page, shell, CSP hash or sitemap entry).
- Filters, search or date jumps.

## Anti-goals

- Layout shift while loading: the button appears below the last list on the page, after data arrives, like the list's own length does today; the e2e layout-shift tests must still read zero.
- Showing an ended outage as ongoing: the full list reloads whenever the recent outages change.
- Revealing how outages were recorded.

## Behaviour

- **API.** `GET /api/outages` (`OUTAGES_PATH`) returns `{ outages, generatedAt }`: every outage except false positives, newest first, each as in `/api/status` (`id`, `startTime`, `endTime`, `planned`). The whole list in one response, as the CSV already is (about 80 bytes an outage), so it can be edge-cached like the other views; query-string pages could not be, as the edge cache key ignores the query. Browsers get `no-store` and the edge holds it for `STATUS_EDGE_TTL_SECONDS`, like the status it extends, since the page reloads it when the status changes and a browser copy would bring back the old list; `limiter: 'STATUS_LIMITER'`, `cors: true`, and in `OUTAGE_VIEWS` so writes purge it. README API table, `llms.txt` and a Bruno request document it.
- **When the button shows.** When `recent` holds `RECENT_LIMIT` outages (moved to `shared/api.ts`), since there may be more. With exactly that many on record, the full list is one page; that costs nothing.
- **Expanded.** The heading becomes "All outages" and the focus moves to the pager; the list shows page 1; under it, Newer / "Page 1 of 3" / Older, then "Show recent only". The page label is a live region, so a screen reader hears the new page. Newer and Older are `aria-disabled` at the ends, keeping focus. "Show recent only" returns focus to "Show all outages".
- **Loading and failure.** While the list loads, the button reads "Loading…" and stays put; a failure shows `history.failed` with the button as a retry. A failed reload of the open list keeps it and shows the same line; closing the list drops a reload still on its way.
- **Freshness.** While expanded, a change in the recent outages (a new one, an end time, a planned flag) reloads the list, and an ongoing outage's duration ticks as in the recent list.
- **Rows** are the recent list's rows (`OutageHistory`), unchanged.

## Calls Claude made

- Ten a page; client-side pages over one cached response.
- `RECENT_LIMIT` as the trigger instead of a new count field in `/api/status`.
