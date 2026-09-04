import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  repositories: ['/repo/a', '/repo/b', '/repo/c', '/repo/d'],
  discoverySeedsFromDrop: vi.fn(async (uriList: string) => uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((uri) => decodeURIComponent(new URL(uri).pathname))),
  listWorktrees: vi.fn(),
  getCommonDirSafe: vi.fn(),
  listSessions: vi.fn(),
}));

vi.mock('vscode', () => ({
  DataTransferItem: class {
    constructor(readonly value: unknown) {}
  },
  Uri: {
    parse: vi.fn((value: string) => ({ fsPath: decodeURIComponent(new URL(value).pathname) })),
  },
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
}));

vi.mock('../src/git/worktrees', () => ({
  getCommonDirSafe: vscodeState.getCommonDirSafe,
  listWorktrees: vscodeState.listWorktrees,
}));

vi.mock('../src/tree/discoverySeedsFromDrop', () => ({
  discoverySeedsFromDrop: vscodeState.discoverySeedsFromDrop,
}));

import * as vscode from 'vscode';
import { BookmarkStore } from '../src/bookmark/bookmarkStore';
import { RepositoryRegistryStore } from '../src/repository/repositoryRegistryStore';
import { TerminalOrderStore } from '../src/terminal/terminalOrderStore';
import { DeckTreeDragAndDropController } from '../src/tree/deckTreeDragAndDropController';
import { WorktreeOrderStore } from '../src/worktree/worktreeOrderStore';

class DataTransferMock {
  private readonly items = new Map<string, vscode.DataTransferItem>();

  get(mimeType: string): vscode.DataTransferItem | undefined {
    return this.items.get(mimeType);
  }

  set(mimeType: string, value: vscode.DataTransferItem): void {
    this.items.set(mimeType, value);
  }
}

function repository(repositoryPath: string) {
  return { contextValue: 'deck.repository', repositoryPath };
}

function worktree(repositoryPath: string, worktreePath: string) {
  return {
    contextValue: 'deck.worktree',
    repositoryPath,
    worktree: { path: worktreePath },
  };
}

function terminal(repositoryPath: string, worktreePath: string, sessionName: string) {
  return {
    contextValue: 'deck.terminal.foreign',
    repositoryPath,
    worktreePath,
    terminal: { sessionName, windowName: sessionName },
  };
}

function bookmark(repositoryPath: string, worktreePath: string, url: string) {
  return {
    contextValue: 'deck.bookmark',
    repositoryPath,
    worktreePath,
    bookmark: { url },
  };
}

function createController(refresh = vi.fn()) {
  const repositoryRegistry = {
    list: vi.fn(() => vscodeState.repositories),
    append: vi.fn(async (repositoryPath: string) => {
      vscodeState.repositories = [...vscodeState.repositories, repositoryPath];
    }),
    replace: vi.fn(async (repositories: readonly string[]) => {
      vscodeState.repositories = [...repositories];
    }),
  } as unknown as RepositoryRegistryStore;
  const worktreeOrders = {
    get: vi.fn(),
    set: vi.fn(async () => undefined),
  } as unknown as WorktreeOrderStore;
  const terminalOrders = {
    get: vi.fn(() => [
      'wt-_repo_a-main__term-1',
      'wt-_repo_a-main__term-2',
      'wt-_repo_a-main__term-3',
    ]),
    set: vi.fn(async () => undefined),
  } as unknown as TerminalOrderStore;
  const tmux = {
    listSessions: vscodeState.listSessions,
  };
  const bookmarks = {
    list: vi.fn(() => [{ url: 'http://localhost:5173/' }]),
    move: vi.fn(async () => undefined),
  };
  const activeWorktrees = { set: vi.fn(async () => undefined) };
  const switcher = { switchTo: vi.fn(async () => undefined) };
  const detachedOpener = { open: vi.fn(async () => undefined) };
  const reveal = vi.fn(async () => undefined);
  return {
    activeWorktrees,
    controller: new DeckTreeDragAndDropController(
      refresh,
      repositoryRegistry,
      worktreeOrders,
      terminalOrders,
      tmux,
      bookmarks,
      activeWorktrees,
      switcher,
      detachedOpener,
      reveal,
    ),
    bookmarks,
    detachedOpener,
    repositoryRegistry,
    refresh,
    reveal,
    switcher,
    terminalOrders,
    worktreeOrders,
  };
}

function createBookmarkMoveController() {
  const values: Record<string, unknown> = {};
  const memento = {
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  };
  const bookmarks = new BookmarkStore(memento);
  const terminalOrders = new TerminalOrderStore(memento);
  const refresh = vi.fn();
  const controller = new DeckTreeDragAndDropController(
    refresh,
    new RepositoryRegistryStore(memento),
    new WorktreeOrderStore(memento),
    terminalOrders,
    { listSessions: vscodeState.listSessions },
    bookmarks,
  );

  return { bookmarks, controller, refresh, terminalOrders };
}

describe('DeckTreeDragAndDropController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
    vscodeState.repositories = ['/repo/a', '/repo/b', '/repo/c', '/repo/d'];
    vscodeState.getCommonDirSafe.mockResolvedValue('/git/a');
    vscodeState.listWorktrees.mockResolvedValue([
      {
        path: '/repo/a-main',
        head: 'a',
        bare: false,
        detached: false,
        branch: 'main',
      },
      {
        path: '/repo/a-feature',
        head: 'b',
        bare: false,
        detached: false,
        branch: 'feature',
      },
      {
        path: '/repo/a-fix',
        head: 'c',
        bare: false,
        detached: false,
        branch: 'fix',
      },
    ]);
    vscodeState.listSessions.mockResolvedValue([
      { sessionName: 'wt-_repo_a-main__term-1', windowName: 'one' },
      { sessionName: 'wt-_repo_a-main__term-2', windowName: 'two' },
      { sessionName: 'wt-_repo_a-main__term-3', windowName: 'three' },
    ]);
  });

  it('reorders Repositories in RepositoryRegistryStore and refreshes the tree', async () => {
    const { controller, repositoryRegistry, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([repository('/repo/b')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(repository('/repo/d'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(repositoryRegistry.replace).toHaveBeenCalledWith(
      ['/repo/a', '/repo/c', '/repo/d', '/repo/b'],
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('moves Repositories upward above the target', async () => {
    const { controller, repositoryRegistry, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([repository('/repo/d')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(repository('/repo/b'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(repositoryRegistry.replace).toHaveBeenCalledWith(
      ['/repo/a', '/repo/d', '/repo/b', '/repo/c'],
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('ignores Repository drops on empty space', async () => {
    const { controller, repositoryRegistry, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([repository('/repo/b')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(undefined, dataTransfer as vscode.DataTransfer, {} as never);

    expect(vscodeState.repositories).toEqual(['/repo/a', '/repo/b', '/repo/c', '/repo/d']);
    expect(repositoryRegistry.replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores Repository drops onto Worktree rows', async () => {
    const { controller, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([repository('/repo/b')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(
      worktree('/repo/a', '/repo/a-feature'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(vscodeState.repositories).toEqual(['/repo/a', '/repo/b', '/repo/c', '/repo/d']);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reorders sibling Worktrees and refreshes the tree', async () => {
    const { controller, refresh, worktreeOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [worktree('/repo/a', '/repo/a-feature')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      worktree('/repo/a', '/repo/a-main'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(worktreeOrders.set).toHaveBeenCalledWith('/git/a', [
      '/repo/a-feature',
      '/repo/a-main',
      '/repo/a-fix',
    ]);
    expect(refresh).toHaveBeenCalledWith({ repositoryPath: '/repo/a' });
  });

  it('reorders Worktrees from the reconciled stored order', async () => {
    const { controller, refresh, worktreeOrders } = createController();
    vi.mocked(worktreeOrders.get).mockReturnValue(['/repo/a-fix', '/repo/a-main']);
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [worktree('/repo/a', '/repo/a-feature')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      worktree('/repo/a', '/repo/a-main'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(worktreeOrders.set).toHaveBeenCalledWith('/git/a', [
      '/repo/a-fix',
      '/repo/a-feature',
      '/repo/a-main',
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('reorders sibling Terminals and refreshes the tree', async () => {
    const { controller, refresh, terminalOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-3')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(terminalOrders.set).toHaveBeenCalledWith('/repo/a-main', [
      'wt-_repo_a-main__term-3',
      'wt-_repo_a-main__term-1',
      'wt-_repo_a-main__term-2',
      'http://localhost:5173/',
    ]);
    expect(refresh).toHaveBeenCalledWith({ worktreePath: '/repo/a-main' });
  });

  it('reorders an uncurated Bookmark among its Worktree rows', async () => {
    const { controller, refresh, terminalOrders } = createController();
    vi.mocked(terminalOrders.get).mockReturnValue([
      'wt-_repo_a-main__term-1',
      'wt-_repo_a-main__term-2',
      'wt-_repo_a-main__term-3',
    ]);
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [bookmark('/repo/a', '/repo/a-main', 'http://localhost:5173/')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-2'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(terminalOrders.set).toHaveBeenCalledWith('/repo/a-main', [
      'wt-_repo_a-main__term-1',
      'http://localhost:5173/',
      'wt-_repo_a-main__term-2',
      'wt-_repo_a-main__term-3',
    ]);
    expect(refresh).toHaveBeenCalledWith({ worktreePath: '/repo/a-main' });
  });

  it('preserves stored Terminal keys when reordering a Bookmark with no observed sessions', async () => {
    const { controller, terminalOrders } = createController();
    vi.mocked(terminalOrders.get).mockReturnValue([
      'wt-_repo_a-main__term-3',
      'http://localhost:5173/',
      'wt-_repo_a-main__term-1',
      'wt-_repo_a-main__term-2',
    ]);
    vscodeState.listSessions.mockResolvedValue([]);
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [bookmark('/repo/a', '/repo/a-main', 'http://localhost:5173/')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-3'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(terminalOrders.set).toHaveBeenCalledWith('/repo/a-main', [
      'http://localhost:5173/',
      'wt-_repo_a-main__term-3',
      'wt-_repo_a-main__term-1',
      'wt-_repo_a-main__term-2',
    ]);
  });

  it('moves a Bookmark across Repositories onto a Worktree and appends it to its rows', async () => {
    const { bookmarks, controller, refresh, terminalOrders } = createBookmarkMoveController();
    const url = 'https://github.com/org/repo/pull/192';
    const moved = { url, label: 'PR 192' };
    const targetBookmark = { url: 'https://example.com/target' };
    await bookmarks.add('/repo/a-main', moved);
    await bookmarks.add('/repo/b-main', targetBookmark);
    await terminalOrders.set('/repo/a-main', ['wt-_repo_a-main__term-1', url]);
    await terminalOrders.set('/repo/b-main', [
      targetBookmark.url,
      'wt-_repo_b-main__term-1',
    ]);
    vscodeState.listSessions.mockImplementation(async (prefix: string | undefined) => {
      if (prefix === 'wt-_repo_a-main__term-') {
        return [{ sessionName: 'wt-_repo_a-main__term-1', windowName: 'source' }];
      }
      return [{ sessionName: 'wt-_repo_b-main__term-1', windowName: 'target' }];
    });
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [bookmark('/repo/a', '/repo/a-main', url)],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      worktree('/repo/b', '/repo/b-main'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(bookmarks.list('/repo/a-main')).toEqual([]);
    expect(bookmarks.list('/repo/b-main')).toEqual([targetBookmark, moved]);
    expect(terminalOrders.get('/repo/a-main')).toEqual([
      'wt-_repo_a-main__term-1',
    ]);
    expect(terminalOrders.get('/repo/b-main')).toEqual([
      targetBookmark.url,
      'wt-_repo_b-main__term-1',
      url,
    ]);
    expect(refresh).toHaveBeenCalledWith({ worktreePath: '/repo/a-main' });
    expect(refresh).toHaveBeenCalledWith({ worktreePath: '/repo/b-main' });
  });

  it('moves a Bookmark to a specific position among another Worktree rows', async () => {
    const { bookmarks, controller, terminalOrders } = createBookmarkMoveController();
    const url = 'https://github.com/org/repo/pull/192';
    await bookmarks.add('/repo/a-main', { url });
    await terminalOrders.set('/repo/a-main', ['wt-_repo_a-main__term-1', url]);
    await terminalOrders.set('/repo/a-feature', [
      'wt-_repo_a-feature__term-1',
      'wt-_repo_a-feature__term-2',
    ]);
    vscodeState.listSessions.mockImplementation(async (prefix: string | undefined) => (
      prefix === 'wt-_repo_a-main__term-'
        ? [{ sessionName: 'wt-_repo_a-main__term-1', windowName: 'source' }]
        : [
            { sessionName: 'wt-_repo_a-feature__term-1', windowName: 'first' },
            { sessionName: 'wt-_repo_a-feature__term-2', windowName: 'second' },
          ]
    ));
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [bookmark('/repo/a', '/repo/a-main', url)],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-feature', 'wt-_repo_a-feature__term-2'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(bookmarks.list('/repo/a-main')).toEqual([]);
    expect(bookmarks.list('/repo/a-feature')).toEqual([{ url }]);
    expect(terminalOrders.get('/repo/a-feature')).toEqual([
      'wt-_repo_a-feature__term-1',
      url,
      'wt-_repo_a-feature__term-2',
    ]);
  });

  it('preserves both Worktrees stored Terminal keys when moving a Bookmark with no observed sessions', async () => {
    const { bookmarks, controller, terminalOrders } = createBookmarkMoveController();
    const url = 'https://github.com/org/repo/pull/196';
    const targetBookmark = { url: 'https://example.com/target' };
    await bookmarks.add('/repo/a-main', { url });
    await bookmarks.add('/repo/a-feature', targetBookmark);
    await terminalOrders.set('/repo/a-main', [
      'wt-_repo_a-main__term-3',
      url,
      'wt-_repo_a-main__term-1',
    ]);
    await terminalOrders.set('/repo/a-feature', [
      'wt-_repo_a-feature__term-2',
      targetBookmark.url,
      'wt-_repo_a-feature__term-1',
    ]);
    vscodeState.listSessions.mockResolvedValue([]);
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [bookmark('/repo/a', '/repo/a-main', url)],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-feature', 'wt-_repo_a-feature__term-1'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(terminalOrders.get('/repo/a-main')).toEqual([
      'wt-_repo_a-main__term-3',
      'wt-_repo_a-main__term-1',
    ]);
    expect(terminalOrders.get('/repo/a-feature')).toEqual([
      'wt-_repo_a-feature__term-2',
      targetBookmark.url,
      url,
      'wt-_repo_a-feature__term-1',
    ]);
  });

  it('does not duplicate a target Worktree row that already has the moved Bookmark URL', async () => {
    const { bookmarks, controller, terminalOrders } = createBookmarkMoveController();
    const url = 'https://github.com/org/repo/pull/192';
    await bookmarks.add('/repo/a-main', { url, label: 'Source label' });
    await bookmarks.add('/repo/a-feature', { url, label: 'Target label' });
    await terminalOrders.set('/repo/a-main', ['wt-_repo_a-main__term-1', url]);
    await terminalOrders.set('/repo/a-feature', ['wt-_repo_a-feature__term-1', url]);
    vscodeState.listSessions.mockImplementation(async (prefix: string | undefined) => (
      prefix === 'wt-_repo_a-main__term-'
        ? [{ sessionName: 'wt-_repo_a-main__term-1', windowName: 'source' }]
        : [{ sessionName: 'wt-_repo_a-feature__term-1', windowName: 'target' }]
    ));
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [bookmark('/repo/a', '/repo/a-main', url)],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      worktree('/repo/a', '/repo/a-feature'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(bookmarks.list('/repo/a-main')).toEqual([]);
    expect(bookmarks.list('/repo/a-feature')).toEqual([{ url, label: 'Source label' }]);
    expect(terminalOrders.get('/repo/a-feature')).toEqual([
      'wt-_repo_a-feature__term-1',
      url,
    ]);
  });

  it('reorders an internal Terminal drag even when VS Code also adds a resourceUri uri-list', async () => {
    const { controller, refresh, terminalOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-3')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    // VS Code auto-adds the dragged node's resourceUri to text/uri-list; this
    // must not be mistaken for an external folder drop.
    dataTransfer.set(
      'text/uri-list',
      new vscode.DataTransferItem('file:///terminal/wt-_repo_a-main__term-3'),
    );
    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(terminalOrders.set).toHaveBeenCalledWith('/repo/a-main', [
      'wt-_repo_a-main__term-3',
      'wt-_repo_a-main__term-1',
      'wt-_repo_a-main__term-2',
      'http://localhost:5173/',
    ]);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('reorders Terminals from live term-N order when no TerminalOrder is stored', async () => {
    const { controller, refresh, terminalOrders } = createController();
    vi.mocked(terminalOrders.get).mockReturnValue(undefined);
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-3'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(terminalOrders.set).toHaveBeenCalledWith('/repo/a-main', [
      'wt-_repo_a-main__term-2',
      'wt-_repo_a-main__term-3',
      'wt-_repo_a-main__term-1',
      'http://localhost:5173/',
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('ignores Terminal drops onto another Worktree terminal', async () => {
    const { controller, refresh, terminalOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-feature', 'wt-_repo_a-feature__term-1'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(terminalOrders.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores Terminal drops onto non-Terminal rows and empty space', async () => {
    const { controller, refresh, terminalOrders } = createController();
    const repositoryDrop = new DataTransferMock();
    const worktreeDrop = new DataTransferMock();
    const emptyDrop = new DataTransferMock();

    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1')],
      repositoryDrop as vscode.DataTransfer,
      {} as never,
    );
    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1')],
      worktreeDrop as vscode.DataTransfer,
      {} as never,
    );
    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1')],
      emptyDrop as vscode.DataTransfer,
      {} as never,
    );

    await controller.handleDrop?.(repository('/repo/a'), repositoryDrop as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(
      worktree('/repo/a', '/repo/a-main'),
      worktreeDrop as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(undefined, emptyDrop as vscode.DataTransfer, {} as never);

    expect(terminalOrders.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores Worktree drops onto Repository rows', async () => {
    const { controller, refresh, worktreeOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [worktree('/repo/a', '/repo/a-feature')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(repository('/repo/b'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(vscodeState.repositories).toEqual(['/repo/a', '/repo/b', '/repo/c', '/repo/d']);
    expect(worktreeOrders.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores Worktree drops onto another Repository worktree', async () => {
    const { controller, refresh, worktreeOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [worktree('/repo/a', '/repo/a-feature')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      worktree('/repo/b', '/repo/b-main'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(worktreeOrders.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('registers one external uri-list folder drop and shows post-add actions', async () => {
    const { activeWorktrees, controller, repositoryRegistry, refresh, reveal, switcher } = createController();
    vscodeState.repositories = ['/repo/a'];
    vscodeState.getCommonDirSafe.mockImplementation(async (worktreePath: string) => {
      if (worktreePath === '/dropped/main') return '/git/dropped';
      if (worktreePath === '/repo/a') return '/git/a';
      return null;
    });
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Switch');
    const dataTransfer = new DataTransferMock();
    dataTransfer.set('text/uri-list', new vscode.DataTransferItem('file:///dropped/main'));

    await controller.handleDrop?.(undefined, dataTransfer as vscode.DataTransfer, {} as never);

    expect(repositoryRegistry.append).toHaveBeenCalledWith('/dropped/main');
    expect(vscodeState.repositories).toEqual(['/repo/a', '/dropped/main']);
    expect(activeWorktrees.set).toHaveBeenCalledWith('/git/dropped', '/dropped/main');
    expect(refresh).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith('/dropped/main');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Added repository main.',
      'Switch',
      'Open in New Window',
    );
    expect(switcher.switchTo).toHaveBeenCalledWith('/dropped/main');
  });

  it('ignores an external uri-list drop carrying only files', async () => {
    const { activeWorktrees, controller, repositoryRegistry, refresh, reveal } = createController();
    vscodeState.discoverySeedsFromDrop.mockResolvedValueOnce([]);
    const dataTransfer = new DataTransferMock();
    dataTransfer.set('text/uri-list', new vscode.DataTransferItem('file:///dropped/photo.jpg'));

    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(repositoryRegistry.append).not.toHaveBeenCalled();
    expect(activeWorktrees.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('registers multiple external uri-list folder drops silently and reveals the last', async () => {
    const { activeWorktrees, controller, repositoryRegistry, refresh, reveal } = createController();
    vscodeState.repositories = ['/repo/a'];
    vscodeState.getCommonDirSafe.mockImplementation(async (worktreePath: string) => {
      if (worktreePath === '/dropped/one') return '/git/one';
      if (worktreePath === '/dropped/two') return '/git/two';
      if (worktreePath === '/repo/a') return '/git/a';
      return null;
    });
    const dataTransfer = new DataTransferMock();
    dataTransfer.set(
      'text/uri-list',
      new vscode.DataTransferItem('# explorer selection\nfile:///dropped/one\nfile:///dropped/two'),
    );

    await controller.handleDrop?.(undefined, dataTransfer as vscode.DataTransfer, {} as never);

    expect(repositoryRegistry.append).toHaveBeenCalledWith('/dropped/one');
    expect(repositoryRegistry.append).toHaveBeenCalledWith('/dropped/two');
    expect(vscodeState.repositories).toEqual(['/repo/a', '/dropped/one', '/dropped/two']);
    expect(activeWorktrees.set).toHaveBeenCalledWith('/git/one', '/dropped/one');
    expect(activeWorktrees.set).toHaveBeenCalledWith('/git/two', '/dropped/two');
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(reveal).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith('/dropped/two');
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });
});
