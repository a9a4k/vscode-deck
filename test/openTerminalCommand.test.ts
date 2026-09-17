import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createTerminal: vi.fn(() => ({ show: vi.fn() })),
  executeCommand: vi.fn(async () => undefined),
  workspaceFolders: [{ uri: { fsPath: '/work/alpha-main' } }],
}));

vi.mock('vscode', () => ({
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
    createTerminal: vscodeState.createTerminal,
  },
  workspace: {
    workspaceFolders: vscodeState.workspaceFolders,
  },
}));

import { OpenTerminalCommand } from '../src/terminal/openTerminalCommand';

describe('OpenTerminalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
  });

  it('opens a same-worktree terminal row as a Deck custom editor and focuses it once its tab exists', async () => {
    // A focus request for a Terminal with no tab yet is a silent no-op, so
    // the tab must exist by the time the request is made.
    let tabOpen = false;
    vscodeState.executeCommand.mockImplementationOnce(async () => {
      tabOpen = true;
    });
    const focusRequests: Array<{ sessionName: string; tabOpen: boolean }> = [];
    const terminalPanels = {
      panelFor: () => undefined,
      focusTerminal: (sessionName: string) => {
        focusRequests.push({ sessionName, tabOpen });
      },
    };

    await new OpenTerminalCommand({ terminalPanels }).run({
      terminal: { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      worktreePath: '/work/alpha-main',
    });

    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      {
        scheme: 'deck-terminal',
        path: '/work/alpha-main/term-1',
      },
      'deck.terminal',
      { viewColumn: -1 },
    );
    expect(focusRequests).toEqual([{ sessionName: 'wt-_work_alpha-main__term-1', tabOpen: true }]);
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
  });

  it('reveals and focuses an existing custom-editor tab instead of reopening it', async () => {
    const panel = { reveal: vi.fn() };
    const terminalPanels = {
      panelFor: vi.fn(() => panel),
      focusTerminal: vi.fn(),
    };

    await new OpenTerminalCommand({ terminalPanels }).run({
      terminal: { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      worktreePath: '/work/alpha-main',
    });

    expect(terminalPanels.panelFor).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
    expect(panel.reveal).toHaveBeenCalledWith();
    expect(terminalPanels.focusTerminal).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
    expect(vscodeState.executeCommand).not.toHaveBeenCalled();
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
  });

  it('opens a foreign-worktree terminal row in place without switching', async () => {
    await new OpenTerminalCommand().run({
      terminal: { sessionName: 'wt-_work_beta-main__term-1', windowName: 'zsh' },
      worktreePath: '/work/beta-main',
    });

    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      {
        scheme: 'deck-terminal',
        path: '/work/beta-main/term-1',
      },
      'deck.terminal',
      { viewColumn: -1 },
    );
    expect(vscodeState.executeCommand).toHaveBeenCalledOnce();
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
  });

  it('derives the term number from the session name (real rows carry no n)', async () => {
    await new OpenTerminalCommand().run({
      terminal: { sessionName: 'wt-_work_alpha-main__term-7', windowName: 'zsh' },
      worktreePath: '/work/alpha-main',
    });

    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      {
        scheme: 'deck-terminal',
        path: '/work/alpha-main/term-7',
      },
      'deck.terminal',
      { viewColumn: -1 },
    );
  });
});
