# Handoff back: Custom Terminal Launchers — prototype results

**Reads with:** [`custom-terminal-launchers.md`](./custom-terminal-launchers.md) (the spec this
implemented). This doc reports what happened when Option B was built and run.

**Status:** Option B prototype **built, runs, verified by hand**. Code is **stashed**, not
committed — see *Restoring the prototype* below. Build clean, `npm run test` green
(610 passing, incl. 9 new launcher tests).

## TL;DR

- Option B works: lettered inline buttons appear next to `+` and launch a terminal that runs
  the command. The user confirmed *"they do show up"* and a launch succeeded after one bug fix.
- **Risk #1 (the spike) is effectively resolved for rendering**: buttons render from generated
  `slot-i.svg` files written at activation. *Live repaint on settings edit* (change a letter,
  see it update without reload) was **not explicitly confirmed** — assume unverified.
- One real bug found and fixed (see below).
- **Per-repository launchers do NOT work with this mechanism** — important finding, drives the
  next decision. See *Per-repo finding*.

## What was built

| File | Role |
|---|---|
| `src/launchers/terminalLaunchers.ts` | parse/validate `deck.terminalLaunchers`; default letter = `label[0]`; cap `MAX_LAUNCHER_SLOTS = 5` |
| `src/launchers/launcherSlotSvg.ts` | paint letter+color → 16×16 SVG string |
| `src/launchers/syncLauncherSlots.ts` | rewrite `media/launchers/slot-{0..4}.svg` + `setContext('deck.launcherCount', n)` |
| `src/terminal/launchTerminalCommand.ts` | slot handler: create+open terminal, then type the command |
| `src/terminal/addTerminalCommand.ts` | factored out `createAndOpenTerminal()` (shared by Add Terminal + launchers) |
| `src/terminal/tmuxCli.ts` | added `sendCommandLine()` (literal `send-keys -l`, then `Enter`) |
| `src/extension.ts` | read launchers, sync slots at activation + on config change, register `deck.launcher.0..4` |
| `package.json` | config schema, 5 slot commands (icon → `slot-N.svg`), 5 inline menus `inline@10..14` gated by `launcherCount > N`, hidden palette entries |
| `media/launchers/slot-{0..4}.svg` | committed blank placeholders so the icon path resolves before activation |

Command is sent the same way a user types it, so `DECK_SESSION` + agent-hook/snapshot machinery
observes it for free (a `claude` launcher resumes as today) — this property held up.

## Bug found and fixed

**`send-keys` with the `=`-exact target → "can't find pane: =wt-…__term-7".**
`send-keys -t` resolves its target as a *pane*; the `=name` exact form only works for
session-target commands (`has-session`, `kill-session`). Fix: use the **bare** session name,
matching the existing `windowName`/`terminalSession`/`panePid` methods (which carry a comment
about this exact gotcha). Already applied in the stashed `tmuxCli.ts`.

## Known caveat (not observed, flagged)

The command is sent right after `ensureSession` resolves — *before* the custom editor's control
client attaches. tmux buffers keystrokes into the pane, so it should land, but if you ever see
truncation or the command landing before the prompt is ready, move the send to *after* the
editor attaches instead of after create.

## Per-repo finding (the key decision input)

The user asked for **per-repository launchers**. Option B's surface **cannot** do this:

- The inline button icon is a static path (one shared `slot-i.svg`) — VS Code can't vary a
  menu-contribution icon per tree item.
- `deck.launcherCount` is set via `setContext`, which is **window-global**, not per-row.

So every Worktree row renders the *same* lettered buttons regardless of config. You can gate the
*count* per row by baking it into the node `contextValue`, but the letters/commands on a given
slot index stay shared — not real per-repo.

Config source, if pursued later:
- Resource-scoped setting (`"scope": "resource"`) read with the worktree Uri → only resolves for
  the **currently open** worktree folder (Deck opens one folder per window); other rows fall back
  to global.
- Read each repo's file directly (`<repo>/.vscode/settings.json` or a `.deck/launchers.json`) →
  works for any row, but you own the watch + merge.

**Recommendation:** if per-repo / per-worktree matters, pivot the surface to the deferred
**Option A** — one static `$(play)` button per row → a Quick Pick built *at click time* for that
node. The button is identical per row (allowed), but its menu is computed for the clicked
worktree, so launchers can differ per repo/worktree, unlimited count, free letters/labels. Bonus:
moots Risk #1 (no icon cache) and the MAX=5 cap. Cost: two-click launch, no always-visible
letters. Keep Option B only if launchers are meant to be global.

## Open / deferred (unchanged from spec, plus updates)

- **MAX slot count** — prototype used 5, still unconfirmed.
- **Scope** — global only as built; per-repo needs Option A (above).
- **Live letter repaint on settings edit** — render confirmed, live update unverified.
- **cwd / restore semantics** — untouched; assumptions in the spec still stand.

## Restoring the prototype

The prototype is stashed (this doc and `custom-terminal-launchers.md` are left in the tree):

```
git stash list          # find the "wip: custom terminal launchers prototype" entry
git stash pop           # or: git stash apply stash@{N}
```

After popping: `npm run build && npm run test` to confirm green, then F5 to run.
