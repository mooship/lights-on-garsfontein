import {
  type AdminOutagesResponse,
  OUTAGE_ACTION,
  type StatsResponse,
  type StatusResponse,
  type TimerAction,
} from '../../shared/api';
import { ADMIN_OUTAGES_PATH, LOGIN_PATH, LOGOUT_PATH, STATS_PATH, STATUS_PATH, TIMER_PATH } from '../../shared/paths';
import { FROM_CACHE_HEADER } from '../sw/strategy';

/** A status, flagged when the service worker answered from its cache because the network failed. */
export type Status = StatusResponse & { fromCache?: true };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `http_${res.status}`);
  return (res.headers.has(FROM_CACHE_HEADER) ? { ...body, fromCache: true } : body) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  status: () => request<Status>(STATUS_PATH),
  stats: () => request<StatsResponse>(STATS_PATH),
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
