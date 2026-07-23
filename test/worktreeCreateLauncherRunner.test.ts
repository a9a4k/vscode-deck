import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  executeCommand: vi.fn(async () => undefined),
  userLaunchers: [] as unknown[],
  repositoryLaunchers: [] as unknown[],
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vscodeState.executeCommand,
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, defaultValue: unknown) => {
        if (key === 'terminalLaunchers') return vscodeState.userLaunchers ?? defaultValue;
        if (key === 'repositoryLaunchers') return vscodeState.repositoryLaunchers ?? defaultValue;
        return defaultValue;
      },
    }),
  },
}));

import { WorktreeCreateLauncherRunner } from '../src/terminal/worktreeCreateLauncherRunner';

describe('WorktreeCreateLauncherRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.userLaunchers = [];
    vscodeState.repositoryLaunchers = [];
  });

  it('runs flagged launchers in source order in distinct headless terminals', async () => {
    const sessions: Array<{ sessionName: string; windowName: string }> = [];
    const tmux = {
      listSessions: vi.fn(async (prefix?: string) =>
        sessions.filter((session) => !prefix || session.sessionName.startsWith(prefix)),
      ),
      ensureSession: vi.fn(async (sessionName: string) => {
        sessions.push({ sessionName, windowName: 'zsh' });
      }),
      sendCommandLine: vi.fn(async () => undefined),
    };
    const wakePoll = vi.fn();
    const resolveLaunchers = vi.fn(async () => ({
      repo: [
        { label: 'Dev', command: 'npm run dev' },
        { label: 'Bootstrap', command: 'pnpm bootstrap', runOnWorktreeCreate: true },
      ],
      repositoryLocal: [
        { label: 'Local Claude', command: 'claude', runOnWorktreeCreate: true },
      ],
      user: [
        { label: 'User Watch', command: 'npm test -- --watch', runOnWorktreeCreate: true },
      ],
    }));
    vscodeState.repositoryLaunchers = [
      { repository: '/work/repo', launchers: [{ label: 'Local Claude', command: 'claude' }] },
    ];
    vscodeState.userLaunchers = [
      { label: 'User Watch', command: 'npm test -- --watch', runOnWorktreeCreate: true },
    ];

    await new WorktreeCreateLauncherRunner(tmux, { wakePoll, resolveLaunchers }).run({
      worktree: { path: '/work/repo' },
    });

    expect(resolveLaunchers).toHaveBeenCalledWith(
      '/work/repo',
      vscodeState.userLaunchers,
      vscodeState.repositoryLaunchers,
    );
    expect(tmux.ensureSession).toHaveBeenNthCalledWith(1, 'wt-_work_repo__term-1', '/work/repo');
    expect(tmux.ensureSession).toHaveBeenNthCalledWith(2, 'wt-_work_repo__term-2', '/work/repo');
    expect(tmux.ensureSession).toHaveBeenNthCalledWith(3, 'wt-_work_repo__term-3', '/work/repo');
    expect(tmux.sendCommandLine).toHaveBeenNthCalledWith(
      1,
      'wt-_work_repo__term-1',
      'pnpm bootstrap',
    );
    expect(tmux.sendCommandLine).toHaveBeenNthCalledWith(2, 'wt-_work_repo__term-2', 'claude');
    expect(tmux.sendCommandLine).toHaveBeenNthCalledWith(
      3,
      'wt-_work_repo__term-3',
      'npm test -- --watch',
    );
    expect(vscodeState.executeCommand).not.toHaveBeenCalled();
    expect(wakePoll).toHaveBeenCalledOnce();
  });

  it('does not create terminals when no launchers are flagged', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
      sendCommandLine: vi.fn(async () => undefined),
    };
    const wakePoll = vi.fn();
    const beforeCreate = vi.fn(async () => undefined);
    const resolveLaunchers = vi.fn(async () => ({
      repo: [{ label: 'Dev', command: 'npm run dev' }],
      repositoryLocal: [],
      user: [{ label: 'Watch', command: 'npm test -- --watch' }],
    }));

    await new WorktreeCreateLauncherRunner(tmux, {
      beforeCreate,
      wakePoll,
      resolveLaunchers,
    }).run({ worktree: { path: '/work/repo' } });

    expect(beforeCreate).not.toHaveBeenCalled();
    expect(tmux.ensureSession).not.toHaveBeenCalled();
    expect(tmux.sendCommandLine).not.toHaveBeenCalled();
    expect(wakePoll).not.toHaveBeenCalled();
  });
});
