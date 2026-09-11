# Bookmark follow-ups

Deferred out of the first Bookmark slice (worktree-scoped, hand-pinned URLs
rendered as rows beside Terminals). Recorded here from the design session; to be
converted to issues.

## Required follow-ups

1. **Drag a URL onto a Worktree row to pin it.**
   The tree already declares `text/uri-list` in `dropMimeTypes`, but
   `handleDrop` routes *every* uri-list drop to `dropRepositorySeeds`, which
   calls `.fsPath` on any scheme — so dropping an `https://` URL today produces
   a garbage path that survives the `catch` in `discoverySeedsFromDrop` and
   becomes a discovery seed. Fix by branching on scheme before either path:
   `file:` → repository seeds, `http(s):` → Bookmark on the target Worktree,
   anything else → ignore.
   Needs a manual check of whether dragging from VS Code's *Integrated* Browser
   emits `text/uri-list` across the Electron boundary; dragging from an external
   browser is expected to work.

2. **Configure the default open target.**
   Un-superseded: the per-Bookmark "open in default browser" row action
   **stays in v1**. It was briefly dropped in favour of a single
   Worktree-level action that opens everything at once, but the two differ in
   scope (one row vs. all), frequency, and target — an open-everything action
   cannot express "externally" for a single Bookmark, and dropping the
   capability to resolve an icon collision was backwards. Only the **icon**
   changes: not `globe` (now the row's leading icon) — candidates are being
   compared in `prototypes/bookmark-row-icon-label/` ("Follow-up: the Bookmark
   row's external-open action icon").
   The Worktree-level open-everything action remains an idea, not a decision;
   it has not been grilled, and ADR-0013 is evidence against part of it (VS
   Code already replays a folder's custom-editor tabs across a Switch, and
   `TabSnapshotStore` was deleted precisely because bulk-reopening resurrected
   deliberately-closed rows).
   Follow-up still applies: give a Bookmark its own
   `target` (`integrated` | `external`) and/or a global default setting. The
   two targets are not equivalent — the Integrated Browser has its own cookie
   jar (`workbench.browser.dataStorage`, forced to `ephemeral` in an untrusted
   workspace), so authenticated sites cost a sign-in there while the default
   browser already has the session.

## No-go: per-site favicons as the row icon

Explored in `prototypes/bookmark-row-icon-label/`. **No-go for v1.** A
favicon's legibility depends on that specific site's icon design against
whatever VS Code theme the user runs — GitHub's favicon (no background chip)
was legible on light theme and nearly invisible on dark theme, same asset,
opposite outcomes. Deck has no way to detect or compensate per-bookmark, and
the failure is silent (not a blank, not a crash — just occasionally
unreadable). Request-frequency (E2) and a true offline-reload (E3) were
never fully closed out in that prototype, but the theming failure alone is
disqualifying regardless of how those land.

Ship instead: a codicon (`globe` — matches Chrome/Firefox's own no-favicon
fallback convention; no longer collides with anything else in the UI now
that the per-Bookmark "open in default browser" action is superseded by a
single workspace-level open-everything action, see #2 above) sized as a
custom padded glyph (`scripts/generate-tree-icons.py`, same technique as
`deck-terminal`), paired with path-tail-as-label / host-as-description
(`pull/1234`, dimmed `github.com`) — the label arrangement that let two pins
on the same host stay distinguishable at a glance.

Revisit only via an icon service that guarantees a background chip (e.g.
Google's `s2/favicons`), and only after actually running E2/E3 live, not
just via desk research.

## Recorded, not required

3. **Derived Bookmarks.** Compute the rows instead of pinning them: the PR from
   the branch (`gh pr view --json url,title,state`), the ticket from the branch
   name (`ins-4924-…` carries the id). Rows would appear with the Worktree and
   never go stale. Costs: Deck would shell `gh` (it shells only `git` today), a
   workspace slug in settings, network-dependent rows in a tree that renders
   from local state, and a decision about worktrees with no PR yet.

4. **Repository-level Bookmarks, inherited by Worktrees.** Author once on the
   Repository, render under every one of its Worktrees — for links identical
   across worktrees (Actions page, dashboard, staging). Changes authoring only,
   not what a row is.

5. **Last-URL memory.** V1 always loads the pinned address. A Bookmark could
   remember where you left off, as a non-identity attribute.

6. **`New Terminal` as the first item in the launcher Quick Pick.** Not a
   Bookmark change — surfaced by the split-button research during this session.
   The pattern says mirror the split button's primary action as the menu's first
   item so keyboard and screen-reader users get the same options.
