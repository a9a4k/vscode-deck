import { TextDecoder } from 'node:util';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export function decodeOsc52(oscBody: string): string | undefined {
  const separator = oscBody.indexOf(';');
  if (separator === -1) return undefined;
  const payload = oscBody.slice(separator + 1).replace(/[\t\n\f\r ]/g, '');
  if (payload === '?') return undefined;
  if (!isBase64(payload)) return undefined;

  try {
    const bytes = Buffer.from(payload, 'base64');
    const padding = '='.repeat((4 - payload.length % 4) % 4);
    if (bytes.toString('base64') !== payload + padding) return undefined;
    return utf8Decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function isBase64(payload: string): boolean {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return false;
  if (payload.length % 4 === 1) return false;
  return !payload.includes('=') || payload.length % 4 === 0;
}
