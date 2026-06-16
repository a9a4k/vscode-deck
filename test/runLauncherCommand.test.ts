import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  executeCommand: vi.fn(async () => undefined),
  showQuickPick: vi.fn(),
  userLaunchers: [] as unknown[],
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
      get: (_key: string, defaultValue: unknown) => vscodeState.userLaunchers ?? defaultValue,
    }),
  },
}));

import { RunLauncherCommand } from '../src/terminal/runLauncherCommand';

describe('RunLauncherCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.userLaunchers = [];
  });

  it('shows repository launchers before user launchers and runs the picked command in a new Terminal', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
      sendCommandLine: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const resolveLaunchers = vi.fn(async () => ({
      repo: [{ label: 'Repo Dev', command: 'npm run dev' }],
      user: [{ label: 'User Watch', command: 'npm test -- --watch' }],
    }));
    vscodeState.userLaunchers = [{ label: 'User Watch', command: 'npm test -- --watch' }];
    vscodeState.showQuickPick.mockImplementation(async (items: Array<{ label: string }>) =>
      items.find((item) => item.label === 'User Watch'),
    );

    await new RunLauncherCommand(tmux, { refresh, resolveLaunchers }).run({
      worktree: { path: '/work/repo' },
    });

    expect(resolveLaunchers).toHaveBeenCalledWith('/work/repo', vscodeState.userLaunchers);
    expect(vscodeState.showQuickPick).toHaveBeenCalledWith(
      [
        { kind: -1, label: 'This repository' },
        expect.objectContaining({ label: 'Repo Dev', description: 'npm run dev' }),
        { kind: -1, label: 'User' },
        expect.objectContaining({ label: 'User Watch', description: 'npm test -- --watch' }),
      ],
      { placeHolder: 'Run Terminal Launcher' },
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
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('opens launcher settings from the empty-state item', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
      sendCommandLine: vi.fn(async () => undefined),
    };
    const resolveLaunchers = vi.fn(async () => ({ repo: [], user: [] }));
    vscodeState.showQuickPick.mockImplementation(async (items: Array<{ label: string }>) => items[0]);

    await new RunLauncherCommand(tmux, { refresh: vi.fn(), resolveLaunchers }).run({
      worktree: { path: '/work/repo' },
    });

    expect(vscodeState.showQuickPick).toHaveBeenCalledWith(
      [expect.objectContaining({ label: 'No launchers configured — Configure…' })],
      { placeHolder: 'Run Terminal Launcher' },
    );
    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'workbench.action.openSettings',
      'deck.terminalLaunchers',
    );
    expect(tmux.ensureSession).not.toHaveBeenCalled();
    expect(tmux.sendCommandLine).not.toHaveBeenCalled();
  });
});
