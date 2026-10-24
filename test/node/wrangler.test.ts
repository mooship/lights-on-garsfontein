import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { API_PREFIX, WORKER_PAGES } from '../../shared/paths';

/** The top-level `assets.run_worker_first` of a Wrangler config. */
function runWorkerFirst(file: string): string[] {
  const toml = readFileSync(resolve(import.meta.dirname, '../..', file), 'utf8');
  const list = toml.match(/^run_worker_first = \[(.*)\]$/m)?.[1];
  if (list === undefined) throw new Error(`no run_worker_first in ${file}`);
  // A TOML array of basic strings is valid JSON.
  return JSON.parse(`[${list}]`) as string[];
}

// A Worker page missing here is answered by the asset server (404) instead of its route.
it.each(['wrangler.toml', 'wrangler.example.toml'])('%s sends the API and every Worker page to the Worker', (file) => {
  expect(runWorkerFirst(file).sort()).toEqual([`${API_PREFIX}*`, ...WORKER_PAGES].sort());
});
