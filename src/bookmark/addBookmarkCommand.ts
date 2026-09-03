import * as vscode from 'vscode';
import type { Bookmark } from './bookmarkStore';

interface BookmarkWriter {
  list(worktreePath: string): readonly Bookmark[];
  add(worktreePath: string, bookmark: Bookmark): Promise<Bookmark>;
}

interface WorktreeNodeLike {
  worktree: {
    path: string;
  };
}

export class AddBookmarkCommand {
  constructor(
    private readonly bookmarks: BookmarkWriter,
    private readonly appendToRowOrder: (worktreePath: string, bookmark: Bookmark) => Promise<void>,
    private readonly reveal: (worktreePath: string, bookmark: Bookmark) => Promise<void>,
  ) {}

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    const clipboardText = (await vscode.env.clipboard.readText()).trim();
    const input = await vscode.window.showInputBox({
      prompt: 'URL to pin to this Worktree',
      placeHolder: 'https://…',
      value: isHttpUrl(clipboardText) ? clipboardText : undefined,
      validateInput: (value) => isHttpUrl(value.trim()) ? undefined : 'Enter an http(s) URL.',
    });
    if (input === undefined) return;

    const url = input.trim();
    const alreadyPinned = this.bookmarks.list(node.worktree.path)
      .some((bookmark) => bookmark.url === url);
    const bookmark = await this.bookmarks.add(node.worktree.path, { url });
    if (!alreadyPinned) await this.appendToRowOrder(node.worktree.path, bookmark);
    await this.reveal(node.worktree.path, bookmark);
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
