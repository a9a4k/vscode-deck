import { execFile, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import {
  TmuxControlClient,
  type TmuxControlChild,
  type TmuxControlSpawnFactory,
} from '../src/terminal/tmuxControlClient';
import { TerminalTransport } from '../src/terminal/terminalTransport';

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

  it('delivers the post-attach repaint to the program when another tab already holds the same size', async () => {
    const socketName = `deck-test-${process.pid}-${Date.now()}-repaint`;
    const sessionName = 'repaint-after-attach';
    const logDir = mkdtempSync(join(tmpdir(), 'deck-winch-'));
    const winchLog = join(logDir, 'winch.log');
    const spawnOnTestSocket: TmuxControlSpawnFactory = (file, args, options) =>
      spawn(file, withSocket(args, socketName), options) as TmuxControlChild;
    const clientOnTestSocket = (configPath: string) => new TmuxControlClient(configPath, spawnOnTestSocket);
    const first = clientOnTestSocket('resources/deck.conf');
    const second = new TerminalTransport('resources/deck.conf', clientOnTestSocket);

    try {
      await exec('tmux', [
        '-L', socketName, '-f', '/dev/null', 'new-session', '-d', '-s', sessionName, '-x', '100', '-y', '40',
        `sh -c 'trap "echo w >> ${winchLog}" WINCH; while :; do sleep 0.1; done'`,
      ]);
      await first.start(sessionName, process.cwd(), 100);
      await first.resize(100, 40);
      await first.comeToFront();
      const signalsBeforeSecondTab = winchCount(winchLog);

      await second.start(sessionName, process.cwd(), 100, 40, true);

      await vi.waitFor(() => expect(winchCount(winchLog)).toBeGreaterThan(signalsBeforeSecondTab));
    } finally {
      first.kill();
      second.dispose();
      await exec('tmux', ['-L', socketName, 'kill-server']).catch(() => undefined);
      rmSync(logDir, { recursive: true, force: true });
    }
  });
});

function winchCount(path: string): number {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0;
}

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
