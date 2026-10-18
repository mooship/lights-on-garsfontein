import { type Accessor, batch, createSignal } from 'solid-js';

interface Poll<T> {
  /** The last successful response; kept through later failures. */
  data: Accessor<T | undefined>;
  /** The latest failure, cleared by the next success. */
  error: Accessor<unknown>;
  /** When `data` last arrived (Date.now() ms); 0 until it first does. */
  updatedAt: Accessor<number>;
  refetch: () => void;
}

/**
 * Polled data that never throws on read, unlike a Solid resource in error. Starts from `initial`
 * (the request index.tsx already sent) and ignores responses that arrive out of order.
 */
export function createPoll<T>(initial: Promise<T>, fetcher: () => Promise<T>): Poll<T> {
  const [data, setData] = createSignal<T>();
  const [error, setError] = createSignal<unknown>();
  const [updatedAt, setUpdatedAt] = createSignal(0);
  let latest = 0;
  const load = (request: Promise<T>) => {
    const id = ++latest;
    request.then(
      (value) =>
        id === latest &&
        batch(() => {
          setData(() => value);
          setError(undefined);
          setUpdatedAt(Date.now());
        }),
      (e) => id === latest && setError(() => e ?? new Error('failed')),
    );
  };
  load(initial);
  return { data, error, updatedAt, refetch: () => load(fetcher()) };
}
