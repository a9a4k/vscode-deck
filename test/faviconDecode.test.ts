import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFavicon } from '../src/bookmark/faviconDecode';

const FIXTURES = join(__dirname, 'fixtures/favicons');

describe('decodeFavicon', () => {
  it('sniffs and decodes real PNG bytes without a filename or content type', () => {
    const result = decodeFavicon(readFileSync(join(FIXTURES, 'github-raw.png')));

    expect(result).toBeDefined();
    expect([result!.width, result!.height]).toEqual([32, 32]);
    const alpha = result!.data.filter((_, offset) => offset % 4 === 3);
    expect(alpha.some((value) => value < 128)).toBe(true);
    expect(alpha.some((value) => value >= 128)).toBe(true);
  });

  it('sniffs a real multi-frame ICO and decodes its largest frame', () => {
    const result = decodeFavicon(readFileSync(join(FIXTURES, 'notion-raw.ico')));

    expect(result).toBeDefined();
    expect([result!.width, result!.height]).toEqual([64, 64]);
  });

  it('rejects unsupported or corrupt bytes without throwing', () => {
    expect(decodeFavicon(Buffer.from('not an image'))).toBeUndefined();
    expect(decodeFavicon(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      .toBeUndefined();
  });
});
