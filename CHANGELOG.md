# Changelog

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
