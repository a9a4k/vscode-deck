# Reference projects

Reference repos live as **siblings** in `~/code/`. Local paths are tracked in `.agents/local-repos.json` (gitignored); the committed template is `.agents/local-repos.example.json`. File pointers below use the repo keys from that map, for example
`tabstronaut:src/extension.ts`.

## Index

| Reference | Role |
|---|---|
| **vscode-git-worktree-switcher** | The no-reload switching mechanic. `updateWorkspaceFolders` instead of `openFolder`. |
| **git-worktree-manager** | Feature-rich worktree tree view (21.5k installs). Reference for tree UX, context menu, command surface. |
| **vscode-project-manager** | 7.28M installs. Reference for multi-repo discovery and the "list of projects" UX in the Activity Bar. |
| **tabstronaut** | Manual tab snapshot/restore extension. Reference for the per-tab serialization we automate per-worktree. |
| **superset** | Electron + own pty-daemon. The over-architected predecessor; reference for PTY/terminal-runtime patterns that vscode-deck's per-worktree terminals will need to handle. |
| **vscode** | microsoft/vscode source. Reference for VS Code API internals — verifying contribution-point gates (e.g. `secondarySidebar`), built-in command names, and how VS Code itself implements tree views, view containers, and walkthroughs. |
| **sanctel** | Tauri + tmux Arc-shaped workspace. Reference for per-worktree PTY/tmux persistence patterns and multi-context workspace UX (profiles / spaces / tabs / agent flows). |
| **iterm2** | The canonical tmux control-mode (`-C`) client. Reference for the protocol handling behind ADR-0012: reply correlation, %output decoding, history seeding, flow control. |
| **tmux** | The server side of ADR-0012's transport. Ground truth for what the control-mode protocol actually emits and accepts — read this instead of guessing from client behavior. |
| **tmux-resurrect** | The save/restore engine vendored for ADR-0019. Ground truth for what `save.sh`/`restore.sh` actually do — the `cat <file>; exec <shell>` content-restore mechanism, the `@resurrect-processes` / `@resurrect-capture-pane-contents` knobs — read this instead of guessing from plugin docs. |
| **orca** | Electron worktree + agent-terminal manager. The only reference that handles Codex's shared app-server daemon (launches `codex --no-daemon`, detects panes that joined the daemon). Also screen-scrape status predicates for Codex. |
| **codex** | openai/codex source. Ground truth for Codex hooks (payload schema, how/where hooks are spawned), the shared app-server daemon, and `resume`. |
| **opencode** | anomalyco/opencode source. Ground truth for OpenCode's process model (each TUI runs its own in-process server; sharing only via opt-in `opencode serve` + `attach`), plugin events, and session storage. |
| **xterm.js** | The terminal emulator behind Deck's Terminal editor. Ground truth for parser, addon, and rendering behavior. |
| **agntree** | VS Code extension: Claude Code session + worktree manager. Closest peer in the same host. |
| **worktrunk** | Worktree CLI. Reference for worktree lifecycle UX (create / switch / remove / merge). |
| **claude-squad** | tmux + worktrees per agent. Reference for content-diff ("is the pane changing") status. |
| **dmux** | tmux + worktrees, parallel agents. Per-worktree Codex hooks that drop events whose pane id doesn't match. |
| **cctop** | macOS menubar agent monitor. Keys session state by hook payload `session_id`, not env; reads Codex state sqlite / rollouts. |
| **cmux** | Ghostty-based terminal with agent notifications. Hook install + `session_id` store (env still wins for routing). |
| **herdr** | Agent pane manager. Hooks plus screen-content detection fallback for Codex. |
| **agent-deck** | tmux agent command center. Codex via config.toml `notify`, capture-pane live status, rollout/state reading. |
| **amux** | Agent control plane. No hooks: capture-pane scrape, `codex exec --json`, rollout ledger. |
| **tuicommander** | Agent IDE. PTY-output spinner parsing; rollout-filename session binding. |
| **tmux-agent-sidebar** | tmux sidebar tracking Claude/Codex/OpenCode panes. `TMUX_PANE`-routed hooks + process inspection. |
| **tmux-agent-status** | tmux agent status sidebar. Hooks + legacy `notify` + `pgrep` process-tree polling. |
| **tmux-assistant-resurrect** | Resumes agent sessions after tmux-resurrect restore. Finds session ids by process + cwd + start time (Codex `state_*.sqlite`, rollouts). |

## By subsystem

When you hit a problem, jump to the listed file rather than reading the whole repo.

### No-reload worktree switching

| File | What it teaches |
|---|---|
| `vscode-git-worktree-switcher:src/extension.ts` | The pattern that avoids window reload. |

### Tree view (multi-project + worktrees in one view)

| File | What it teaches |
|---|---|
| `git-worktree-manager:src/views/` | `TreeDataProvider` with project/work
tree hierarchy. |
| `vscode-project-manager:src/extension.ts` | Project list discovery, settings storage, quickpick switcher. |

### Tab snapshot mechanic

| File | What it teaches |
|---|---|
| `tabstronaut:src/` | `vscode.window.tabGroups` capture + `openTextDocument` + `showTextDocument` restore. The exact APIs we use. |

### VS Code API behavior & contribution points

| File | What it teaches |
|---|---|
| `vscode:src/vs/workbench/api/common/extHostApiCommands.ts` | Built-in command names extensions can invoke (e.g. `workbench.action.toggleAuxiliaryBar`). |
| `vscode:src/vs/workbench/api/common/configurationExtensionPoint.ts` | How contribution-point gates work; useful when verifying when a contribution became stable. |

### PTY / per-worktree terminal persistence

| File | What it teaches |
|---|---|
| `sanctel:src-tauri/src/` | tmux-backed PTY persistence wired to a workspace shell. Lighter-weight alternative to `superset`'s pty-daemon. |
| `sanctel:src/` | Profiles / spaces / tabs UX over a workspace surface — adjacent UX for multi-worktree agent flows. |

### Reboot-surviving terminals (ADR-0019)

| File | What it teaches |
|---|---|
| `sanctel:src-tauri/src/restore_runtime.rs` | The `anchor → restore.sh → kill-anchor` launch sequence, periodic-save timer (`start_periodic_save(300)`), and save-on-exit — the working implementation ADR-0019 mirrors. |
| `sanctel:docs/design/spikes/restore-feasibility.md` | Why continuum is dropped (the `another_tmux_server_running` short-circuit) and resurrect's `save.sh`/`restore.sh` are driven directly; measured save/restore timings. |
| `sanctel:app-bundle/sanctel.tmux.conf` | The templated-conf shape (`__…__` placeholders) and resurrect knobs Deck adapts for `globalStorage/deck.conf`. |
| `tmux-resurrect:scripts/save.sh` | What a save touches — `list-panes`/`list-windows` metadata plus one `capture-pane -epJ` per pane (why a save never freezes panes). |
| `tmux-resurrect:scripts/restore.sh` | Content restore via `cat <file>; exec <default-command>` (line ~123) — the sequential pipeline that composes cleanly with ADR-0012 §5's seed. |
| `tmux-resurrect:resurrect.tmux` | The `run-shell` entry point and the `@resurrect-*-script-path` options Deck deliberately bypasses (it calls the scripts with the current path). |
| `tmux-resurrect:docs/restoring_programs.md` | `@resurrect-processes 'false'` = restore no programs (Deck's "shells only"). |

### tmux control mode (ADR-0012 transport)

| File | What it teaches |
|---|---|
| `iterm2:sources/tmux/TmuxGateway.m` | Control-mode protocol parsing: %begin/%end/%error correlation, %output octal decoding, notification dispatch, %pause/%continue flow control. The battle-tested counterpart to `TmuxControlClient`. |
| `iterm2:sources/tmux/TmuxController.m` | Session/window lifecycle over the gateway: attach/detach, resize strategy (`window-size` handling), command batching. |
| `iterm2:sources/tmux/TmuxHistoryParser.m` | Seeding scrollback from tmux history into the terminal buffer — iTerm2's equivalent of our capture-pane seed. |
| `tmux:control.c` | What the server writes to a `-C` client: %output octal escaping (`control_write_output`), %begin/%end/%error block emission, pause-mode offsets. |
| `tmux:control-notify.c` | Every `%`-notification the server can emit (%window-add, %session-changed, …) — the complete list our parser must tolerate. |
| `tmux:cmd-send-keys.c` | The `-H` literal-byte path our `sendKeys` rides (`args_has 'H'` → `KEYC_LITERAL`). |
| `tmux:cmd-capture-pane.c` | Exact semantics of the seed flags `-p -e -q -J -N -S`. |
| `tmux:cmd-parse.y` | The command grammar whose yacc stack depth caps send-keys at <16384 args (why we chunk at 4096). |

### Agent status, hooks & session resume

| File | What it teaches |
|---|---|
| `codex:codex-rs/hooks/src/schema.rs` | Codex hook payloads (`session_id`, `transcript_path`, `cwd`, …). No terminal identity is passed. |
| `codex:codex-rs/hooks/src/engine/command_runner.rs` | Hooks inherit the env of the process running the hook engine — the shared daemon when one is in use. |
| `codex:codex-rs/tui/src/startup_orchestration.rs` | When the TUI joins the shared daemon; `--no-daemon` and `[features] daemon_auto_start` (auto-start only — a live daemon is still reused). |
| `codex:codex-rs/tui/src/daemon_startup.rs` | Every launch condition that excludes the daemon. |
| `orca:src/shared/codex-shell-function.ts` | Shell function that adds `--no-daemon` when `codex --help` supports it. |
| `orca:src/main/codex/codex-shared-server-pane.ts` | Detecting a pane whose Codex joined the shared server; fix dialog in `codex-shared-server-fix.ts`. |
| `orca:src/main/runtime/agent-state-rules/codex-screen-predicates.ts` | Codex busy/ready detection from the rendered TUI. |
| `cctop:menubar/CctopMenubar/Hook/HookHandler.swift` | Session records keyed by payload `session_id`. |
| `superset:packages/agent-setup/templates/codex-wrapper-exec.template.sh` | Per-terminal `CODEX_TUI_SESSION_LOG_PATH` tailing as a hook-independent signal. |
| `opencode:packages/opencode/src/cli/cmd/tui.ts` | The TUI starts its own server as a Worker with a copy of its env (~line 210) — no shared server by default. |
| `opencode:packages/opencode/src/plugin/index.ts` | Where server plugins run and the `event` hook payload (`sessionID`, directory-filtered). |
| `herdr:src/integration/assets/opencode/herdr-tui-session.js` | Pane-local TUI plugin filtered to the TUI's selected session — survives a shared `opencode serve`. |
| `orca:src/shared/agent-hook-listener/opencode-session-correlation.ts` | Heuristic session→pane binding (directory + client process lifetime) for a shared OpenCode server; TUI-side variant in `src/main/opencode/status-plugin-legacy-tui-source.ts`. |
| `tmux-assistant-resurrect:scripts/save-assistant-sessions.sh` | Finding an agent's session id from process + cwd + start time. |

## Cloning fresh

These are not vendored. Clone as siblings of `vscode-deck/`:

```sh
cd ~/code
git clone --depth 1 https://github.com/tmokmss/vscode-git-worktree-switcher
git clone --depth 1 https://github.com/jackiotyu/git-worktree-manager
git clone --depth 1 https://github.com/alefragnani/vscode-project-manager
git clone --depth 1 https://github.com/jhhtaylor/Tabstronaut tabstronaut
git clone --depth 1 git@github.com:superset-sh/superset.git
git clone --depth 1 https://github.com/microsoft/vscode
git clone --depth 1 git@github.com:sanctel/sanctel.git
git clone --depth 1 https://github.com/gnachman/iTerm2 iterm2
git clone --depth 1 https://github.com/tmux/tmux
git clone --depth 1 https://github.com/tmux-plugins/tmux-resurrect
git clone --depth 1 https://github.com/stablyai/orca
git clone --depth 1 https://github.com/openai/codex
git clone --depth 1 https://github.com/anomalyco/opencode
git clone --depth 1 https://github.com/xtermjs/xterm.js
git clone --depth 1 https://github.com/subhashkhileri/agntree
git clone --depth 1 https://github.com/max-sixty/worktrunk
git clone --depth 1 https://github.com/smtg-ai/claude-squad
git clone --depth 1 https://github.com/formkit/dmux
git clone --depth 1 https://github.com/st0012/cctop
git clone --depth 1 https://github.com/manaflow-ai/cmux
git clone --depth 1 https://github.com/ogulcancelik/herdr
git clone --depth 1 https://github.com/asheshgoplani/agent-deck
git clone --depth 1 https://github.com/mixpeek/amux
git clone --depth 1 https://github.com/sstraus/tuicommander
git clone --depth 1 https://github.com/hiroppy/tmux-agent-sidebar
git clone --depth 1 https://github.com/samleeney/tmux-agent-status
git clone --depth 1 https://github.com/timvw/tmux-assistant-resurrect
```
