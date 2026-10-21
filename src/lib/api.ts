import {
  type AdminOutagesResponse,
  MINUTE_MS,
  OUTAGE_ACTION,
  type OutagesResponse,
  POWER_STATUSES,
  type PowerStatus,
  type StatsResponse,
  type StatusResponse,
  type TimerAction,
} from '../../shared/api';
import {
  ADMIN_OUTAGES_PATH,
  CONTACT_PATH,
  LOGIN_PATH,
  LOGOUT_PATH,
  OUTAGES_PATH,
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

/** A 2xx whose body is not what the app expects, such as a captive portal's page. */
const INVALID_RESPONSE = 'invalid_response';

async function request<T>(
  path: string,
  init?: RequestInit,
  valid: (body: unknown) => boolean = () => true,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `http_${res.status}`);
  if (body === undefined || !valid(body)) throw new ApiError(res.status, INVALID_RESPONSE);
  return body as T;
}

// Just enough shape to render: anything else is treated like a failed request, not drawn as a reading.
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStatus = (b: unknown) =>
  isRecord(b) &&
  POWER_STATUSES.includes(b.status as PowerStatus) &&
  Array.isArray(b.recent) &&
  b.recent.every(isRecord);
const isOutages = (b: unknown) => isRecord(b) && Array.isArray(b.outages) && b.outages.every(isRecord);
const isStats = (b: unknown) =>
  isRecord(b) && typeof b.trackingSince === 'string' && isRecord(b.last30) && Array.isArray(b.weeks);

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/** The app's calls to the Worker; each rejects with ApiError on a non-2xx reply. */
export const api = {
  status: () => request<StatusResponse>(STATUS_PATH, undefined, isStatus),
  stats: () => request<StatsResponse>(STATS_PATH, undefined, isStats),
  allOutages: () => request<OutagesResponse>(OUTAGES_PATH, undefined, isOutages),
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
