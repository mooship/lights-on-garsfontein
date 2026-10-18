# Who dismissed a false positive: design

18 October 2026. One of the improvements Claude proposed and the operator liked ("I like all these"), built while they were away with no questions taken, so the choices are Claude's.

## Intent

Since the sensor can dismiss an outage itself (a heartbeat's `poweredFor` shows the power stayed on), admin shows those the same way as outages the operator dismissed by hand. The operator cannot see what the automatic dismissal decided, so they cannot check that it decides well.

## Behaviour

- A nullable `outages.dismissed_by` column, `'sensor'` or `'admin'` (`DISMISSED_BY` in `shared/api.ts`), added by a generated migration: one `ADD` of a nullable column, which works with the old code and the new.
- The heartbeat that dismisses an outage sets `'sensor'`. Marking a false positive in admin sets `'admin'`; unmarking sets `null`.
- `GET /api/admin/outages` adds `dismissedBy` to each outage. Admin only: public responses do not change, since they must not reveal how an outage was recorded.
- `/admin` tags an outage the sensor dismissed "false positive (the sensor had power throughout)" instead of plain "false positive".
- False positives marked before this change keep `null` and the plain tag. They are not backfilled, because nothing records who marked them.

## Non-goals

- Public changes of any kind.
- Undo or audit history beyond the latest mark.
