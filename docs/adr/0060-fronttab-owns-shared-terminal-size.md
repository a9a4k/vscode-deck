# ADR-0060: FrontTab owns a shared Terminal's size

## Context

A Terminal is one tmux session and pane, but VS Code may open its custom-editor
tab in several windows. Each tab has its own tmux control client and xterm size.
With tmux's default `window-size latest`, the client that attached last sized the
shared pane. Reloading a background window could therefore change wrapping in
the window the user was actively using.

ADR-0012 decision 7 assumed one control client per session. ADR-0008 and
ADR-0011 acknowledged shared tabs only as a possible keystroke collision; they
did not define which tab owns the pane size.

## Decision

1. The Terminal takes the size of its **FrontTab**: the tab that is VS Code's
   active editor in the focused window. A background tab may render at the wrong
   width until it comes to the front because one pane cannot have two sizes.
2. Every new control client sets `ignore-size` before sending its first size.
   A lone flagged client still sizes normally under tmux, preserving the
   single-tab case; when an unflagged FrontTab exists, a background attachment
   or resize cannot change the pane.
3. A FrontTab claim sends, in order: clear `ignore-size`, `switch-client` to the
   Terminal's exact session, then the tab's latest size. `switch-client` makes
   that control client tmux's latest client; typing does not.
4. Deck re-evaluates FrontTab ownership when the webview becomes ready, the
   panel view state changes, or the VS Code window focus changes. Keyboard focus
   inside xterm is not part of the rule.
5. The transport serializes a claim against resize events and replays the newest
   measured size after the claim. A claim before the control client is ready is
   ignored.
6. The minimum supported tmux version is 3.2, where the required client flags
   are available. Preflight, the unavailable Worktree row, and README state the
   new floor.

## Rejected alternatives

- `window-size smallest`: a narrow background window would still control the
  FrontTab.
- `window-size manual` plus `resize-window`: changes session policy and makes
  every client coordinate global mutable state.
- Allow only one live tab per Terminal: conflicts with VS Code restoration and
  the established durable-Terminal/disposable-tab model.
- Claim on xterm keyboard focus only: switching windows to read or scroll a
  Terminal would leave the old window's size in force.

## Consequences

- Reloading or restoring a background tab does not resize the Terminal or send
  a spurious SIGWINCH to its foreground program.
- Switching windows or editor tabs hands the pane to the new FrontTab and
  replays its current size, causing full-screen programs to redraw correctly.
- Closing the FrontTab lets tmux choose a remaining unflagged client; if only a
  flagged client remains, tmux includes that lone client in sizing.
- Tests assert command order through the control-client and transport APIs, and
  a tmux 3.2+ integration test verifies the real shared-pane semantics.

## Refines

- ADR-0012 decision 7: `window-size latest` is coordinated across the several
  per-tab clients that may share one Terminal.
- ADR-0008 and ADR-0011: opening one Terminal in several windows is supported
  for sizing; simultaneous keystroke coordination remains out of scope.

## Status

Accepted.
