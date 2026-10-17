import type {
  AdminOutagesResponse,
  ConfirmResponse,
  StatsResponse,
  StatusResponse,
  StillOffResponse,
  TimerAction,
} from '../../shared/api';

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
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  status: () => request<StatusResponse>('/api/status'),
  stats: () => request<StatsResponse>('/api/stats'),
  confirm: (token: string, outageId: number) => post<ConfirmResponse>('/api/confirm', { token, outageId }),
  stillOff: (token: string) => post<StillOffResponse>('/api/still-off', { token }),
  login: (username: string, password: string, token: string) =>
    post<{ ok: true }>('/api/admin/login', { username, password, token }),
  logout: () => post<{ ok: true }>('/api/admin/logout'),
  outages: () => request<AdminOutagesResponse>('/api/admin/outages'),
  punch: (action: TimerAction) => post('/api/admin/timer', { action }),
  createOutage: (startTime: string, endTime: string | null, isPlanned: boolean) =>
    post('/api/admin/outages', { action: 'create', startTime, endTime, isPlanned }),
  updateOutage: (id: number, changes: { endTime?: string | null; isFalsePositive?: boolean; isPlanned?: boolean }) =>
    post('/api/admin/outages', { action: 'update', id, ...changes }),
  deleteOutage: (id: number) => post('/api/admin/outages', { action: 'delete', id }),
};
