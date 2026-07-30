import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createFileSystemWatcher: vi.fn(),
  existsSync: vi.fn(),
  patterns: [] as Array<{ baseUri: { fsPath: string }; pattern: string }>,
  watchers: [] as Array<{
    dispose: ReturnType<typeof vi.fn>;
    onDidCreate: ReturnType<typeof vi.fn>;
    onDidChange: ReturnType<typeof vi.fn>;
    onDidDelete: ReturnType<typeof vi.fn>;
    handlers: Array<(uri: { path: string }) => void>;
  }>,
}));

vi.mock('node:fs', () => ({
  existsSync: vscodeState.existsSync,
}));

vi.mock('vscode', () => ({
  RelativePattern: class {
    constructor(public readonly baseUri: { fsPath: string }, public readonly pattern: string) {
      vscodeState.patterns.push({ baseUri, pattern });
    }
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
  workspace: {
    createFileSystemWatcher: vscodeState.createFileSystemWatcher,
  },
}));

import { watchGitCommonDir } from '../src/repository/vscodeExternalGitWatch';

function watcherFor(pattern: string) {
  const watcherIndex = vscodeState.patterns.findIndex((entry) => entry.pattern === pattern);

  expect(watcherIndex).not.toBe(-1);

  return vscodeState.watchers[watcherIndex];
}

describe('watchGitCommonDir', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vscodeState.existsSync.mockReturnValue(true);
    vscodeState.patterns = [];
    vscodeState.watchers = [];
    vscodeState.createFileSystemWatcher.mockImplementation(() => {
      const watcher = {
        dispose: vi.fn(),
        onDidCreate: vi.fn((handler: (uri: { path: string }) => void) => {
          watcher.handlers.push(handler);
          return { dispose: vi.fn() };
        }),
        onDidChange: vi.fn((handler: (uri: { path: string }) => void) => {
          watcher.handlers.push(handler);
          return { dispose: vi.fn() };
        }),
        onDidDelete: vi.fn((handler: (uri: { path: string }) => void) => {
          watcher.handlers.push(handler);
          return { dispose: vi.fn() };
        }),
        handlers: [] as Array<(uri: { path: string }) => void>,
      };
      vscodeState.watchers.push(watcher);
      return watcher;
    });
  });

  it('does not create watchers for a missing common dir', () => {
    vscodeState.existsSync.mockReturnValue(false);

    const watch = watchGitCommonDir('/git/missing', vi.fn());

    expect(watch).toBeUndefined();
    expect(vscodeState.createFileSystemWatcher).not.toHaveBeenCalled();
  });

  it('watches git HEAD paths and coalesces bursts into one refresh', () => {
    const refresh = vi.fn();

    watchGitCommonDir('/git/alpha', refresh);
    watcherFor('HEAD').handlers[0]({ path: '/git/alpha/HEAD' });
    watcherFor('worktrees/**/HEAD').handlers[1]({
      path: '/git/alpha/worktrees/feature/HEAD',
    });
    vi.advanceTimersByTime(249);

    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(vscodeState.patterns).toHaveLength(5);
    expect(vscodeState.patterns).toEqual(
      expect.arrayContaining([
        { baseUri: { fsPath: '/git/alpha' }, pattern: 'HEAD' },
        { baseUri: { fsPath: '/git/alpha' }, pattern: 'worktrees/**/HEAD' },
        { baseUri: { fsPath: '/git/alpha' }, pattern: 'worktrees/*/gitdir' },
        { baseUri: { fsPath: '/git/alpha' }, pattern: 'worktrees' },
        { baseUri: { fsPath: '/git/alpha' }, pattern: 'worktrees/*' },
      ]),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('refreshes when a child worktree directory is deleted', () => {
    const refresh = vi.fn();

    watchGitCommonDir('/git/alpha', refresh);
    watcherFor('worktrees/*').handlers[2]({ path: '/git/alpha/worktrees/feature' });
    vi.advanceTimersByTime(250);

    expect(refresh).toHaveBeenCalledOnce();
  });

  it('refreshes when a linked Worktree gitdir changes', () => {
    const refresh = vi.fn();

    watchGitCommonDir('/git/alpha', refresh);
    watcherFor('worktrees/*/gitdir').handlers[1]({
      path: '/git/alpha/worktrees/feature/gitdir',
    });
    vi.advanceTimersByTime(250);

    expect(refresh).toHaveBeenCalledOnce();
  });

  it('refreshes when the worktrees directory is created or deleted', () => {
    const refresh = vi.fn();

    watchGitCommonDir('/git/alpha', refresh);
    const watcher = watcherFor('worktrees');

    watcher.handlers[0]({ path: '/git/alpha/worktrees' });
    vi.advanceTimersByTime(250);

    expect(refresh).toHaveBeenCalledOnce();

    watcher.handlers[2]({ path: '/git/alpha/worktrees' });
    vi.advanceTimersByTime(250);

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('ignores index locks and watchman cookie files before debounce', () => {
    const refresh = vi.fn();

    watchGitCommonDir('/git/alpha', refresh);
    const changed = watcherFor('worktrees/*').handlers[1];
    changed({ path: '/git/alpha/index.lock' });
    changed({ path: '/git/alpha/worktrees/feature/index.lock' });
    changed({ path: '/git/alpha/.watchman-cookie-host-123' });
    vi.advanceTimersByTime(250);

    expect(refresh).not.toHaveBeenCalled();

    changed({ path: '/git/alpha/worktrees/feature' });
    vi.advanceTimersByTime(250);

    expect(refresh).toHaveBeenCalledOnce();
  });
});
