import { describe, expect, it } from 'vitest';
import { BOOKMARKS_KEY, BookmarkStore } from '../src/bookmark/bookmarkStore';

function createStore() {
  const values: Record<string, unknown> = {};
  const memento = {
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  };
  const store = new BookmarkStore(memento);

  return { store, values, memento };
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

  it('renames a Bookmark without changing its URL or position', async () => {
    const { store, memento } = createStore();
    await store.add('/work/alpha', { url: 'https://example.com/first' });
    await store.add('/work/alpha', { url: 'https://example.com/second' });

    await store.rename('/work/alpha', 'https://example.com/first', 'Dashboard');

    const reloadedStore = new BookmarkStore(memento);
    expect(reloadedStore.list('/work/alpha')).toEqual([
      { url: 'https://example.com/first', label: 'Dashboard' },
      { url: 'https://example.com/second' },
    ]);
  });

  it('clears a custom label so callers can derive the Bookmark label again', async () => {
    const { store } = createStore();
    await store.add('/work/alpha', {
      url: 'https://github.com/org/repo/pull/190',
      label: 'Rename work',
    });

    await store.rename('/work/alpha', 'https://github.com/org/repo/pull/190', undefined);

    expect(store.list('/work/alpha')).toStrictEqual([
      { url: 'https://github.com/org/repo/pull/190' },
    ]);
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
