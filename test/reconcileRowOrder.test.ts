import { describe, expect, it } from 'vitest';
import { appendBookmarkToRowOrder, reconcileRowOrder } from '../src/tree/reconcileRowOrder';

describe('reconcileRowOrder', () => {
  it('keeps a stored Bookmark between live Terminals', () => {
    const bookmark = { url: 'http://localhost:5173/' };
    const terminals = [
      { sessionName: 'wt-_work_alpha__term-1' },
      { sessionName: 'wt-_work_alpha__term-2' },
    ];

    expect(reconcileRowOrder(
      [terminals[1].sessionName, bookmark.url, terminals[0].sessionName],
      terminals,
      [bookmark],
    ).map((row) => row.key)).toEqual([
      terminals[1].sessionName,
      bookmark.url,
      terminals[0].sessionName,
    ]);
  });

  it('returns live Terminals in ascending term-N order when no order is stored', () => {
    const terminals = [
      { sessionName: 'wt-_work_alpha__term-3' },
      { sessionName: 'wt-_work_alpha__term-1' },
      { sessionName: 'wt-_work_alpha__term-2' },
    ];

    expect(reconcileRowOrder(undefined, terminals, []).map((row) => row.key)).toEqual([
      'wt-_work_alpha__term-1',
      'wt-_work_alpha__term-2',
      'wt-_work_alpha__term-3',
    ]);
  });

  it('drops stored keys claimed by neither source', () => {
    const terminal = { sessionName: 'wt-_work_alpha__term-1' };
    const bookmark = { url: 'http://localhost:5173/' };

    expect(reconcileRowOrder(
      ['dead', bookmark.url, terminal.sessionName],
      [terminal],
      [bookmark],
    ).map((row) => row.key)).toEqual([
      bookmark.url,
      terminal.sessionName,
    ]);
  });

  it('appends uncurated Terminals after curated rows in ascending term-N order', () => {
    const bookmark = { url: 'http://localhost:5173/' };
    const terminals = [
      { sessionName: 'wt-_work_alpha__term-3' },
      { sessionName: 'wt-_work_alpha__term-1' },
      { sessionName: 'wt-_work_alpha__term-2' },
    ];

    expect(reconcileRowOrder(
      [bookmark.url, terminals[0].sessionName],
      terminals,
      [bookmark],
    ).map((row) => row.key)).toEqual([
      bookmark.url,
      'wt-_work_alpha__term-3',
      'wt-_work_alpha__term-1',
      'wt-_work_alpha__term-2',
    ]);
  });

  it('appends a newly pinned Bookmark to the bottom of the stored row order', () => {
    const existingBookmark = { url: 'https://example.com/docs' };
    const newBookmark = { url: 'http://localhost:5173/' };
    const terminals = [
      { sessionName: 'wt-_work_alpha__term-1' },
      { sessionName: 'wt-_work_alpha__term-2' },
    ];

    expect(appendBookmarkToRowOrder(
      [terminals[1].sessionName, existingBookmark.url, terminals[0].sessionName],
      newBookmark,
    )).toEqual([
      terminals[1].sessionName,
      existingBookmark.url,
      terminals[0].sessionName,
      newBookmark.url,
    ]);
  });

  it('preserves curated Terminal keys when appending with no observed Terminals', () => {
    const existingBookmark = { url: 'https://example.com/docs' };
    const newBookmark = { url: 'http://localhost:5173/' };

    expect(appendBookmarkToRowOrder(
      [
        'wt-_work_alpha__term-3',
        'wt-_work_alpha__term-1',
        existingBookmark.url,
      ],
      newBookmark,
    )).toEqual([
      'wt-_work_alpha__term-3',
      'wt-_work_alpha__term-1',
      existingBookmark.url,
      newBookmark.url,
    ]);
  });
});
