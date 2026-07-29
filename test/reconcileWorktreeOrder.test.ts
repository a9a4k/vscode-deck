import { describe, expect, it } from 'vitest';
import { Worktree } from '../src/git/worktrees';
import { reconcileWorktreeOrder } from '../src/tree/reconcileWorktreeOrder';

function worktree(path: string, createdAt?: number): Worktree {
  return {
    path,
    head: path,
    bare: false,
    detached: false,
    branch: path,
    main: path === '/work/main',
    createdAt,
  };
}

describe('reconcileWorktreeOrder', () => {
  it('defaults to main first, then creation order with newest last', () => {
    const gitWorktrees = [
      worktree('/work/main'),
      worktree('/work/feature-new', 3000),
      worktree('/work/feature-old', 1000),
      worktree('/work/feature-middle', 2000),
    ];

    expect(reconcileWorktreeOrder(undefined, gitWorktrees).map((w) => w.path)).toEqual([
      '/work/main',
      '/work/feature-old',
      '/work/feature-middle',
      '/work/feature-new',
    ]);
  });

  it('does not pin the first linked Worktree of a bare Repository', () => {
    const linkedWorktrees = [
      worktree('/work/feature-new', 3000),
      worktree('/work/feature-old', 1000),
    ];

    expect(reconcileWorktreeOrder(undefined, linkedWorktrees).map((w) => w.path)).toEqual([
      '/work/feature-old',
      '/work/feature-new',
    ]);
  });

  it('puts stored worktrees first and appends unplaced worktrees in creation order', () => {
    const gitWorktrees = [
      worktree('/work/main'),
      worktree('/work/feature-a', 3000),
      worktree('/work/feature-b'),
      worktree('/work/feature-c', 1000),
    ];

    expect(
      reconcileWorktreeOrder(
        ['/work/feature-b', '/work/main'],
        gitWorktrees,
      ).map((w) => w.path),
    ).toEqual([
      '/work/feature-b',
      '/work/main',
      '/work/feature-c',
      '/work/feature-a',
    ]);
  });

  it('keeps git order for unplaced worktrees with equal creation timestamps', () => {
    const gitWorktrees = [
      worktree('/work/main'),
      worktree('/work/feature-b', 1000),
      worktree('/work/feature-a', 1000),
      worktree('/work/feature-c', 1000),
    ];

    expect(reconcileWorktreeOrder(undefined, gitWorktrees).map((w) => w.path)).toEqual([
      '/work/main',
      '/work/feature-b',
      '/work/feature-a',
      '/work/feature-c',
    ]);
  });

  it('keeps git order for unplaced worktrees without creation timestamps', () => {
    const gitWorktrees = [
      worktree('/work/main'),
      worktree('/work/feature-b'),
      worktree('/work/feature-a'),
      worktree('/work/feature-c'),
    ];

    expect(reconcileWorktreeOrder(undefined, gitWorktrees).map((w) => w.path)).toEqual([
      '/work/main',
      '/work/feature-b',
      '/work/feature-a',
      '/work/feature-c',
    ]);
  });

  it('drops stale stored paths while preserving kept order', () => {
    const gitWorktrees = [
      worktree('/work/main'),
      worktree('/work/feature-a'),
      worktree('/work/feature-b'),
    ];

    expect(
      reconcileWorktreeOrder(
        ['/stale', '/work/feature-b', '/missing', '/work/main'],
        gitWorktrees,
      ).map((w) => w.path),
    ).toEqual(['/work/feature-b', '/work/main', '/work/feature-a']);
  });

  it('returns git order when all stored paths are stale', () => {
    const gitWorktrees = [worktree('/work/main'), worktree('/work/feature')];

    expect(
      reconcileWorktreeOrder(['/stale-a', '/stale-b'], gitWorktrees).map(
        (w) => w.path,
      ),
    ).toEqual(['/work/main', '/work/feature']);
  });

  it('returns empty when git has no worktrees', () => {
    expect(reconcileWorktreeOrder(['/work/main'], [])).toEqual([]);
  });
});
