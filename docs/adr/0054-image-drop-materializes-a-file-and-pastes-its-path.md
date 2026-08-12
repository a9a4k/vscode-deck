# ADR-0054: ImageDrop materializes a file and pastes its path

## Context

Dragging an image onto a Terminal tab opens the image in a new editor tab
instead of handing it to the agent. ADR-0024 §4 declined drag-and-drop, reading
the workbench as an immovable obstacle: *"VS Code's workbench intercepts a file
drop and opens the image in an editor tab before the webview sees it
(QA-confirmed)."* The observation was right; the mechanism was not (ADR-0024's
Consequences are corrected accordingly).

**The webview volunteers the drag away, and can decline to.** On `dragenter` of
an all-file drag, VS Code's webview host script posts `drag-start`
(`webview/browser/pre/index.html:782`) and the host sets
`pointerEvents: 'none'` on the iframe (`webviewElement.ts:323` → `:559`) — so
the drop lands on the workbench editor area. That forwarding is skipped
outright when the content has already called `preventDefault()`: *"Extension
code has already handled this event."* Upstream treats this as the way in
(microsoft/vscode#182449, microsoft/vscode#209211). Deck registered no drag
listeners at all, so it opted into the workbench default by omission.

Two constraints shape what can be done with a drop once claimed:

1. **A webview cannot resolve a dropped `File` to a filesystem path.** The only
   route is Electron's `webUtils`, reached through a preload-injected global
   (`platform/dnd/browser/dnd.ts:516`, installed by
   `sandbox/electron-browser/preload.ts:187` into the workbench window only).
   A webview document gets `acquireVsCodeApi()` and nothing else, and
   `src/vscode-dts/` has no proposed API for webview drops. Bytes and a
   basename are all that is available. This is why VS Code's own terminal
   (`terminalInstance.ts:2643`) and Orca (its Electron preload) can inject a
   *real* path and Deck cannot.
2. **ADR-0024's `\x16` forward cannot serve a drop.** That decision works
   because the pasteboard already holds the image and the agent reads it
   locally. A dropped file is not on the pasteboard, so there is nothing for
   the keystroke to pick up.

**The wire format was measured, not inherited.** Prior art (Orca) holds that
TUI agents detect an image from a *bracketed paste of the raw, un-escaped
path*, and that shell-escaping corrupts the file-existence check they run.
Sending exact byte sequences to live agents over `tmux send-keys -l`:

| Variant | Claude Code v2.1.222 | Codex (gpt-5.6-sol) |
| --- | --- | --- |
| raw path, bracketed | attached | attached |
| quoted path, bracketed | attached | not run |
| raw path, **unbracketed** | literal text, no attachment | attached |
| path **with a space**, raw, bracketed | attached | not run |

Submitting an attached image answered directly with **no Read tool call** — a
real inline attachment, not a path the model went and fetched. So bracketing is
the load-bearing part; quoting and spaces are not (contra Orca, for these two
agents at these versions). pi is unverified — not installed on the test
machine.

## Decision

1. **The Terminal webview claims image drags.** Capture-phase `dragenter` /
   `dragover` / `drop` listeners on `document`, claiming only drags carrying an
   `image/*` item, calling `preventDefault()` **and `stopPropagation()`**.
   `stopPropagation` is not belt-and-braces: `handleInnerDragEvent` (dragover)
   forwards a `drag` message *without* checking `defaultPrevented`, and the
   host re-dispatches it on the workbench window where
   `WebviewWindowDragMonitor` would blank the iframe mid-drag. The pre-script
   listens on `window` in the bubble phase, so a capture-phase listener on
   `document` runs first and wins. A drop overlay marks the target while an
   image drag is over it (ADR-0029: Deck's drop targets get explicit feedback).

2. **Deck materializes the image and pastes its path.** Bytes cross as a
   `Uint8Array` — webview messages carry `ArrayBuffer`s on a binary side
   channel (`extHostWebviewMessaging.ts`) for any extension declaring
   `engines.vscode >= 1.57`; Deck declares `^1.110.0`, so no base64. The host
   writes `os.tmpdir()/deck-drops/<epochMs>-<sanitized-basename>.<ext>` and
   sends `\x1b[200~<path>\x1b[201~` over the existing `{type:'input'}` →
   `transport.write` route. The path is raw: escaping buys nothing measurable
   and would be one more rule to carry.

   One ImageDrop module owns MIME-to-extension mapping, fallback to the dropped
   extension for unknown image types, basename sanitization, filename creation,
   collision handling, and bracketed-paste framing. Its single entry point
   accepts an injected clock and exclusive writer. An `EEXIST` result advances
   a numeric suffix, so simultaneous drops cannot clobber each other.

3. **No cleanup.** `/tmp` and `$TMPDIR` are reaped by the OS on both platforms
   Deck supports — measured on macOS, nothing in either survives 24h;
   `systemd-tmpfiles` defaults to 10 days. A Deck-owned sweep would be dead
   code everywhere it ran.

4. **Uniform, whatever occupies the pane.** No check for a running
   AgentSession. Gating would make a user gesture depend on the TerminalModel's
   ≤2s bounded-staleness observation — a race the user loses silently and
   cannot reproduce — and Deck only observes agents, never infers their
   lifecycle. The unguarded case is inert: a bracketed paste does not execute,
   so a bare shell just shows the path on its command line.

5. **No size cap and no format policy.** Any `image/*` is accepted. ADR-0024
   committed Deck to owning neither, and a cap would encode an assumption about
   what the agent accepts into an agent-agnostic pipe.

6. **Non-image drags stay with the workbench** and keep opening an editor tab.
   A temp copy of a dropped `.ts` would be actively wrong — for source files
   identity matters — while for an image the copy is as good as the original.

7. **ADR-0024 §2 is narrowed, not superseded.** "Deck never reads, decodes, or
   stores the image" remains true *of paste*, and is the reason paste stays a
   one-byte forward. The asymmetry is the insight: the pasteboard already holds
   the image, so a keystroke suffices; a dropped file does not, so someone must
   materialize it.

8. **Multi-image drops are one ordered batch (#177).** The drop handler acquires
   every `File` synchronously while the drag data store is readable, then reads
   their bytes and posts one message. The host may materialize those images
   concurrently, but sends pane input only after every write succeeds and in
   drag order. A failure shows a VS Code error notification and sends no partial
   pane input. Directory creation happens before the exclusive-create retry;
   only a target-file `EEXIST` advances the suffix, and 100 failed attempts
   reject.

   **A batch is one bracketed paste carrying every path, space separated** — not
   a paste per image. Measured against a live agent by sending exact byte
   sequences, after two wrong attempts shipped:

   - *A paste per path, all reaching the pane together* → the agent **loses the
     first path's text entirely**; only the last survives. This is what Deck
     does whenever it issues several writes from one message handler, because
     `sendKeys` puts them on the control client's stdin in the same tick and
     tmux hands the pane one burst. Writing them as separate `transport.write`
     calls does **not** separate them; only real elapsed time would, and timing
     is not a contract worth depending on.
   - *A paste per path with no separator* → two paths **merge into one unusable
     token**, invisible while the agent recognizes every paste and replaces it
     with a chip, silent garbage when it declines one.
   - *One paste, paths space separated* → every recognized image attaches **and**
     every declined path stays readable. No timing dependency.

   The merge was found by QA (an SVG in a multi-image drop); the data loss was
   introduced by the first fix for it and found by QA again. Both are recorded
   because each looked like the tidy choice: the framing belongs to the batch,
   not to each file, which is why materialization returns a path and the paste
   input is built from the list.

   The overlay clears when a drag is cancelled with Escape — observed in QA. A
   `dragend` listener is registered, but `dragend` fires at the drag's source
   node and an OS-originated drag has none inside the webview, so the clearing
   most likely comes from the cancel-time `dragleave` the spec fires at the
   current target. The behaviour is verified; the mechanism is not.

## Considered Options

- **Host-side path recovery** — let the workbench keep the drop, then correlate
  a webview "a file drag entered this Terminal" signal with the file tab VS
  Code opens in that editor group (`window.tabGroups.onDidChangeTabs`), close
  the tab, and paste the *real* path. Zero bytes; ADR-0024 §2 would survive
  intact. Rejected: the signal is a coincidence rather than the event — a
  Terminal active in a group while the user opens an image by other means is a
  false positive — and the user watches a tab flash open and closed, which
  reads as a bug even when it works.
- **Write the bytes to the OS pasteboard, then send `\x16`** — one mechanism
  for paste and drop. Rejected: clobbers the user's clipboard as a side effect
  of a drag, needs a macOS-specific pasteboard write, and still puts the bytes
  through Deck.
- **Shell-escape the path** like VS Code's integrated terminal
  (`preparePathForShell`). Rejected: measurement shows escaping is unnecessary
  for attachment, and the raw form is what both tested agents accept.
- **Base64 data URLs across the bridge**, as Cline does
  (`ChatTextArea.tsx`, `readAsDataURL`). Rejected: buffers are supported; the
  base64 folklore costs +33% and a string copy for nothing.
- **Do nothing; document "copy the image and press Cmd+V."** Rejected — the
  reported gesture is the natural one, and it currently does something actively
  unhelpful.

## Consequences

- **Deck now stores image bytes**, which ADR-0024 §2 forbade globally and now
  forbids only for paste. There are two mechanisms for getting an image to an
  agent — a keystroke for paste, a file for drop — and the split is forced by
  where the image already lives, not by taste.
- **The agent's prompt shows the temp path, not the original.** Dropping
  `~/Documents/shot.png` attaches a file named
  `/…/deck-drops/1754…-shot.png`. Harmless for pixels; it would not be for a
  source file, which is why non-images are out of scope.
- **This works identically on Linux.** Unlike the paste forward — whose
  Linux/Windows behaviour ADR-0024 left unverified because it depends on
  pasteboard access and Ctrl+V racing xterm — drop involves no pasteboard at
  all.
- **Dragging from VS Code's Explorer onto a Terminal remains a no-op** unless
  the user holds Shift. That is a workbench-level block
  (`WebviewWindowDragMonitor`) no extension can opt out of; Cline documents the
  same requirement. Known limit, not a regression.
- **A file dropped on a Terminal row is deliberately inert.** The tree still
  routes external drops to Repository registration regardless of target, but a
  confirmed file carries no discovery seed and stops before registration. The
  row is the one Terminal surface where VS Code gives Deck the real path, so it
  could instead paste any dropped path without making a temp copy and even while
  the tab is closed. That remains deferred: it would change what a folder drop
  on the row means and needs a paste route that does not append Enter. The Shift
  + `uri-list` path on the tab remains a no-op too.
- **Watch for a double overlay.** Because the dragover forward ignores
  `defaultPrevented`, VS Code's own editor drop overlay flashing alongside
  Deck's is the first symptom that `stopPropagation` lost the race.
- **If VS Code ever exposes a webview drop API carrying paths**, the temp copy
  becomes unnecessary and this decision should be revisited; `src/vscode-dts/`
  has no such proposal today.

## Status

Accepted — implemented in #176; multi-image and failure handling corrected in
#177; tree file drops made inert in #178.
