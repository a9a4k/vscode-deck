import { describe, expect, it } from 'vitest';
import { canRemoveWorktree } from '../src/worktree/worktreeRemoval';

describe('canRemoveWorktree', () => {
  it('allows deleting a regular worktree', () => {
    expect(
      canRemoveWorktree(
        {
          path: '/repo/feature',
          head: 'abc',
          bare: false,
          detached: false,
          branch: 'feature',
          main: false,
        },
        '/repo/other',
      ),
    ).toEqual({ canDelete: true });
  });

  it('disables deleting the active worktree', () => {
    expect(
      canRemoveWorktree(
        {
          path: '/repo/feature',
          head: 'abc',
          bare: false,
          detached: false,
          branch: 'feature',
          main: false,
        },
        '/repo/feature',
      ),
    ).toEqual({
      canDelete: false,
      reason: 'Switch to another worktree first.',
    });
  });

  it('disables deleting the main worktree', () => {
    expect(
      canRemoveWorktree(
        {
          path: '/repo/main',
          head: 'abc',
          bare: false,
          detached: false,
          branch: 'main',
          main: true,
        },
        '/repo/feature',
      ),
    ).toEqual({
      canDelete: false,
      reason: 'git refuses to remove the main worktree.',
    });
  });

  it('uses the active reason when a worktree is both active and main', () => {
    expect(
      canRemoveWorktree(
        {
          path: '/repo/main',
          head: 'abc',
          bare: false,
          detached: false,
          branch: 'main',
          main: true,
        },
        '/repo/main',
      ),
    ).toEqual({
      canDelete: false,
      reason: 'Switch to another worktree first.',
    });
  });
});
