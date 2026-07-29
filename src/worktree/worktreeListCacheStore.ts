import type { Worktree } from '../git/worktrees';
import type { MementoLike } from '../switch/activeWorktreeStore';

export const WORKTREE_LIST_CACHE_KEY = 'deck.worktreeListCache';
export const WORKTREE_LIST_CACHE_SCHEMA_VERSION = 3;

interface WorktreeListCacheEntry {
  schemaVersion: number;
  worktrees: Worktree[];
}

export class WorktreeListCacheStore {
  constructor(private readonly memento: MementoLike) {}

  get(commonDir: string): Worktree[] | undefined {
    const entry = this.all()[commonDir];
    if (entry?.schemaVersion !== WORKTREE_LIST_CACHE_SCHEMA_VERSION) return undefined;
    return entry.worktrees;
  }

  async set(commonDir: string, worktrees: readonly Worktree[]): Promise<void> {
    await this.memento.update(WORKTREE_LIST_CACHE_KEY, {
      ...this.all(),
      [commonDir]: {
        schemaVersion: WORKTREE_LIST_CACHE_SCHEMA_VERSION,
        worktrees: worktrees.map((worktree) => ({ ...worktree })),
      },
    });
  }

  async add(commonDir: string, worktree: Worktree): Promise<void> {
    const cached = this.get(commonDir);
    if (!cached) return;
    await this.set(commonDir, [
      ...cached.filter((existing) => existing.path !== worktree.path),
      worktree,
    ]);
  }

  async remove(commonDir: string, worktreePath: string): Promise<void> {
    const cached = this.get(commonDir);
    if (!cached) return;
    await this.set(
      commonDir,
      cached.filter((worktree) => worktree.path !== worktreePath),
    );
  }

  async clear(commonDir: string): Promise<void> {
    const all = { ...this.all() };
    delete all[commonDir];
    await this.memento.update(WORKTREE_LIST_CACHE_KEY, all);
  }

  private all(): Record<string, WorktreeListCacheEntry> {
    return this.memento.get<Record<string, WorktreeListCacheEntry>>(
      WORKTREE_LIST_CACHE_KEY,
      {},
    );
  }
}
