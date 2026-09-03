import { describe, expect, it } from 'vitest';
import { pruneRowOrder } from '../src/tree/pruneRowOrder';
import { reconcileRowOrder } from '../src/tree/reconcileRowOrder';

describe('pruneRowOrder', () => {
  it('keeps keys claimed by either the Terminal or Bookmark source', () => {
    const order = [
      'wt-_work_alpha__term-1',
      'http://localhost:5173/',
    ];

    expect(pruneRowOrder(
      order,
      new Set(['wt-_work_alpha__term-1']),
      new Set(['http://localhost:5173/']),
    )).toEqual({ order, changed: false });
  });

  it('drops keys claimed by neither source and reports drift', () => {
    expect(pruneRowOrder(
      ['dead', 'live-terminal', 'https://example.com/docs'],
      new Set(['live-terminal']),
      new Set(['https://example.com/docs']),
    )).toEqual({
      order: ['live-terminal', 'https://example.com/docs'],
      changed: true,
    });
  });

  it('lets a reused Terminal name append after the dead slot was pruned', () => {
    const storedOrder = [
      'wt-_work_alpha__term-3',
      'https://example.com/docs',
      'wt-_work_alpha__term-1',
      'wt-_work_alpha__term-2',
    ];
    const pruned = pruneRowOrder(
      storedOrder,
      new Set(['wt-_work_alpha__term-1', 'wt-_work_alpha__term-2']),
      new Set(['https://example.com/docs']),
    );

    expect(reconcileRowOrder(pruned.order, [
      { sessionName: 'wt-_work_alpha__term-1' },
      { sessionName: 'wt-_work_alpha__term-2' },
      { sessionName: 'wt-_work_alpha__term-3' },
    ], [{ url: 'https://example.com/docs' }]).map((row) => row.key)).toEqual([
      'https://example.com/docs',
      'wt-_work_alpha__term-1',
      'wt-_work_alpha__term-2',
      'wt-_work_alpha__term-3',
    ]);
  });
});
