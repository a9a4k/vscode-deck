import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    withProgress: vi.fn((_options, task) => task()),
  },
  ProgressLocation: { Window: 10, Notification: 15, SourceControl: 1 },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/repo/main' } }],
  },
}));

vi.mock('../src/git/worktrees', () => ({
  getCommonDir: vi.fn(async () => '/git/repo'),
  getWorktreeStatus: vi.fn(async () => ({
    hasChanges: false,
    hasUnpushedCommits: false,
  })),
  removeWorktree: vi.fn(async () => undefined),
  deleteBranch: vi.fn(async () => undefined),
  readBranchTip: vi.fn(async () => 'abc123'),
}));

import * as vscode from 'vscode';
import {
  deleteBranch,
  getCommonDir,
  getWorktreeStatus,
  readBranchTip,
  removeWorktree,
} from '../src/git/worktrees';
import { WorktreeRemovalCommand } from '../src/worktree/worktreeRemovalCommand';

const node = {
  repositoryPath: '/repo/main',
  mainWorktreePath: '/repo/main',
  worktree: {
    path: '/repo/feature',
    head: 'abc',
    bare: false,
    detached: false,
    branch: 'feature',
  },
};

describe('WorktreeRemovalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCommonDir).mockResolvedValue('/git/repo');
    vi.mocked(getWorktreeStatus).mockResolvedValue({
      hasChanges: false,
      hasUnpushedCommits: false,
    });
    vi.mocked(removeWorktree).mockResolvedValue(undefined);
    vi.mocked(deleteBranch).mockResolvedValue(undefined);
    vi.mocked(readBranchTip).mockResolvedValue('abc123');
  });

  it('removes the worktree without deleting the branch when keep-branch is accepted', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const branchDeletionPreferences = {
      get: vi.fn(() => false),
      set: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      branchDeletionPreferences,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    await command.run(node);
    await waitUntil(() => removeWorktree.mock.calls.length > 0);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Remove worktree at `/repo/feature`?',
      { modal: true, detail: undefined },
      'Remove (keep branch)',
      'Remove and delete branch',
    );
    expect(branchDeletionPreferences.set).toHaveBeenCalledOnce();
    expect(branchDeletionPreferences.set).toHaveBeenCalledWith(false);
    expect(removeWorktree).toHaveBeenCalledWith('/repo/main', '/repo/feature', {
      force: false,
    });
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(activeWorktrees.clear).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith('/repo/main');
  });

  it('kills matching Deck terminal sessions before removing the worktree', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const terminalCascade = {
      killWorktree: vi.fn(async () => undefined),
    };
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      vi.fn(),
      undefined,
      undefined,
      terminalCascade,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    await command.run(node);
    await waitUntil(() => removeWorktree.mock.calls.length > 0);

    expect(terminalCascade.killWorktree).toHaveBeenCalledWith('/repo/feature');
    expect(terminalCascade.killWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      removeWorktree.mock.invocationCallOrder[0],
    );
  });

  it('continues removing the worktree when terminal cascade fails', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const terminalCascade = {
      killWorktree: vi.fn(async () => {
        throw new Error('tmux socket busy');
      }),
    };
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      vi.fn(),
      undefined,
      undefined,
      terminalCascade,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    await command.run(node);
    await waitUntil(() => removeWorktree.mock.calls.length > 0);

    expect(removeWorktree).toHaveBeenCalledWith('/repo/main', '/repo/feature', {
      force: false,
    });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalledWith(
      'Cannot remove worktree: tmux socket busy',
    );
  });

  it('removes the row before git removal finishes', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const pendingRemovals = new Set<string>();
    const removeDone = deferred<void>();
    vi.mocked(removeWorktree).mockReturnValueOnce(removeDone.promise);
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      undefined,
      undefined,
      undefined,
      pendingRemovals,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    const run = command.run(node);
    await waitUntil(() => removeWorktree.mock.calls.length > 0);

    try {
      expect(refresh).toHaveBeenCalledOnce();
    } finally {
      removeDone.resolve();
      await waitUntil(() => !pendingRemovals.has('/repo/feature'));
      await run;
    }
  });

  it('waits for Worktree reconciliation before starting git removal', async () => {
    let finishReconcile: (() => void) | undefined;
    const reconcile = vi.fn(() => new Promise<void>((resolve) => {
      finishReconcile = resolve;
    }));
    const command = new WorktreeRemovalCommand(
      {
        get: vi.fn(() => undefined),
        clear: vi.fn(async () => undefined),
      },
      reconcile,
      undefined,
      undefined,
      undefined,
      new Set(),
    );
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    const run = command.run(node);
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce());

    expect(removeWorktree).not.toHaveBeenCalled();
    finishReconcile?.();
    await run;
    await waitUntil(() => removeWorktree.mock.calls.length > 0);

    expect(removeWorktree).toHaveBeenCalledOnce();
  });

  it('runs the background removal under a notification progress indicator', async () => {
    const command = new WorktreeRemovalCommand(
      { get: vi.fn(() => undefined), clear: vi.fn(async () => undefined) },
      vi.fn(),
      undefined,
      undefined,
      undefined,
      new Set<string>(),
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    await command.run(node);
    await waitUntil(() => removeWorktree.mock.calls.length > 0);

    expect(vscode.window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        location: vscode.ProgressLocation.Notification,
        title: 'Deck: Removing worktree feature…',
      }),
      expect.any(Function),
    );
  });

  it('keeps the path pending until background removal settles', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const pendingRemovals = new Set<string>();
    const removeDone = deferred<void>();
    vi.mocked(removeWorktree).mockReturnValueOnce(removeDone.promise);
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      undefined,
      undefined,
      undefined,
      pendingRemovals,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    const run = command.run(node);
    await waitUntil(() => removeWorktree.mock.calls.length > 0);
    let returned = false;
    run.then(() => {
      returned = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      expect(returned).toBe(true);
      expect(pendingRemovals.has('/repo/feature')).toBe(true);
    } finally {
      removeDone.resolve();
      await waitUntil(() => !pendingRemovals.has('/repo/feature'));
    }
  });

  it('removes the worktree and then deletes the branch when accepted', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const branchDeletionPreferences = {
      get: vi.fn(() => true),
      set: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      branchDeletionPreferences,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove and delete branch' as never,
    );

    await command.run(node);
    await waitUntil(() => deleteBranch.mock.calls.length > 0);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Remove worktree at `/repo/feature`?',
      { modal: true, detail: undefined },
      'Remove and delete branch',
      'Remove (keep branch)',
    );
    expect(branchDeletionPreferences.set).toHaveBeenCalledOnce();
    expect(branchDeletionPreferences.set).toHaveBeenCalledWith(true);
    expect(branchDeletionPreferences.set.mock.invocationCallOrder[0]).toBeLessThan(
      removeWorktree.mock.invocationCallOrder[0],
    );
    expect(removeWorktree).toHaveBeenCalledWith('/repo/main', '/repo/feature', {
      force: false,
    });
    expect(deleteBranch).toHaveBeenCalledWith('/repo/main', 'feature');
    expect(removeWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      deleteBranch.mock.invocationCallOrder[0],
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('deletes the branch from the main worktree path when it differs from the registered repository path', async () => {
    const command = new WorktreeRemovalCommand(
      { get: vi.fn(() => undefined), clear: vi.fn(async () => undefined) },
      vi.fn(),
      { get: vi.fn(() => true), set: vi.fn(async () => undefined) },
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove and delete branch' as never,
    );

    await command.run({
      ...node,
      repositoryPath: '/repo/registered-feature',
      mainWorktreePath: '/repo/main',
    });
    await waitUntil(() => deleteBranch.mock.calls.length > 0);

    expect(removeWorktree).toHaveBeenCalledWith(
      '/repo/registered-feature',
      '/repo/feature',
      { force: false },
    );
    expect(deleteBranch).toHaveBeenCalledWith('/repo/main', 'feature');
  });

  it('falls back to the registered repository path when the main worktree path is absent', async () => {
    const command = new WorktreeRemovalCommand(
      { get: vi.fn(() => undefined), clear: vi.fn(async () => undefined) },
      vi.fn(),
      { get: vi.fn(() => true), set: vi.fn(async () => undefined) },
    );
    const nodeWithoutMainPath = {
      ...node,
      repositoryPath: '/repo/registered',
      mainWorktreePath: undefined,
    };

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove and delete branch' as never,
    );

    await command.run(nodeWithoutMainPath);
    await waitUntil(() => deleteBranch.mock.calls.length > 0);

    expect(deleteBranch).toHaveBeenCalledWith('/repo/registered', 'feature');
  });

  it('does nothing when confirmation is cancelled', async () => {
    const activeWorktrees = {
      get: vi.fn(() => '/repo/feature'),
      clear: vi.fn(async () => undefined),
    };
    const branchDeletionPreferences = {
      get: vi.fn(() => true),
      set: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      branchDeletionPreferences,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    await command.run(node);

    expect(branchDeletionPreferences.set).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(activeWorktrees.clear).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('restores the row when git removal fails', async () => {
    const activeWorktrees = {
      get: vi.fn(() => '/repo/feature'),
      clear: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const pendingRemovals = new Set<string>();
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      undefined,
      undefined,
      undefined,
      pendingRemovals,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );
    vi.mocked(removeWorktree).mockRejectedValueOnce({ stderr: 'is dirty' });

    await command.run(node);
    await waitUntil(() => vscode.window.showErrorMessage.mock.calls.length > 0);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Cannot remove worktree: is dirty',
    );
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(activeWorktrees.clear).toHaveBeenCalledWith('/git/repo');
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(pendingRemovals.has('/repo/feature')).toBe(false);
  });

  it('shows a KeptBranch warning when safe branch deletion is refused after removing the worktree', async () => {
    const activeWorktrees = {
      get: vi.fn(() => '/repo/feature'),
      clear: vi.fn(async () => undefined),
    };
    const branchDeletionPreferences = {
      get: vi.fn(() => true),
      set: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      branchDeletionPreferences,
    );

    vi.mocked(vscode.window.showWarningMessage)
      .mockResolvedValueOnce('Remove and delete branch' as never)
      .mockResolvedValueOnce(undefined);
    vi.mocked(deleteBranch).mockRejectedValueOnce({ stderr: 'not fully merged' });

    await command.run(node);
    await waitUntil(() => readBranchTip.mock.calls.length > 0);

    expect(removeWorktree).toHaveBeenCalledOnce();
    expect(deleteBranch).toHaveBeenCalledWith('/repo/main', 'feature');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      "Worktree removed — branch 'feature' kept: git could not confirm its commits are merged.",
      'Force Delete Branch',
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(activeWorktrees.clear).toHaveBeenCalledWith('/git/repo');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('keeps generic branch deletion errors as error toasts after removing the worktree', async () => {
    const activeWorktrees = {
      get: vi.fn(() => '/repo/feature'),
      clear: vi.fn(async () => undefined),
    };
    const branchDeletionPreferences = {
      get: vi.fn(() => true),
      set: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      branchDeletionPreferences,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove and delete branch' as never,
    );
    vi.mocked(deleteBranch).mockRejectedValueOnce({
      stderr: "error: cannot delete branch 'feature' checked out at '/repo/other'",
    });

    await command.run(node);
    await waitUntil(() => vscode.window.showErrorMessage.mock.calls.length > 0);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "Cannot delete branch: error: cannot delete branch 'feature' checked out at '/repo/other'",
    );
    expect(readBranchTip).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('surfaces status failures without removing', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(activeWorktrees, refresh);

    vi.mocked(getWorktreeStatus).mockRejectedValueOnce({ stderr: 'not a git repo' });

    await command.run(node);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Cannot inspect worktree: not a git repo',
    );
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('clears the ActiveWorktree entry only when it points at the deleted path', async () => {
    const activeWorktrees = {
      get: vi.fn(() => '/repo/feature'),
      clear: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(activeWorktrees, refresh);

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    await command.run(node);

    expect(activeWorktrees.clear).toHaveBeenCalledWith('/git/repo');

    activeWorktrees.get.mockReturnValue('/repo/other');
    activeWorktrees.clear.mockClear();
    refresh.mockClear();

    await command.run(node);

    expect(activeWorktrees.clear).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('uses force when the worktree is dirty or locked', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const command = new WorktreeRemovalCommand(activeWorktrees, vi.fn());

    vi.mocked(getWorktreeStatus).mockResolvedValue({
      hasChanges: true,
      hasUnpushedCommits: true,
    });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Force Remove (keep branch)' as never,
    );

    await command.run({
      ...node,
      worktree: {
        ...node.worktree,
        locked: true,
      },
    });
    await waitUntil(() => removeWorktree.mock.calls.length > 0);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Remove worktree at `/repo/feature`?',
      {
        modal: true,
        detail:
          'Warning: this worktree has uncommitted changes, unpushed commits, locked worktree.',
      },
      'Force Remove (keep branch)',
      'Force Remove and delete branch',
    );
    expect(removeWorktree).toHaveBeenCalledWith('/repo/main', '/repo/feature', {
      force: true,
    });
  });

  it('hides branch deletion for detached worktrees', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const branchDeletionPreferences = {
      get: vi.fn(() => true),
      set: vi.fn(async () => undefined),
    };
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      vi.fn(),
      branchDeletionPreferences,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove' as never);

    await command.run({
      ...node,
      worktree: {
        ...node.worktree,
        branch: undefined,
        detached: true,
      },
    });
    await waitUntil(() => removeWorktree.mock.calls.length > 0);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Remove worktree at `/repo/feature`?',
      { modal: true, detail: undefined },
      'Remove',
    );
    expect(branchDeletionPreferences.set).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(removeWorktree).toHaveBeenCalledOnce();
  });

  it('shows the structural reason and does not call git for active or main worktrees', async () => {
    const command = new WorktreeRemovalCommand(
      {
        get: vi.fn(() => undefined),
        clear: vi.fn(async () => undefined),
      },
      vi.fn(),
    );

    await command.run({
      ...node,
      worktree: {
        ...node.worktree,
        path: '/repo/main',
      },
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Remove worktree at `/repo/main`?',
      { modal: true, detail: 'Switch to another worktree first.' },
    );
    expect(getWorktreeStatus).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition was not met');
}
