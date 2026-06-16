# Spec: Terminal Launchers — Option A (authoritative, supersedes B)

**Supersedes** the slot/SVG approach in
[`custom-terminal-launchers.md`](./custom-terminal-launchers.md). Read
[`custom-terminal-launchers-results.md`](./custom-terminal-launchers-results.md)
for *why* — Option B (lettered inline buttons) structurally **cannot** do per-repo
launchers (static menu icon path + window-global `setContext`). We pivoted.

Glossary: **TerminalLauncher** is now defined in `CONTEXT.md`.

## What we're building

A user-defined command that opens a new Terminal and runs in it. Surface:

- **One static `$(play)` inline button** on each Worktree row (next to `+`),
  identical across rows — that's all VS Code allows dynamically.
- **Click → Quick Pick** built *at click time* for the clicked node, merging two
  sources:
  - **"This repository"** group (first): `<worktree>/.deck/launchers.json`
  - **"User"** group (second): global setting `deck.terminalLaunchers`
- No dedup / no override — show both, separated. Each item's `description` is the
  command (so the user sees what runs).
- **Empty state:** if both sources are empty, the Quick Pick shows a single
  "No launchers configured — Configure…" item that opens settings.
- Pick → create+open a Terminal for that worktree, then type the command.

Why A wins for the requirement: per-repo + global + unlimited count + free
labels, and it **moots Risk #1** (no icon cache) and the MAX=5 cap. Cost
(accepted): two-click launch, no always-visible letters.

## Decisions locked in this session

- Per-repo config = **committed `<worktree>/.deck/launchers.json`** — present in
  every checkout (so it's per-repo), team-shareable via git, overridable per
  branch, and readable for *foreign* worktree rows (we have the path).
  `.vscode/settings.json` resource-scope was rejected: only resolves for the open
  folder.
- **Read fresh on click** — no file watcher.
- Merge order: **repo group first, then user**, no override.
- Same launcher schema for both sources (`label`, `command`; `letter`/`color`
  dropped — no inline buttons).

## Reuse from the B prototype (stash — see results doc "Restoring")

Carry these over **unchanged**:

- `src/launchers/terminalLaunchers.ts` — parse/validate launchers, `label[0]`
  default. (Drop the `MAX_LAUNCHER_SLOTS=5` cap; A is unlimited. Keep letter/color
  parsing harmless or strip.)
- `src/terminal/addTerminalCommand.ts` — the factored `createAndOpenTerminal()`
  (shared by Add Terminal + launchers).
- `src/terminal/tmuxCli.ts` — `sendCommandLine()` (literal `send-keys -l` + Enter)
  **with the bare-session-name fix** (the `=name` exact target fails for
  `send-keys`; see results doc "Bug found").

**Delete / don't port** the B-only machinery:

- `src/launchers/launcherSlotSvg.ts`, `src/launchers/syncLauncherSlots.ts`
- `media/launchers/slot-*.svg`
- the 5 `deck.launcher.0..4` slot commands, their `inline@10..14` menus, and the
  `deck.launcherCount` context key in `package.json` + `extension.ts`

## New work

| File | Role |
|---|---|
| `src/launchers/repoLaunchers.ts` | read+parse `<worktree>/.deck/launchers.json` (missing/invalid → empty, never throw); reuse the validator from `terminalLaunchers.ts` |
| `src/launchers/resolveLaunchers.ts` | merge → `{ repo: Launcher[], user: Launcher[] }` for a given worktree path |
| `src/terminal/runLauncherCommand.ts` | the `$(play)` handler: resolve launchers for the node, show Quick Pick (separators repo→user, command as description, empty-state item), on pick call `createAndOpenTerminal()` then `sendCommandLine()` |
| `package.json` | one command `deck.runLauncher` (icon `$(play)`); one `view/item/context` inline menu gated `view == deck.repositories && (viewItem == deck.worktree \|\| ...active \|\| ...main) && deck.tmuxAvailable`, group e.g. `inline@5` (decide order vs the `+` at `deck.addTerminal`); hidden palette entry |
| `src/extension.ts` | register `deck.runLauncher` (drop slot registration + slot-sync) |

Keep the global setting `deck.terminalLaunchers` schema from B (it's the "User"
source). Strip `letter`/`color` from its schema if cleaning up.

## Known caveat (carried from B, still applies)

Command is sent right after `ensureSession` resolves — *before* the custom
editor's control client attaches. tmux buffers keystrokes into the pane, so it
should land; if you see truncation or the command landing before the prompt is
ready, move the send to *after* the editor attaches. Validate during manual test.

## Build / verify

- `npm run build`; `npm run test` (port the launcher-parse tests; add tests for
  `repoLaunchers` parse and `resolveLaunchers` merge order).
- Manual: a repo with `.deck/launchers.json` + a couple global launchers → click
  `$(play)` on a worktree row → both groups appear, repo first; pick one → Terminal
  opens and runs the command. Repeat on a **foreign** worktree row (its repo's
  file, not the open one's). Empty repo+empty global → "Configure…" item.

## Still open (don't block)

- Exact inline order of `$(play)` vs `+` on the row (left/right of Add Terminal).
- Scaffold behavior of the "Configure…" empty-state item (open user settings vs
  create a stub `.deck/launchers.json`).
- `cwd` / restore semantics — unchanged from B; one-shot at creation, Terminal
  restores as normal afterward.
