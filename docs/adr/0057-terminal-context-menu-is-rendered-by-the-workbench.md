# ADR-0057: The Terminal context menu is the workbench's; its actions stay in the webview

## Context

Deck already ships a native right-click menu: `view/item/context` contributes 11
entries to the tree rows. The Terminal's context menu was the only hand-drawn one
— a `<div id="context-menu">` inside the webview with its own CSS, its own
viewport-clamping arithmetic, its own click-to-dismiss listener, and its own item
dispatcher. A user reads the two menus as the same object; only one of them was.

The hand-rolled menu had no Escape handling at all. That surfaced the deeper
problem: it cannot be fixed cheaply, because a webview is an iframe and xterm's
`<textarea>` keeps focus while the menu is open. xterm registers its keydown
listener **on that textarea**
(`@xterm/xterm/src/browser/CoreBrowserTerminal.ts:379`), and `_keyDown` forwards
the key to the pane (`:1025`) during the target phase — before the event bubbles
to any `document`-level listener. A listener on `document` therefore closes the
menu *after* xterm has already sent the ESC byte to the running process. Closing
the menu and not disturbing the shell are two separate problems.

ADR-0011 §7 states that "xterm.js owns the in-tab feel. Copy/paste, mouse
selection, `Cmd/Ctrl+click` web links, Cmd+F search … all live in the webview."
That is already only half true: Cmd+F is `deck.terminal.find`, a host command with
a `package.json` keybinding that posts `{type:'find'}` into the webview. The
chrome is the workbench's and the action is the webview's. This ADR makes that
split deliberate and applies it to the menu.

VS Code's own code never solves this by intercepting keys. `Menu extends
ActionBar`, and the Escape handler is bound to the *menu's own DOM node* in bubble
phase; `contextMenuHandler` saves `focusToReturn = getActiveElement()` before
showing and restores it on hide. It works because focus **moves into the menu**.
The integrated terminal adds nothing on top: `terminalContextMenu.ts:51-70` just
calls `contextMenuService.showContextMenu({…})`, and `terminalInstance.ts`'s
`attachCustomKeyEventHandler` (`:1135-1194`) has no menu guard at all — it treats
Escape as always belonging to the shell (`:1144-1147`). Once the menu takes focus
the textarea blurs (`:1216-1218`) and the handler is never reached.

Feasibility was validated by prototype before this decision: the native menu
renders correctly over xterm's canvas for bare output, over a hovered link, and
over an active selection, with the selection preserved.

## Considered Options

- **Move focus into the hand-rolled menu.** Focus the first item on open, bind
  Escape and arrow keys to the menu element, restore `terminal.focus()` on every
  dismissal path. This is what VS Code core does, what the ARIA APG menu pattern
  prescribes ("places focus on the first menu item"), and what `superset` — Deck's
  Electron+xterm predecessor — gets for free from `@radix-ui/react-context-menu`,
  whose `terminal-key-event-handler.ts` contains no Escape special-casing at all.
  Rejected not because it fails but because it keeps Deck owning chrome it has no
  reason to own: positioning, clamping, theming, arrow-key navigation, type-ahead
  and screen-reader semantics all stay hand-written and all stay Deck's to
  maintain.

- **Capture-phase key interception.** A `document` listener registered with
  `useCapture: true` runs before the target phase, so it can close the menu and
  `stopPropagation()` before xterm sees the key. Correct, and about four lines.
  Rejected: it is an event-ordering trick nothing else in the codebase or in VS
  Code uses, and it buys only Escape — arrow keys, type-ahead and the rest remain
  unimplemented.

- **The HTML Popover API / `<dialog>` light dismiss.** Superficially ideal: the UA
  dismisses on Escape and outside-click for free. It does **not** work here, and
  the reason is not obvious from the code. Per the HTML Standard's close-request
  model, on Escape platforms the UA fires `keydown` **first**, and only "if the
  event fires without being canceled" does it proceed to process close watchers.
  xterm's textarea listener still runs and still sends ESC to the shell; the
  popover closes afterward. Light dismiss is free; preemption is not. Recorded
  because a reader will propose this again otherwise.

## Decision

1. **The menu box is the workbench's; what the items do stays in the webview.**
   The menu is contributed through `webview/context` in `package.json` and
   rendered by VS Code outside the iframe. The hand-rolled `#context-menu` div,
   its CSS, its clamping arithmetic, its click-to-dismiss listener and its item
   dispatcher are deleted.

2. **The webview publishes context, not markup.** The terminal element carries a
   `data-vscode-context` payload with `preventDefaultContextMenuItems: true` (to
   suppress VS Code's built-in webview entries), a `deckTerminal` marker that the
   `when` clauses gate on, and `deckHoveredLink`, refreshed whenever the hovered
   link changes. Deck uses its own marker key rather than `webviewId` so the gate
   does not depend on unverified custom-editor context-key behavior.

3. **Copy Link resolves host-side; the other four round-trip.** `Copy Link` reads
   the hovered URL straight off the command's context argument and writes it to
   `vscode.env.clipboard` — the target is already in the argument, so no message
   is needed. `Copy`, `Paste`, `Select All` and `Clear` post
   `{type:'menu', action}` into the webview, mirroring `showFind()`, because they
   operate on the xterm instance and their behavior must not change.

4. **ADR-0011 §4's message list is historical.** It documents six messages; the
   protocol has roughly fourteen and this adds another. The code is the source of
   truth. This ADR does not restate the schema, because a list in a document rots
   exactly the way §4 did.

5. **No fallback is retained.** The focus-into-menu design is recorded in
   *Considered Options* as prose, not kept in the codebase behind a flag.

## Consequences

- **The menu can only ever be opened by right-click**
  ([microsoft/vscode#188143](https://github.com/microsoft/vscode/issues/188143)).
  There is no programmatic invocation, so it can never be bound to a keystroke.
  This is strictly less capable than the hand-rolled menu, which could have been
  opened from anything. Accepted: no one has asked for a keyboard-invoked
  terminal menu, and Escape, arrow keys, type-ahead, theming and screen-reader
  support arrive in exchange.

- **If `webview/context` ever regresses over a canvas, there is no path back in
  the repo** — the fix would be to rewrite the menu from scratch against
  *Considered Options*. Accepted deliberately per decision 5; recorded because a
  future reader will otherwise assume the fallback was forgotten rather than
  declined.

- **The `{type:'menu', action}` contract is enforced by a test or by nothing.**
  The webview script is a template string inside a `.ts` file and is never
  compiled or type-checked, so the host's `action: 'copy' | 'paste' | …` union
  cannot reach the webview's `if (action === 'selectAll')`. Renaming one side
  silently breaks every menu item with all tests green. A test asserting both
  ends agree is the only backstop that exists and is therefore mandatory, not
  optional.

- **The five commands become visible in the Keyboard Shortcuts UI.** They are
  gated out of the Command Palette with `when: false`, matching the 20 existing
  palette-gated commands. Their titles stay unprefixed ("Copy", not "Deck
  Terminal: Copy") because these strings render directly in the menu, unlike
  `deck.terminal.find`, which is only ever read in the palette.

- **ADR-0024 is preserved, not amended.** The context-menu Paste remains
  image-aware — image present → `\x16`, otherwise the text path — because the
  branch stays in the webview and only its trigger moves. Likewise the
  `terminal.paste(text)` delegation that keeps bracketed paste intact (#208,
  #210), and `Clear`'s `clearHistory` message that clears tmux's scrollback.

- **The context attribute is scoped to the Terminal element, not the webview
  body — deliberately.** VS Code merges `data-vscode-context` from the clicked
  element upward through its ancestors, so the attribute on the Terminal element
  covers everything xterm renders inside it. The Find widget and the file-drop
  overlay are siblings rather than descendants and inherit nothing: right-
  clicking the Find input falls through to VS Code's built-in webview menu, which
  is the right menu for a text field, where Deck's own items would offer Select
  All and Clear meaning the Terminal buffer. Hoisting the attribute to the body
  would look like a tidy-up and would be a regression.

- **This does not generalise to the webview's remaining chrome.** The obvious
  next move — "Deck hand-draws nothing the workbench could render" — was
  considered and rejected, because the two remaining pieces were checked against
  it rather than assumed, and both fail.

  The **Find widget** is the trap, because VS Code genuinely does offer one:
  `WebviewPanelOptions.enableFindWidget`. It cannot be adapted to a Terminal.
  The option is a bare boolean and the only find-related entry in the whole
  extension API — no provider, no query event, no way to return results. The
  protocol runs between the workbench and VS Code's *own* preload frame (`find`
  and `find-stop` in, `did-find` out), so Deck's script — a nested iframe that is
  the search's *target*, not a participant — never sees it. The preload
  implements the search as `contentWindow.find(value, …)`
  (`webview/browser/pre/index.html`), the legacy DOM find-in-page: it matches
  rendered text only, while xterm's DOM renderer materialises just the visible
  rows and keeps the scrollback in its buffer. Adopting it would therefore search
  one screen instead of the configured 5000 lines, hardcode `caseSensitive` and
  `wholeWord` off, and leave its DOM selection invisible to
  `terminal.getSelection()` — breaking Copy after a find. That
  `@xterm/addon-search` exists at all is the corroboration: nobody writes a
  buffer-searching addon if DOM find can search a terminal.

  The **file-drop overlay** fails for an unrelated reason: per ADR-0055 the
  webview claims the drag itself so the workbench will not handle it, which
  leaves the drop feedback to the extension by construction.

  Both are hand-drawn out of necessity, not neglect. The rule worth carrying
  forward is narrower than the tempting one: prefer workbench chrome where it can
  carry the behaviour, hand-draw only where it cannot, and record which it was.

- **Both of Deck's right-click menus are now the same mechanism.** The
  inconsistency between the tree's native menu and the Terminal's hand-drawn one
  is removed.

## Refines

- **ADR-0011.** §7's "xterm.js owns the in-tab feel" is narrowed: the *actions*
  live in the webview, the *chrome* is the workbench's. §4's message schema is
  marked historical (decision 4). Everything else in ADR-0011 is untouched.
- **ADR-0024.** Cited as a constraint this decision preserves. Its decision about
  what Paste does is unaffected by who draws the menu.

## Status

Accepted — implementation pending.
