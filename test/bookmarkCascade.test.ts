import { describe, expect, it } from 'vitest';
import { BookmarkCascade } from '../src/bookmark/bookmarkCascade';
import { BookmarkStore } from '../src/bookmark/bookmarkStore';
import { TerminalOrderStore } from '../src/terminal/terminalOrderStore';

describe('BookmarkCascade', () => {
  it('clears one Worktree\'s Bookmarks and row order while preserving another Worktree', async () => {
    const values: Record<string, unknown> = {};
    const memento = {
      get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
      update: async (key: string, value: unknown) => {
        values[key] = value;
      },
    };
    const bookmarks = new BookmarkStore(memento);
    const rowOrders = new TerminalOrderStore(memento);
    const sharedUrl = 'https://example.com/shared';
    await bookmarks.add('/work/alpha', { url: sharedUrl });
    await bookmarks.add('/work/alpha', { url: 'https://example.com/alpha' });
    await bookmarks.add('/work/beta', { url: sharedUrl });
    await rowOrders.set('/work/alpha', ['wt-_work_alpha__term-1', sharedUrl]);
    await rowOrders.set('/work/beta', ['wt-_work_beta__term-1', sharedUrl]);

    await new BookmarkCascade(bookmarks, rowOrders).clearWorktree('/work/alpha');

    expect(bookmarks.list('/work/alpha')).toEqual([]);
    expect(rowOrders.get('/work/alpha')).toBeUndefined();
    expect(bookmarks.list('/work/beta')).toEqual([{ url: sharedUrl }]);
    expect(rowOrders.get('/work/beta')).toEqual(['wt-_work_beta__term-1', sharedUrl]);
  });
});
