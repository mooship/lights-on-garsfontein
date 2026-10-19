import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, pageOf } from '../../src/lib/pages';

const items = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('pageOf', () => {
  it('splits a list into pages of PAGE_SIZE, the last one holding the rest', () => {
    expect(pageOf(items(PAGE_SIZE + 2), 0)).toEqual({ items: items(PAGE_SIZE), index: 0, count: 2 });
    expect(pageOf(items(PAGE_SIZE + 2), 1)).toEqual({ items: [PAGE_SIZE, PAGE_SIZE + 1], index: 1, count: 2 });
  });

  it('keeps the index on a page that exists when the list shrinks', () => {
    expect(pageOf(items(3), 4)).toEqual({ items: items(3), index: 0, count: 1 });
    expect(pageOf(items(PAGE_SIZE + 1), -1).index).toBe(0);
  });

  it('has one empty page for an empty list', () => {
    expect(pageOf([], 0)).toEqual({ items: [], index: 0, count: 1 });
  });
});
