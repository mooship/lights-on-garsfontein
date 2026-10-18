import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('favicon.ico holds a 16, 32 and 48 px image, each drawn at its own size', () => {
  const ico = readFileSync(resolve(import.meta.dirname, '../../public/favicon.ico'));
  const entries = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const entry = 6 + i * 16;
    const png = ico.subarray(ico.readUInt32LE(entry + 12));
    // A PNG's IHDR chunk holds its width and height at bytes 16 and 20.
    return { listed: ico.readUInt8(entry), width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  });
  expect(entries).toEqual([16, 32, 48].map((size) => ({ listed: size, width: size, height: size })));
});
