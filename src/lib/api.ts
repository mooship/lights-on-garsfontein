import {
  type AdminOutagesResponse,
  MINUTE_MS,
  OUTAGE_ACTION,
  type StatsResponse,
  type StatusResponse,
  type TimerAction,
} from '../../shared/api';
import {
  ADMIN_OUTAGES_PATH,
  CONTACT_PATH,
  LOGIN_PATH,
  LOGOUT_PATH,
  STATS_PATH,
  STATUS_PATH,
  TIMER_PATH,
} from '../../shared/paths';

/** A non-2xx reply: `code` is the body's ErrorCode, or `http_<status>` when it has none. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** A request that hangs, as on a failing mobile connection, fails after this so the page can say so. */
export const REQUEST_TIMEOUT_MS = MINUTE_MS / 4;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `http_${res.status}`);
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/** The app's calls to the Worker; each rejects with ApiError on a non-2xx reply. */
export const api = {
  status: () => request<StatusResponse>(STATUS_PATH),
  stats: () => request<StatsResponse>(STATS_PATH),
  contact: (token: string) => post<{ email: string }>(CONTACT_PATH, { token }),
  login: (username: string, password: string, token: string) =>
    post<{ ok: true }>(LOGIN_PATH, { username, password, token }),
  logout: () => post<{ ok: true }>(LOGOUT_PATH),
  outages: () => request<AdminOutagesResponse>(ADMIN_OUTAGES_PATH),
  punch: (action: TimerAction) => post(TIMER_PATH, { action }),
  createOutage: (startTime: string, endTime: string | null, isPlanned: boolean) =>
    post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.create, startTime, endTime, isPlanned }),
  updateOutage: (id: number, changes: { endTime?: string | null; isFalsePositive?: boolean; isPlanned?: boolean }) =>
    post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.update, id, ...changes }),
  deleteOutage: (id: number) => post(ADMIN_OUTAGES_PATH, { action: OUTAGE_ACTION.delete, id }),
};
