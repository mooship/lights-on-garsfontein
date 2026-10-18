import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** A value from .dev.vars.example, which playwright.config.ts gives the e2e server as .dev.vars.e2e. */
export function exampleVar(name: string): string {
  const file = readFileSync(resolve(import.meta.dirname, '../.dev.vars.example'), 'utf8');
  const value = new RegExp(`^${name}="([^"\\s]+)"`, 'm').exec(file)?.[1];
  if (!value) throw new Error(`.dev.vars.example has no ${name}`);
  return value;
}
