import decodeIco from 'decode-ico';
import { PNG } from 'pngjs';
import type { RgbaImage } from './faviconSilhouette';

const ICO_MAGIC = [0x00, 0x00, 0x01, 0x00] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function decodeFavicon(bytes: Uint8Array): RgbaImage | undefined {
  try {
    if (startsWith(bytes, PNG_MAGIC)) return decodePng(bytes);
    if (startsWith(bytes, ICO_MAGIC)) return decodeLargestIcoFrame(bytes);
    return undefined;
  } catch {
    return undefined;
  }
}

function decodeLargestIcoFrame(bytes: Uint8Array): RgbaImage | undefined {
  const frames = decodeIco(bytes);
  let largest: (typeof frames)[number] | undefined;
  for (const frame of frames) {
    if (largest === undefined || frame.width * frame.height > largest.width * largest.height) {
      largest = frame;
    }
  }
  if (largest === undefined) return undefined;
  if (largest.type === 'png') return decodePng(largest.data);
  return {
    width: largest.width,
    height: largest.height,
    data: new Uint8ClampedArray(largest.data),
  };
}

function decodePng(bytes: Uint8Array): RgbaImage {
  const decoded = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
  };
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((value, offset) => bytes[offset] === value);
}
