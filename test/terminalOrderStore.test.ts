import { describe, expect, it } from 'vitest';
import { TERMINAL_ORDERS_KEY, TerminalOrderStore } from '../src/terminal/terminalOrderStore';

function createStore() {
  const values: Record<string, unknown> = {};
  const store = new TerminalOrderStore({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  });

  return { store, values };
}

describe('TerminalOrderStore', () => {
  it('stores TerminalOrder as a Worktree-path keyed map', async () => {
    const { store, values } = createStore();

    expect(store.get('/work/alpha')).toBeUndefined();

    await store.set('/work/alpha', [
      'wt-_work_alpha__term-2',
      'https://example.com/docs',
      'wt-_work_alpha__term-1',
    ]);
    await store.set('/work/beta', ['wt-_work_beta__term-1']);

    expect(values[TERMINAL_ORDERS_KEY]).toEqual({
      '/work/alpha': [
        'wt-_work_alpha__term-2',
        'https://example.com/docs',
        'wt-_work_alpha__term-1',
      ],
      '/work/beta': ['wt-_work_beta__term-1'],
    });
    expect(store.get('/work/alpha')).toEqual([
      'wt-_work_alpha__term-2',
      'https://example.com/docs',
      'wt-_work_alpha__term-1',
    ]);
  });

  it('overwrites and clears one Worktree order without touching others', async () => {
    const { store, values } = createStore();

    await store.set('/work/alpha', ['wt-_work_alpha__term-1']);
    await store.set('/work/beta', ['wt-_work_beta__term-1']);
    await store.set('/work/alpha', ['wt-_work_alpha__term-2']);
    await store.clear('/work/alpha');

    expect(values[TERMINAL_ORDERS_KEY]).toEqual({
      '/work/beta': ['wt-_work_beta__term-1'],
    });
    expect(store.get('/work/alpha')).toBeUndefined();
  });
});
