import { describe, expect, it } from 'vitest';
import { materializeImageDrop } from '../src/terminal/imageDrop';

describe('materializeImageDrop', () => {
  it('writes an image and returns its bracketed path as Terminal input', async () => {
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    const bytes = new Uint8Array([137, 80, 78, 71]);

    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: 'diagram.png', mime: 'image/png', bytes },
      {
        now: () => 1_700_000_000_000,
        writeFileExclusively: async (path, writtenBytes) => {
          writes.push({ path, bytes: writtenBytes });
        },
      },
    );

    expect(writes).toEqual([{
      path: '/tmp/deck-drops/1700000000000-diagram.png',
      bytes,
    }]);
    expect(result).toEqual({
      filePath: '/tmp/deck-drops/1700000000000-diagram.png',
      terminalInput: '\x1b[200~/tmp/deck-drops/1700000000000-diagram.png\x1b[201~',
    });
  });

  it('derives the written extension from the image MIME type', async () => {
    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: 'diagram.jpeg', mime: 'image/png', bytes: new Uint8Array() },
      { now: () => 42, writeFileExclusively: async () => undefined },
    );

    expect(result.filePath).toBe('/tmp/deck-drops/42-diagram.png');
  });

  it('uses the conventional JPEG extension from its MIME type', async () => {
    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: 'camera.download', mime: 'image/jpeg', bytes: new Uint8Array() },
      { now: () => 42, writeFileExclusively: async () => undefined },
    );

    expect(result.filePath).toBe('/tmp/deck-drops/42-camera.jpg');
  });

  it('falls back to the dropped extension for an unrecognized image MIME type', async () => {
    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: 'camera.HEIC', mime: 'image/heic', bytes: new Uint8Array() },
      { now: () => 42, writeFileExclusively: async () => undefined },
    );

    expect(result.filePath).toBe('/tmp/deck-drops/42-camera.heic');
  });

  it('sanitizes the dropped basename in the written filename', async () => {
    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: '../../My diagram (final).jpeg', mime: 'image/png', bytes: new Uint8Array() },
      { now: () => 42, writeFileExclusively: async () => undefined },
    );

    expect(result.filePath).toBe('/tmp/deck-drops/42-My-diagram-final.png');
  });

  it('bumps a suffix when the written filename already exists', async () => {
    const attemptedPaths: string[] = [];
    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: 'diagram.png', mime: 'image/png', bytes: new Uint8Array() },
      {
        now: () => 42,
        writeFileExclusively: async (path) => {
          attemptedPaths.push(path);
          if (attemptedPaths.length === 1) {
            throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
          }
        },
      },
    );

    expect(attemptedPaths).toEqual([
      '/tmp/deck-drops/42-diagram.png',
      '/tmp/deck-drops/42-diagram-1.png',
    ]);
    expect(result.filePath).toBe('/tmp/deck-drops/42-diagram-1.png');
  });
});
