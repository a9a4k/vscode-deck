import * as vscode from 'vscode';
import type { Bookmark } from './bookmarkStore';

interface BookmarkStoreLike {
  add(worktreePath: string, bookmark: Bookmark): Promise<Bookmark>;
}

interface WorktreeNodeLike {
  worktree: {
    path: string;
  };
}

export class AddBookmarkCommand {
  constructor(
    private readonly bookmarks: BookmarkStoreLike,
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

    const worktreePath = node.worktree.path;
    const url = input.trim();
    const bookmark = await this.bookmarks.add(worktreePath, { url });
    await this.reveal(worktreePath, bookmark);
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
