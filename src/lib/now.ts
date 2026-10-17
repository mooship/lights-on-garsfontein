import { type Accessor, createSignal, onCleanup } from 'solid-js';

/** A clock signal that ticks every `intervalMs` while the owning component is mounted. */
export function useNow(intervalMs: number): Accessor<number> {
  const [now, setNow] = createSignal(Date.now());
  const timer = setInterval(() => setNow(Date.now()), intervalMs);
  onCleanup(() => clearInterval(timer));
  return now;
}
