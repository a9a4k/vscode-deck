# ADR-0049: Bare worktrees are hidden from the tree

## Context

`git worktree list --porcelain` reports two kinds of branchless worktree: a
**Detached Worktree** (`detached`, checked out at a commit) and a **Bare
Worktree** (`bare`, no working tree at all). Both fell through the label fallback
`worktree.branch ?? worktree.path`, so both rendered their full filesystem path
as the row label — the reported bug.

A Bare Worktree is different in kind from a Detached one. Its `path` points at
the git directory, not a checkout. `WorktreeSwitcher.switchTo` calls
`vscode.openFolder` on that path with no validation and first records it as the
`ActiveWorktree` — so Switching to a Bare Worktree would mount git internals
(`HEAD`, `objects/`, `refs/`) as the workspace **and** poison the ActiveWorktree
so the Repository node reopens that garbage on the next click. A row click is
inert (WorktreeNode sets no `command`), but the Switch and DetachedOpen context
actions a visible row exposes are the hazard.

Surveyed tools split on exactly this line: worktree-organized UIs that show a
worktree list either render a Bare Worktree as an unusable row (git CLI,
git-worktree-manager, vscode-git-worktree-switcher, agent-deck) or hide it
(orca). A Detached Worktree, being a real checkout, is universally kept and
merely relabelled.

## Decision

**Relabel the Detached Worktree; hide the Bare Worktree.**

1. **Detached stays shown.** It is a real working-tree checkout — Switching to it
   mounts real files. The label falls back to the folder basename
   (`worktree.branch ?? path.basename(worktree.path)`), with the detached state
   and short commit carried in the tooltip. No icon and no `description` marker:
   the secondary sidebar is narrow and already ellipsises long labels, so a
   trailing `description` would be truncated away — the tooltip is the only slot
   immune to label width.

2. **Bare is filtered out** in `visibleWorktrees`, so it never renders and can
   never be a Switch target. This is the sole reason it is hidden: it cannot be
   mounted. Main identity is captured from the first porcelain entry before
   this filter runs. For a bare Repository that entry is the Bare Worktree, so
   none of its visible linked Worktrees is treated as main.

3. **Empty bare-only Repository is tolerated as-is.** A bare repo with no linked
   worktrees renders a childless Repository node. VS Code's native
   `TreeDataProvider` handles empty children without placeholder machinery (unlike
   orca's custom sidebar, which needed a placeholder path). No empty-state UI is
   built speculatively.

## Consequences

- Switching can no longer mount a bare git directory or poison the
  ActiveWorktree — the footgun is removed by construction, not by validation.
- A bare-only Repository shows an empty node; acceptable for a rare case, and
  revisitable if it proves confusing.
- A Detached Worktree looks like any other row at a glance (folder name only);
  its detached state is discoverable on hover, not by scanning. Deliberate, given
  the width constraint.

## Status

Accepted.
