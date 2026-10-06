import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { Disposable } from './agentStatusStore';
import type { SharedCodexServerMarkerSource } from './sharedCodexServerNotice';

export class SharedCodexServerMarkerFile implements SharedCodexServerMarkerSource {
  constructor(private readonly path: string) {}

  async read(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError || isNotFound(error)) return undefined;
      throw error;
    }
  }

  onDidChange(listener: () => void): Disposable {
    const markerName = basename(this.path);
    const watcher = watch(dirname(this.path), (_event, filename) => {
      if (filename?.toString() === markerName) listener();
    });
    watcher.on('error', () => watcher.close());
    return { dispose: () => watcher.close() };
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
