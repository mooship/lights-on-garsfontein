# Show all outages: plan

Design: [specs/2026-10-19-show-all-outages-design.md](../specs/2026-10-19-show-all-outages-design.md).

1. **Endpoint.** Test first in `test/stats.test.ts`: `GET /api/outages` lists every outage but false positives, newest first, in the public shape, with `max-age=60` and CORS. Add `OUTAGES_PATH` and put it in `OUTAGE_VIEWS` (`shared/paths.ts`), `OutagesResponse` and `RECENT_LIMIT` in `shared/api.ts`, and the handler and route in `worker/routes/history.ts`. `test/edge-cache.test.ts` then covers the purge.
2. **Client.** `api.allOutages` in `src/lib/api.ts`, with a shape check like the others.
3. **UI.** e2e first in `e2e/app.spec.ts`, in both languages: with more than `RECENT_LIMIT` outages, "Show all" pages through them, the ends are disabled, "Show recent only" returns; with fewer, no button. Copy in `src/i18n/af.ts` and `en.ts`; the card in `src/components/OutageHistory.tsx`, used from `src/App.tsx`.
4. **Docs.** README API table, `templates/llms.txt`, `bruno/public/outages.bru`.
5. **Definition of done** from AGENTS.md, then the pull request.
