import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import { MINUTE_MS } from '../../shared/api';

/** A clock signal that ticks every `intervalMs` while the owning component is mounted. */
export function useNow(intervalMs: number): Accessor<number> {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), intervalMs);
  onCleanup(() => clearInterval(timer));
  return now;
}

/** `now` floored to the minute, so text that only changes by the minute re-renders once a minute. */
export function useMinute(now: Accessor<number>): Accessor<number> {
  return createMemo(() => Math.floor(now() / MINUTE_MS) * MINUTE_MS);
}
