import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  TmuxControlClient,
  type TmuxControlChild,
  type TmuxControlSpawnFactory,
} from '../src/terminal/tmuxControlClient';

const exec = promisify(execFile);

describe.skipIf(!supportsTmux32())('shared Terminal sizing with real tmux', () => {
  it('keeps the FrontTab width across another tab attach and resize', async () => {
    const socketName = `deck-test-${process.pid}-${Date.now()}`;
    const sessionName = 'shared-terminal-size';
    const spawnOnTestSocket: TmuxControlSpawnFactory = (file, args, options) =>
      spawn(file, withSocket(args, socketName), options) as TmuxControlChild;
    const first = new TmuxControlClient('resources/deck.conf', spawnOnTestSocket);
    const second = new TmuxControlClient('resources/deck.conf', spawnOnTestSocket);

    try {
      await first.start(sessionName, process.cwd(), 100);
      await first.resize(101, 53);
      expect(await paneSize(socketName, sessionName)).toBe('101x53');
      await first.comeToFront();

      await second.start(sessionName, process.cwd(), 100);
      await second.resize(138, 65);
      expect(await paneSize(socketName, sessionName)).toBe('101x53');

      await second.comeToFront();
      await second.resize(138, 65);
      expect(await paneSize(socketName, sessionName)).toBe('138x65');

      await first.resize(90, 40);
      expect(await paneSize(socketName, sessionName)).toBe('138x65');

      await first.comeToFront();
      await first.resize(101, 53);
      expect(await paneSize(socketName, sessionName)).toBe('101x53');
    } finally {
      first.kill();
      second.kill();
      await exec('tmux', ['-L', socketName, 'kill-server']).catch(() => undefined);
    }
  });
});

function withSocket(args: string[], socketName: string): string[] {
  const socketIndex = args.indexOf('-L') + 1;
  const rewritten = [...args];
  rewritten[socketIndex] = socketName;
  return rewritten;
}

async function paneSize(socketName: string, sessionName: string): Promise<string> {
  const { stdout } = await exec('tmux', [
    '-L',
    socketName,
    'display-message',
    '-p',
    '-t',
    sessionName,
    '#{window_width}x#{window_height}',
  ]);
  return stdout.trim();
}

function supportsTmux32(): boolean {
  const result = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  const match = result.stdout?.match(/(\d+)\.(\d+)/);
  if (!match) return false;
  const [major, minor] = match.slice(1).map(Number);
  return major > 3 || (major === 3 && minor >= 2);
}
