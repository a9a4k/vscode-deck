# Deck Context

A VS Code extension that surfaces multiple git repositories' worktrees in one
secondary sidebar view, switches between them by opening one folder at a time,
and gives each Worktree persistent Terminals. (Per-worktree agent chat sessions
are planned.)

## Language

### Repositories & worktrees

**Repository**:
A git repository registered with Deck, identified by its git common dir (the directory all its worktrees share).
_Avoid_: project (a VS Code user reads the open folder as their "project" — that folder is a Worktree), folder

**Worktree**:
A `git worktree` entry within a Repository, identified by its filesystem path.
_Avoid_: branch (a Worktree has a branch but is not one)

**Discovery seed**:
The path recorded when a Repository is registered — whichever Worktree was checked out then — used to rediscover the repo, not the Repository's identity.
_Avoid_: repository path

### Selection

**ActiveWorktree**:
The Worktree a Repository currently points at — the one reopened when its Repository node is clicked.
_Avoid_: current branch, checked-out worktree

**ActiveRepository**:
The Repository whose ActiveWorktree is the mounted workspace folder.
_Avoid_: current repo, current project

### Operations

**Switch**:
Replacing the mounted folder with a Worktree's and reloading the window.
_Avoid_: navigate, jump
(implemented as **SwitchOperation**)

**DetachedOpen**:
Opening a Worktree in a new window without changing the current one or the ActiveWorktree.
_Avoid_: new tab, fork

**WorktreeRemoval**:
Removing a Worktree from git, with optional, opt-in deletion of its branch.
_Avoid_: delete (ambiguous between Worktree and branch)

**RepositoryRemoval**:
Delisting a Repository from Deck without touching its git repository or files.
_Avoid_: delete repository, uninstall

**TerminalRemoval**:
Destroying a Terminal — killing its tmux session and removing its row. Surfaced as "Delete Terminal" (right-click or `cmd+backspace`). Also happens when the shell `exit`s or when the Terminal's Worktree or Repository is removed. Closing the editor tab does **not** trigger it.
_Avoid_: close (closing a tab is non-destructive), kill

### Ordering

**RepositoryRegistry**:
The user-curated set and order of registered Repositories.
_Avoid_: repository list, config

**WorktreeOrder**:
The user-curated display order of Worktrees within a Repository.
_Avoid_: sort order

**TerminalOrder**:
The user-curated display order of Terminals within a Worktree. An order overlay reconciled against the live tmux list — tmux owns which Terminals exist; this owns only their order. Absent it, Terminals fall back to ascending `term-N` order.
_Avoid_: terminal list (it stores order, not existence — cf. ADR-0014), sort order

### Terminals

**DeckSocket**:
Deck's own isolated tmux server, separate from the user's personal tmux.
_Avoid_: tmux (the user's own tmux is a distinct thing)

**TerminalSnapshot**:
The capture of every Terminal on the DeckSocket — each one's working directory, scrollback, and the AgentSession it was running (if any) — that lets Terminals survive death of the DeckSocket (reboot, crash, `kill-server`). Saved periodically and restored when Deck next starts.
_Avoid_: backup, session dump

**AgentSession**:
The resumable AI-agent conversation (Claude Code or Codex) a Terminal was running, identified by the agent's own session id. Deck only *observes* it — the user starts the agent — and captures it in the TerminalSnapshot so that on restore the Terminal relaunches the agent (`claude --resume` / `codex resume`) instead of returning to a bare shell. Discovered via a Deck hook installed in the agent's config, keyed to the Terminal by an injected `DECK_SESSION` env var.
_Avoid_: agent chat session (implies a separate chat surface; this is an attribute of a Terminal), conversation, thread, agent process

**AgentStatus**:
The observed status of an AgentSession in a Terminal: InProgress, NeedsInput,
Completed with unread metadata, or Failed. Absence means there is nothing current
to report. Deck observes it through agent hooks; it does not own or infer the
agent lifecycle.
_Avoid_: busy, done, agent state, terminal status (the Terminal itself can be healthy while the agent is blocked), process status

**AgentTitle**:
The task summary an agent's TUI publishes for its Terminal (e.g. Claude's
"Reconcile Datadog monitors"), surfaced as the Terminal's row and tab label so
concurrent agents are distinguishable. Deck only observes it — read from the
running agent and cleaned of the agent's leading status glyph — and keeps the
agent *identity* (which drives the icon) as a separate marker, so a stale or
default title never confuses which agent it is. Absent or default title falls
back to the agent identity name.
_Avoid_: window name / tab title (those are the surfaces it is shown on, not the observed summary), terminal name

**AgentStatusNotification**:
The toast Deck raises when a Terminal's AgentStatus changes to NeedsInput or Completed, naming the agent by the labels the user already reads in the tree — Repository, Worktree branch, AgentTitle — followed by the agent's own ask, with an Open Terminal action. Identity leads so the line stays legible when the toast collapses to one ellipsised line.
_Avoid_: alert, popup; "agent needs input"/"agent done" alone (unactionable without identity)

**TerminalLauncher**:
A user-defined command that opens a new Terminal and runs in it. Sourced from two places merged in a Quick Pick behind a Worktree row's launch button: global user settings (`deck.terminalLaunchers`) and a per-repo committed file (`<worktree>/.deck/launchers.json`), repo entries shown first. Deck types the command into a fresh Terminal exactly as the user would, so a launcher that runs an agent is observed and resumed by the existing AgentSession machinery — Deck still does not own the agent lifecycle.
_Avoid_: agent preset (no prompt templates/transports — it is just a command), task (VS Code tasks are a separate system), button (the surface is one row button opening a Quick Pick, not a button per launcher — VS Code cannot render per-row dynamic menu buttons)

**Terminal**:
A persistent shell owned by Deck — one tmux session on the DeckSocket — shown as a row under a Worktree and opened as an xterm.js editor tab addressed by `deck-terminal:/<worktree>/term-N`. Like a file, the Terminal is the durable thing and its tab is just a view onto it: closing the tab leaves the Terminal running, and any Terminal can be opened from any mounted Worktree without a Switch. Its Worktree is fixed when it is created and never changes — a Terminal cannot move to another Worktree or Repository.
_Avoid_: tmux session, tmux window, pane (the backing mechanism); tab (a disposable view, not the Terminal itself)

### External changes

**ExternalGitWatch**:
Watches a Repository's git common dir for changes made **outside** Deck (e.g. a terminal `git checkout`, or `git worktree add/remove` from the CLI) and tells the tree to reconcile. One per Repository, keyed by common dir. Deck's own operations already refresh, so this exists solely to catch out-of-Deck drift.
_Avoid_: file watcher, watcher controller (implementation); polling (it is event-driven, not polled)

## Relationships

- A **Repository** has many **Worktrees**.
- A **Repository** has one **ExternalGitWatch** keyed by its git common dir.
- A **Repository** has one **ActiveWorktree**; the mounted folder has one **ActiveRepository** (or none).
- A **Worktree** hosts zero or more **Terminals**.
- A **Terminal**'s AgentStatus change to NeedsInput/Completed raises one **AgentStatusNotification**.
- A **Terminal** belongs to exactly one **Worktree** and lives on the one **DeckSocket**.
- A **Worktree** row offers its Repository's **TerminalLaunchers** (from the worktree's `.deck/launchers.json`) merged with the user's global ones.
- A **TerminalSnapshot** captures every **Terminal** on the **DeckSocket**.
- A **Terminal** may be running one **AgentSession**; the **TerminalSnapshot** captures it so the agent is resumed (not just the shell) on restore.
- A **Switch** changes which **Worktree** is mounted; a **DetachedOpen** does not.

## Example dialogue

> **Dev:** "I clicked a **Worktree** row and nothing happened — shouldn't it switch?"
> **Domain expert:** "No — a **Worktree** row is folder-like: a click just expands or collapses its **Terminals**. **Switch** is an explicit action in the row's right-click menu — it replaces the mounted folder and reloads. Opening in a new window is a **DetachedOpen**, which doesn't change the **ActiveWorktree**."
>
> **Dev:** "If I register the same repo from two different worktree paths, is that two **Repositories**?"
> **Domain expert:** "No. A **Repository** is its git common dir, so both resolve to one. The path you registered is just a **discovery seed**."
>
> **Dev:** "Do my **Terminals** die when I **Switch** away?"
> **Domain expert:** "No — they live on the **DeckSocket** and reattach when you return. They die only on **TerminalRemoval** (Delete), shell `exit`, or when their **Worktree** or **Repository** is removed."
>
> **Dev:** "And if I reboot my machine — the **DeckSocket** is gone then, right?"
> **Domain expert:** "It dies, but your **Terminals** come back. Deck saves a **TerminalSnapshot** as you work and restores it when it next starts, so each **Terminal** returns at its working directory with its scrollback — picking up a fresh shell prompt. Whatever was *running* is not relaunched."
>
> **Dev:** "So if I close a **Terminal**'s editor tab, is it gone?"
> **Domain expert:** "No — the tab is just a view, like an editor over a file. The **Terminal** keeps running; reopen its row anytime. Destroying it is **TerminalRemoval**."
>
> **Dev:** "What happens when I click a **Terminal** that belongs to a **Worktree** I'm not in?"
> **Domain expert:** "Its tab opens right here in the current window — no **Switch**. Any **Terminal** opens from anywhere, the way you'd open a file."

## Flagged ambiguities

- "delete" conflated removing a **Worktree** with deleting its branch — resolved: **WorktreeRemoval** keeps them separate; branch deletion is opt-in.
- "active" meant both **ActiveRepository** and **ActiveWorktree** — resolved: distinct concepts (the Repository vs the specific Worktree).
- A Repository's registered path was treated as its identity — resolved: it is a **discovery seed**; the git common dir is the identity.
- "agent session" could mean a Deck-managed entity (with its own tree rows / chat surface) or an observed attribute of a Terminal — resolved: it is an **AgentSession**, an observed attribute. Deck never launches agents; it discovers the session via agent hooks keyed to the Terminal and resumes it by rewriting the TerminalSnapshot. (The intro's "agent chat sessions are planned" is this, not a separate chat UI.)
- "tmux session" was used for **Terminal** — resolved: the session is the backing mechanism; **Terminal** is the domain concept.
- "close" conflated closing a **Terminal**'s editor tab with destroying the **Terminal** — resolved: closing the tab is a non-destructive view operation; destroying is **TerminalRemoval** ("Delete"). Reverses ADR-0011 §6's kill-on-tab-close.
- "Project" was the canonical term for a registered repo — resolved: renamed to **Repository** for precision (it is literally a git repo, keyed by common dir). "project" is now avoided because a VS Code user reads the open *folder* as their "project," and that folder is a **Worktree** in Deck.
