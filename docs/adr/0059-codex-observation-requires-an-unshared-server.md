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

4. Instead, that hook atomically replaces the machine-global marker
   `~/.local/share/deck/codex-shared-server.json` with
   `{ serverPid, sessionId, cwd, at }`. The marker is beside the AgentStatus
   directory because every JSON file inside that directory represents one
   Terminal's status.

5. Each Deck window watches the marker. It warns once per app-server pid and
   once per new registered Worktree reached by that pid. The Worktree is the
   longest path prefix containing the marker's `cwd`, and is named
   `<Repository>/<branch>`. Events outside registered Worktrees get a generic
   warning. The warning links to launcher settings and the README.

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
- Detect attachment by polling pane process trees or the daemon socket —
  rejected. The hook already supplies decisive evidence at the boundary.

## Consequences

- Unshared Codex sessions keep correct status, notifications, and reboot resume.
- Shared Codex sessions deliberately have no Deck status or resume sidecar and
  produce an actionable, deduplicated warning.
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

Accepted by PRD #228.
