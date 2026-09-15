import { PNG } from 'pngjs';
import { decodeFavicon } from './faviconDecode';
import {
  createFaviconSilhouette,
  FAVICON_THEME_COLORS,
  type RgbaImage,
} from './faviconSilhouette';

export interface FaviconIcons {
  readonly light: Buffer;
  readonly dark: Buffer;
}

export function buildFaviconIcons(bytes: Uint8Array): FaviconIcons | undefined {
  const source = decodeFavicon(bytes);
  if (source === undefined) return undefined;
  return {
    light: encodePng(createFaviconSilhouette(source, FAVICON_THEME_COLORS.light)),
    dark: encodePng(createFaviconSilhouette(source, FAVICON_THEME_COLORS.dark)),
  };
}

function encodePng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return PNG.sync.write(png);
}
