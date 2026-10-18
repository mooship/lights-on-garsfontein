import type { Routes } from '../lib/router';
import { adminRoutes } from './admin';
import { authRoutes } from './auth';
import { contactRoutes } from './contact';
import { historyRoutes } from './history';
import { seoRoutes } from './seo';
import { statusRoutes } from './status';

/** Every Worker endpoint. To add one, see README, "Adding an endpoint". */
export const routes: Routes = {
  ...statusRoutes,
  ...historyRoutes,
  ...authRoutes,
  ...adminRoutes,
  ...seoRoutes,
  ...contactRoutes,
};
