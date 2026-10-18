import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('schema', () => {
  it('no longer has the resident report tables, which stored connection fingerprints', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('outage_confirmations', 'still_off_reports')",
    ).all<{ name: string }>();
    expect(results).toEqual([]);
  });
});
