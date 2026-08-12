import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: {
    parse: (value: string) => ({ fsPath: fileURLToPath(value) }),
  },
}));

import { discoverySeedsFromDrop } from '../src/tree/discoverySeedsFromDrop';

describe('discoverySeedsFromDrop', () => {
  it('returns dropped directories in order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deck-discovery-seeds-'));
    const first = join(root, 'first');
    const second = join(root, 'second');
    await mkdir(first);
    await mkdir(second);

    try {
      const seeds = await discoverySeedsFromDrop([
        pathToFileURL(first).href,
        pathToFileURL(second).href,
        pathToFileURL(first).href,
      ].join('\n'));

      expect(seeds).toEqual([first, second, first]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes a confirmed file from a mixed drop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deck-discovery-seeds-'));
    const directory = join(root, 'repository');
    const file = join(root, 'photo.jpg');
    await mkdir(directory);
    await writeFile(file, 'image bytes');

    try {
      const seeds = await discoverySeedsFromDrop([
        pathToFileURL(file).href,
        pathToFileURL(directory).href,
      ].join('\n'));

      expect(seeds).toEqual([directory]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns no discovery seeds for a file-only drop', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deck-discovery-seeds-'));
    const file = join(root, 'archive.zip');
    await writeFile(file, 'archive bytes');

    try {
      const seeds = await discoverySeedsFromDrop(pathToFileURL(file).href);

      expect(seeds).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a path when its directory check fails', async () => {
    const uri = 'file:///disconnected/repository';

    const seeds = await discoverySeedsFromDrop(uri, async () => {
      throw new Error('volume disconnected');
    });

    expect(seeds).toEqual(['/disconnected/repository']);
  });

  it('keeps a symlink to a directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deck-discovery-seeds-'));
    const directory = join(root, 'repository');
    const link = join(root, 'repository-link');
    await mkdir(directory);
    await symlink(directory, link, 'dir');

    try {
      const seeds = await discoverySeedsFromDrop(pathToFileURL(link).href);

      expect(seeds).toEqual([link]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('ignores blank and comment lines in the uri-list', async () => {
    const seeds = await discoverySeedsFromDrop(
      '\r\n# Explorer selection\r\nfile:///first\n  \nfile:///second\r\n',
      async () => true,
    );

    expect(seeds).toEqual(['/first', '/second']);
  });
});
