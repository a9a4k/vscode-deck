import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createTerminal: vi.fn(() => ({ show: vi.fn() })),
  executeCommand: vi.fn(async () => undefined),
  workspaceFolders: [{ uri: { fsPath: '/work/repo' } }],
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
    get workspaceFolders() {
      return vscodeState.workspaceFolders;
    },
  },
}));

import {
  AddTerminalCommand,
  createHeadlessTerminal,
} from '../src/terminal/addTerminalCommand';
import { BookmarkStore } from '../src/bookmark/bookmarkStore';
import { TerminalOrderStore } from '../src/terminal/terminalOrderStore';

function createRowStores() {
  const values: Record<string, unknown> = {};
  const memento = {
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  };

  return {
    bookmarks: new BookmarkStore(memento),
    terminalOrders: new TerminalOrderStore(memento),
  };
}

function createCommand(
  tmux: ConstructorParameters<typeof AddTerminalCommand>[0],
  wakePoll?: ConstructorParameters<typeof AddTerminalCommand>[3],
  sessionUriCodec?: ConstructorParameters<typeof AddTerminalCommand>[4],
  beforeCreate?: ConstructorParameters<typeof AddTerminalCommand>[5],
  focusTerminal?: ConstructorParameters<typeof AddTerminalCommand>[6],
) {
  const { bookmarks, terminalOrders } = createRowStores();
  return new AddTerminalCommand(
    tmux,
    terminalOrders,
    bookmarks,
    wakePoll,
    sessionUriCodec,
    beforeCreate,
    focusTerminal,
  );
}

describe('AddTerminalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/repo' } }];
  });

  it('allocates the next terminal in tmux and opens it as a Deck custom editor', async () => {
    const existing = [
      { sessionName: 'wt-_work_repo__term-1', windowName: 'zsh' },
      { sessionName: 'wt-_work_repo__term-3', windowName: 'claude' },
    ];
    const tmux = {
      listSessions: vi.fn().mockResolvedValueOnce(existing),
      ensureSession: vi.fn(async () => undefined),
    };
    const wakePoll = vi.fn();

    await createCommand(
      tmux,
      wakePoll,
    ).run({ worktree: { path: '/work/repo' } });

    expect(tmux.ensureSession).toHaveBeenCalledWith(
      'wt-_work_repo__term-4',
      '/work/repo',
    );
    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      {
        scheme: 'deck-terminal',
        path: '/work/repo/term-4',
      },
      'deck.terminal',
      { viewColumn: -1 },
    );
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
    expect(wakePoll).toHaveBeenCalledOnce();
  });

  it('appends a newly created Terminal below an uncurated Bookmark', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
    };
    const { bookmarks, terminalOrders } = createRowStores();
    await bookmarks.add('/work/repo', { url: 'https://example.com/docs' });

    await new AddTerminalCommand(tmux, terminalOrders, bookmarks).run({
      worktree: { path: '/work/repo' },
    });

    expect(terminalOrders.get('/work/repo')).toEqual([
      'https://example.com/docs',
      'wt-_work_repo__term-1',
    ]);
  });

  it('keeps an existing curated row order and appends the new Terminal last', async () => {
    const existing = [
      { sessionName: 'wt-_work_repo__term-1', windowName: 'zsh' },
      { sessionName: 'wt-_work_repo__term-2', windowName: 'node' },
    ];
    const tmux = {
      listSessions: vi.fn(async () => existing),
      ensureSession: vi.fn(async () => undefined),
    };
    const { bookmarks, terminalOrders } = createRowStores();
    const bookmarkUrl = 'https://example.com/docs';
    await bookmarks.add('/work/repo', { url: bookmarkUrl });
    await terminalOrders.set('/work/repo', [
      existing[1].sessionName,
      bookmarkUrl,
      existing[0].sessionName,
    ]);

    await new AddTerminalCommand(tmux, terminalOrders, bookmarks).run({
      worktree: { path: '/work/repo' },
    });

    expect(terminalOrders.get('/work/repo')).toEqual([
      existing[1].sessionName,
      bookmarkUrl,
      existing[0].sessionName,
      'wt-_work_repo__term-3',
    ]);
  });

  it('requests focus for the newly opened Terminal', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
    };
    const focusTerminal = vi.fn();

    await createCommand(
      tmux,
      vi.fn(),
      undefined,
      undefined,
      focusTerminal,
    ).run({ worktree: { path: '/work/repo' } });

    expect(focusTerminal).toHaveBeenCalledWith('wt-_work_repo__term-1');
    expect(vscodeState.executeCommand.mock.invocationCallOrder[0]).toBeLessThan(
      focusTerminal.mock.invocationCallOrder[0],
    );
  });

  it('restores the TerminalSnapshot before creating, so a + right after a server death does not clobber it', async () => {
    const order: string[] = [];
    const tmux = {
      listSessions: vi.fn(async () => {
        order.push('list');
        return [];
      }),
      ensureSession: vi.fn(async () => {
        order.push('ensure');
      }),
    };
    const beforeCreate = vi.fn(async () => {
      order.push('restore');
    });

    await createCommand(tmux, vi.fn(), undefined, beforeCreate).run({
      worktree: { path: '/work/repo' },
    });

    expect(beforeCreate).toHaveBeenCalledOnce();
    expect(order).toEqual(['restore', 'list', 'ensure']);
  });

  it('creates a foreign-worktree tmux session and opens it in place without switching', async () => {
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
    const tmux = {
      listSessions: vi.fn().mockResolvedValueOnce([]),
      ensureSession: vi.fn(async () => undefined),
    };
    const wakePoll = vi.fn();

    await createCommand(
      tmux,
      wakePoll,
    ).run({ worktree: { path: '/work/beta-main' } });

    expect(tmux.ensureSession).toHaveBeenCalledWith(
      'wt-_work_beta-main__term-1',
      '/work/beta-main',
    );
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
    expect(wakePoll).toHaveBeenCalledOnce();
  });

  it('creates a headless terminal without opening a custom editor', async () => {
    const tmux = {
      listSessions: vi.fn().mockResolvedValueOnce([
        { sessionName: 'wt-_work_repo__term-1', windowName: 'zsh' },
      ]),
      ensureSession: vi.fn(async () => undefined),
    };

    await expect(createHeadlessTerminal(tmux, {
      worktree: { path: '/work/repo' },
    })).resolves.toEqual({
      session: 'wt-_work_repo__term-2',
      term: 2,
    });

    expect(tmux.ensureSession).toHaveBeenCalledWith('wt-_work_repo__term-2', '/work/repo');
    expect(vscodeState.executeCommand).not.toHaveBeenCalled();
  });
});
