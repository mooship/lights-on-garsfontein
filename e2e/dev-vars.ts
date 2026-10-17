import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A value from .dev.vars.example. playwright.config.ts passes the ones the tests rely on to the
 * server with --var, which beats a developer's own .dev.vars.
 */
export function exampleVar(name: string): string {
  const file = readFileSync(resolve(import.meta.dirname, '../.dev.vars.example'), 'utf8');
  const value = new RegExp(`^${name}="([^"\\s]+)"`, 'm').exec(file)?.[1];
  if (!value) throw new Error(`.dev.vars.example has no ${name}`);
  return value;
}
