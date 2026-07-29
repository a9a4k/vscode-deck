import * as path from 'node:path';
import type { Worktree } from '../git/worktrees';
import { pruneOrder } from '../tree/pruneOrder';
import { describeWorktreeTreeItem } from '../tree/worktreeTreeItem';
import { reconcileWorktreeOrder } from '../tree/reconcileWorktreeOrder';

interface RepositoryList {
  list(): readonly string[];
}

interface CommonDirs {
  get(repositoryPath: string): string | undefined;
  resolve(repositoryPath: string): Promise<string | null>;
}

interface WorktreeListCache {
  get(commonDir: string): readonly Worktree[] | undefined;
  set(commonDir: string, worktrees: readonly Worktree[]): Promise<void>;
}

interface WorktreeOrders {
  get(commonDir: string): readonly string[] | undefined;
  set(commonDir: string, paths: readonly string[]): Promise<void>;
}

interface WorktreeReconcilerOptions {
  repositories: RepositoryList;
  commonDirs: CommonDirs;
  worktreeListCache: WorktreeListCache;
  worktreeOrders: WorktreeOrders;
  listWorktrees(repositoryPath: string): Promise<readonly Worktree[]>;
  activeWorktreePath(): string | undefined;
  refreshRepository(repositoryPath: string): void;
  pendingWorktreeRemovals?: ReadonlySet<string>;
}

export class WorktreeReconciler {
  constructor(private readonly options: WorktreeReconcilerOptions) {}

  async reconcileAll(): Promise<void> {
    await this.reconcileRepositories(this.options.repositories.list());
  }

  async reconcileCommonDir(commonDir: string): Promise<void> {
    await this.reconcileRepositories(
      this.options.repositories.list()
        .filter((repositoryPath) => this.options.commonDirs.get(repositoryPath) === commonDir),
    );
  }

  async reconcile(repositoryPath: string): Promise<void> {
    const commonDir =
      this.options.commonDirs.get(repositoryPath)
      ?? await this.options.commonDirs.resolve(repositoryPath);
    if (commonDir === null) return;

    const pendingAtListStart = new Set(this.options.pendingWorktreeRemovals);
    const gitWorktrees = await this.options.listWorktrees(repositoryPath);
    const observed = visibleWorktrees(
      gitWorktrees,
      this.options.pendingWorktreeRemovals,
      pendingAtListStart,
    );
    const cached = this.options.worktreeListCache.get(commonDir) ?? [];
    const order = this.options.worktreeOrders.get(commonDir);
    if (order !== undefined) {
      const pruned = pruneOrder(
        order,
        new Set(gitWorktrees.map((worktree) => worktree.path)),
      );
      if (pruned.changed) {
        await this.options.worktreeOrders.set(commonDir, pruned.order).catch(() => undefined);
      }
    }
    const activeWorktreePath = this.options.activeWorktreePath();
    const changed =
      renderedProjection(cached, order, activeWorktreePath)
      !== renderedProjection(observed, order, activeWorktreePath);

    await this.options.worktreeListCache.set(commonDir, observed);
    if (changed) this.options.refreshRepository(repositoryPath);
  }

  private async reconcileRepositories(repositoryPaths: readonly string[]): Promise<void> {
    const results = await Promise.allSettled(
      repositoryPaths.map((repositoryPath) => this.reconcile(repositoryPath)),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failure !== undefined) throw failure.reason;
  }
}

function visibleWorktrees(
  worktrees: readonly Worktree[],
  pendingWorktreeRemovals: ReadonlySet<string> = new Set(),
  pendingAtListStart: ReadonlySet<string> = new Set(),
): Worktree[] {
  return worktrees.filter(
    (worktree) =>
      !worktree.bare
      && !pendingWorktreeRemovals.has(worktree.path)
      && !pendingAtListStart.has(worktree.path),
  );
}

function renderedProjection(
  worktrees: readonly Worktree[],
  order: readonly string[] | undefined,
  activeWorktreePath: string | undefined,
): string {
  const ordered = reconcileWorktreeOrder(order, worktrees);

  return JSON.stringify(ordered.map((worktree) => {
    const item = describeWorktreeTreeItem(
      worktree,
      samePath(worktree.path, activeWorktreePath),
    );
    return {
      path: worktree.path,
      label: item.label,
      description: item.description,
      contextValue: item.contextValue,
      tooltip: item.tooltip,
      createdAt: worktree.createdAt ?? null,
    };
  }));
}

function samePath(left: string, right: string | undefined): boolean {
  return right !== undefined && path.resolve(left) === path.resolve(right);
}
