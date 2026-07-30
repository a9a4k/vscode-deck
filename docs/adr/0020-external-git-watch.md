# ADR-0020: ExternalGitWatch refreshes the Deck tree on out-of-Deck git changes

## Context

ADR-0007 deliberately deferred a `FileSystemWatcher` on git metadata until a
staleness bug was proven. Issue #77 proves it: a `git checkout` in a Terminal
can leave a Worktree row showing the old branch until the user manually
refreshes or hides and re-shows Deck. The same stale-cache gap affects
`git worktree add` and `git worktree remove` run outside Deck.

Deck's tree already knows how to reconcile once `refresh()` runs:
`refreshWorktreesInBackground` re-runs `git worktree list`, and
`sameWorktrees` suppresses redundant repaints. The missing piece is a push
signal when git state changes outside Deck.

## Decision

1. Add **ExternalGitWatch** per Repository common dir. The module owns a
   `Map<commonDir, Disposable>` and exposes `sync(commonDirs)` plus
   `dispose()`. It is synchronous and has no `vscode` dependency; callers
   resolve discovery seeds to common dirs first.

2. Create watches with `vscode.workspace.createFileSystemWatcher` over an
   absolute common-dir base:

   ```
   HEAD
   worktrees/**/HEAD
   worktrees/*/gitdir
   worktrees
   worktrees/*
   ```

   `HEAD` changes when a Worktree checks out another branch or detaches. A
   commit, fetch, or rebase moves refs without rewriting `HEAD`, so storm
   avoidance is structural, not only debounce-based. A linked Worktree move
   rewrites its administrative `gitdir` file. The exact `worktrees` pattern
   catches the first linked Worktree's creation and the last one's deletion;
   `worktrees/*` catches child directory changes while linked Worktrees
   remain.

3. Debounce watch events on a trailing 250ms edge. A checkout can touch several
   files; Deck should repaint once after the burst.

4. Wire activation through the existing refresh path. `refreshTree()` calls
   `tree.refresh()` and then reconciles the watch set from
   `RepositoryRegistry.list()` discovery seeds resolved by
   `resolveCommonDirSafe`. Unresolvable seeds are skipped. The watch set is
   keyed by common dir, so duplicate seed paths converge to one watch.

5. Do not mute Deck's own writes. Add/remove commands already call refresh, and
   `sameWorktrees` suppresses redundant repaints. Self-muting would add state
   without changing the observable result.

## Rejected Option: VS Code Git Extension API

Deck does not use `vscode.git`'s `getAPI(1)` for this signal.

- It auto-discovers repositories inside the open workspace, but Deck mounts one
  Worktree at a time and must watch all registered Repositories.
- Force-opening unmounted repositories through the Git API would add them to
  the user's Source Control view, including linked worktrees as SCM entries.
- Its status-change signal is tied to `git status`, debounced, and gated by
  idle/focus behavior. Issue #77 requires updates even when the window is not
  focused.
- It would be a soft dependency on the built-in Git extension being enabled.

The worktree diffing the Git API could provide is not needed; Deck already
diffs `git worktree list` results.

## Consequences

- External `git checkout`, detached `HEAD`, and `git worktree add/remove/move`
  refresh the tree without manual action.
- Commits, fetches, and rebases do not churn the tree because refs are not
  watched.
- All watches are disposed through the extension subscription lifecycle.
- **Known gap, accepted: a common dir replaced at the same path mid-session
  stops delivering events until the window reloads.** A `FileSystemWatcher`
  does not survive its base directory being deleted and recreated, and `sync`
  skips any dir it already watches, so the dead watch is never replaced.
  Triggers are rare and deliberate — re-cloning in place, a script rebuilding
  `.git`, a volume unmounted while VS Code stays open. Deck: Refresh still
  reconciles the data on demand (only the push signal is lost), and a reload
  repairs it fully. A fix was implemented and reverted (#168): detecting
  replacement needs the dir's filesystem identity, and deriving that from
  `birthtimeMs` is unreliable on filesystems lacking a creation timestamp —
  Node substitutes ctime there, which changes whenever an entry inside `.git`
  changes, so every sync would dispose and recreate every watcher. That trades
  a rare single-Repository degradation for a systematic one on untested
  platforms. Revisit only with a stable identity source (e.g. `dev:ino` alone)
  or if the scenario proves common.
  The distinct case of a dir missing *when the watch is first attempted* IS
  handled — that attempt is not recorded, so a later sync retries it (#166).
- Unit tests verify watch reconciliation and debounce coalescing without a real
  filesystem watcher.
- OS delivery for out-of-workspace `RelativePattern` git events remains
  F5-verifiable only. VS Code's built-in Git extension uses the same style of
  out-of-workspace `.git` watching, but unit tests cannot prove OS delivery.

## Refines

- **ADR-0007.** Supersedes §6's "No `FileSystemWatcher` until proven
  necessary." The staleness bug is now proven, and the watcher is the missing
  push signal for ADR-0007's stale-while-revalidate cache.

## Status

Accepted.
