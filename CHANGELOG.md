# Changelog

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
