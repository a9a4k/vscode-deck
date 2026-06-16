# Terminal Launchers via a Quick Pick, not per-launcher inline buttons

TerminalLaunchers (user-defined commands that open a Terminal and run in it) are
surfaced as **one static `$(play)` button per Worktree row that opens a Quick
Pick**, merging a per-repo committed file (`<worktree>/.deck/launchers.json`,
shown first) with the global `deck.terminalLaunchers` setting. We chose this
because the requirement is **per-repo launchers**, and VS Code's menu model makes
per-repo *buttons* impossible: menu contributions are static in `package.json`, a
command's icon is a single fixed path (can't vary per tree row), and
`launcherCount`-style gating uses `setContext`, which is window-global, not
per-row. A Quick Pick built at click time sidesteps all of this — its contents are
computed for the clicked node, so launchers can differ per repo, be unlimited in
count, and carry free labels.

## Considered options

- **Lettered inline buttons (one per launcher), painted via regenerated
  `slot-N.svg` files gated by a `deck.launcherCount` context key.** Prototyped and
  working *for the global case* (see `docs/handoffs/custom-terminal-launchers*.md`).
  Rejected: structurally cannot be per-repo — the icon path and the count context
  key are both window-global, so every Worktree row renders the *same* buttons
  regardless of which repo it belongs to.
- **Per-repo config via `.vscode/settings.json` (resource scope).** Rejected: only
  resolves for the *currently open* folder, so foreign-worktree rows (the common
  case in Deck) would see no launchers.

## Consequences

- Launching is two clicks (button → pick), and there are no always-visible
  per-launcher letters on the row — the trade accepted to get per-repo support.
- `<worktree>/.deck/launchers.json` is committed, so launchers are team-shareable
  via git and overridable per branch; it is read fresh on each click (no watcher).
- A launcher's command is typed into the Terminal exactly as a user would, so a
  launcher running an agent is observed and resumed by the existing AgentSession
  machinery for free — Deck still does not own the agent lifecycle (cf. ADR-0021).
