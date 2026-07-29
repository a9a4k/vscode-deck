import { Worktree } from '../git/worktrees';

export interface WorktreeRemovalDecision {
  canDelete: boolean;
  reason?: string;
}

export function canRemoveWorktree(
  worktree: Worktree,
  activeWorktreePath: string | undefined,
): WorktreeRemovalDecision {
  if (worktree.path === activeWorktreePath) {
    return {
      canDelete: false,
      reason: 'Switch to another worktree first.',
    };
  }

  if (worktree.main) {
    return {
      canDelete: false,
      reason: 'git refuses to remove the main worktree.',
    };
  }

  return { canDelete: true };
}
