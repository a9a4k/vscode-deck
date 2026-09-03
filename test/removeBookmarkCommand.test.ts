import { describe, expect, it, vi } from 'vitest';
import { BookmarkStore } from '../src/bookmark/bookmarkStore';
import { RemoveBookmarkCommand } from '../src/bookmark/removeBookmarkCommand';
import { TerminalOrderStore } from '../src/terminal/terminalOrderStore';

describe('RemoveBookmarkCommand', () => {
  it('removes the selected Bookmark and its row-order key without touching sibling rows', async () => {
    const values: Record<string, unknown> = {};
    const memento = {
      get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
      update: async (key: string, value: unknown) => {
        values[key] = value;
      },
    };
    const bookmarks = new BookmarkStore(memento);
    const terminalOrders = new TerminalOrderStore(memento);
    const removedUrl = 'https://example.com/shared';
    const keptUrl = 'https://example.com/kept';
    const terminal = 'wt-_work_alpha__term-1';
    await bookmarks.add('/work/alpha', { url: removedUrl });
    await bookmarks.add('/work/alpha', { url: keptUrl });
    await bookmarks.add('/work/beta', { url: removedUrl });
    await terminalOrders.set('/work/alpha', [terminal, removedUrl, keptUrl]);
    await terminalOrders.set('/work/beta', [removedUrl]);
    const refreshWorktree = vi.fn();
    const command = new RemoveBookmarkCommand(bookmarks, terminalOrders, refreshWorktree);

    await command.run({
      bookmark: { url: removedUrl },
      worktreeNode: { worktree: { path: '/work/alpha' } },
    });

    expect(bookmarks.list('/work/alpha')).toEqual([{ url: keptUrl }]);
    expect(bookmarks.list('/work/beta')).toEqual([{ url: removedUrl }]);
    expect(terminalOrders.get('/work/alpha')).toEqual([terminal, keptUrl]);
    expect(terminalOrders.get('/work/beta')).toEqual([removedUrl]);
    expect(refreshWorktree).toHaveBeenCalledWith('/work/alpha');
  });
});
