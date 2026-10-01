import { describe, expect, it } from 'vitest';
import { decodeOsc52 } from '../src/terminal/osc52Decoder';

describe('decodeOsc52', () => {
  it.each([
    ['ASCII text', 'c;aGVsbG8=', 'hello'],
    ['multi-byte UTF-8', 'c;Y2Fmw6kg5L2g5aW9IPCfmIAg4pSA', 'café 你好 😀 ─'],
    ['an empty payload', 'c;', ''],
    ['a primary-selection target', 'p;aGVsbG8=', 'hello'],
    ['several targets', 'cp;aGVsbG8=', 'hello'],
    ['an empty selection field', ';aGVsbG8=', 'hello'],
    ['base64 containing ASCII whitespace', 'c;aGVs bG8=\r\n', 'hello'],
  ])('decodes %s', (_case, oscBody, expected) => {
    expect(decodeOsc52(oscBody)).toBe(expected);
  });

  it.each([
    ['a clipboard read query', 'c;?'],
    ['a missing separator', 'aGVsbG8='],
    ['malformed base64', 'c;%%%'],
    ['base64 with non-zero padding bits', 'c;Zh=='],
    ['invalid UTF-8', 'c;wyg='],
  ])('rejects %s', (_case, oscBody) => {
    expect(decodeOsc52(oscBody)).toBeUndefined();
  });
});
