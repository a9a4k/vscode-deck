# ADR-0040: Agent status notifications identify the agent by its tree labels, resolved live at the Worktree level

## Context

The AgentStatusNotification (`agentStatusNotifier`) carried one bit of
information — the state. It showed `Agent needs input` / `Agent completed` plus
an `Open Terminal` button, with VS Code auto-appending `Source: Deck`. With N
agents running across N Worktrees that is unactionable: you still have to go
hunting for which one.

The notifier holds only the `sessionName` and the AgentStatus, which already
carries `agent` (`claude`/`codex`) and, for `needsInput`, an optional `message`
(the agent's own ask, e.g. *"Claude needs your permission to use Bash"*; ADR-0025).
What it does **not** have is the Repository and branch — and the Worktree path is
**not recoverable from the `sessionName`**, because `tmuxSafe` maps `/`, `.`, `:`
all to `_` one-way (`tmuxSafe.ts`). That is why the tree matches a session to a
Worktree by **prefix** against the live worktree list rather than decoding.

VS Code's toast API (`showWarningMessage(message, ...buttons)`) gives one message
string plus buttons — no title/body split, no markdown. In the **collapsed**
(default) toast the message is a single line clipped with `text-overflow: ellipsis`
(`notificationsList.css`); only the **expanded** notification wraps to show the
full text.

## Decision

The toast names the agent by the **exact labels the user already reads in the
tree**, identity-first, in one line:

```
<Repository>/<Worktree branch> · <AgentTitle> · <detail>
e.g.  vscode-deck/main · fix-dlq-requeue-uploads-deadline · Claude needs your permission to use Bash
```

1. **AgentTitle** is resolved through ADR-0039's `resolveTerminalLabel(windowName,
   paneTitle)`; `paneTitle` comes from the TerminalModel when it already knows
   the session, or from a **single-session, ungated** tmux read keyed by the
   `sessionName` on a model miss. It falls back to the agent identity name when
   the agent has no title yet.

2. **detail** is the agent's hook `message` when present — shown **alongside** the
   AgentTitle, not in place of it — else a synthesized `needs input` / `finished`.
   The **agent name** comes from `AgentStatus.agent` (already in hand), never a
   lookup.

3. **Repository + branch** are resolved by a **narrow Worktree-level resolve**
   (`describeSession`): match the `sessionName` prefix against the registered
   Repositories' reconciled Worktree lists and stop at the matched Worktree,
   reading its `branch` and Repository. It **does not descend into the terminal
   list**, so a Terminal created while the window is unfocused can still be
   described before the TerminalPoll observes it.

4. **On a resolve miss** (transient git-list failure, or a Worktree hidden by the
   optimistic-removal filter), fall back **per field**: drop the
   `<Repository>/<branch> ·` prefix but keep the agent + detail — `Claude needs
   your input` beats the generic `Agent needs input`.

5. **No terminal-`#` disambiguator**, and **both NeedsInput and Completed notify
   by default.**

## Considered Options

- **Reuse `findTerminalBySessionName`** (the resolver already wired into the
  `Open Terminal` action). Rejected: it `await ensureSnapshotRestored()` and lists
  tmux sessions to confirm the **exact** Terminal exists (`repositoryTree.ts`),
  which would let an in-progress — or wedged (ADR-0030) — restore stall or swallow
  the *urgent* `needsInput` toast. Identity lives at the Worktree level; confirming
  the Terminal exists is unnecessary for a label, and the status already proves it
  is real. The narrow resolve never touches the gate, so it needs no timeout guard.

- **Cache Repository/branch in the sidecar at Terminal creation**, so the notifier
  reads identity directly. Rejected: a Terminal's Worktree and Repository are
  immutable (cacheable), but its **branch is live** — `ExternalGitWatch` (ADR-0020)
  exists precisely because a Worktree's checked-out branch changes out-of-Deck, and
  Terminals outlive reboots/`kill-server` (ADR-0019), so a creation-time branch
  would show the wrong one after any checkout. The notifier also reads the status
  store, not the sidecar, and ADR-0031 scopes the sidecar to **resume identity** —
  so this is net *more* plumbing for a *staler* result. Peer survey (`~/code`):
  tools that cache branch at creation (agent-deck, tuicommander) deliberately
  **never display it**; every tool that shows it (cctop, superset, herdr, cmux)
  reads it **live**.

- **Show a terminal `#` to disambiguate co-located agents.** Rejected: the `#`
  (`term-N`) is parsed from the internal `sessionName` and shown **nowhere** in the
  UI — the tree labels Terminals by agent name / AgentTitle, never a number — so the
  toast would be the only user-facing place it exists. Computing "two agents in this
  Worktree" needs the terminal list, back behind the restore gate we just escaped.
  And `Open Terminal` routes by `sessionName` regardless, so the pre-click ambiguity
  is harmless and identical to the tree's. AgentTitle (ADR-0039) is the real
  disambiguator: two `claude` agents in one Worktree now show distinct task summaries.

## Consequences

- The notifier gains a dependency on ADR-0039's `resolveTerminalLabel`. The
  TerminalModel is the normal path; a model miss performs one small, ungated
  single-session pane-title tmux read. Repository and branch stay available via
  the narrow `describeSession` even while the focus-gated poll is paused.
- In the collapsed toast the line ellipsises at the toast's pixel width (no
  character budget). Identity-first ordering keeps *which agent / where* in the
  always-visible prefix; the verbatim ask is the tail that clips, recoverable by
  expanding the notification, and the button reaches it regardless.
- The agent-name-duplication edge (AgentTitle falls back to the agent name **and**
  the hook message already names the agent → `claude · Claude needs…`) is left
  **unhandled**: a permission prompt fires mid-task, by which point the TUI has set
  a real title, so the overlap is effectively unreachable.

## Status

Accepted.
