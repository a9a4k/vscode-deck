# ADR-0059: Codex observation requires an unshared server

## Context

Codex 0.156 introduced a shared background `app-server` daemon. A plain `codex`
TUI can attach to that daemon, which then runs hooks for every attached session.
Those hooks inherit the daemon's environment, including the `DECK_SESSION` from
the first Deck Terminal that started it. Their payload has a Codex session id and
working directory, but no Terminal identity.

Deck therefore cannot safely map a shared-server hook to a Terminal. Accepting
the inherited `DECK_SESSION` puts status, notifications, and the AgentSession
sidecar on the wrong Terminal. That can later resume the wrong Codex session.
ADR-0025 requires uncertain observation to fail open rather than guess.

Codex's `--no-daemon` option keeps the app-server in the TUI process. Hooks then
remain descendants of the Codex process in the Terminal and retain that
Terminal's `DECK_SESSION`.

## Decision

1. Deck observes Codex only when it runs with `--no-daemon`. The built-in Codex
   resume template is `codex --no-daemon resume {id}`. User templates and
   TerminalLaunchers remain opaque user configuration and are never rewritten.

2. The hook resolves its agent process from `$PPID`, walking through at most four
   `sh`, `bash`, `zsh`, `fish`, or `dash` parents. This handles login shells that
   stay alive because they install an exit trap. The resolved process supplies
   the sidecar's pid and start time for both Claude Code and Codex.

3. If a resolved Codex process command line contains `codex … app-server`, the
   hook writes no AgentStatus or AgentSession sidecar and does not rename a
   Terminal. An app-server never speaks for a Terminal, whether it is Codex's
   managed daemon, the desktop app's server, or a manually started server.

4. TerminalPoll identifies Codex from each Terminal's window name and foreground
   command line. A `codex` window is native Codex; a `node` window is Codex only
   when its program is the npm launcher's `codex.js`. The command line is read
   only when the window name changes. A whole `--no-daemon` argument after the
   Codex program marks the process unshared. When the argument is absent, Deck
   probes `$CODEX_HOME/app-server-control/app-server-control.sock` after 1, 4,
   and 10 seconds. It connects rather than checking the socket file, so only a
   live shared server is evidence.

5. A Terminal whose Codex lacks `--no-daemon` while the shared server is live
   shows a warning banner in its own tab. The banner reserves space above the
   Terminal, disappears when that Codex exits, and offers Learn More, dismissal
   for the current Codex run, and Don't Show Again. The last action disables the
   global `deck.warnCodexWithoutNoDaemon` setting. The same identity gives an
   npm-installed Codex the Codex label and icon instead of Node's.

6. Agent liveness treats a recorded Codex app-server pid as dead even when its
   pid and start time match. The existing AgentExitSweep then remains the sole
   remover of the misattributed sidecar and status, preserving ADR-0033's
   ownership and server-lifetime gate.

7. Launcher setting descriptions and the README make `--no-daemon` and its
   tradeoff visible. Shared-server features such as `codex agents`, `codex
   queue`, and remote control are unavailable for unshared sessions.

## Considered options

- Correlate `cwd` or Codex session ids back to a Terminal — rejected. Several
  Terminals can share a Worktree and the hook carries no Terminal identity.
- Rewrite launchers, add a PATH shim, or change Codex's global config — rejected.
  Those hide the operational choice and mutate user or repository-owned config.
- Raise a toast from a hook-written machine-global marker — rejected. The hook
  cannot name the affected Terminal, fires for Codex outside Deck, and may not
  run at all on a shared server.

## Consequences

- Unshared Codex sessions keep correct status, notifications, and reboot resume.
- Shared Codex sessions deliberately have no Deck status or resume sidecar and
  show an actionable warning only in their own Terminal tabs.
- Existing wrong sidecars and statuses are removed by the next exit sweep.
- Codex versions that predate `--no-daemon` show their own resume error and leave
  the user at the pane's shell; Deck does not probe versions or rewrite config.
- Claude Code behavior is unchanged except that stayed login shells now resolve
  to the real Claude process.

## Refines

- **ADR-0025.** Codex now has AgentStatus parity only in unshared mode; shared
  hooks fail open.
- **ADR-0033.** The sweep stays the sole sidecar remover.
- **ADR-0037.** The recorded process identity is the resolved agent, not a
  stayed hook shell.

## Status

Accepted by PRD #229; decisions 1–3, 6, and 7 originated in PRD #228.
