import { describe, expect, it } from 'vitest';
import {
  WORKTREE_LIST_CACHE_KEY,
  WORKTREE_LIST_CACHE_SCHEMA_VERSION,
  WorktreeListCacheStore,
} from '../src/worktree/worktreeListCacheStore';

function createStore() {
  const values: Record<string, unknown> = {};
  const store = new WorktreeListCacheStore({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  });

  return { store, values };
}

const alphaWorktrees = [
  {
    path: '/work/alpha-main',
    head: 'abc',
    bare: false,
    detached: false,
    branch: 'main',
    main: true,
  },
];

describe('WorktreeListCacheStore', () => {
  it('returns undefined for an empty cache', () => {
    const { store } = createStore();

    expect(store.get('/git/alpha')).toBeUndefined();
  });

  it('round-trips worktrees for one common-dir', async () => {
    const { store } = createStore();

    await store.set('/git/alpha', alphaWorktrees);

    expect(store.get('/git/alpha')).toEqual(alphaWorktrees);
  });

  it('treats schema-version mismatch as cold cache', () => {
    const { store, values } = createStore();
    values[WORKTREE_LIST_CACHE_KEY] = {
      '/git/alpha': {
        schemaVersion: WORKTREE_LIST_CACHE_SCHEMA_VERSION - 1,
        worktrees: alphaWorktrees,
      },
    };

    expect(store.get('/git/alpha')).toBeUndefined();
  });

  it('treats schema version 2 without main identity as a cold cache', () => {
    const { store, values } = createStore();
    values[WORKTREE_LIST_CACHE_KEY] = {
      '/git/alpha': {
        schemaVersion: 2,
        worktrees: [{
          path: '/work/alpha-main',
          head: 'abc',
          bare: false,
          detached: false,
          branch: 'main',
        }],
      },
    };

    expect(store.get('/git/alpha')).toBeUndefined();
  });

  it('clears one common-dir without touching others', async () => {
    const { store } = createStore();
    await store.set('/git/alpha', alphaWorktrees);
    await store.set('/git/beta', [{ ...alphaWorktrees[0], path: '/work/beta-main' }]);

    await store.clear('/git/alpha');

    expect(store.get('/git/alpha')).toBeUndefined();
    expect(store.get('/git/beta')).toEqual([{ ...alphaWorktrees[0], path: '/work/beta-main' }]);
  });

  it('isolates multiple common-dirs', async () => {
    const { store } = createStore();
    const betaWorktrees = [{ ...alphaWorktrees[0], path: '/work/beta-main' }];

    await store.set('/git/alpha', alphaWorktrees);
    await store.set('/git/beta', betaWorktrees);

    expect(store.get('/git/alpha')).toEqual(alphaWorktrees);
    expect(store.get('/git/beta')).toEqual(betaWorktrees);
  });
});
