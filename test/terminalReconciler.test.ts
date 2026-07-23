import { describe, expect, it, vi } from 'vitest';
import { TerminalModel } from '../src/terminal/terminalModel';
import { TerminalReconciler } from '../src/terminal/terminalReconciler';
import { TERMINAL_SNAPSHOT_ANCHOR_SESSION } from '../src/terminal/terminalSnapshotRuntime';

describe('TerminalReconciler', () => {
  it('restores a down DeckSocket without changing trusted Terminal state', async () => {
    const model = new TerminalModel();
    model.apply([
      { sessionName: 'wt-_work_alpha__term-1', windowName: 'one' },
    ]);
    const restore = vi.fn(async () => undefined);
    const terminalOrders = {
      get: vi.fn(() => ['wt-_work_alpha__term-1']),
      set: vi.fn(async () => undefined),
    };
    const updateDecorations = vi.fn();
    const wakeExitSweep = vi.fn();
    const fireTree = vi.fn();
    const reconciler = new TerminalReconciler({
      model,
      restore,
      terminalOrders,
      locations: () => [{ repositoryPath: '/work/alpha', worktreePath: '/work/alpha' }],
      updateDecorations,
      wakeExitSweep,
      fireTree,
    });

    await reconciler.reconcile([]);

    expect(restore).toHaveBeenCalledOnce();
    expect(model.get('/work/alpha')).toEqual([
      { sessionName: 'wt-_work_alpha__term-1', n: 1, windowName: 'one' },
    ]);
    expect(terminalOrders.set).not.toHaveBeenCalled();
    expect(updateDecorations).not.toHaveBeenCalled();
    expect(wakeExitSweep).not.toHaveBeenCalled();
    expect(fireTree).not.toHaveBeenCalled();
  });

  it('applies a restored observation before ordered reconciliation side effects', async () => {
    const model = new TerminalModel();
    model.apply([
      { sessionName: 'wt-_work_alpha__term-1', windowName: 'one' },
      { sessionName: 'wt-_work_alpha__term-2', windowName: 'two' },
    ]);
    const effects: string[] = [];
    const restore = vi.fn(async () => undefined);
    const terminalOrders = {
      get: vi.fn(() => [
        'wt-_work_alpha__term-1',
        'wt-_work_alpha__term-2',
      ]),
      set: vi.fn(async () => {
        effects.push('order');
      }),
    };
    const updateDecorations = vi.fn(() => {
      effects.push('decorations');
    });
    const wakeExitSweep = vi.fn(() => {
      effects.push('wake');
    });
    const fireTree = vi.fn(() => {
      effects.push('fire');
    });
    const reconciler = new TerminalReconciler({
      model,
      restore,
      terminalOrders,
      locations: () => [{ repositoryPath: '/work/alpha', worktreePath: '/work/alpha' }],
      updateDecorations,
      wakeExitSweep,
      fireTree,
    });

    await reconciler.reconcile([
      { sessionName: 'wt-_work_alpha__term-2', windowName: 'renamed' },
      { sessionName: 'wt-_work_alpha__term-3', windowName: 'three' },
    ]);

    expect(restore).not.toHaveBeenCalled();
    expect(model.get('/work/alpha')).toEqual([
      { sessionName: 'wt-_work_alpha__term-2', n: 2, windowName: 'renamed' },
      { sessionName: 'wt-_work_alpha__term-3', n: 3, windowName: 'three' },
    ]);
    expect(terminalOrders.set).toHaveBeenCalledWith('/work/alpha', [
      'wt-_work_alpha__term-2',
    ]);
    expect(updateDecorations).toHaveBeenCalledWith([
      {
        repositoryPath: '/work/alpha',
        worktreePath: '/work/alpha',
        sessionName: 'wt-_work_alpha__term-2',
      },
      {
        repositoryPath: '/work/alpha',
        worktreePath: '/work/alpha',
        sessionName: 'wt-_work_alpha__term-3',
      },
    ]);
    expect(effects).toEqual(['order', 'decorations', 'wake', 'fire']);
  });

  it('restores an anchor-only DeckSocket without pruning or firing', async () => {
    const model = observedModel();
    const restore = vi.fn(async () => undefined);
    const terminalOrders = {
      get: vi.fn(() => ['wt-_work_alpha__term-1']),
      set: vi.fn(async () => undefined),
    };
    const updateDecorations = vi.fn();
    const wakeExitSweep = vi.fn();
    const fireTree = vi.fn();
    const reconciler = new TerminalReconciler({
      model,
      restore,
      terminalOrders,
      locations: () => [{ repositoryPath: '/work/alpha', worktreePath: '/work/alpha' }],
      updateDecorations,
      wakeExitSweep,
      fireTree,
    });

    await reconciler.reconcile([
      { sessionName: TERMINAL_SNAPSHOT_ANCHOR_SESSION, windowName: 'anchor' },
    ]);

    expect(restore).toHaveBeenCalledOnce();
    expect(terminalOrders.set).not.toHaveBeenCalled();
    expect(updateDecorations).not.toHaveBeenCalled();
    expect(wakeExitSweep).not.toHaveBeenCalled();
    expect(fireTree).not.toHaveBeenCalled();
  });

  it('feeds decorations on an unchanged trusted observation without other effects', async () => {
    const model = observedModel();
    const sessions = [
      { sessionName: 'wt-_work_alpha__term-1', windowName: 'one' },
    ];
    model.apply(sessions);
    const terminalOrders = {
      get: vi.fn(() => ['wt-_work_alpha__term-1']),
      set: vi.fn(async () => undefined),
    };
    const updateDecorations = vi.fn();
    const wakeExitSweep = vi.fn();
    const fireTree = vi.fn();
    const reconciler = new TerminalReconciler({
      model,
      restore: vi.fn(async () => undefined),
      terminalOrders,
      locations: () => [{ repositoryPath: '/work/alpha', worktreePath: '/work/alpha' }],
      updateDecorations,
      wakeExitSweep,
      fireTree,
    });

    await reconciler.reconcile(sessions);

    expect(terminalOrders.set).not.toHaveBeenCalled();
    expect(updateDecorations).toHaveBeenCalledWith([
      {
        repositoryPath: '/work/alpha',
        worktreePath: '/work/alpha',
        sessionName: 'wt-_work_alpha__term-1',
      },
    ]);
    expect(wakeExitSweep).not.toHaveBeenCalled();
    expect(fireTree).not.toHaveBeenCalled();
  });
});

function observedModel(): TerminalModel {
  const model = new TerminalModel();
  model.apply([
    { sessionName: 'wt-_work_alpha__term-1', windowName: 'one' },
  ]);
  return model;
}
