# Changelog

## 0.25.6

Deleting a Terminal by keyboard (`cmd+backspace`) has been removed. It relied on the
tree's arrow-highlighted row matching its separately-tracked selection, and VS Code
gives extensions no way to keep those in sync — arrow keys move the highlight but never
the selection, so the shortcut could delete a different Terminal than the one you were
looking at. In manual testing this destroyed a live shell. Right-click → Delete Terminal
is unaffected and remains the only way to delete a Terminal.

## 0.25.5

Opening a Terminal from the sidebar now puts your cursor in it. Previously a
row click left keyboard focus on the tree instead — typing was invisibly
captured by the tree's own type-ahead navigation, which could jump the
selection to another row and open the wrong Terminal on Enter. Clicking a
row, pressing Enter on one, opening from an agent-status notification, Add
Terminal and Run Launcher all now focus the Terminal the moment its tab
opens, including re-clicking the tab that's already active. Deleting a
Terminal by keyboard (`cmd+backspace`) now requires the tree to hold focus
first — reach it with the arrow keys or by right-clicking a row for Delete
Terminal, since clicking a row focuses the Terminal instead.

## 0.25.4

The right-click menu in a Terminal is now the same menu VS Code draws everywhere
else in the editor. Escape dismisses it — and the escape no longer reaches the
program running in the Terminal, so backing out of a menu cannot cancel what
your shell or agent was doing. Arrow keys and type-ahead move through the items,
the menu follows your colour theme, it can no longer be clipped at the edge of
the screen, and screen readers can see it. Copy, Paste, Select All and Clear do
exactly what they did before, including forwarding an image paste to a running
agent and clearing tmux's scrollback.

## 0.25.3

Pasting into a Terminal from the right-click menu now behaves the same as
`Cmd+V`. Previously the menu sent the clipboard straight to the pane as if it
had been typed, so a multi-line paste ran every line in a shell, staircased the
indentation in an editor, and submitted an agent prompt on the first newline —
while the keyboard shortcut handled the same clipboard correctly. Both gestures
now go through the Terminal itself, which also fixes the line ending the menu
sent for Enter.

## 0.25.2

Pasting multi-line text into a Terminal now behaves the same after you Switch
away to another Worktree and back. Previously the reattached tab forgot that the
program running in it had asked for bracketed paste, so a multi-line paste
arrived as if typed — a shell ran every line, an editor staircased the
indentation, and an agent submitted the prompt on the first newline. This
completes the mode restoration started in 0.25.1 and works on every tmux version
Deck supports, not only those new enough to report the mode themselves.

## 0.25.1

A Terminal running a full-screen app — lazygit, vim, an agent TUI — now keeps
its mouse, cursor and key handling when you Switch away to another Worktree and
back. Previously the app kept running but its reattached tab lost the terminal
modes the app had set at startup: clicks stopped reaching it, a stray cursor
could sit in its UI, and arrow keys could send the wrong sequences. Restarting
the app was the only way out.

## 0.25.0

Bookmark rows now show the site's own icon — a flat, theme-colored silhouette
derived from its favicon — instead of a generic globe. Icons are fetched and
cached automatically per host, recolored to match Deck's other tree icons in
both light and dark themes, and fall back to the globe for a site with no
favicon.

## 0.24.0

Pin a URL — a GitHub PR, a Linear ticket, a local dev server — as a **Bookmark**
row next to a Worktree's Terminals. Click it to open in VS Code's Integrated
Browser, or use the inline action to open in your default browser instead.
Bookmarks drag-reorder alongside Terminals and move between Worktrees like any
other row. Add one from the Worktree row's `+` menu, now retitled **Start on
this Worktree…**.

## 0.23.0

Deck now tells you when it updates. The quiet update notice links to this local
changelog, which remains available at any time through **Deck: What's New** in
the Command Palette. You can turn future update notices off from the notice or
with the `deck.showReleaseNotes` setting.

## 0.22.0

Shift-drag a file from VS Code's Explorer or an editor tab onto a Terminal to hand its
real path to whatever's running there — an agent gets a usable path instead of pasted text.

## 0.21.0

Drop an image onto a Terminal to hand it to the agent running there, the same way file
drag now works.

## 0.20.2

The tree now selects a newly created Terminal automatically, instead of leaving the
previous row highlighted.

## 0.20.1

Terminal tabs take keyboard focus when you open them, and after VS Code reloads —
instead of leaving focus stuck elsewhere.

## 0.20.0

The tree renders without spinners now, refreshing only the parts that actually
changed instead of the whole view.

## 0.19.0

Deck's sidebar now notices Terminals created outside Deck itself — from the CLI, or
by an agent — and adds them to the tree automatically.

## 0.18.0

A Terminal tab that survives an extension restart but stops responding now gets a
badge and a "Reopen Terminals" action to fix it, instead of silently looking alive.

## 0.17.0

Deleting a Worktree whose branch has unmerged commits now keeps the branch and offers
a guarded "Force Delete Branch" action, instead of failing quietly.

## 0.16.0

The Terminal right-click menu gained Copy Link, and links printed in a Terminal are
now clickable.

## 0.15.2

Agent Terminal rows and tabs are labeled and iconed from a stable agent identity, so
labels don't flicker as an agent's own title changes.

## 0.15.1

Worktrees with no branch (a detached checkout) now get a readable label instead of
showing a raw filesystem path.

## 0.15.0

New Worktrees are added to the list in creation order by default, instead of
alphabetically.

## 0.14.2

README and demo assets refreshed.
