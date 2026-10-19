/** Outages on each page of the full history. */
export const PAGE_SIZE = 10;

/** Page `index` of `list` (0 is the first), clamped to a page that exists; an empty list has one empty page. */
export function pageOf<T>(list: readonly T[], index: number): { items: T[]; index: number; count: number } {
  const count = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const clamped = Math.min(Math.max(0, index), count - 1);
  return { items: list.slice(clamped * PAGE_SIZE, (clamped + 1) * PAGE_SIZE), index: clamped, count };
}
