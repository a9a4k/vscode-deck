# Per-Repository local launchers live in user settings, keyed by path

Deck adds a third TerminalLauncher source — **RepositoryLaunchers** — for launchers
that are personal to one Repository but should not be committed to its
`.deck/launchers.json`. They live in user settings as `deck.repositoryLaunchers`,
an **array of `{ repository, launchers }`** entries (repository identity is a
field, not the JSON key). They are resolved by common dir, so they apply to every
Worktree of the Repository, and merged into the Worktree add Quick Pick after the
committed-repo group and before the global-user group. An entry is **config, not
registration**: a path matching no registered Repository is inert, and editing it
never mutates the RepositoryRegistry.

## Considered options

- **A committed/gitignored file in the repo** (`.deck/launchers.json` or a
  `.local` sibling). Rejected — the requirement is explicitly "no `.deck` folder
  created *or* committed in the repo."
- **A file in the git common dir** (`<common-dir>/deck/launchers.json`, mirroring
  `.git/info/exclude`). Strong git-native fit and intrinsically per-Repository,
  but rejected because a stated future direction is supporting **non-git folders**,
  which have no common dir — the storage key must be a plain path that generalizes.
- **`globalState` (Memento), keyed by path.** Matches where the RepositoryRegistry
  and other per-Repo state live, and never syncs — but it is opaque (SQLite) and
  **not user-openable**, and the user wants to hand-edit these.
- **A `globalStorageUri` file.** Openable and machine-local, but VS Code documents
  `globalStorageUri` for *large files*; using it for a small user-edited config is
  off-label, and there is no established precedent for user-editable config there.
- **User settings (chosen).** The documented VS Code home for user-editable config,
  with direct precedent: SQLTools (`sqltools.connections`) and MS SQL
  (`mssql.connections`) store connection profiles as a settings array, keeping only
  secrets out (in OS secure storage). Our launchers carry no secrets, so the whole
  record lives in settings.

## The sync question

User settings ride Settings Sync by default, and we did *not* want these to sync.
We accept it rather than fight it, exactly as the connection-profile precedent
does: the only machine-specific field is the `repository` **path**, and a synced
entry whose path matches no local Repository is simply inert — harmless, like a
synced DB connection pointing at an unreachable host. A user who wants zero sync
adds the key to `settingsSync.ignoredSettings`. Crucially, because settings
entries are references and never register a Repository (below), sync can carry
launcher *config* but can never make a Repository *appear* on another machine —
so repository registration stays local, as intended.

## Boundary: reference, not registration

`deck.repositoryLaunchers` references a Repository by path; it does not create one.
Registration stays exclusively the RepositoryRegistry's job (Add Repository /
drag-to-register), which owns existence *and* curated order. We do **not** sync
settings paths into `globalState`:

- it would give two ways to register, one a side effect of editing config;
- a settings entry has no position in the curated order;
- a path may be a typo, a non-git folder, or absent on this machine;
- cascading registry mutations from text edits are surprising and hard to reverse;
- it would silently re-sync *registration* (settings sync; the registry must not),
  the very thing we ruled out.

RepositoryRemoval leaves a Repository's launchers entry untouched (removal delists
from the registry; the config is the user's to keep for a later re-register).
Orphaned/typo entries are ignored — no validation UI.

## Consequences

- Extends ADR-0043 (two launcher sources via Quick Pick) to three. The merge order
  is committed-repo → repository-local → global-user.
- Storage diverges by tier *on purpose*: the RepositoryRegistry stays in
  `globalState` (read on the synchronous tree-render path, command-managed, never
  user-edited; cf. ADR-0007), while RepositoryLaunchers go to settings (off the
  hot path, user-edited). Same decision rule, different homes — not an
  inconsistency.
- RunOnWorktreeCreate (ADR-0044) honors the new source like the other two.
- A path-keyed settings array is mildly machine-specific; this is accepted (see
  the sync question) and mirrors established connection-profile extensions.

## Status

Accepted.
