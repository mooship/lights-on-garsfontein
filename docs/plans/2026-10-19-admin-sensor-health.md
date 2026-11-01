# Sensor health in admin: plan

Design: [specs/2026-10-19-admin-sensor-health-design.md](../specs/2026-10-19-admin-sensor-health-design.md).

1. **API field.** Test first in `test/admin.test.ts`: `sensor` is null before a heartbeat, then carries `lastSeen` and `pausedUntil`. Add `SensorReading` and `sensor` to `AdminOutagesResponse` (`shared/api.ts`), read the heartbeat row in `listOutages` (`worker/routes/admin.ts`) in one batch with the list.
2. **State function.** Test first in `test/node/sensor.test.ts`: never, paused, reporting (at the threshold), silent (just past it). Write `sensorState` in `src/admin/sensor.ts`.
3. **Admin line and refresh.** e2e first in `e2e/app.spec.ts`: with the list mocked, the dashboard shows the silent and reporting lines, and a failed refresh shows the warning. Add the copy to `src/admin/copy.ts`, the line under the punch clock and the `POLL_MS` reload in `src/admin/Admin.tsx`.
4. **Docs.** README admin section and API notes; Bruno `admin/list.bru` keys.
5. **Definition of done** from AGENTS.md, then the pull request.
