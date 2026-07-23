import { describe, expect, it } from 'vitest';
import { TerminalModel } from '../src/terminal/terminalModel';

describe('TerminalModel', () => {
  it('applies observed Terminals and exposes them by Worktree', () => {
    const model = new TerminalModel();

    const diff = model.apply([
      { sessionName: 'wt-_work_alpha__term-2', windowName: 'two' },
      { sessionName: 'wt-_work_beta__term-1', windowName: 'beta' },
      { sessionName: 'wt-_work_alpha__term-1', windowName: 'one' },
      { sessionName: '__deck_snapshot_anchor', windowName: 'anchor' },
    ]);

    expect(model.get('/work/alpha')).toEqual([
      { sessionName: 'wt-_work_alpha__term-1', n: 1, windowName: 'one' },
      { sessionName: 'wt-_work_alpha__term-2', n: 2, windowName: 'two' },
    ]);
    expect(diff).toEqual([
      {
        worktreePrefix: 'wt-_work_alpha__term-',
        added: model.get('/work/alpha'),
        removed: [],
        relabeled: [],
      },
      {
        worktreePrefix: 'wt-_work_beta__term-',
        added: model.get('/work/beta'),
        removed: [],
        relabeled: [],
      },
    ]);
  });

  it('ignores observed fields that do not change a Terminal row label or identity', () => {
    const model = new TerminalModel();
    model.apply([
      {
        sessionName: 'wt-_work_alpha__term-1',
        windowName: 'zsh',
        paneTitle: ':/work/alpha',
      },
    ]);

    const diff = model.apply([
      {
        sessionName: 'wt-_work_alpha__term-1',
        windowName: 'zsh',
        paneTitle: ':/work/alpha/src',
      },
    ]);

    expect(diff).toEqual([]);
    expect(model.find('wt-_work_alpha__term-1')).toEqual({
      sessionName: 'wt-_work_alpha__term-1',
      n: 1,
      windowName: 'zsh',
      paneTitle: ':/work/alpha/src',
    });
  });

  it('reports additions, removals, and relabels per Worktree', () => {
    const model = new TerminalModel();
    model.apply([
      { sessionName: 'wt-_work_alpha__term-1', windowName: 'one' },
      { sessionName: 'wt-_work_alpha__term-2', windowName: 'two' },
      { sessionName: 'wt-_work_beta__term-1', windowName: 'beta' },
    ]);

    const diff = model.apply([
      { sessionName: 'wt-_work_alpha__term-2', windowName: 'renamed' },
      { sessionName: 'wt-_work_alpha__term-3', windowName: 'three' },
      { sessionName: 'wt-_work_beta__term-1', windowName: 'beta' },
    ]);

    expect(diff).toEqual([
      {
        worktreePrefix: 'wt-_work_alpha__term-',
        added: [
          expect.objectContaining({ sessionName: 'wt-_work_alpha__term-3' }),
        ],
        removed: [
          expect.objectContaining({ sessionName: 'wt-_work_alpha__term-1' }),
        ],
        relabeled: [
          expect.objectContaining({
            sessionName: 'wt-_work_alpha__term-2',
            windowName: 'renamed',
          }),
        ],
      },
    ]);
    expect(model.find('wt-_work_alpha__term-1')).toBeUndefined();
    expect(model.find('wt-_work_alpha__term-2')).toEqual(
      expect.objectContaining({ windowName: 'renamed' }),
    );
  });
});
