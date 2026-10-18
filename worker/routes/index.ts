import type { Routes } from '../lib/router';
import { adminRoutes } from './admin';
import { authRoutes } from './auth';
import { contactRoutes } from './contact';
import { historyRoutes } from './history';
import { seoRoutes } from './seo';
import { statusRoutes } from './status';

/**
 * Every Worker endpoint. Adding one means: its path in shared/paths.ts, its handler in a file
 * under routes/, its route map spread here and, if it is outside API_PREFIX, the path in
 * WORKER_PAGES and in wrangler's `assets.run_worker_first`.
 */
export const routes: Routes = {
  ...statusRoutes,
  ...historyRoutes,
  ...authRoutes,
  ...adminRoutes,
  ...seoRoutes,
  ...contactRoutes,
};
