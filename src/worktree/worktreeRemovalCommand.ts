import * as path from 'path';
import * as vscode from 'vscode';
import {
  CommonDirCacheLike,
  PASS_THROUGH_COMMON_DIR_CACHE,
  resolveCommonDir,
} from '../repository/repositoryCommonDirCache';
import {
  deleteBranch,
  getWorktreeStatus,
  removeWorktree,
  Worktree,
} from '../git/worktrees';
import { handleBranchDeletionRefusal } from './keptBranch';
import { canRemoveWorktree } from './worktreeRemoval';

interface WorktreeNodeLike {
  repositoryPath: string;
  mainWorktreePath?: string;
  worktree: Worktree;
}

interface ActiveWorktreeStoreLike {
  get(commonDir: string): string | undefined;
  clear(commonDir: string): Promise<void>;
}

interface BranchDeletionPreferenceStoreLike {
  get(): boolean;
  set(value: boolean): Promise<void>;
}

interface TerminalCascadeLike {
  killWorktree(worktreePath: string): Promise<void>;
}

const REMOVE_LABEL = 'Remove';
const FORCE_REMOVE_LABEL = 'Force Remove';

interface RemovalActions {
  labels: string[];
  keepBranchLabel?: string;
  deleteBranchLabel?: string;
}

export class WorktreeRemovalCommand {
  constructor(
    private readonly activeWorktrees: ActiveWorktreeStoreLike,
    private readonly reconcileWorktrees: (repositoryPath: string) => Promise<void> | void,
    private readonly branchDeletionPreferences: BranchDeletionPreferenceStoreLike = {
      get: () => false,
      set: async () => undefined,
    },
    private readonly repositoryCommonDirCache: CommonDirCacheLike = PASS_THROUGH_COMMON_DIR_CACHE,
    private readonly terminalCascade: TerminalCascadeLike = {
      killWorktree: async () => undefined,
    },
    private readonly pendingWorktreeRemovals: Set<string> = new Set(),
  ) {}

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    const activeWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const decision = canRemoveWorktree(
      node.worktree,
      activeWorktreePath,
      node.mainWorktreePath,
    );
    if (!decision.canDelete) {
      // VS Code's modal provides an implicit Cancel button; no explicit action items.
      await vscode.window.showWarningMessage(
        `Remove worktree at \`${node.worktree.path}\`?`,
        { modal: true, detail: decision.reason },
      );
      return;
    }

    let status: { hasChanges: boolean; hasUnpushedCommits: boolean };
    try {
      status = await getWorktreeStatus(node.worktree.path);
    } catch (error) {
      vscode.window.showErrorMessage(`Cannot inspect worktree: ${errorMessage(error)}`);
      return;
    }
    const force = status.hasChanges || node.worktree.locked === true;
    const actionLabel = force ? FORCE_REMOVE_LABEL : REMOVE_LABEL;
    const branchName = node.worktree.detached ? undefined : node.worktree.branch;
    const actions = removalActions(
      actionLabel,
      branchName,
      this.branchDeletionPreferences.get(),
    );
    const picked = await vscode.window.showWarningMessage(
      `Remove worktree at \`${node.worktree.path}\`?`,
      { modal: true, detail: warningDetail(status, node.worktree.locked === true) },
      ...actions.labels,
    );
    // VS Code's modal adds its own Cancel; undefined here = user cancelled.
    if (!picked) return;

    const deleteLocalBranch = branchDeletionChoice(actions, picked);
    if (deleteLocalBranch === undefined) return;

    if (branchName) {
      await this.branchDeletionPreferences.set(deleteLocalBranch);
    }

    const commonDir = await this.resolveCommonDirForRemoval(node.repositoryPath);
    if (commonDir === undefined) return;

    if (this.activeWorktrees.get(commonDir) === node.worktree.path) {
      await this.activeWorktrees.clear(commonDir);
    }
    this.pendingWorktreeRemovals.add(node.worktree.path);
    await this.reconcileWorktrees(node.repositoryPath);

    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Deck: Removing worktree ${path.basename(node.worktree.path)}…`,
      },
      () => this.removeInBackground(node, force, deleteLocalBranch, branchName),
    );
  }

  private async resolveCommonDirForRemoval(repositoryPath: string): Promise<string | undefined> {
    try {
      return await resolveCommonDir(this.repositoryCommonDirCache, repositoryPath);
    } catch (error) {
      vscode.window.showErrorMessage(`Cannot remove worktree: ${errorMessage(error)}`);
      return undefined;
    }
  }

  private async removeInBackground(
    node: WorktreeNodeLike,
    force: boolean,
    deleteLocalBranch: boolean,
    branchName: string | undefined,
  ): Promise<void> {
    try {
      await bestEffort(() => this.terminalCascade.killWorktree(node.worktree.path));
      await removeWorktree(node.repositoryPath, node.worktree.path, { force });
    } catch (error) {
      this.pendingWorktreeRemovals.delete(node.worktree.path);
      await this.reconcileWorktrees(node.repositoryPath);
      vscode.window.showErrorMessage(`Cannot remove worktree: ${errorMessage(error)}`);
      return;
    }

    if (deleteLocalBranch && branchName) {
      const branchDeletionRepositoryPath = node.mainWorktreePath ?? node.repositoryPath;
      try {
        await deleteBranch(branchDeletionRepositoryPath, branchName);
      } catch (error) {
        await handleBranchDeletionRefusal({
          repositoryPath: branchDeletionRepositoryPath,
          branchName,
          error,
        });
      }
    }
    this.pendingWorktreeRemovals.delete(node.worktree.path);
  }
}

function removalActions(
  actionLabel: string,
  branchName: string | undefined,
  deleteBranchByDefault: boolean,
): RemovalActions {
  // No explicit Cancel — VS Code's modal supplies its own Cancel/Esc affordance.
  if (!branchName) return { labels: [actionLabel] };

  const keepBranchLabel = `${actionLabel} (keep branch)`;
  const deleteBranchLabel = `${actionLabel} and delete branch`;
  const orderedActions = deleteBranchByDefault
    ? [deleteBranchLabel, keepBranchLabel]
    : [keepBranchLabel, deleteBranchLabel];
  return {
    labels: orderedActions,
    keepBranchLabel,
    deleteBranchLabel,
  };
}

function branchDeletionChoice(
  actions: RemovalActions,
  picked: string,
): boolean | undefined {
  if (!actions.deleteBranchLabel) return false;
  if (picked === actions.deleteBranchLabel) return true;
  if (picked === actions.keepBranchLabel) return false;
  return undefined;
}

function warningDetail(
  status: { hasChanges: boolean; hasUnpushedCommits: boolean },
  locked: boolean,
): string | undefined {
  const warnings: string[] = [];
  if (status.hasChanges) warnings.push('uncommitted changes');
  if (status.hasUnpushedCommits) warnings.push('unpushed commits');
  if (locked) warnings.push('locked worktree');
  if (warnings.length === 0) return undefined;
  return `Warning: this worktree has ${warnings.join(', ')}.`;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderrValue = error.stderr;
    const stderr = typeof stderrValue === 'string' ? stderrValue.trim() : '';
    if (stderr) return stderr;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

async function bestEffort(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // Tmux cleanup must not block git removal.
  }
}
