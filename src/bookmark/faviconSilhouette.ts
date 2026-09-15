export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

// Version 2 includes the opacity guard for both shape-extraction paths.
export const FAVICON_ALGORITHM_VERSION = 2;
export const FAVICON_CANVAS_SIZE = 32;
// VS Code's default icon.foreground values for Light+ and Dark+.
export const FAVICON_THEME_COLORS = {
  light: [66, 66, 66, 255] as const,
  dark: [197, 197, 198, 255] as const,
};
// Keep runtime favicons aligned with deck-terminal from generate-tree-icons.py.
const FAVICON_INK_SCALE = 0.7;
const TREE_MIDLINE_FRACTION = 9.6 / 16;
const MIN_INK_ALPHA = 128;
const TRANSPARENT_BACKGROUND_FRACTION = 0.15;

export function createFaviconSilhouette(
  source: RgbaImage,
  color: readonly [number, number, number, number],
): RgbaImage {
  const mask = extractInkMask(source);

  const bounds = maskBounds(mask, source.width, source.height);
  const output = new Uint8ClampedArray(FAVICON_CANVAS_SIZE * FAVICON_CANVAS_SIZE * 4);
  if (bounds === undefined) {
    return { width: FAVICON_CANVAS_SIZE, height: FAVICON_CANVAS_SIZE, data: output };
  }

  const sourceWidth = bounds.right - bounds.left;
  const sourceHeight = bounds.bottom - bounds.top;
  const scale = (FAVICON_CANVAS_SIZE * FAVICON_INK_SCALE) / Math.max(sourceWidth, sourceHeight);
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const left = Math.round(FAVICON_CANVAS_SIZE * TREE_MIDLINE_FRACTION - targetWidth / 2);
  const top = Math.round(FAVICON_CANVAS_SIZE / 2 - targetHeight / 2);
  const resizedMask = resizeMask(mask, source.width, bounds, targetWidth, targetHeight);

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const alpha = resizedMask[y * targetWidth + x];
      if (alpha === 0) continue;
      const offset = ((top + y) * FAVICON_CANVAS_SIZE + left + x) * 4;
      output[offset] = color[0];
      output[offset + 1] = color[1];
      output[offset + 2] = color[2];
      output[offset + 3] = Math.round(alpha * color[3] / 255);
    }
  }

  return { width: FAVICON_CANVAS_SIZE, height: FAVICON_CANVAS_SIZE, data: output };
}

function resizeMask(
  mask: Uint8ClampedArray,
  sourceStride: number,
  bounds: { left: number; top: number; right: number; bottom: number },
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray {
  const sourceWidth = bounds.right - bounds.left;
  const sourceHeight = bounds.bottom - bounds.top;
  const resized = new Uint8ClampedArray(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.max(0, Math.min(sourceHeight - 1, (y + 0.5) * sourceHeight / targetHeight - 0.5));
    const top = Math.floor(sourceY);
    const bottom = Math.min(sourceHeight - 1, top + 1);
    const verticalWeight = sourceY - top;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.max(0, Math.min(sourceWidth - 1, (x + 0.5) * sourceWidth / targetWidth - 0.5));
      const left = Math.floor(sourceX);
      const right = Math.min(sourceWidth - 1, left + 1);
      const horizontalWeight = sourceX - left;
      const topLeft = mask[(bounds.top + top) * sourceStride + bounds.left + left];
      const topRight = mask[(bounds.top + top) * sourceStride + bounds.left + right];
      const bottomLeft = mask[(bounds.top + bottom) * sourceStride + bounds.left + left];
      const bottomRight = mask[(bounds.top + bottom) * sourceStride + bounds.left + right];
      const topAlpha = topLeft + (topRight - topLeft) * horizontalWeight;
      const bottomAlpha = bottomLeft + (bottomRight - bottomLeft) * horizontalWeight;
      resized[y * targetWidth + x] = Math.round(topAlpha + (bottomAlpha - topAlpha) * verticalWeight);
    }
  }
  return resized;
}

function extractInkMask(source: RgbaImage): Uint8ClampedArray {
  if (hasMeaningfullyTransparentBackground(source)) return extractAlphaMask(source);
  return extractContrastMask(source);
}

function hasMeaningfullyTransparentBackground(source: RgbaImage): boolean {
  const pixelCount = source.width * source.height;
  let transparentPixels = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (source.data[pixel * 4 + 3] < MIN_INK_ALPHA) transparentPixels += 1;
  }
  return transparentPixels / pixelCount > TRANSPARENT_BACKGROUND_FRACTION;
}

function extractAlphaMask(source: RgbaImage): Uint8ClampedArray {
  const pixelCount = source.width * source.height;
  const mask = new Uint8ClampedArray(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const alpha = source.data[pixel * 4 + 3];
    mask[pixel] = alpha >= MIN_INK_ALPHA ? alpha : 0;
  }
  return mask;
}

function extractContrastMask(source: RgbaImage): Uint8ClampedArray {
  const pixelCount = source.width * source.height;
  const luminance = new Uint8ClampedArray(pixelCount);
  const histogram = new Array<number>(256).fill(0);
  let visiblePixels = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const value = Math.round(
      0.299 * source.data[offset]
      + 0.587 * source.data[offset + 1]
      + 0.114 * source.data[offset + 2],
    );
    luminance[pixel] = value;
    if (source.data[offset + 3] >= MIN_INK_ALPHA) {
      histogram[value] += 1;
      visiblePixels += 1;
    }
  }

  const threshold = otsuThreshold(histogram);
  let darkPixels = 0;
  for (let level = 0; level <= threshold; level += 1) darkPixels += histogram[level];
  const darkIsInk = darkPixels <= visiblePixels / 2;
  const mask = new Uint8ClampedArray(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const isDark = luminance[pixel] <= threshold;
    const alpha = source.data[pixel * 4 + 3];
    mask[pixel] = isDark === darkIsInk && alpha >= MIN_INK_ALPHA ? 255 : 0;
  }
  return mask;
}

function otsuThreshold(histogram: readonly number[]): number {
  const pixelCount = histogram.reduce((sum, count) => sum + count, 0);
  const totalLuminance = histogram.reduce((sum, count, level) => sum + count * level, 0);
  let darkWeight = 0;
  let darkLuminance = 0;
  let bestVariance = 0;
  let threshold = 0;
  for (let level = 0; level < histogram.length; level += 1) {
    darkWeight += histogram[level];
    if (darkWeight === 0) continue;
    const lightWeight = pixelCount - darkWeight;
    if (lightWeight === 0) break;
    darkLuminance += level * histogram[level];
    const darkMean = darkLuminance / darkWeight;
    const lightMean = (totalLuminance - darkLuminance) / lightWeight;
    const variance = darkWeight * lightWeight * (darkMean - lightMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = level;
    }
  }
  return threshold;
}

function maskBounds(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } | undefined {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right === -1 ? undefined : { left, top, right: right + 1, bottom: bottom + 1 };
}
