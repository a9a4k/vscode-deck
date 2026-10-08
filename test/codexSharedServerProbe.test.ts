import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexSharedServerProbe } from '../src/terminal/codexSharedServerProbe';

let server: Server | undefined;
let root: string | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('CodexSharedServerProbe', () => {
  it('reports live while the Codex control socket accepts connections', async () => {
    root = mkdtempSync('/tmp/deck-codex-home-');
    const socketDirectory = join(root, 'app-server-control');
    const socketPath = join(socketDirectory, 'app-server-control.sock');
    mkdirSync(socketDirectory);
    server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server?.listen(socketPath, resolve));

    await expect(new CodexSharedServerProbe(root).probe()).resolves.toBe('live');
  });

  it('reports absent when the Codex control socket is missing', async () => {
    root = mkdtempSync('/tmp/deck-codex-home-');

    await expect(new CodexSharedServerProbe(root).probe()).resolves.toBe('absent');
  });
});
