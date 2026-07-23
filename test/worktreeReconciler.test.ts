import { describe, expect, it, vi } from 'vitest';
import type { Worktree } from '../src/git/worktrees';
import { WorktreeReconciler } from '../src/worktree/worktreeReconciler';

const branchWorktree = (head: string): Worktree => ({
  path: '/work/alpha-main',
  head,
  branch: 'main',
  bare: false,
  detached: false,
});

describe('WorktreeReconciler', () => {
  it('updates the cache without firing when only a branch Worktree head changes', async () => {
    const cached = [branchWorktree('old-head')];
    const observed = [branchWorktree('new-head')];
    const worktreeListCache = {
      get: vi.fn(() => cached),
      set: vi.fn(async () => undefined),
    };
    const refreshRepository = vi.fn();
    const reconciler = new WorktreeReconciler({
      repositories: { list: () => ['/work/alpha-main'] },
      commonDirs: {
        get: () => '/git/alpha',
        resolve: async () => '/git/alpha',
      },
      worktreeListCache,
      worktreeOrders: {
        get: () => undefined,
        set: async () => undefined,
      },
      listWorktrees: async () => observed,
      activeWorktreePath: () => undefined,
      refreshRepository,
    });

    await reconciler.reconcile('/work/alpha-main');

    expect(worktreeListCache.set).toHaveBeenCalledWith('/git/alpha', observed);
    expect(refreshRepository).not.toHaveBeenCalled();
  });

  it('fires the Repository when a detached Worktree head changes', async () => {
    const detachedWorktree = (head: string): Worktree => ({
      path: '/work/alpha-detached',
      head,
      bare: false,
      detached: true,
    });
    const worktreeListCache = {
      get: vi.fn(() => [detachedWorktree('11111112222222')]),
      set: vi.fn(async () => undefined),
    };
    const refreshRepository = vi.fn();
    const reconciler = new WorktreeReconciler({
      repositories: { list: () => ['/work/alpha-main'] },
      commonDirs: {
        get: () => '/git/alpha',
        resolve: async () => '/git/alpha',
      },
      worktreeListCache,
      worktreeOrders: {
        get: () => undefined,
        set: async () => undefined,
      },
      listWorktrees: async () => [detachedWorktree('aaaaaaabbbbbbb')],
      activeWorktreePath: () => undefined,
      refreshRepository,
    });

    await reconciler.reconcile('/work/alpha-main');

    expect(refreshRepository).toHaveBeenCalledWith('/work/alpha-main');
  });

  it('fires the Repository when a sort-relevant creation time changes', async () => {
    const refreshRepository = vi.fn();
    const reconciler = new WorktreeReconciler({
      repositories: { list: () => ['/work/alpha-main'] },
      commonDirs: {
        get: () => '/git/alpha',
        resolve: async () => '/git/alpha',
      },
      worktreeListCache: {
        get: () => [{ ...branchWorktree('head'), createdAt: 1 }],
        set: async () => undefined,
      },
      worktreeOrders: {
        get: () => undefined,
        set: async () => undefined,
      },
      listWorktrees: async () => [{ ...branchWorktree('head'), createdAt: 2 }],
      activeWorktreePath: () => undefined,
      refreshRepository,
    });

    await reconciler.reconcile('/work/alpha-main');

    expect(refreshRepository).toHaveBeenCalledWith('/work/alpha-main');
  });

  it('fires the Repository when a Worktree branch label changes', async () => {
    const refreshRepository = vi.fn();
    const reconciler = new WorktreeReconciler({
      repositories: { list: () => ['/work/alpha-main'] },
      commonDirs: {
        get: () => '/git/alpha',
        resolve: async () => '/git/alpha',
      },
      worktreeListCache: {
        get: () => [branchWorktree('head')],
        set: async () => undefined,
      },
      worktreeOrders: {
        get: () => undefined,
        set: async () => undefined,
      },
      listWorktrees: async () => [{
        ...branchWorktree('head'),
        branch: 'renamed-main',
      }],
      activeWorktreePath: () => undefined,
      refreshRepository,
    });

    await reconciler.reconcile('/work/alpha-main');

    expect(refreshRepository).toHaveBeenCalledWith('/work/alpha-main');
  });

  it('prunes WorktreeOrder from the fresh Git listing', async () => {
    const worktreeOrders = {
      get: vi.fn(() => ['/work/missing', '/work/alpha-main']),
      set: vi.fn(async () => undefined),
    };
    const reconciler = new WorktreeReconciler({
      repositories: { list: () => ['/work/alpha-main'] },
      commonDirs: {
        get: () => '/git/alpha',
        resolve: async () => '/git/alpha',
      },
      worktreeListCache: {
        get: () => [branchWorktree('old-head')],
        set: async () => undefined,
      },
      worktreeOrders,
      listWorktrees: async () => [branchWorktree('new-head')],
      activeWorktreePath: () => undefined,
      refreshRepository: vi.fn(),
    });

    await reconciler.reconcile('/work/alpha-main');

    expect(worktreeOrders.set).toHaveBeenCalledWith('/git/alpha', [
      '/work/alpha-main',
    ]);
  });

  it('reconciles only the Repository whose common dir changed', async () => {
    const listWorktrees = vi.fn(async () => [
      branchWorktree('same-head'),
      {
        path: '/work/alpha-feature',
        head: 'feature-head',
        branch: 'feature',
        bare: false,
        detached: false,
      },
    ]);
    const refreshRepository = vi.fn();
    const reconciler = new WorktreeReconciler({
      repositories: { list: () => ['/work/alpha-main', '/work/beta-main'] },
      commonDirs: {
        get: (repositoryPath) =>
          repositoryPath === '/work/alpha-main' ? '/git/alpha' : '/git/beta',
        resolve: async () => null,
      },
      worktreeListCache: {
        get: () => [branchWorktree('same-head')],
        set: async () => undefined,
      },
      worktreeOrders: {
        get: () => undefined,
        set: async () => undefined,
      },
      listWorktrees,
      activeWorktreePath: () => undefined,
      refreshRepository,
    });

    await reconciler.reconcileCommonDir('/git/alpha');

    expect(listWorktrees).toHaveBeenCalledOnce();
    expect(listWorktrees).toHaveBeenCalledWith('/work/alpha-main');
    expect(refreshRepository).toHaveBeenCalledWith('/work/alpha-main');
    expect(refreshRepository).not.toHaveBeenCalledWith('/work/beta-main');
  });

  it('reconciles every registered Repository', async () => {
    const repositories = ['/work/alpha-main', '/work/beta-main'];
    const listWorktrees = vi.fn(async (repositoryPath: string) => [{
      ...branchWorktree('head'),
      path: repositoryPath,
    }]);
    const reconciler = new WorktreeReconciler({
      repositories: { list: () => repositories },
      commonDirs: {
        get: () => undefined,
        resolve: async (repositoryPath) =>
          repositoryPath === '/work/alpha-main' ? '/git/alpha' : '/git/beta',
      },
      worktreeListCache: {
        get: () => [],
        set: async () => undefined,
      },
      worktreeOrders: {
        get: () => undefined,
        set: async () => undefined,
      },
      listWorktrees,
      activeWorktreePath: () => undefined,
      refreshRepository: vi.fn(),
    });

    await reconciler.reconcileAll();

    expect(listWorktrees.mock.calls.map(([repositoryPath]) => repositoryPath).sort())
      .toEqual([...repositories].sort());
  });

  it('does not re-add a pending removal that settles during the Git listing', async () => {
    const pendingWorktreeRemovals = new Set(['/work/alpha-feature']);
    let finishListing: ((worktrees: Worktree[]) => void) | undefined;
    const listing = new Promise<Worktree[]>((resolve) => {
      finishListing = resolve;
    });
    const worktreeListCache = {
      get: vi.fn(() => [branchWorktree('head')]),
      set: vi.fn(async () => undefined),
    };
    const reconciler = new WorktreeReconciler({
      repositories: { list: () => ['/work/alpha-main'] },
      commonDirs: {
        get: () => '/git/alpha',
        resolve: async () => '/git/alpha',
      },
      worktreeListCache,
      worktreeOrders: {
        get: () => undefined,
        set: async () => undefined,
      },
      listWorktrees: () => listing,
      activeWorktreePath: () => undefined,
      refreshRepository: vi.fn(),
      pendingWorktreeRemovals,
    });

    const reconciliation = reconciler.reconcile('/work/alpha-main');
    pendingWorktreeRemovals.delete('/work/alpha-feature');
    finishListing?.([
      branchWorktree('head'),
      {
        path: '/work/alpha-feature',
        head: 'feature-head',
        branch: 'feature',
        bare: false,
        detached: false,
      },
    ]);
    await reconciliation;

    expect(worktreeListCache.set).toHaveBeenCalledWith('/git/alpha', [
      branchWorktree('head'),
    ]);
  });
});
