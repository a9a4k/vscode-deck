import { describe, expect, it } from 'vitest';
import {
  FAVICON_ALGORITHM_VERSION,
  FAVICON_CANVAS_SIZE,
  createFaviconSilhouette,
  type RgbaImage,
} from '../src/bookmark/faviconSilhouette';

describe('favicon silhouette algorithm', () => {
  it('exposes the output version used to invalidate generated icons', () => {
    expect(FAVICON_ALGORITHM_VERSION).toBe(2);
  });
});

function image(width: number, height: number, pixels: number[]): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(pixels) };
}

function inkBounds(icon: RgbaImage): { left: number; top: number; width: number; height: number } {
  let left = icon.width;
  let top = icon.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < icon.height; y += 1) {
    for (let x = 0; x < icon.width; x += 1) {
      if (icon.data[(y * icon.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function inkSize(icon: RgbaImage): { width: number; height: number } {
  const { width, height } = inkBounds(icon);
  return { width, height };
}

describe('createFaviconSilhouette', () => {
  it('turns a transparent-background mark into a flat-color icon', () => {
    const transparentMark = image(3, 3, [
      255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0,
      255, 0, 0, 0, 10, 20, 30, 255, 255, 0, 0, 0,
      255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0,
    ]);

    const result = createFaviconSilhouette(transparentMark, [66, 66, 66, 255]);

    expect(result.width).toBe(FAVICON_CANVAS_SIZE);
    expect(result.height).toBe(FAVICON_CANVAS_SIZE);
    const colors = new Set<string>();
    let inkPixels = 0;
    for (let offset = 0; offset < result.data.length; offset += 4) {
      if (result.data[offset + 3] === 0) continue;
      inkPixels += 1;
      colors.add(`${result.data[offset]},${result.data[offset + 1]},${result.data[offset + 2]}`);
    }
    expect(inkPixels).toBeGreaterThan(0);
    expect([...colors]).toEqual(['66,66,66']);
  });

  it('drops mostly transparent edge pixels from an alpha-based shape', () => {
    const transparentMark = image(3, 3, [
      255, 0, 0, 20, 255, 0, 0, 20, 255, 0, 0, 20,
      255, 0, 0, 20, 10, 20, 30, 255, 255, 0, 0, 20,
      255, 0, 0, 20, 255, 0, 0, 20, 255, 0, 0, 20,
    ]);

    const result = createFaviconSilhouette(transparentMark, [66, 66, 66, 255]);
    const nonzeroAlpha = result.data.filter((_, offset) => offset % 4 === 3 && result.data[offset] > 0);

    expect(Math.min(...nonzeroAlpha)).toBe(255);
  });

  it('extracts a luminance-contrast mark from an opaque background', () => {
    const opaqueContrastMark = image(4, 4, [
      240, 240, 240, 255, 240, 240, 240, 255, 240, 240, 240, 255, 240, 240, 240, 255,
      240, 240, 240, 255, 10, 10, 10, 255, 240, 240, 240, 255, 240, 240, 240, 255,
      240, 240, 240, 255, 10, 10, 10, 255, 240, 240, 240, 255, 240, 240, 240, 255,
      240, 240, 240, 255, 240, 240, 240, 255, 240, 240, 240, 255, 240, 240, 240, 255,
    ]);

    const result = createFaviconSilhouette(opaqueContrastMark, [66, 66, 66, 255]);

    expect(inkSize(result)).toEqual({ width: 11, height: 22 });
  });

  it('does not turn near-transparent edge color into a frame around a contrast mark', () => {
    const pixels = Array.from({ length: 16 * 16 }, () => [20, 20, 20, 255]).flat();
    for (let y = 5; y < 11; y += 1) {
      for (let x = 5; x < 11; x += 1) {
        const offset = (y * 16 + x) * 4;
        pixels.splice(offset, 4, 230, 230, 230, 255);
      }
    }
    pixels.splice(0, 4, 230, 230, 230, 20);

    const result = createFaviconSilhouette(image(16, 16, pixels), [66, 66, 66, 255]);

    expect(inkSize(result)).toEqual({ width: 22, height: 22 });
    expect(result.data[(16 * FAVICON_CANVAS_SIZE + 19) * 4 + 3]).toBeGreaterThan(0);
  });

  it('does not let near-transparent color change which contrast class is the mark', () => {
    const contrastMark = image(5, 2, [
      230, 230, 230, 20, 20, 20, 20, 255, 20, 20, 20, 255, 20, 20, 20, 255, 230, 230, 230, 255,
      20, 20, 20, 255, 20, 20, 20, 255, 230, 230, 230, 255, 230, 230, 230, 255, 230, 230, 230, 255,
    ]);

    const result = createFaviconSilhouette(contrastMark, [66, 66, 66, 255]);

    expect(inkSize(result)).toEqual({ width: 22, height: 15 });
  });

  it('smoothly scales the extracted shape instead of producing jagged nearest-neighbor edges', () => {
    const antialiasedMark = image(4, 3, [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 20, 20, 20, 255, 20, 20, 20, 128, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);

    const result = createFaviconSilhouette(antialiasedMark, [66, 66, 66, 255]);
    const nonzeroAlpha = new Set<number>();
    for (let offset = 3; offset < result.data.length; offset += 4) {
      if (result.data[offset] > 0) nonzeroAlpha.add(result.data[offset]);
    }

    expect(nonzeroAlpha.size).toBeGreaterThan(2);
  });

  it('matches the Terminal glyph scale and right-shifted tree midline', () => {
    const rectangularMark = image(4, 3, [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 10, 10, 10, 255, 10, 10, 10, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);

    const result = createFaviconSilhouette(rectangularMark, [66, 66, 66, 255]);

    expect(inkBounds(result)).toEqual({ left: 8, top: 11, width: 22, height: 11 });
  });
});
