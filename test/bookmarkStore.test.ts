import { describe, expect, it } from 'vitest';
import { BOOKMARKS_KEY, BookmarkStore } from '../src/bookmark/bookmarkStore';

function createStore() {
  const values: Record<string, unknown> = {};
  const store = new BookmarkStore({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  });

  return { store, values };
}

describe('BookmarkStore', () => {
  it('adds and lists Bookmarks for a Worktree', async () => {
    const { store, values } = createStore();

    expect(store.list('/work/alpha')).toEqual([]);

    const result = await store.add('/work/alpha', { url: 'https://github.com/org/repo/pull/186' });

    expect(result).toEqual({ url: 'https://github.com/org/repo/pull/186' });
    expect(store.list('/work/alpha')).toEqual([
      { url: 'https://github.com/org/repo/pull/186' },
    ]);
    expect(values[BOOKMARKS_KEY]).toEqual({
      '/work/alpha': [{ url: 'https://github.com/org/repo/pull/186' }],
    });
  });

  it('returns the existing Bookmark when its URL is already pinned to that Worktree', async () => {
    const { store } = createStore();
    const existing = { url: 'https://github.com/org/repo/pull/186', label: 'PR 186' };
    await store.add('/work/alpha', existing);

    const result = await store.add('/work/alpha', {
      url: 'https://github.com/org/repo/pull/186',
    });

    expect(result).toEqual(existing);
    expect(store.list('/work/alpha')).toEqual([existing]);
  });

  it('keeps Bookmarks isolated between Worktrees', async () => {
    const { store } = createStore();
    const bookmark = { url: 'https://github.com/org/repo/pull/186' };

    await store.add('/work/alpha', bookmark);
    const result = await store.add('/work/beta', bookmark);

    expect(result).toEqual(bookmark);
    expect(store.list('/work/alpha')).toEqual([bookmark]);
    expect(store.list('/work/beta')).toEqual([bookmark]);
  });

  it('removes one Bookmark without touching its siblings or another Worktree', async () => {
    const { store, values } = createStore();
    const removed = { url: 'https://example.com/shared' };
    const kept = { url: 'https://example.com/kept' };
    await store.add('/work/alpha', removed);
    await store.add('/work/alpha', kept);
    await store.add('/work/beta', removed);

    await store.remove('/work/alpha', removed.url);

    expect(store.list('/work/alpha')).toEqual([kept]);
    expect(store.list('/work/beta')).toEqual([removed]);
    expect(values[BOOKMARKS_KEY]).toEqual({
      '/work/alpha': [kept],
      '/work/beta': [removed],
    });
  });

  it('clears one Worktree without touching another', async () => {
    const { store, values } = createStore();
    await store.add('/work/alpha', { url: 'https://example.com/alpha' });
    await store.add('/work/beta', { url: 'https://example.com/beta' });

    await store.clear('/work/alpha');

    expect(store.list('/work/alpha')).toEqual([]);
    expect(store.list('/work/beta')).toEqual([{ url: 'https://example.com/beta' }]);
    expect(values[BOOKMARKS_KEY]).toEqual({
      '/work/beta': [{ url: 'https://example.com/beta' }],
    });
  });
});
