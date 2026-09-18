# ADR-0013: VS Code natively restores custom-editor tabs across switches (supersedes ADR-0011 §8)

## Context

ADR-0011 §8 introduced `TabSnapshotStore`: a per-worktree `workspaceState`
record of Deck terminal tab placement (editor layout, viewColumn, index,
pinned, active), captured immediately before a `SwitchOperation`'s
`vscode.openFolder` and replayed on activation. Its stated justification:

> VS Code's per-folder workspace storage handles same-worktree reload of
> custom-editor tabs natively. It does *not* survive SwitchOperation — a
> worktree switch reloads the window into a different folder, and the prior
> folder's custom-editor tab list is not re-played on return.

That claim was inherited from the **pre-cutover** surface (ADR-0008 §6),
where Deck terminals were VS Code's built-in terminal-in-editor — whose
restoration VS Code does not persist per-folder across folder swaps. It was
never re-verified against the **custom-editor** surface that ADR-0011
adopted.

Re-verified empirically (June 2026, with `TabSnapshotStore.restore`
disabled so only VS Code's native behavior was in play): open three Deck
terminals in worktree A across two editor columns with one pinned, switch
to worktree B, switch back to A. VS Code **fully restored** them on its
own — existence, column/split, tab order, pinned state, active tab, and
live reattachment to the surviving tmux sessions (scrollback intact via
the control-mode capture-pane seed). Custom-editor tabs *are* persisted
per folder and replayed when the folder is reopened, including across a
`SwitchOperation` round-trip.

`TabSnapshotStore` was therefore redundant. Worse, it was an active bug
source: it was only `capture()`d on switch, so it could re-open a tab for
a session the user had since closed (`exit`/Cmd+W) — `vscode.openWith` →
`new-session -A` resurrecting a deliberately-closed terminal on the next
activation. The clean separation of concerns is:

- **tmux is the source of truth for terminal existence** (`list-sessions`).
- **VS Code is the source of truth for editor tab placement** — it knows
  columns, splits, order, pin/active; tmux cannot.

The snapshot store sat between these and duplicated both, badly.

## Decision

1. **Delete `TabSnapshotStore` entirely** — the module, its tests, the
   `WorktreeSwitcher` capture call + constructor dependency, and the
   activation-time `restore()` call. Tab restoration across reload **and**
   switch is delegated wholesale to VS Code's native custom-editor
   restoration (ADR-0011 decision 5, now confirmed to also cover switches).

2. **Existence remains tmux's.** A Deck terminal exists iff its tmux
   session exists. Closing a tab (`exit`, Cmd+W, Kill, cascade) ends the
   session; VS Code drops the closed tab from its persisted set, so it is
   not replayed. No Deck-side reconciliation is needed.

3. **Placement remains VS Code's.** No Deck-side capture/replay of
   layout, column, order, pin, or active state.

## Consequences

- The `exit`/Cmd+W-then-reload resurrection bug disappears with the store:
  VS Code's native restore correctly omits closed tabs, and there is no
  longer a stale snapshot to replay.
- A killed Terminal's tab can remain in another folder's persisted layout
  when TerminalRemoval happens elsewhere. On native replay, Deck waits for
  TerminalSnapshot restore, checks tmux for the Terminal, and closes the tab
  without attaching when the session is absent. This prevents the transport's
  create-or-attach command from resurrecting the Terminal as a blank shell.
- `deck.terminalSnapshot` `workspaceState` entries become orphaned on
  upgrade. They are never read again; no migration needed (workspaceState
  is per-folder and self-prunes in practice). Not worth a cleanup pass.
- One fewer persisted store to schema-version and keep in sync with the
  tree/session model. Net removal of code and a class of timing bugs.
- Risk: this leans entirely on VS Code continuing to persist+replay
  custom-editor tabs per folder across folder swaps. If a future VS Code
  release regresses that, terminal placement (not existence) would reset
  on switch. Acceptable: existence is still tmux-backed, and the failure
  mode is cosmetic (tabs reopen in default placement), recoverable by
  re-introducing a placement-only store.

## Refines

- ADR-0011. Supersedes §8 (the `TabSnapshotStore` mechanism) wholesale.
  Decision 5 (native restore on reload) stands and is extended to cover
  `SwitchOperation`. All other decisions unchanged.
- ADR-0008. The Terminal model is untouched.

## Validation

- A/B in the Extension Development Host with `restore()` disabled: switch
  away-and-back restored all of existence, column/split, order, pinned,
  active, and live shells. Plain reload likewise. `exit`-then-reload did
  **not** resurrect the closed tab.

## Status

Accepted.
