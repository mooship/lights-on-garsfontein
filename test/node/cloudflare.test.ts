import { expect, it } from 'vitest';
import config from '../../cloudflare.config';
import { LOCALES, localePath } from '../../shared/locale';
import { API_PREFIX, WORKER_PAGES } from '../../shared/paths';

it.each([undefined, 'e2e'])('mode %s sends the API and every Worker page to the Worker', async (mode) => {
  const resolved = await config({ mode, isPreview: false });
  const localePages = LOCALES.map(localePath)
    .filter((path) => path !== '/')
    .flatMap((path) => [path, path.slice(0, -1)]);
  expect(resolved.worker.assets.runWorkerFirst.sort()).toEqual(
    [`${API_PREFIX}*`, '/admin', ...WORKER_PAGES, ...localePages].sort(),
  );
});
