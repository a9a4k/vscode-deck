# ADR-0042: Decorate Terminal tabs only while visible

## Context

Agent-aware tab decoration (ADR-0023, ADR-0039) writes a Terminal's
`#{window_name}`-derived icon and its TUI-title label onto the editor tab by
setting `WebviewPanel.title` / `WebviewPanel.iconPath`. `refreshIcons` /
`refreshTitles` apply these to **every** open Terminal panel whenever an
`AgentStatus` or `AgentTitle` changes.

Empirically, **writing `title` or `iconPath` to a *hidden* `WebviewPanel` makes
VS Code activate that tab.** Verified with instrumented builds: a write to a
background panel was followed every time by `onDidChangeTabs` reporting that tab
active (`panel.active` was still `false` synchronously after the write — the
activation lands on the next tick); skipping the write never activated it; and
no `reveal()`/`openWith` was involved. Neither `preserveFocus`, the webview's
`window`-focus → `terminal.focus()` listener, nor focus reconciliation explained
it — only the decoration write did.

The user-visible effect: with two Terminals open, an agent/shell update in a
**background** Terminal yanked the active editor tab to it, and the active-row
highlight (issue #71) faithfully followed — stealing the sidebar selection the
user had placed elsewhere. It surfaced during QA of the #134 fix and sits
**upstream of the #134 guard** (which correctly suppresses the *churn* but cannot
un-steal an active-tab change VS Code actually made).

VS Code exposes **no API to decorate a background editor tab without touching
it** — `WebviewPanel.iconPath` is the only lever and routes through activation
(microsoft/vscode#90616). The established lifecycle pattern is to gate webview
side-effects on visibility via `onDidChangeViewState` (VS Code Webview API
guide; cf. the focus-steal class in anthropics/claude-code#14995,
microsoft/vscode#76863).

## Decision

**Write a Terminal tab's panel decoration (`title` / `iconPath`) only while its
panel is visible.** `applyTabDecoration` no-ops when `panel.visible` is false
(marking the session stale without even resolving it); an `onDidChangeViewState`
subscription re-applies the current label/icon when the tab becomes visible *and*
went stale while hidden.

This gate is **scoped to the panel writes** — the agent identity **icon glyph**
(`iconPath`) and the **AgentTitle label** (`title`). The **AgentStatus attention
dot + tab color** reach the tab through a *different* path: the
`AgentStatusFileDecorationProvider` (a `FileDecorationProvider` keyed on the
`deck-terminal:` URI), which VS Code applies to the tab without touching the
`WebviewPanel` — so it is **not** subject to this gate and **stays live on hidden
tabs**, never stealing activation. The sidebar row (ADR-0025/0040/0041) and
`AgentStatusNotification` also carry status.

So on a hidden Terminal tab: the **status dot/color stay live**; only the
**identity glyph and title text lag** until the tab is shown.

This **amends ADR-0023/0039**: a tab's agent *identity glyph and title* are shown
only while the tab is visible, not live on background tabs (the status dot/color
remain live regardless).

**The icon glyph is agent *identity* only — never working/AgentStatus state.**
Since `iconPath` writes are visible-gated, a status-driven icon would freeze at
whatever state a tab held when last visible and lie on background tabs (the stuck
"working" spinner after a hidden agent completed); a perpetual working animation
also distracts and, as a GIF, ignores `workbench.reduceMotion`. Agent identity
changes only when the agent starts/stops (a window rename, which already
re-decorates), so a static identity glyph is always correct. The **working
state** reaches the tab only via the live attention dot (the FileDecoration
path above) and the sidebar row — not the glyph. This reverses the working-icon
half of the tab-icon work; the working GIFs remain in use on the sidebar row.

## Considered Options

- **Write decoration, then re-activate the previously-active tab** — rejected:
  re-activating requires `reveal()`, which steals focus and flickers, and there
  is no clean "restore prior active tab" primitive.
- **Drop tab decoration entirely** — rejected: the *visible* tab should still
  show its agent icon/label; only background writes are harmful.
- **Live with the activation** — rejected: it is the bug.

## Consequences

- A hidden Terminal's identity **glyph and title text** are **stale until the tab
  is shown** (refreshed on `onDidChangeViewState`). Its **AgentStatus dot/color
  stay live** via the FileDecorationProvider, and the sidebar row + notifications
  carry status too — so the "which background agent needs me" signal is never
  lost; only the per-tab identity glyph/label lags.
- The re-apply is **gated on staleness**: a plain tab switch where nothing changed
  while hidden does no decoration work (no session resolve, no write), so
  switching tabs stays cheap.
- **Bonus:** window restore no longer thrashes tabs — VS Code eagerly resolves
  restored background custom editors, and decorating them previously activated
  each in turn; deferring to visible removes that.

## Status

Accepted.
