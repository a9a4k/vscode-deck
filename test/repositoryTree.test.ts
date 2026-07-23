import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  emitters: [] as Array<{ fire: ReturnType<typeof vi.fn> }>,
  workspaceFolders: [{ uri: { fsPath: '/work/beta-main' } }] as Array<{ uri: { fsPath: string } }>,
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vi.fn(),
  },
  EventEmitter: class {
    readonly event = vi.fn();
    fire = vi.fn();

    constructor() {
      vscodeState.emitters.push(this);
    }
  },
  ThemeColor: class {
    constructor(readonly id: string) {}
  },
  ThemeIcon: class {
    constructor(readonly id: string, readonly color?: unknown) {}
  },
  TreeItem: class {
    contextValue?: string;
    description?: string;
    iconPath?: unknown;
    command?: unknown;

    constructor(
      readonly label: string,
      readonly collapsibleState?: number,
    ) {}
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    from: (value: { scheme: string; authority: string; path: string; query: string }) => value,
  },
  window: {
    showErrorMessage: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: <T>(_key: string, defaultValue: T) =>
        ['/work/alpha-main', '/work/beta-main'] as T,
      update: vi.fn(),
    })),
    get workspaceFolders() {
      return vscodeState.workspaceFolders;
    },
  },
}));

vi.mock('../src/git/worktrees', () => ({
  getCommonDir: vi.fn(async (worktreePath: string) =>
    worktreePath.startsWith('/work/alpha') ? '/git/alpha' : '/git/beta',
  ),
  getCommonDirSafe: vi.fn(async (worktreePath: string) =>
    worktreePath.startsWith('/work/alpha') ? '/git/alpha' : '/git/beta',
  ),
  listWorktrees: vi.fn(async (repositoryPath: string) => {
    if (repositoryPath === '/work/alpha-main') {
      return [
        {
          path: '/work/alpha-main',
          head: 'a',
          bare: false,
          detached: false,
          branch: 'main',
        },
        {
          path: '/work/alpha-feature',
          head: 'aa',
          bare: false,
          detached: false,
          branch: 'feature',
        },
      ];
    }

    return [
      {
        path: '/work/beta-main',
        head: 'b',
        bare: false,
        detached: false,
        branch: 'main',
      },
    ];
  }),
}));

import * as vscode from 'vscode';
import { ActiveWorktreeStore } from '../src/switch/activeWorktreeStore';
import { RepositoryTreeProvider } from '../src/tree/repositoryTree';
import { TerminalOrderStore } from '../src/terminal/terminalOrderStore';
import { WorktreeListCacheStore } from '../src/worktree/worktreeListCacheStore';
import { WorktreeOrderStore } from '../src/worktree/worktreeOrderStore';
import { RepositoryCommonDirCache } from '../src/repository/repositoryCommonDirCache';
import { RepositoryRegistryStore } from '../src/repository/repositoryRegistryStore';
import { getCommonDir, listWorktrees, type Worktree } from '../src/git/worktrees';
import { TerminalModel } from '../src/terminal/terminalModel';
import { WorktreeReconciler } from '../src/worktree/worktreeReconciler';

function registry(repositories = ['/work/alpha-main', '/work/beta-main']) {
  return {
    list: vi.fn(() => repositories),
  } as unknown as RepositoryRegistryStore;
}

const alphaMainWorktree: Worktree = {
  path: '/work/alpha-main',
  head: 'a',
  bare: false,
  detached: false,
  branch: 'main',
};

const alphaFeatureWorktree: Worktree = {
  path: '/work/alpha-feature',
  head: 'aa',
  bare: false,
  detached: false,
  branch: 'feature',
};

function observedModel(sessions: Parameters<TerminalModel['apply']>[0] = []): TerminalModel {
  const model = new TerminalModel();
  model.apply(sessions);
  return model;
}

function warmWorktreeCache(): WorktreeListCacheStore {
  return {
    get: vi.fn((commonDir: string) =>
      commonDir === '/git/alpha'
        ? [alphaMainWorktree, alphaFeatureWorktree]
        : [{
            path: '/work/beta-main',
            head: 'b',
            bare: false,
            detached: false,
            branch: 'main',
          }]),
    set: vi.fn(async () => undefined),
  } as unknown as WorktreeListCacheStore;
}

function knownCommonDirs(): RepositoryCommonDirCache {
  return {
    get: vi.fn((repositoryPath: string) =>
      repositoryPath.startsWith('/work/alpha') ? '/git/alpha' : '/git/beta'),
    set: vi.fn(async () => undefined),
  } as unknown as RepositoryCommonDirCache;
}

describe('RepositoryTreeProvider', () => {
  beforeEach(() => {
    vscodeState.emitters = [];
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/beta-main' } }];
  });

  it('renders Repository and Worktree rows without scheduling Git work', async () => {
    vi.mocked(getCommonDir).mockClear();
    vi.mocked(listWorktrees).mockClear();
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      {
        get: vi.fn(() => '/git/alpha'),
        set: vi.fn(async () => undefined),
      } as unknown as RepositoryCommonDirCache,
    );

    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync Repository roots');
    const worktrees = provider.getChildren(repositories[0]);

    expect(worktrees).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getCommonDir).not.toHaveBeenCalled();
    expect(listWorktrees).not.toHaveBeenCalled();
  });

  it('updates a detached Worktree tooltip after its Repository reconciles', async () => {
    const detached = (head: string): Worktree => ({
      path: '/work/alpha-detached',
      head,
      bare: false,
      detached: true,
    });
    let cached: Worktree[] = [alphaMainWorktree, detached('11111112222222')];
    const worktreeListCache = {
      get: vi.fn(() => cached),
      set: vi.fn(async (_commonDir: string, worktrees: readonly Worktree[]) => {
        cached = [...worktrees];
      }),
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      worktreeListCache as unknown as WorktreeListCacheStore,
      knownCommonDirs(),
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync Repository roots');
    provider.getChildren(repositories[0]);
    vscodeState.emitters[0].fire.mockClear();
    const reconciler = new WorktreeReconciler({
      repositories: registry(['/work/alpha-main']),
      commonDirs: {
        get: () => '/git/alpha',
        resolve: async () => '/git/alpha',
      },
      worktreeListCache,
      worktreeOrders: {
        get: () => undefined,
        set: async () => undefined,
      },
      listWorktrees: async () => [alphaMainWorktree, detached('aaaaaaabbbbbbb')],
      activeWorktreePath: () => undefined,
      refreshRepository: (repositoryPath) => provider.refreshRepository(repositoryPath),
    });

    await reconciler.reconcile('/work/alpha-main');

    expect(vscodeState.emitters[0].fire).toHaveBeenCalledWith(repositories[0]);
    const worktrees = provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected sync Worktree rows');
    expect(worktrees[1].tooltip).toBe('/work/alpha-detached\nDetached HEAD · aaaaaaa');
  });

  it('marks only the currently mounted worktree as active', async () => {
    const get = vi.fn((commonDir: string) =>
      commonDir === '/git/alpha' ? '/work/alpha-main' : '/work/beta-main',
    );
    const activeWorktrees = {
      get,
    } as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(),
    } as unknown as WorktreeOrderStore;
    const provider = new RepositoryTreeProvider(
      registry(),
      activeWorktrees,
      worktreeOrders,
      warmWorktreeCache(),
      knownCommonDirs(),
    );

    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');

    const worktreeNodes = (
      await Promise.all(repositories.map((repository) => provider.getChildren(repository)))
    ).flat();

    expect(worktreeNodes.map((node) => node.contextValue)).toEqual([
      'deck.worktree.main',
      'deck.worktree',
      'deck.worktree.active',
    ]);
    expect(worktreeNodes.map((node) => node.description)).toEqual([
      '',
      '',
      'active',
    ]);
    expect(worktreeNodes.map((node) => node.tooltip)).toEqual([
      '/work/alpha-main',
      '/work/alpha-feature',
      '/work/beta-main',
    ]);
    expect(worktreeNodes.map((node) => node.iconPath)).toEqual([undefined, undefined, undefined]);
    expect(get).not.toHaveBeenCalled();
  });

  it('uses the same active Worktree match for row text and decorations', async () => {
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main/.' } }];
    const provider = new RepositoryTreeProvider(
      registry(),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      knownCommonDirs(),
    );

    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');

    const worktreeNodes = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktreeNodes)) throw new Error('expected worktree children');

    expect(worktreeNodes.map((node) => node.description)).toEqual([
      'active',
      '',
    ]);
    expect(provider.isActiveWorktreeDecorationTarget('/work/alpha-main')).toBe(true);
  });

  it('invalidates old and new active Worktree decorations when the mounted folder changes', () => {
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
    const provider = new RepositoryTreeProvider(
      registry(),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
    );
    vscodeState.emitters[1].fire.mockClear();

    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/beta-main' } }];
    provider.refresh();

    expect(vscodeState.emitters[1].fire).toHaveBeenCalledWith([
      expect.objectContaining({ scheme: 'deck-status', path: '/worktree/%2Fwork%2Falpha-main' }),
      expect.objectContaining({ scheme: 'deck-status', path: '/worktree/%2Fwork%2Fbeta-main' }),
    ]);
  });

  it('fires only the old and new active Repository and Worktree rows when the workspace folder changes', () => {
    const provider = new RepositoryTreeProvider(
      registry(),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn((commonDir: string) =>
          commonDir === '/git/alpha'
            ? [alphaMainWorktree, alphaFeatureWorktree]
            : [{
                path: '/work/beta-main',
                head: 'b',
                bare: false,
                detached: false,
                branch: 'main',
              }]),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      {
        get: vi.fn((repositoryPath: string) =>
          repositoryPath.startsWith('/work/alpha') ? '/git/alpha' : '/git/beta'),
        set: vi.fn(async () => undefined),
      } as unknown as RepositoryCommonDirCache,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const alphaWorktrees = provider.getChildren(repositories[0]);
    const betaWorktrees = provider.getChildren(repositories[1]);
    if (!Array.isArray(alphaWorktrees) || !Array.isArray(betaWorktrees)) {
      throw new Error('expected sync cached worktrees');
    }
    vscodeState.emitters[0].fire.mockClear();

    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
    provider.refreshWorkspaceFolders();

    expect(vscodeState.emitters[0].fire.mock.calls).toEqual([
      [betaWorktrees[0]],
      [alphaWorktrees[0]],
      [repositories[1]],
      [repositories[0]],
    ]);
    expect(vscodeState.emitters[0].fire).not.toHaveBeenCalledWith(undefined);
    expect(betaWorktrees[0].description).toBe('');
    expect(alphaWorktrees[0].description).toBe('active');
    expect(repositories[1].description).toBe('');
    expect(repositories[0].description).toBe('active');
  });

  it('renders worktrees in stored order with unknown worktrees appended', async () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(() => ['/work/alpha-feature']),
    } as unknown as WorktreeOrderStore;
    const provider = new RepositoryTreeProvider(
      registry(),
      activeWorktrees,
      worktreeOrders,
      warmWorktreeCache(),
      knownCommonDirs(),
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    const worktreeNodes = await provider.getChildren(repositoryNode[0]);
    if (!Array.isArray(worktreeNodes)) throw new Error('expected worktree children');

    expect(worktreeOrders.get).toHaveBeenCalledWith('/git/alpha');
    expect(worktreeNodes.map((node) => ('worktree' in node ? node.worktree.path : ''))).toEqual([
      '/work/alpha-feature',
      '/work/alpha-main',
    ]);
    expect(worktreeNodes.map((node) => node.contextValue)).toEqual([
      'deck.worktree',
      'deck.worktree.main',
    ]);
  });

  it('does not prune stale WorktreeOrder entries while rendering', async () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(() => ['/work/missing', '/work/alpha-feature', '/work/alpha-main']),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeOrderStore;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      activeWorktrees,
      worktreeOrders,
      warmWorktreeCache(),
      knownCommonDirs(),
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    const worktreeNodes = await provider.getChildren(repositoryNode[0]);
    if (!Array.isArray(worktreeNodes)) throw new Error('expected worktree children');

    expect(worktreeNodes.map((node) => ('worktree' in node ? node.worktree.path : ''))).toEqual([
      '/work/alpha-feature',
      '/work/alpha-main',
    ]);
    expect(worktreeOrders.set).not.toHaveBeenCalled();
  });

  it('does not rewrite WorktreeOrder when every stored Worktree is live', async () => {
    const worktreeOrders = {
      get: vi.fn(() => ['/work/alpha-feature', '/work/alpha-main']),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeOrderStore;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      worktreeOrders,
      warmWorktreeCache(),
      knownCommonDirs(),
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    await provider.getChildren(repositoryNode[0]);

    expect(worktreeOrders.set).not.toHaveBeenCalled();
  });

  it('hides bare worktrees while keeping detached worktrees visible', async () => {
    const cached = [
      alphaMainWorktree,
      {
        path: '/git/alpha',
        head: '',
        bare: true,
        detached: false,
      },
      {
        path: '/work/alpha-detached',
        head: 'abcdef1234567890',
        bare: false,
        detached: true,
      },
    ];
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => cached),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      knownCommonDirs(),
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    const worktreeNodes = await provider.getChildren(repositoryNode[0]);
    if (!Array.isArray(worktreeNodes)) throw new Error('expected worktree children');

    expect(worktreeNodes.map((node) => ('worktree' in node ? node.worktree.path : ''))).toEqual([
      '/work/alpha-main',
      '/work/alpha-detached',
    ]);
    expect(worktreeNodes.map((node) => node.label)).toEqual([
      'main',
      'alpha-detached',
    ]);
  });

  it('renders warm cached worktrees synchronously without updating the cache', async () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(),
    } as unknown as WorktreeOrderStore;
    const worktreeListCache = {
      get: vi.fn(() => [
        {
          path: '/work/alpha-main',
          head: 'a',
          bare: false,
          detached: false,
          branch: 'main',
        },
      ]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const repositoryCommonDirCache = {
      get: vi.fn(() => '/git/alpha'),
      set: vi.fn(async () => undefined),
    } as unknown as RepositoryCommonDirCache;
    const provider = new RepositoryTreeProvider(
      registry(),
      activeWorktrees,
      worktreeOrders,
      worktreeListCache,
      repositoryCommonDirCache,
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    const worktreeNodes = provider.getChildren(repositoryNode[0]);

    expect(Array.isArray(worktreeNodes)).toBe(true);
    expect((worktreeNodes as Array<{ worktree: { path: string } }>).map((node) => node.worktree.path)).toEqual([
      '/work/alpha-main',
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worktreeListCache.set).not.toHaveBeenCalled();
  });

  it('does not fire the cached Repository while rendering Worktrees', async () => {
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => [alphaMainWorktree]),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    vscodeState.emitters[0].fire.mockClear();

    provider.getChildren(repositories[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vscodeState.emitters[0].fire).not.toHaveBeenCalled();
  });

  it('does not rewrite a warm cache while rendering', async () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(),
    } as unknown as WorktreeOrderStore;
    const worktreeListCache = {
      get: vi.fn(() => [
        {
          path: '/work/alpha-main',
          head: 'a',
          branch: 'main',
          bare: false,
          detached: false,
        },
        {
          path: '/work/alpha-feature',
          head: 'aa',
          branch: 'feature',
          bare: false,
          detached: false,
        },
      ]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const repositoryCommonDirCache = {
      get: vi.fn(() => '/git/alpha'),
      set: vi.fn(async () => undefined),
    } as unknown as RepositoryCommonDirCache;
    const provider = new RepositoryTreeProvider(
      registry(),
      activeWorktrees,
      worktreeOrders,
      worktreeListCache,
      repositoryCommonDirCache,
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    provider.getChildren(repositoryNode[0]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worktreeListCache.set).not.toHaveBeenCalled();
  });

  it('does not discover creation timestamps while rendering', async () => {
    vi.mocked(listWorktrees).mockResolvedValueOnce([
      {
        path: '/work/alpha-main',
        head: 'a',
        branch: 'main',
        bare: false,
        detached: false,
      },
      {
        path: '/work/alpha-feature',
        head: 'aa',
        branch: 'feature',
        bare: false,
        detached: false,
        createdAt: 1234,
      },
    ]);
    const worktreeListCache = {
      get: vi.fn(() => [
        {
          path: '/work/alpha-main',
          head: 'a',
          branch: 'main',
          bare: false,
          detached: false,
        },
        {
          path: '/work/alpha-feature',
          head: 'aa',
          branch: 'feature',
          bare: false,
          detached: false,
        },
      ]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      worktreeListCache,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    provider.getChildren(repositoryNode[0]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worktreeListCache.set).not.toHaveBeenCalled();
  });

  it('hides pending worktree removals from warm cached rows', () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(),
    } as unknown as WorktreeOrderStore;
    const worktreeListCache = {
      get: vi.fn(() => [
        {
          path: '/work/alpha-main',
          head: 'a',
          bare: false,
          detached: false,
          branch: 'main',
        },
        {
          path: '/work/alpha-feature',
          head: 'aa',
          bare: false,
          detached: false,
          branch: 'feature',
        },
      ]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const repositoryCommonDirCache = {
      get: vi.fn(() => '/git/alpha'),
      set: vi.fn(async () => undefined),
    } as unknown as RepositoryCommonDirCache;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      activeWorktrees,
      worktreeOrders,
      worktreeListCache,
      repositoryCommonDirCache,
      true,
      undefined,
      new Set(['/work/alpha-feature']),
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    const worktreeNodes = provider.getChildren(repositoryNode[0]);

    expect(Array.isArray(worktreeNodes)).toBe(true);
    expect((worktreeNodes as Array<{ worktree: { path: string } }>).map((node) => node.worktree.path)).toEqual([
      '/work/alpha-main',
    ]);
  });

  it('does not re-add pending Worktree removals while rendering', async () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(),
    } as unknown as WorktreeOrderStore;
    const worktreeListCache = {
      get: vi.fn(() => [
        {
          path: '/work/alpha-main',
          head: 'a',
          bare: false,
          detached: false,
          branch: 'main',
        },
      ]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const repositoryCommonDirCache = {
      get: vi.fn(() => '/git/alpha'),
      set: vi.fn(async () => undefined),
    } as unknown as RepositoryCommonDirCache;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      activeWorktrees,
      worktreeOrders,
      worktreeListCache,
      repositoryCommonDirCache,
      true,
      undefined,
      new Set(['/work/alpha-feature']),
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    provider.getChildren(repositoryNode[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(worktreeListCache.set).not.toHaveBeenCalled();
  });

  it('keeps a stale refresh from re-adding a removal that settled while it was in flight', async () => {
    const pendingRemovals = new Set(['/work/alpha-feature']);
    const worktreeListCache = {
      get: vi.fn(() => [alphaMainWorktree]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      worktreeListCache,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      true,
      undefined,
      pendingRemovals,
    );
    vi.mocked(listWorktrees).mockResolvedValueOnce([
      alphaMainWorktree,
      alphaFeatureWorktree,
    ]);

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');
    provider.getChildren(repositoryNode[0]);
    pendingRemovals.delete('/work/alpha-feature');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(worktreeListCache.set).not.toHaveBeenCalled();
  });

  it('does not update the cache when a removal becomes pending during rendering', async () => {
    const pendingRemovals = new Set<string>();
    const worktreeListCache = {
      get: vi.fn(() => [alphaMainWorktree, alphaFeatureWorktree]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      worktreeListCache,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      true,
      undefined,
      pendingRemovals,
    );
    vi.mocked(listWorktrees).mockResolvedValueOnce([
      alphaMainWorktree,
      alphaFeatureWorktree,
    ]);

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');
    provider.getChildren(repositoryNode[0]);
    pendingRemovals.add('/work/alpha-feature');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(worktreeListCache.set).not.toHaveBeenCalled();
  });

  it('reads root Repositories from RepositoryRegistryStore without reading deck.repositories settings', () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(),
    } as unknown as WorktreeOrderStore;
    const repositoryRegistry = registry(['/work/beta-main']);
    const provider = new RepositoryTreeProvider(repositoryRegistry, activeWorktrees, worktreeOrders);

    const repositories = provider.getChildren();

    expect(Array.isArray(repositories)).toBe(true);
    expect((repositories as Array<{ repositoryPath: string }>).map((node) => node.repositoryPath)).toEqual([
      '/work/beta-main',
    ]);
    expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
  });

  it('does not resolve a Repository common dir while rendering roots', async () => {
    vi.mocked(getCommonDir).mockClear();
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    vscodeState.emitters[0].fire.mockClear();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vscodeState.emitters[0].fire).not.toHaveBeenCalled();
    expect(getCommonDir).not.toHaveBeenCalled();
  });

  it('updates and fires the cached Repository when active-repository resolution completes', async () => {
    let commonDir: string | undefined;
    const provider = new RepositoryTreeProvider(
      registry(['/work/beta-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      {
        get: vi.fn(() => commonDir),
        set: vi.fn(async (_repositoryPath: string, resolvedCommonDir: string) => {
          commonDir = resolvedCommonDir;
        }),
      } as unknown as RepositoryCommonDirCache,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    vscodeState.emitters[0].fire.mockClear();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(repositories[0].description).toBe('active');
    expect(vscodeState.emitters[0].fire).toHaveBeenCalledWith(repositories[0]);
    expect(vscodeState.emitters[0].fire).not.toHaveBeenCalledWith(undefined);
  });

  it('renders existing Worktree terminals expanded without the add row when tmux is available', async () => {
    const model = observedModel([
      { sessionName: 'wt-_work_alpha-main__term-2', windowName: 'claude' },
      { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
    ]);
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');

    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    expect(worktrees.map((worktree) => worktree.collapsibleState)).toEqual([2, 2]);
    expect(worktrees[0].command).toBeUndefined();
    const terminalRows = await provider.getChildren(worktrees[0]);
    const emptyRows = await provider.getChildren(worktrees[1]);

    expect(Array.isArray(terminalRows)).toBe(true);
    expect(emptyRows).toEqual([]);
    expect((terminalRows as Array<{ label: string; command?: { command: string } }>)).toEqual([
      expect.objectContaining({
        label: 'zsh',
        tooltip: 'term-1',
        command: expect.objectContaining({ command: 'deck.openTerminal' }),
        worktreePath: '/work/alpha-main',
        contextValue: 'deck.terminal.foreign',
      }),
      expect.objectContaining({
        label: 'claude',
        tooltip: 'term-2',
        command: expect.objectContaining({ command: 'deck.openTerminal' }),
        worktreePath: '/work/alpha-main',
        contextValue: 'deck.terminal.foreign',
      }),
    ]);
  });

  it('renders Terminals in stored order with unknown live Terminals appended by term-N', async () => {
    const model = observedModel([
      { sessionName: 'wt-_work_alpha-main__term-3', windowName: 'three' },
      { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'one' },
      { sessionName: 'wt-_work_alpha-main__term-2', windowName: 'two' },
    ]);
    const terminalOrders = {
      get: vi.fn(() => ['wt-_work_alpha-main__term-2']),
    } as unknown as TerminalOrderStore;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
      new Set(),
      undefined,
      terminalOrders,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    const terminalRows = await provider.getChildren(worktrees[0]);

    expect((terminalRows as Array<{ label: string }>).map((row) => row.label)).toEqual([
      'two',
      'one',
      'three',
    ]);
    expect(terminalOrders.get).toHaveBeenCalledWith('/work/alpha-main');
  });

  it('relabels only the rendered Terminal row when its working status changes', async () => {
    const model = observedModel([
      {
        sessionName: 'wt-_work_alpha-main__term-1',
        windowName: 'claude',
        paneTitle: '✳ reconcile checkout state',
      },
    ]);
    let statusChange: (() => void) | undefined;
    let status = { status: 'completed' as const, statusAt: 1710000000 };
    const agentStatuses = {
      get: vi.fn((sessionName: string) =>
        sessionName === 'wt-_work_alpha-main__term-1'
          ? status
          : undefined,
      ),
      entries: vi.fn(() => new Map().entries()),
      onDidChange: vi.fn((listener: () => void) => {
        statusChange = listener;
        return { dispose: vi.fn() };
      }),
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
      new Set(),
      agentStatuses,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    const terminalRows = await provider.getChildren(worktrees[0]);
    vscodeState.emitters[0].fire.mockClear();
    status = { status: 'inProgress' as const, statusAt: 1710000001 };
    statusChange?.();

    expect((terminalRows as Array<{ label: string }>)[0].label).toBe('reconcile checkout state');
    expect((terminalRows as Array<{ iconPath: { fsPath: string } }>)[0].iconPath.fsPath)
      .toMatch(/resources\/claude-working-padded\.gif$/);
    expect(vscodeState.emitters[0].fire).toHaveBeenCalledOnce();
    expect(vscodeState.emitters[0].fire).toHaveBeenCalledWith(terminalRows[0]);
    expect(vscodeState.emitters[0].fire).not.toHaveBeenCalledWith(undefined);
  });

  it('does not repaint Terminal rows when only the status message changes', async () => {
    const model = observedModel([
      {
        sessionName: 'wt-_work_alpha-main__term-1',
        windowName: 'claude',
        paneTitle: '✳ reconcile checkout state',
      },
    ]);
    let status = {
      status: 'inProgress' as const,
      statusAt: 1710000000,
      message: 'first',
    };
    let statusChange: (() => void) | undefined;
    const agentStatuses = {
      get: vi.fn((sessionName: string) =>
        sessionName === 'wt-_work_alpha-main__term-1' ? status : undefined,
      ),
      entries: vi.fn(() => new Map().entries()),
      onDidChange: vi.fn((listener: () => void) => {
        statusChange = listener;
        return { dispose: vi.fn() };
      }),
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
      new Set(),
      agentStatuses,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');
    await provider.getChildren(worktrees[0]);
    vscodeState.emitters[0].fire.mockClear();

    status = {
      status: 'inProgress',
      statusAt: 1710000001,
      message: 'second',
    };
    statusChange?.();

    expect(vscodeState.emitters[0].fire).not.toHaveBeenCalled();
  });

  it('renders a Codex identity icon for a codex window before status exists', async () => {
    const model = observedModel([
      { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'codex' },
    ]);
    const agentStatuses = {
      get: vi.fn(() => undefined),
      entries: vi.fn(() => new Map().entries()),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
      new Set(),
      agentStatuses,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    const terminalRows = await provider.getChildren(worktrees[0]);

    expect((terminalRows as Array<{ iconPath: { fsPath: string } }>)[0].iconPath.fsPath)
      .toMatch(/resources\/codex-code-padded\.png$/);
  });

  it('sets deck-status resource URIs without inline status descriptions on Terminal rows', async () => {
    const model = observedModel([
      { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'claude' },
    ]);
    const agentStatuses = {
      get: vi.fn(() => ({ status: 'needsInput' as const, statusAt: 1710000000 })),
      entries: vi.fn(() => new Map().entries()),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
      new Set(),
      agentStatuses,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    const terminalRows = await provider.getChildren(worktrees[0]);

    expect((terminalRows as Array<{
      description?: string;
      iconPath: { fsPath: string };
      resourceUri: { scheme: string; path: string };
    }>)[0])
      .toEqual(expect.objectContaining({
        description: undefined,
        iconPath: expect.objectContaining({
          fsPath: expect.stringMatching(/resources\/claude-code-padded\.png$/),
        }),
        resourceUri: expect.objectContaining({
          scheme: 'deck-status',
          path: '/terminal/wt-_work_alpha-main__term-1',
        }),
      }));
  });

  it('keeps Repository and Worktree descriptions free of agent status rollups', async () => {
    const statuses = new Map([
      ['wt-_work_alpha-main__term-1', { status: 'needsInput' as const, statusAt: 1710000000 }],
      ['wt-_work_alpha-feature__term-1', { status: 'completed' as const, statusAt: 1710000001 }],
      ['wt-_work_alpha-feature__term-2', { status: 'needsInput' as const, statusAt: 1710000002 }],
      ['wt-_work_beta-main__term-1', { status: 'needsInput' as const, statusAt: 1710000003 }],
    ]);
    const agentStatuses = {
      get: vi.fn((sessionName: string) => statuses.get(sessionName)),
      entries: vi.fn(() => statuses.entries()),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(() => [alphaMainWorktree, alphaFeatureWorktree]), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      {
        get: vi.fn((path: string) => (path === '/work/alpha-main' ? '/git/alpha' : '/git/beta')),
        set: vi.fn(async () => undefined),
      } as unknown as RepositoryCommonDirCache,
      observedModel(),
      true,
      new Set(),
      agentStatuses,
    );

    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected cached worktree children');

    expect(repositories[0].description).toBe('');
    expect(worktrees.map((worktree) => worktree.description)).toEqual([
      '',
      '',
    ]);
    expect(worktrees.map((worktree) => worktree.tooltip)).toEqual([
      '/work/alpha-main',
      '/work/alpha-feature',
    ]);
  });

  it('rolls agent status up to a collapsed Repository before its Worktrees render', () => {
    const sessionName = 'wt-_work_alpha-main__term-1';
    const statuses = new Map([
      [sessionName, { status: 'needsInput' as const, statusAt: 1710000000 }],
    ]);
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      observedModel(),
      true,
      new Set(),
      {
        get: vi.fn((name: string) => statuses.get(name)),
        entries: vi.fn(() => statuses.entries()),
        onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      },
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');

    provider.updateTerminalDecorations([
      {
        repositoryPath: '/work/alpha-main',
        worktreePath: '/work/alpha-main',
        sessionName,
      },
    ]);
    provider.setCollapsed(repositories[0], true);

    expect(
      provider.agentStatusDecorationRollups
        .getDecorationStatus('repository', '/work/alpha-main')?.status,
    ).toBe('needsInput');
  });

  it('returns the registered parent instances for Worktree and Terminal rows', async () => {
    const model = observedModel([
      { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
    ]);
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');
    const terminals = await provider.getChildren(worktrees[0]);
    if (!Array.isArray(terminals)) throw new Error('expected terminal children');

    expect(provider.getParent(worktrees[0])).toBe(repositories[0]);
    expect(provider.getParent(terminals[0])).toBe(worktrees[0]);
  });

  it('keeps Repository and Worktree node identity across child reads', () => {
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => [alphaMainWorktree, alphaFeatureWorktree]),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
    );

    const firstRepositories = provider.getChildren();
    const secondRepositories = provider.getChildren();
    if (!Array.isArray(firstRepositories) || !Array.isArray(secondRepositories)) {
      throw new Error('expected sync repository roots');
    }
    const firstWorktrees = provider.getChildren(firstRepositories[0]);
    const secondWorktrees = provider.getChildren(secondRepositories[0]);
    if (!Array.isArray(firstWorktrees) || !Array.isArray(secondWorktrees)) {
      throw new Error('expected sync cached worktrees');
    }

    expect(secondRepositories[0]).toBe(firstRepositories[0]);
    expect(secondWorktrees[0]).toBe(firstWorktrees[0]);
    expect(secondWorktrees[1]).toBe(firstWorktrees[1]);
  });

  it('evicts a removed Repository after firing the root', () => {
    let repositoryPaths = ['/work/alpha-main', '/work/beta-main'];
    const provider = new RepositoryTreeProvider(
      {
        list: vi.fn(() => repositoryPaths),
      } as unknown as RepositoryRegistryStore,
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
    );
    const first = provider.getChildren();
    if (!Array.isArray(first)) throw new Error('expected sync repository roots');

    repositoryPaths = ['/work/alpha-main'];
    provider.refresh();
    provider.getChildren();
    repositoryPaths = ['/work/alpha-main', '/work/beta-main'];
    provider.refresh();
    const readded = provider.getChildren();
    if (!Array.isArray(readded)) throw new Error('expected sync repository roots');

    expect(vscodeState.emitters[0].fire).toHaveBeenCalledWith(undefined);
    expect(readded[1]).not.toBe(first[1]);
  });

  it('evicts a removed Worktree after firing its Repository', () => {
    let cachedWorktrees = [alphaMainWorktree, alphaFeatureWorktree];
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => cachedWorktrees),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const first = provider.getChildren(repositories[0]);
    if (!Array.isArray(first)) throw new Error('expected sync cached worktrees');

    cachedWorktrees = [alphaMainWorktree];
    provider.refreshRepository('/work/alpha-main');
    provider.getChildren(repositories[0]);
    cachedWorktrees = [alphaMainWorktree, alphaFeatureWorktree];
    provider.refreshRepository('/work/alpha-main');
    const readded = provider.getChildren(repositories[0]);
    if (!Array.isArray(readded)) throw new Error('expected sync cached worktrees');

    expect(vscodeState.emitters[0].fire).toHaveBeenCalledWith(repositories[0]);
    expect(readded[1]).not.toBe(first[1]);
  });

  it('fires exactly the cached Worktree whose TerminalModel entry changed', () => {
    const model = observedModel();
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => [alphaMainWorktree, alphaFeatureWorktree]),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected sync cached worktrees');
    vscodeState.emitters[0].fire.mockClear();

    model.apply([
      { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
    ]);
    provider.refreshWorktree('/work/alpha-main');

    expect(vscodeState.emitters[0].fire).toHaveBeenCalledOnce();
    expect(vscodeState.emitters[0].fire).toHaveBeenCalledWith(worktrees[0]);
    expect(vscodeState.emitters[0].fire).not.toHaveBeenCalledWith(worktrees[1]);
  });

  it('no-ops a fire for an unfetched Worktree and renders current model state on expand', () => {
    const model = observedModel();
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => [alphaMainWorktree, alphaFeatureWorktree]),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    vscodeState.emitters[0].fire.mockClear();

    model.apply([
      { sessionName: 'wt-_work_alpha-feature__term-1', windowName: 'claude' },
    ]);
    provider.refreshWorktree('/work/alpha-feature');

    expect(vscodeState.emitters[0].fire).not.toHaveBeenCalled();

    const worktrees = provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected sync cached worktrees');
    const terminals = provider.getChildren(worktrees[1]);

    expect(terminals).toEqual([
      expect.objectContaining({
        label: 'claude',
        terminal: expect.objectContaining({
          sessionName: 'wt-_work_alpha-feature__term-1',
        }),
      }),
    ]);
  });

  it('finds a Terminal row outside the mounted Worktree', async () => {
    const model = observedModel([
      { sessionName: 'wt-_work_alpha-feature__term-1', windowName: 'claude' },
    ]);
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => [alphaMainWorktree, alphaFeatureWorktree]),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
    );

    const terminal = await provider.findTerminal(
      'wt-_work_alpha-feature__term-1',
      '/work/alpha-feature',
    );

    expect(terminal).toMatchObject({
      id: 'terminal::wt-_work_alpha-feature__term-1',
      worktreePath: '/work/alpha-feature',
      terminal: { windowName: 'claude' },
    });
    expect(provider.getParent(terminal!)).toMatchObject({
      id: 'worktree::/work/alpha-feature',
    });
  });

  it('finds a Terminal row by session name for notification actions', async () => {
    const model = observedModel([
      { sessionName: 'wt-_work_alpha-feature__term-1', windowName: 'claude' },
    ]);
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => [alphaMainWorktree, alphaFeatureWorktree]),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
    );

    vi.mocked(listWorktrees).mockClear();
    const terminal = await provider.findTerminalBySessionName('wt-_work_alpha-feature__term-1');

    expect(terminal).toMatchObject({
      id: 'terminal::wt-_work_alpha-feature__term-1',
      worktreePath: '/work/alpha-feature',
      terminal: { windowName: 'claude' },
    });
    expect(listWorktrees).not.toHaveBeenCalled();
  });

  it('describes a session from the TerminalModel and cached Worktree', async () => {
    const model = observedModel([
      { sessionName: 'wt-_work_alpha-feature__term-1', windowName: 'claude' },
    ]);
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => [alphaMainWorktree, alphaFeatureWorktree]),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
    );

    vi.mocked(listWorktrees).mockClear();
    const description = await provider.describeSession('wt-_work_alpha-feature__term-1');

    expect(description).toEqual({ repo: 'alpha-main', branch: 'feature' });
    expect(listWorktrees).not.toHaveBeenCalled();
  });

  it('describes a detached session by folder name, matching its tree label', async () => {
    const detached: Worktree = {
      path: '/work/alpha-origin-fix',
      head: 'abcdef1234567890',
      bare: false,
      detached: true,
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => [alphaMainWorktree, detached]),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      observedModel([
        { sessionName: 'wt-_work_alpha-origin-fix__term-1', windowName: 'codex' },
      ]),
      true,
    );

    const description = await provider.describeSession('wt-_work_alpha-origin-fix__term-1');

    expect(description).toEqual({ repo: 'alpha-main', branch: 'alpha-origin-fix' });
  });

  it('returns no session description when no Worktree owns the session prefix', async () => {
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => [alphaMainWorktree, alphaFeatureWorktree]),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      observedModel([
        { sessionName: 'wt-_elsewhere_repo__term-1', windowName: 'zsh' },
      ]),
      true,
    );

    await expect(provider.describeSession('wt-_elsewhere_repo__term-1')).resolves.toBeUndefined();
  });

  it('marks terminals in the current workspace folder as active', async () => {
    const model = observedModel([
      { sessionName: 'wt-_work_beta-main__term-1', windowName: 'zsh' },
    ]);
    const provider = new RepositoryTreeProvider(
      registry(['/work/beta-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/beta'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');
    const terminalRows = await provider.getChildren(worktrees[0]);

    expect((terminalRows as Array<{ contextValue: string }>).map((r) => r.contextValue)).toEqual([
      'deck.terminal.active',
    ]);
  });

  it('renders an empty Worktree as an expanded empty folder with no rows when no terminals exist', async () => {
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      observedModel(),
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    expect(worktrees[0].collapsibleState).toBe(2);
    const terminalRows = await provider.getChildren(worktrees[0]);
    expect(terminalRows).toEqual([]);
  });

  it('re-reads terminal rows from the model after reconciliation', async () => {
    const model = observedModel([
      { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
    ]);
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    const firstRows = await provider.getChildren(worktrees[0]);
    expect((firstRows as Array<{ label: string }>).map((row) => row.label)).toEqual(['zsh']);
    model.apply([
      { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'claude' },
    ]);
    provider.refresh();
    const secondRows = await provider.getChildren(worktrees[0]);

    expect((secondRows as Array<unknown>)[0]).toBe((firstRows as Array<unknown>)[0]);
    expect((secondRows as Array<{ label: string }>).map((row) => row.label)).toEqual(['claude']);
  });

  it('renders an agent row from explicit session identity when the window name is volatile', async () => {
    const model = observedModel([
      {
        sessionName: 'wt-_work_alpha-main__term-1',
        windowName: '2.1.172',
        paneTitle: '✳ tracking-service-grpc-gateway-pivot',
        agentName: 'claude' as const,
      },
    ]);
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    const terminalRows = await provider.getChildren(worktrees[0]);

    expect((terminalRows as Array<{ label: string }>).map((row) => row.label)).toEqual([
      'tracking-service-grpc-gateway-pivot',
    ]);
    // The rendered icon (not just the change-detection iconId) must resolve from
    // the explicit identity too — a sidecar-only agent with a volatile window
    // name keeps its mark instead of the plain terminal glyph.
    expect((terminalRows as Array<{ iconPath: { fsPath: string } }>)[0].iconPath.fsPath)
      .toMatch(/resources\/claude-code-padded\.png$/);
  });

  it('renders tmux install placeholder when tmux is unavailable', async () => {
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      warmWorktreeCache(),
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      observedModel(),
      false,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');

    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');
    const terminalRows = provider.getChildren(worktrees[0]);

    expect(Array.isArray(terminalRows)).toBe(true);
    expect((terminalRows as Array<{ label: string; command?: unknown }>)).toEqual([
      expect.objectContaining({
        label: 'tmux ≥3.1 not found · install ↗',
        command: undefined,
      }),
    ]);
  });

  it('returns Terminal children synchronously from the TerminalModel', async () => {
    const model = new TerminalModel();
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      {
        get: vi.fn(() => [alphaMainWorktree, alphaFeatureWorktree]),
        set: vi.fn(async () => undefined),
      } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      model,
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected cached worktree children');

    expect(provider.getChildren(worktrees[0])).toEqual([]);

    model.apply([
      { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
    ]);
    const terminals = provider.getChildren(worktrees[0]);

    expect(Array.isArray(terminals)).toBe(true);
    expect(terminals).toEqual([
      expect.objectContaining({
        label: 'zsh',
        terminal: expect.objectContaining({
          sessionName: 'wt-_work_alpha-main__term-1',
        }),
      }),
    ]);
  });
});
