# ADR-0025: Agent status via hooks

## Context

ADR-0021 made an **AgentSession** survive reboots by observing Claude Code and
Codex session ids through hooks and rewriting the **TerminalSnapshot** on
restore. ADR-0023 then used the same hook path to name a **Terminal** `claude`
or `codex`, but it deliberately stayed identity-only: a row could say which
agent occupied the Terminal, not whether the agent was working, blocked on a
permission prompt, finished, or failed.

The feature shipped in PRD #90 closes that observability gap for Claude Code
agents. Deck surfaces an **AgentStatus** on Terminal rows, decorates the
closest collapsed ancestor when status is hidden under a collapsed row, and
notifies on NeedsInput transitions. This ADR records the shipped decisions from
issues #91-#95 and the rendering amendment from issue #105.

## Decision

1. **Use hooks-only detection.** AgentStatus is observed from Claude Code hook
   events. Deck does not parse terminal output and does not watch transcripts.
   This is Claude-only v1; Codex keeps ADR-0023 identity-only naming because it
   lacks the hook parity needed for equivalent status.

2. **Adopt the VS Code ChatSessionStatus model with read/unread metadata.** The
   statuses are InProgress, NeedsInput, Completed, and Failed, with absence
   meaning nothing current to report. Read/unread is metadata on Completed, not
   another status. Completed starts unread and becomes read when the Terminal tab
   is focused, matching VS Code's agent-sessions behavior.

3. **Use a separate disposable status file plus read-marker files, not the
   AgentSession resume data.** Status is high-churn and disposable. Each
   AgentStatus is a machine-global file under `~/.local/share/deck/status/`, and
   each completed Terminal read marker is a sibling machine-global file under
   `~/.local/share/deck/status-reads/` containing the read `statusAt`. Both are
   one file per session so VS Code windows and installs converge through
   filesystem watches. The AgentSession sidecar from ADR-0021 remains the
   resume-critical sidecar and is written before status work. Losing status or
   read markers must never prevent a TerminalSnapshot from resuming an
   AgentSession.

4. **Notification settings are simple on/off booleans, default on.**
   `deck.notifyOnNeedsInput` and `deck.notifyOnCompleted` are booleans
   (default `true`). We deliberately do **not** offer VS Code's
   `windowNotFocused` mode: extensions get only in-window toasts, not OS
   toasts, so "notify when the window is unfocused" is a broken promise — the
   in-window toast isn't visible precisely when you're away. A real
   when-away channel returns with the companion app's OS notifications (#102).
   The only suppression kept is tab-active: no toast for the Terminal whose tab
   you're already viewing.

5. **Expose Open Terminal only; no Allow action.** A notification can open and
   reveal the Terminal. It does not try to approve a Claude permission prompt.
   Sending keys into a TUI dialog through tmux is brittle and can approve the
   wrong thing if the dialog changes or focus moves.

6. **Render status with left identity icons and right-side file decorations.**
   The Terminal row's left icon is identity/liveness: a branded **animated GIF**
   (claude / codex) while InProgress, the branded static agent identity icon for
   NeedsInput, Completed, Failed, and idle agent rows, and the plain terminal
   icon when no agent occupies the Terminal. The working icon is a GIF because
   VS Code renders custom tree SVGs black (microsoft/vscode#311339) and an
   animated GIF is the only way to animate a *branded* tree icon.

   **Reduce-motion is not achievable for this icon, and that is accepted.**
   A `loading~spin` codicon was tried (to honor `workbench.reduceMotion`) and
   reverted: the codicon spin keyframe in VS Code's base CSS has **no**
   `@media (prefers-reduced-motion)` guard and **no** `.monaco-reduce-motion`
   rule (only individual components, e.g. voice chat, freeze it via their own
   scoped CSS), so a `loading~spin` ThemeIcon in a tree spins regardless of both
   the OS preference and the `workbench.reduceMotion` setting — verified from
   source and at runtime. An extension cannot make an animated tree icon
   reduce-motion-aware: it cannot inject workbench CSS, there is no API for the
   effective reduced-motion state, and the tree is not a webview (so `matchMedia`
   is unavailable). The only reduce-motion-correct option is *no* animation,
   which is declined here in favor of the branded liveness cue. This **supersedes
   the earlier amendment** that claimed the codicon respected reduce-motion.

   Attention states use a `FileDecorationProvider` on custom
   `deck-status:` resource URIs so VS Code draws a right-side dot and label
   tint: NeedsInput uses `list.warningForeground`, Completed-unread uses
   `textLink.foreground`, and Failed uses `errorForeground`. InProgress,
   Completed-read, and absent status have no right-side decoration. Decoration
   tooltips carry the status and captured message. Inline status descriptions
   such as "Working...", "Input needed.", and "Failed" are superseded.
   The same `FileDecorationProvider` also answers for a Terminal's
   `deck-terminal:` editor-tab URI, so an open tab carries the identical
   attention dot and label tint — read from its own session's status directly
   (no rollup; a tab is always one Terminal). Because decorations are
   URI-keyed by the workbench, the dot shows even on inactive/unresolved tabs.

7. **Roll attention to the closest collapsed ancestor only.** VS Code's native
   decoration propagation is not used for AgentStatus (`propagate: false`).
   Deck tracks Worktree and Repository expand/collapse state and decorates the
   deepest visible row on the path to an attention-state Terminal: the Terminal
   when nothing is collapsed, the Worktree when only it is collapsed, or the
   Repository when the Repository is collapsed. When several attention
   descendants roll to one collapsed row, urgency is NeedsInput, then Failed,
   then Completed-unread. The previous all-ancestor `· N needs input`
   descriptions are superseded.

8. **Do not badge the Deck view container.** The earlier view badge that counted
   NeedsInput Terminals is superseded. Hidden-sidebar attention is covered only
   by transient notifications; a persistent cross-view cue can return later if
   the quiet model proves too quiet.

9. **Reconcile Deck-owned hook entries on activation.** The PRD's earlier
   "upgrade through consent and diff review" path is superseded. Once an agent
   already has Deck hooks, activation compares the config Deck would render for
   this build plus the generated hook script against what is installed. Drift in
   either one triggers the existing backed-up install path, replacing only Deck's
   hook groups and writing the current script in lockstep. The hook command
   string stays stable, so prior consent still applies. Transparency happens
   after the write: Deck shows an informational toast with Review Changes, which
   opens the `.deck.bak` backup against the current config. There is no Revert
   action; uninstalling Deck hooks is the opt-out.

## Considered Options

- **Pattern matching terminal output, a la tuicommander** - rejected. It is
  prompt-text coupling, agent-version coupling, and fails exactly where status is
  most valuable: permission and failure flows that can change copy.
- **Transcript watching** - rejected. It couples Deck to per-agent storage
  internals and still trails the live TUI state.
- **tmux user options as the status transport** - rejected. User options are a
  durable tmux configuration surface, not a disposable high-churn status feed,
  and would blur ADR-0022's curated user-option boundary.
- **Extending the AgentSession sidecar** - rejected. The sidecar is
  resume-critical state. Mixing high-churn status into it increases write risk
  on the restore path and makes cleanup semantics ambiguous.
- **Allow/approve from the notification** - rejected. It would require tmux
  send-keys into Claude's interactive permission UI, which Deck cannot make
  robust.
- **Asking before hook upgrades** - rejected. While consent is pending or
  declined, Deck-owned event lists and scripts can sit mismatched. Reconcile then
  notify keeps Deck's own hook entries internally consistent while preserving the
  backup, Review Changes diff, and uninstall escape hatch.
- **OS banners via terminal-notifier** - implemented (issue #101) and reverted.
  It made notification delivery depend on a user-installed, macOS-only binary:
  Linux and WSL users get nothing while every user gains an install step, and
  the silent-degradation contract proved leaky in review. Native OS
  notifications belong in a future Deck companion app (cctop-style: a single
  process watching the machine-global status dir), which can own delivery,
  click-through, sounds, and cross-window dedup without the extension API's
  limits. The status-file transport is already companion-ready — any process
  can watch it.

## Consequences

- **Codex parity is conditional (superseded by ADR-0059).** Codex now exposes
  equivalent lifecycle hooks, but Deck can attribute them to a Terminal only
  when Codex runs unshared with `--no-daemon`.
- **Status is best-effort observability, not source-of-truth state.** If a status
  record is missing or stale, Deck prefers to show nothing current rather than
  infer from output.
- **Read markers are disposable with status.** Removing
  `~/.local/share/deck/status/` leaves any `status-reads/` markers orphaned, and
  Deck prunes them on reload. A full AgentStatus reset removes both `status/`
  and `status-reads/`.
- **Multi-window notifications can leave a stale toast.** Each VS Code window
  observes transitions independently. A NeedsInput toast in one window can remain
  after the user handles the prompt from another window, but clicking it still
  opens the Terminal, which is safe.
- **The tree keeps stable Terminal ordering.** Status decorates rows and rolls
  up to the closest collapsed ancestor, but it does not sort Terminals.
- **No persistent hidden-view badge.** If the Deck view or secondary sidebar is
  hidden, the extension no longer shows a numeric container badge. NeedsInput
  and optional Completed toasts remain the nudge.
- **AgentSession resume stays isolated.** Status cleanup, pruning, or parse
  failure cannot break ADR-0021's resume sidecar or TerminalSnapshot restore.
- **Setup prompts stay fresh-install only.** Agents with any Deck hook entries
  are reconciled on activation and are not offered through the setup prompt.

## Status

Accepted — shipped by PRD #90 issues #91-#95 and amended by issues #99 and
#105.
