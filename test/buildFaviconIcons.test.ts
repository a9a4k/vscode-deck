import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { buildFaviconIcons } from '../src/bookmark/buildFaviconIcons';
import { FAVICON_CANVAS_SIZE } from '../src/bookmark/faviconSilhouette';

const FIXTURES = join(__dirname, '../prototypes/bookmark-row-icon-label/spike-composite');

function colorsIn(pngBytes: Uint8Array): Set<string> {
  const png = PNG.sync.read(Buffer.from(pngBytes));
  const colors = new Set<string>();
  for (let offset = 0; offset < png.data.length; offset += 4) {
    if (png.data[offset + 3] === 0) continue;
    colors.add(`${png.data[offset]},${png.data[offset + 1]},${png.data[offset + 2]}`);
  }
  return colors;
}

function countInk(pngBytes: Uint8Array): number {
  const png = PNG.sync.read(Buffer.from(pngBytes));
  let count = 0;
  for (let offset = 3; offset < png.data.length; offset += 4) {
    if (png.data[offset] > 0) count += 1;
  }
  return count;
}

function inkBoundsCenterIsFilled(pngBytes: Uint8Array): boolean {
  const png = PNG.sync.read(Buffer.from(pngBytes));
  let left = png.width;
  let top = png.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[(y * png.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const centerX = Math.round((left + right) / 2);
  const centerY = Math.round((top + bottom) / 2);
  return png.data[(centerY * png.width + centerX) * 4 + 3] > 0;
}

describe('buildFaviconIcons', () => {
  it('builds light and dark flat-color PNG icons from a real transparent favicon', () => {
    const icons = buildFaviconIcons(readFileSync(join(FIXTURES, 'github-raw.png')));

    expect(icons).toBeDefined();
    const light = PNG.sync.read(icons!.light);
    const dark = PNG.sync.read(icons!.dark);
    expect([light.width, light.height]).toEqual([FAVICON_CANVAS_SIZE, FAVICON_CANVAS_SIZE]);
    expect([dark.width, dark.height]).toEqual([FAVICON_CANVAS_SIZE, FAVICON_CANVAS_SIZE]);
    expect([...colorsIn(icons!.light)]).toEqual(['66,66,66']);
    expect([...colorsIn(icons!.dark)]).toEqual(['197,197,198']);
  });

  it('extracts the contrast mark instead of the opaque field from a real Linear favicon', () => {
    const icons = buildFaviconIcons(readFileSync(join(FIXTURES, 'linear-raw.png')));

    expect(icons).toBeDefined();
    expect(countInk(icons!.light)).toBeGreaterThan(0);
    expect(countInk(icons!.light)).toBeLessThan(FAVICON_CANVAS_SIZE ** 2 / 2);
    expect(countInk(icons!.dark)).toBe(countInk(icons!.light));
  });

  it('builds a solid glyph without a corner frame from a real multi-frame Notion favicon', () => {
    const icons = buildFaviconIcons(readFileSync(join(FIXTURES, 'notion-raw.ico')));

    expect(icons).toBeDefined();
    expect(inkBoundsCenterIsFilled(icons!.light)).toBe(true);
    expect(inkBoundsCenterIsFilled(icons!.dark)).toBe(true);
  });
});
