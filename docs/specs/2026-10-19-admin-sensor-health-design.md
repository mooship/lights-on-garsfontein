# Sensor health in admin: design

**Status:** approved in chat on 19 October 2026 ("This sounds good"). The operator then asked for the rest to be built with no questions, so the details below are Claude's calls.

## Intent

The live sensor is a MacBook. It goes quiet when the lid closes, when it restarts to the login screen, or when it leaves home without `lights-on pause`, and each of these logs a false outage. `/admin` shows nothing about the sensor, so the operator finds out only from the public page. A line in admin that says whether the sensor is reporting, paused or silent lets them notice and fix it quickly.

## Goals

- `/admin` shows the sensor's state under the punch clock: reporting, paused, silent, or never reported.
- The line stays current without a reload.

## Non-goals

- Alerts (the Telegram alerts are on hold at the operator's request).
- Recording `poweredFor` or any heartbeat history.
- Any public change. Admin is allowed to name the sensor; public copy and the public API are not.

## Behaviour

- **API.** `GET /api/admin/outages` adds `sensor`: `{ lastSeen, pausedUntil }` (ISO 8601 UTC; `pausedUntil` null when never paused) from the single `heartbeats` row, or `null` before the first heartbeat. Only a field is added. The README and the Bruno `admin/list` request document it.
- **State**, worked out in the app from `HEARTBEAT_THRESHOLD_MS` (one home for the rule), as of when the list last arrived:
  - no row: "No sensor has reported yet."
  - `pausedUntil` in the future: "Paused until 18:00 today."
  - last heartbeat within the threshold: "Reporting. Last heard at 17:42 today."
  - otherwise: "Silent for 12 min, since 17:30 today." in the warning colour.
- **Refresh.** The dashboard reloads the outage list every `POLL_MS` while the tab is visible, and when it becomes visible again, so the line and the list stay current. A 401 ends the session as an action's would. Any other failure keeps the last data and adds "Unable to refresh. Showing the sensor as at 17:40." The state is judged as of the last successful load, so a lost admin connection is never shown as a silent sensor.
- **Copy** goes in `src/admin/copy.ts` (English only).

## Calls Claude made

- Placement under the punch clock, not a card of its own: it is one line and belongs with the live state.
- Polling admin at the public page's `POLL_MS`, reusing its rule rather than adding a second interval.
- The state logic is a pure function in `src/admin/sensor.ts`, unit-tested in Node; e2e covers rendering.
