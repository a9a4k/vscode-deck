import * as vscode from 'vscode';
import { deriveBookmarkLabel } from './bookmarkLabel';
import type { Bookmark } from './bookmarkStore';

interface BookmarkRenamer {
  rename(worktreePath: string, url: string, label: string | undefined): Promise<void>;
}

interface BookmarkNodeLike {
  bookmark: Bookmark;
  worktreeNode: {
    worktree: {
      path: string;
    };
  };
}

export class RenameBookmarkCommand {
  constructor(
    private readonly bookmarks: BookmarkRenamer,
    private readonly refresh: (worktreePath: string) => void,
  ) {}

  async run(node: BookmarkNodeLike): Promise<void> {
    const label = await vscode.window.showInputBox({
      prompt: 'Bookmark name',
      value: node.bookmark.label ?? deriveBookmarkLabel(node.bookmark.url),
    });
    if (label === undefined) return;

    await this.bookmarks.rename(
      node.worktreeNode.worktree.path,
      node.bookmark.url,
      label.trim() || undefined,
    );
    this.refresh(node.worktreeNode.worktree.path);
  }
}
