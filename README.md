<p align="center">
  <img src="https://raw.githubusercontent.com/a9a4k/vscode-deck/main/icon.png" width="128" alt="Deck icon">
</p>

<h1 align="center">Deck</h1>

<p align="center">
  <b>Run coding agents across multiple repos and worktrees</b>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=a9a4k.deck"><img src="https://img.shields.io/visual-studio-marketplace/v/a9a4k.deck?label=Marketplace" alt="Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=a9a4k.deck"><img src="https://img.shields.io/visual-studio-marketplace/i/a9a4k.deck?label=Installs" alt="Installs"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=a9a4k.deck"><img src="https://img.shields.io/visual-studio-marketplace/r/a9a4k.deck?label=Rating" alt="Rating"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<!-- HERO GIF — capture and save to docs/images/hero.gif. Suggested shot: the Deck
     tree in the secondary sidebar with two worktrees, Claude Code in one and Codex
     in the other; one row shows "working" while the other flips to "needs input"
     and raises a notification. ~15-20s, looped. -->

![Deck in action](https://raw.githubusercontent.com/a9a4k/vscode-deck/main/docs/images/hero.gif)

**▶ [Watch the full demo](https://youtu.be/nJ4AQmnY2Oo)**

> **Install:** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=a9a4k.deck), or open the Extensions sidebar (`Cmd/Ctrl+Shift+X`), search **Deck**, click Install. Then open **Deck** from the secondary sidebar.

Deck adds a **Repositories & Worktrees** tree to VS Code's secondary sidebar and gives every worktree its own **persistent terminals**. Run your **coding agents** in them across as many worktrees as you like — the terminals keep your agents alive through window reloads and reboots, and Deck shows each agent's status and notifies the moment one needs you.

Deck closes two gaps VS Code has — working across **multiple repos and worktrees**, and **terminals that persist** instead of dying on every reload.

## Features

### See every repo and worktree in one tree

A unified **Repositories & Worktrees** tree lives in the secondary sidebar — register your repo and every worktree will show up automatically. Click a worktree to open it in this window, or open it in a new window to work on several at the same time.

<!-- SCREENSHOT — the Repositories & Worktrees tree with a few repos expanded.
     Save to docs/images/tree.png -->
![Repositories & Worktrees tree](https://raw.githubusercontent.com/a9a4k/vscode-deck/main/docs/images/tree.png)

### Persistent per-worktree terminals

Each worktree gets its own terminals, opened as **editor tabs** (not in the bottom panel) so you can `Ctrl+Tab`, `Ctrl+@`, `Ctrl+Shift+T` them like any other tab. A terminal is durable like a file - a dedicated tmux server keeps them alive in the background.

- **Close the tab** — the terminal keeps running; reopen its row anytime.
- **Open it in two windows at once** — both are live views of the same terminal; type in one and it shows in the other.
- **Switch worktree or reload the window** — terminals reattach with whatever's running *still running*, untouched.
- **Reboot, crash, or `kill-server`** — terminals come back at their working directory with scrollback, and your **coding agent sessions resume automatically**.

<!-- GIF — close a terminal tab / reload the window, reopen, scrollback intact.
     Save to docs/images/terminals.gif -->
![Persistent terminals](https://raw.githubusercontent.com/a9a4k/vscode-deck/main/docs/images/terminals.gif)

### Agent status in the tree

Run a **coding agent** in a worktree's terminal and Deck reads its status straight from the agent — **working**, **needs input**, **done**, or **failed** — and shows it on the tree row, **labeled with what that agent is working on** (pulled from the agent's own task summary) so a dozen concurrent agents stay distinguishable at a glance. Run several at once and only step in when one actually needs you: optional notifications fire when an agent asks a question or finishes a turn, and stay quiet while you're already looking at that terminal's tab. Deck only *observes* — you start and drive the agents; it gives them a durable home and a status light. (The agent status and notification are shown in the demo at the top.)

### Hand your agent an image

Two gestures, both landing in the terminal you're already looking at:

- **Paste** — copy a screenshot and press **Cmd+V** in a terminal running an agent. The agent attaches it. Deck forwards the keystroke and never touches the image; your agent reads the clipboard itself.
- **Drag and drop** — drag an image file onto a terminal's **tab** from Finder (or any app outside VS Code). Deck saves a copy outside your worktrees and hands the agent that file's path, so nothing lands in your repo.

Deck takes no view on formats or file sizes — whether an agent ingests a given image is the agent's business. Drop **anything that isn't an image** and VS Code opens it in an editor tab exactly as before; a copy of a source file would not *be* that file, so Deck leaves those alone.

**Some drags need Shift held.** VS Code keeps extension views out of a drag unless you hold **Shift**, which affects two sources: dragging from VS Code's **own Explorer**, and dragging the **floating thumbnail** macOS shows just after a screenshot. Hold Shift for the thumbnail and it attaches normally; without it the image opens in an editor tab. (Explorer drags need Shift *and* don't attach yet.) Dragging a saved file from Finder needs nothing special.

Paste is verified on macOS; on Linux and Windows the browser's own Ctrl+V may compete with it.

### One-click terminal launchers

Save a command as a launcher — your agent with its usual flags, or a project bootstrap — and start a terminal running it in one click. Define launchers **per user** (global), **shared with your team** (committed to `<worktree>/.deck/launchers.json`), or **personal to one repo**. Flip **run on worktree create** and Deck fires them automatically when you add a worktree through it, so a fresh worktree can bootstrap itself and kick off an agent without you typing a thing.

**Configuring launchers.** Each launcher is `{ "command": …, "label"?: …, "runOnWorktreeCreate"?: true }` — only `command` is required (`label` defaults to it; sequence commands with `&&`). The launch button on a worktree row opens a Quick Pick listing of all three sources, in this order:

**1. Shared, per repo** — committed to the repo at `<worktree>/.deck/launchers.json` (a bare array):

```jsonc
[
  { "label": "Bootstrap", "command": "pnpm install", "runOnWorktreeCreate": true },
  { "label": "Dev server", "command": "pnpm dev" }
]
```

**2. Personal, per repo** — in your user `settings.json`, keyed by any path inside the repo (matched by git common dir, so it applies to every worktree):

```jsonc
"deck.repositoryLaunchers": [
  {
    "repository": "~/code/myapp",
    "launchers": [
      { "label": "Claude", "command": "claude --dangerously-skip-permissions", "runOnWorktreeCreate": true },
      { "label": "Open PR", "command": "gh pr view --web && exit" }
    ]
  }
]
```

**3. All repos** — in your user `settings.json`:

```jsonc
"deck.terminalLaunchers": [
  { "label": "Claude", "command": "claude --dangerously-skip-permissions" },
  { "label": "Codex", "command": "codex --dangerously-bypass-approvals-and-sandbox" }
]
```

A launcher with `"runOnWorktreeCreate": true` runs when you create a worktree through Deck — only for Deck-created worktrees, not ones it discovers from the CLI.

## Getting started

1. Install Deck and open it from the **secondary sidebar**.
2. **Add Repository** → pick a folder that contains git worktrees.
3. Click a worktree to switch the active folder to it.
4. Click **+** on a worktree to open a terminal; start your agent in it.

## Requirements

- **VS Code 1.110+**
- **tmux ≥ 3.1** on your `PATH` — required for the persistent terminals only. Deck drives an isolated tmux server of its own (separate from your personal tmux) entirely for you; you never run a tmux command. Without tmux, worktree switching still works and the terminal UI is hidden.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `deck.confirmTerminalDelete` | `true` | Ask for confirmation before deleting a terminal. |
| `deck.notifyOnNeedsInput` | `true` | Notify when an agent needs input (suppressed while you're viewing that terminal). |
| `deck.notifyOnCompleted` | `true` | Notify when an agent completes a turn (suppressed while you're viewing that terminal). |
| `deck.agentResumeTemplates.claude` | — | Claude Code command template Deck uses to resume a session. Include `{id}` for the session id. |
| `deck.agentResumeTemplates.codex` | — | Codex command template Deck uses to resume a session. Include `{id}` for the session id. |
| `deck.tmux.automaticRenameFormat` | — | tmux automatic-rename format for Deck terminals. |
| `deck.terminalLaunchers` | `[]` | Launchers available in every repo — see [terminal launchers](#one-click-terminal-launchers). |
| `deck.repositoryLaunchers` | `[]` | Per-repo launchers kept in user settings — see [terminal launchers](#one-click-terminal-launchers). |

## FAQ

**Is it free / open source?** Yes — MIT licensed. Source: [github.com/a9a4k/vscode-deck](https://github.com/a9a4k/vscode-deck).

**Which agents work with Deck?** The terminals run any command or agent. Status, notifications, and session resume currently support **Claude Code and Codex only** — wired up via hooks Deck installs in each agent's config. Using a different agent? [Open an issue](https://github.com/a9a4k/vscode-deck/issues) and we'll look at adding support.

**Do I have to use AI agents?** No. The worktree tree and persistent terminals are useful on their own; agent status is just a bonus when you do run agents in them.

**Does switching worktrees reload the window?** Yes, briefly (~1–3s) — but nothing is lost. Your terminals and the agents in them live outside VS Code on tmux, and VS Code restores that worktree's own tabs, unsaved edits, and layout automatically.

**Does it send telemetry?** No.

**Where does agent status get stored?** In disposable files under `~/.local/share/deck/status/` (with read markers in the sibling `status-reads/`). Delete both directories to fully reset agent status; Deck prunes orphan markers on the next reload.

## Contributing

```sh
git clone https://github.com/a9a4k/vscode-deck
cd vscode-deck
npm install
npm run build
# Press F5 in VS Code (uses .vscode/launch.json) to launch a dev host.
```

More for contributors:

- [AGENTS.md](./AGENTS.md) — agent / contributor working principles
- [CONTEXT.md](./CONTEXT.md) — domain glossary and component map
- [docs/references.md](./docs/references.md) — reference repos under `references/`
- [docs/adr/](./docs/adr/) — architectural decisions

## License

[MIT](./LICENSE)
