interface WorktreeStateStore {
  clear(worktreePath: string): Promise<void>;
}

export class BookmarkCascade {
  constructor(
    private readonly bookmarks: WorktreeStateStore,
    private readonly rowOrders: WorktreeStateStore,
  ) {}

  async clearWorktree(worktreePath: string): Promise<void> {
    await Promise.all([
      this.bookmarks.clear(worktreePath),
      this.rowOrders.clear(worktreePath),
    ]);
  }
}
