import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  materializeImageDrop,
  type ImageDropDependencies,
} from '../src/terminal/imageDrop';

function dependencies(overrides: Partial<ImageDropDependencies> = {}): ImageDropDependencies {
  return {
    now: () => 42,
    createDirectory: async () => undefined,
    writeFileExclusively: async () => undefined,
    ...overrides,
  };
}

describe('materializeImageDrop', () => {
  it('writes an image and returns its bracketed path as Terminal input', async () => {
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    const bytes = new Uint8Array([137, 80, 78, 71]);

    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: 'diagram.png', mime: 'image/png', bytes },
      dependencies({
        now: () => 1_700_000_000_000,
        writeFileExclusively: async (path, writtenBytes) => {
          writes.push({ path, bytes: writtenBytes });
        },
      }),
    );

    expect(writes).toEqual([{
      path: '/tmp/deck-drops/1700000000000-diagram.png',
      bytes,
    }]);
    expect(result).toEqual({ filePath: '/tmp/deck-drops/1700000000000-diagram.png' });
  });

  it('derives the written extension from the image MIME type', async () => {
    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: 'diagram.jpeg', mime: 'image/png', bytes: new Uint8Array() },
      dependencies(),
    );

    expect(result.filePath).toBe('/tmp/deck-drops/42-diagram.png');
  });

  it('uses the conventional JPEG extension from its MIME type', async () => {
    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: 'camera.download', mime: 'image/jpeg', bytes: new Uint8Array() },
      dependencies(),
    );

    expect(result.filePath).toBe('/tmp/deck-drops/42-camera.jpg');
  });

  it('falls back to the dropped extension for an unrecognized image MIME type', async () => {
    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: 'camera.HEIC', mime: 'image/heic', bytes: new Uint8Array() },
      dependencies(),
    );

    expect(result.filePath).toBe('/tmp/deck-drops/42-camera.heic');
  });

  it('sanitizes the dropped basename in the written filename', async () => {
    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: '../../My diagram (final).jpeg', mime: 'image/png', bytes: new Uint8Array() },
      dependencies(),
    );

    expect(result.filePath).toBe('/tmp/deck-drops/42-My-diagram-final.png');
  });

  it('bumps a suffix when the written filename already exists', async () => {
    const attemptedPaths: string[] = [];
    const result = await materializeImageDrop(
      '/tmp/deck-drops',
      { name: 'diagram.png', mime: 'image/png', bytes: new Uint8Array() },
      dependencies({
        writeFileExclusively: async (path) => {
          attemptedPaths.push(path);
          if (attemptedPaths.length === 1) {
            throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
          }
        },
      }),
    );

    expect(attemptedPaths).toEqual([
      '/tmp/deck-drops/42-diagram.png',
      '/tmp/deck-drops/42-diagram-1.png',
    ]);
    expect(result.filePath).toBe('/tmp/deck-drops/42-diagram-1.png');
  });

  it('rejects after 100 filename collision attempts', async () => {
    let attempts = 0;
    const materialization = materializeImageDrop(
      '/tmp/deck-drops',
      { name: 'diagram.png', mime: 'image/png', bytes: new Uint8Array() },
      dependencies({
        writeFileExclusively: async () => {
          attempts += 1;
          if (attempts > 100) throw new Error('collision retries exceeded the documented limit');
          throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
        },
      }),
    );

    await expect(materialization).rejects.toThrow('Could not materialize dropped image');
    expect(attempts).toBe(100);
  });

  it('propagates a target-directory creation failure without collision retries', async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), 'deck-image-drop-'));
    const targetDirectory = join(parentDirectory, 'deck-drops');
    await writeFile(targetDirectory, 'not a directory');

    try {
      await expect(materializeImageDrop(
        targetDirectory,
        { name: 'diagram.png', mime: 'image/png', bytes: new Uint8Array() },
      )).rejects.toMatchObject({ code: 'EEXIST' });
    } finally {
      await rm(parentDirectory, { recursive: true, force: true });
    }
  });
});
