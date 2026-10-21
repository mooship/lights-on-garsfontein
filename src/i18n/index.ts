import type { Locale } from '../../site.config.ts';
import { af, type Messages } from './af.ts';
import { en } from './en.ts';

/** One dictionary per entry in `site.locales`: to add a language, add its file and list it here. */
export const DICTIONARIES: Record<Locale, Messages> = { af, en };
