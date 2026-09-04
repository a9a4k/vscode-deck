import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  showInputBox: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    showInputBox: vscodeState.showInputBox,
  },
}));

import { BookmarkStore } from '../src/bookmark/bookmarkStore';
import { RenameBookmarkCommand } from '../src/bookmark/renameBookmarkCommand';

function createCommand() {
  const values: Record<string, unknown> = {};
  const bookmarks = new BookmarkStore({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  });
  const refresh = vi.fn();
  return { bookmarks, command: new RenameBookmarkCommand(bookmarks, refresh), refresh };
}

describe('RenameBookmarkCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.showInputBox.mockResolvedValue('Dashboard');
  });

  it('pre-fills the current label, renames the Bookmark, and refreshes its Worktree', async () => {
    const { bookmarks, command, refresh } = createCommand();
    const bookmark = { url: 'https://example.com/app', label: 'App' };
    await bookmarks.add('/work/alpha', bookmark);

    await command.run({ bookmark, worktreeNode: { worktree: { path: '/work/alpha' } } });

    expect(vscodeState.showInputBox).toHaveBeenCalledWith({
      prompt: 'Bookmark name',
      value: 'App',
    });
    expect(bookmarks.list('/work/alpha')).toEqual([
      { url: 'https://example.com/app', label: 'Dashboard' },
    ]);
    expect(refresh).toHaveBeenCalledWith('/work/alpha');
  });

  it('pre-fills the derived label when the Bookmark has no custom label', async () => {
    const { bookmarks, command } = createCommand();
    const bookmark = { url: 'https://github.com/org/repo/pull/190' };
    await bookmarks.add('/work/alpha', bookmark);

    await command.run({ bookmark, worktreeNode: { worktree: { path: '/work/alpha' } } });

    expect(vscodeState.showInputBox).toHaveBeenCalledWith(expect.objectContaining({
      value: 'pull/190',
    }));
  });

  it('pre-fills the raw value when the stored URL cannot be parsed', async () => {
    const { bookmarks, command } = createCommand();
    const bookmark = { url: 'not a URL' };
    await bookmarks.add('/work/alpha', bookmark);

    await command.run({ bookmark, worktreeNode: { worktree: { path: '/work/alpha' } } });

    expect(vscodeState.showInputBox).toHaveBeenCalledWith(expect.objectContaining({
      value: 'not a URL',
    }));
  });

  it('clears a custom label when the entered name is blank', async () => {
    const { bookmarks, command } = createCommand();
    const bookmark = { url: 'https://github.com/org/repo/pull/190', label: 'Rename work' };
    await bookmarks.add('/work/alpha', bookmark);
    vscodeState.showInputBox.mockResolvedValue('   ');

    await command.run({ bookmark, worktreeNode: { worktree: { path: '/work/alpha' } } });

    expect(bookmarks.list('/work/alpha')).toStrictEqual([
      { url: 'https://github.com/org/repo/pull/190' },
    ]);
  });
});
