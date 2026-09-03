import type { Bookmark } from './bookmarkStore';

interface BookmarkRemover {
  remove(worktreePath: string, url: string): Promise<void>;
}

interface RowOrderStore {
  get(worktreePath: string): readonly string[] | undefined;
  set(worktreePath: string, order: readonly string[]): Promise<void>;
}

interface BookmarkNodeLike {
  bookmark: Bookmark;
  worktreeNode: {
    worktree: {
      path: string;
    };
  };
}

export class RemoveBookmarkCommand {
  constructor(
    private readonly bookmarks: BookmarkRemover,
    private readonly rowOrders: RowOrderStore,
    private readonly refreshWorktree: (worktreePath: string) => void,
  ) {}

  async run(node: BookmarkNodeLike | undefined): Promise<void> {
    if (!node) return;

    const worktreePath = node.worktreeNode.worktree.path;
    const order = this.rowOrders.get(worktreePath);
    await this.bookmarks.remove(worktreePath, node.bookmark.url);
    if (order !== undefined) {
      await this.rowOrders.set(
        worktreePath,
        order.filter((key) => key !== node.bookmark.url),
      );
    }
    this.refreshWorktree(worktreePath);
  }
}
