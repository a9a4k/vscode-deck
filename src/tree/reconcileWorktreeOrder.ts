import type { Worktree } from '../git/worktrees';

export function reconcileWorktreeOrder(
  storedOrder: readonly string[] | undefined,
  gitWorktrees: readonly Worktree[],
): readonly Worktree[] {
  const byPath = new Map(gitWorktrees.map((worktree) => [worktree.path, worktree]));
  const placedPaths = new Set<string>();
  const ordered: Worktree[] = [];

  for (const path of storedOrder ?? []) {
    const worktree = byPath.get(path);
    if (!worktree) continue;
    ordered.push(worktree);
    placedPaths.add(path);
  }

  ordered.push(...sortUnplacedWorktrees(gitWorktrees, placedPaths));

  return ordered;
}

function sortUnplacedWorktrees(
  gitWorktrees: readonly Worktree[],
  placedPaths: ReadonlySet<string>,
): Worktree[] {
  const mainWorktree = gitWorktrees.find((worktree) => worktree.main);
  const unplacedWorktrees = gitWorktrees.filter(
    (worktree) => worktree.path !== mainWorktree?.path && !placedPaths.has(worktree.path),
  );

  // Stable sort (ES2019): worktrees with equal or absent createdAt keep git order.
  // Undated worktrees fall to epoch 0, i.e. the top — a mixed dated/undated repo is out of scope (ADR-0048).
  unplacedWorktrees.sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));

  if (mainWorktree === undefined || placedPaths.has(mainWorktree.path)) return unplacedWorktrees;
  return [mainWorktree, ...unplacedWorktrees];
}
