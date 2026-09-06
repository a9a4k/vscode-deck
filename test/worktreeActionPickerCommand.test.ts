import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  executeCommand: vi.fn(async () => undefined),
  showQuickPick: vi.fn(),
  userLaunchers: [] as unknown[],
  repositoryLaunchers: [] as unknown[],
}));

vi.mock('vscode', () => ({
  QuickPickItemKind: { Separator: -1 },
  ViewColumn: { Active: -1 },
  Uri: {
    from(value: { scheme: string; authority: string; path: string; query: string }) {
      return value;
    },
  },
  commands: {
    executeCommand: vscodeState.executeCommand,
  },
  window: {
    showQuickPick: vscodeState.showQuickPick,
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

import { WorktreeActionPickerCommand } from '../src/worktree/worktreeActionPickerCommand';

describe('WorktreeActionPickerCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.userLaunchers = [];
    vscodeState.repositoryLaunchers = [];
  });

  it('shows Terminal and Bookmark actions before launcher groups and runs the picked launcher', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
      sendCommandLine: vi.fn(async () => undefined),
    };
    const wakePoll = vi.fn();
    const resolveLaunchers = vi.fn(async () => ({
      repo: [{ label: 'Repo Dev', command: 'npm run dev' }],
      repositoryLocal: [{ label: 'Local Bootstrap', command: 'pnpm bootstrap' }],
      user: [{ label: 'User Watch', command: 'npm test -- --watch' }],
    }));
    vscodeState.userLaunchers = [{ label: 'User Watch', command: 'npm test -- --watch' }];
    vscodeState.repositoryLaunchers = [
      { repository: '/work/repo', launchers: [{ label: 'Local Bootstrap', command: 'pnpm bootstrap' }] },
    ];
    vscodeState.showQuickPick.mockImplementation(async (items: Array<{ label: string }>) =>
      items.find((item) => item.label === 'User Watch'),
    );

    await new WorktreeActionPickerCommand(tmux, { wakePoll, resolveLaunchers }).run({
      worktree: { path: '/work/repo' },
    });

    expect(resolveLaunchers).toHaveBeenCalledWith(
      '/work/repo',
      vscodeState.userLaunchers,
      vscodeState.repositoryLaunchers,
    );
    expect(vscodeState.showQuickPick).toHaveBeenCalledWith(
      [
        expect.objectContaining({ label: 'New Terminal' }),
        expect.objectContaining({ label: 'Add Bookmark…' }),
        { kind: -1, label: 'This repository (shared)' },
        expect.objectContaining({ label: 'Repo Dev', description: 'npm run dev' }),
        { kind: -1, label: 'This repository (personal)' },
        expect.objectContaining({ label: 'Local Bootstrap', description: 'pnpm bootstrap' }),
        { kind: -1, label: 'User' },
        expect.objectContaining({ label: 'User Watch', description: 'npm test -- --watch' }),
      ],
      { placeHolder: 'Start on this Worktree' },
    );
    expect(tmux.ensureSession).toHaveBeenCalledWith('wt-_work_repo__term-1', '/work/repo');
    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      {
        scheme: 'deck-terminal',
        path: '/work/repo/term-1',
      },
      'deck.terminal',
      { viewColumn: -1 },
    );
    expect(tmux.sendCommandLine).toHaveBeenCalledWith(
      'wt-_work_repo__term-1',
      'npm test -- --watch',
    );
    expect(wakePoll).toHaveBeenCalledOnce();
  });

  it('requests focus for the Terminal opened by a launcher', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
      sendCommandLine: vi.fn(async () => undefined),
    };
    const focusTerminal = vi.fn();
    vscodeState.showQuickPick.mockImplementation(async (items: Array<{ label: string }>) =>
      items.find((item) => item.label === 'Dev'),
    );

    await new WorktreeActionPickerCommand(tmux, {
      focusTerminal,
      resolveLaunchers: vi.fn(async () => ({
        repo: [{ label: 'Dev', command: 'npm run dev' }],
        repositoryLocal: [],
        user: [],
      })),
    }).run({ worktree: { path: '/work/repo' } });

    expect(focusTerminal).toHaveBeenCalledWith('wt-_work_repo__term-1');
  });

  it('creates and opens a new Terminal from the primary action', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
      sendCommandLine: vi.fn(async () => undefined),
    };
    const wakePoll = vi.fn();
    vscodeState.showQuickPick.mockImplementation(async (items: Array<{ label: string }>) =>
      items.find((item) => item.label === 'New Terminal'),
    );

    await new WorktreeActionPickerCommand(tmux, {
      wakePoll,
      resolveLaunchers: vi.fn(async () => ({ repo: [], repositoryLocal: [], user: [] })),
    }).run({ worktree: { path: '/work/repo' } });

    expect(tmux.ensureSession).toHaveBeenCalledWith('wt-_work_repo__term-1', '/work/repo');
    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      { scheme: 'deck-terminal', path: '/work/repo/term-1' },
      'deck.terminal',
      { viewColumn: -1 },
    );
    expect(tmux.sendCommandLine).not.toHaveBeenCalled();
    expect(wakePoll).toHaveBeenCalledOnce();
  });

  it('runs the existing Add Bookmark command from the second primary action', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
      sendCommandLine: vi.fn(async () => undefined),
    };
    vscodeState.showQuickPick.mockImplementation(async (items: Array<{ label: string }>) =>
      items.find((item) => item.label === 'Add Bookmark…'),
    );
    const node = { worktree: { path: '/work/repo' } };

    await new WorktreeActionPickerCommand(tmux, {
      resolveLaunchers: vi.fn(async () => ({ repo: [], repositoryLocal: [], user: [] })),
    }).run(node);

    expect(vscodeState.executeCommand).toHaveBeenCalledWith('deck.addBookmark', node);
    expect(tmux.ensureSession).not.toHaveBeenCalled();
  });

  it('offers only Add Bookmark when tmux is unavailable', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
      sendCommandLine: vi.fn(async () => undefined),
    };
    const resolveLaunchers = vi.fn(async () => ({
      repo: [{ label: 'Dev', command: 'npm run dev' }],
      repositoryLocal: [],
      user: [],
    }));
    vscodeState.showQuickPick.mockImplementation(async (items: Array<{ label: string }>) => items[0]);
    const node = { worktree: { path: '/work/repo' } };

    await new WorktreeActionPickerCommand(tmux, {
      resolveLaunchers,
      tmuxAvailable: false,
    }).run(node);

    expect(vscodeState.showQuickPick).toHaveBeenCalledWith(
      [expect.objectContaining({ label: 'Add Bookmark…' })],
      { placeHolder: 'Start on this Worktree' },
    );
    expect(resolveLaunchers).not.toHaveBeenCalled();
    expect(vscodeState.executeCommand).toHaveBeenCalledWith('deck.addBookmark', node);
    expect(tmux.listSessions).not.toHaveBeenCalled();
  });

  it('opens launcher settings from the empty-state item', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
      sendCommandLine: vi.fn(async () => undefined),
    };
    const resolveLaunchers = vi.fn(async () => ({ repo: [], repositoryLocal: [], user: [] }));
    vscodeState.showQuickPick.mockImplementation(async (items: Array<{ label: string }>) =>
      items.find((item) => item.label === 'No launchers configured — Configure…'),
    );

    await new WorktreeActionPickerCommand(tmux, { wakePoll: vi.fn(), resolveLaunchers }).run({
      worktree: { path: '/work/repo' },
    });

    expect(vscodeState.showQuickPick).toHaveBeenCalledWith(
      [
        expect.objectContaining({ label: 'New Terminal' }),
        expect.objectContaining({ label: 'Add Bookmark…' }),
        expect.objectContaining({ label: 'No launchers configured — Configure…' }),
      ],
      { placeHolder: 'Start on this Worktree' },
    );
    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'workbench.action.openSettings',
      'deck.repositoryLaunchers',
    );
    expect(tmux.ensureSession).not.toHaveBeenCalled();
    expect(tmux.sendCommandLine).not.toHaveBeenCalled();
  });
});
