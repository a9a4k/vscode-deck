# ADR-0012: Terminal transport is tmux control mode (supersedes ADR-0011 decisions 3–4)

## Context

QA of the xterm.js migration (step F6) found scrollback is lossy for fast
output: `seq 1 1000` leaves only the last ~1.5 screenfuls in xterm's
buffer. Root cause is tmux itself — when pane output outpaces the
attached client, tmux discards intermediate output and does a full
redraw ([tmux #1019](https://github.com/tmux/tmux/issues/1019), by
design, not configurable). No regular-attach configuration fixes this;
the `smcup@:rmcup@` override fixed wheel-scrolling but cannot fix
completeness.

The established complete solution is **tmux control mode** (`tmux -C`) —
what iTerm2's tmux integration uses: tmux stops rendering a screen and
streams every byte of pane output as `%output` events; the client owns
the buffer entirely.

Alternatives considered:

- **M. tmux `mouse on`** (tmux owns scroll/find/selection via
  copy-mode). Complete scrollback, but re-opens passed QA items F1/F3/F5
  (xterm selection dies, find must become copy-mode RPC), leaks tmux UI
  into a product whose `deck.conf` deliberately hides tmux, and
  wheel-in-copy-mode is jumpy in web terminals. Rejected.
- **S. Keep `smcup@` partial scrollback.** Current state; acceptable
  stopgap, fails F6 for fast bursts. Rejected.
- **Shared control client, window-per-tab (iTerm2 topology).** One
  `tmux -C` client per VS Code window, Deck terminals collapse into
  windows of one session per worktree. Rejected: a control client has
  one size (`refresh-client -C`) so per-editor-group tab sizing breaks
  (iTerm2 needed `window-size manual` + per-window `resize-window` to
  cope); Deck has terminals-without-open-tabs whose `%output` would
  stream to nobody; and it reopens the session-per-terminal model
  ADR-0008 §2 settled when only the transport is at fault. The model
  isn't what failed QA.

## Decision

1. **Per-tab control client; the model is unchanged.** Each open
   terminal tab spawns

   ```
   tmux -C -L deck -f resources/deck.conf \
        new-session -A -s <sessionName> -c <worktreePath>
   ```

   One client process per tab, session-per-terminal naming, tree,
   cascade, URI codec, kill semantics all carry forward verbatim from
   ADR-0008/0011.

2. **`-C`, not `-CC` — and no pty.** Verified empirically (tmux 3.6b):
   `tmux -C` speaks the full `%begin`/`%end`/`%output`/`%exit` protocol
   over plain pipes, while `-CC` fails without a tty (`tcgetattr`).
   The client is spawned via `child_process.spawn`; **node-pty is
   deleted**, along with the `chmod +x spawn-helper` postinstall
   workaround (microsoft/node-pty#850).

3. **New module `TmuxControlClient`** owns the protocol: spawn,
   line parsing, FIFO command/reply queue (`%begin`…`%end`/`%error`),
   per-byte octal-escape decoding of `%output` into a byte buffer then
   UTF-8 decode, `sendKeys(bytes)` via `send-keys -H` (hex; batched per
   onData event, chunked for large pastes), `resize` via
   `refresh-client -C <cols>x<rows>`, `capturePane()`. Unknown `%`
   notification lines are logged and ignored. Unit-tested against
   recorded protocol transcripts; no tmux needed in CI.

4. **`TerminalPtyBridge` becomes `TerminalTransport`**, same public
   interface (`start/onData/onExit/write/resize/kill`), delegating to
   `TmuxControlClient`. `terminalEditorProvider` wiring and the webview
   message schema (ADR-0011 decision 4) are unchanged apart from the
   import. Pane id is discovered post-attach via
   `list-panes -F '#{pane_id}'`; Deck's model guarantees exactly one
   window/one pane per session, asserted.

5. **Restore is capture-pane seeding; the serialize snapshot is
   dropped.** On (re)attach, `capture-pane -p -e -J -S -5000` seeds
   xterm before live `%output` flows. `-5000` matches the webview's
   `scrollback: 5000`. `@xterm/addon-serialize` and the
   `vscode.setState` snapshot plumbing are removed — under control mode
   tmux never redraws, so a snapshot-less reload would otherwise paint
   an empty screen, and mixing snapshot + seed duplicates content (seen
   in QA). `deck.conf` sizes tmux's `history-limit` to the same cap so
   tmux does not retain pane history Deck can never surface.
   The seed also replays the pane's terminal *modes* — mouse reporting
   (`?1000/1002/1003/1006`), cursor visibility, application cursor
   keys/keypad, bracketed paste — read from tmux's per-pane format flags
   (`mouse_*_flag`, `cursor_flag`, …) in the same `list-panes -F` that
   discovers the pane id. A fresh xterm starts with every mode off and a
   running TUI sets them once at startup, so without the replay a
   Terminal reattached after a Switch or reload keeps its process but
   loses mouse input; the post-seed SIGWINCH repaint does not recover
   them because TUIs do not re-send modes on redraw.

6. **Exit semantics are preserved.** Child-process exit (and the
   preceding `%exit`) maps to `onExit(code)` exactly as node-pty's exit
   did: shell `exit` / kill-session / cascade all end the client
   process, the webview shows `[process exited N]`, the panel disposes.
   QA items C2/I1 ride on this unchanged.

7. **`deck.conf` loses the `smcup@:rmcup@` override** — dead config
   once no regular client attaches. Nothing is added: `window-size`
   already defaults to `latest` (correct for a single control client
   per session) and `default-terminal` to `tmux-256color`.

8. **Flow control is deferred.** `refresh-client -f pause-after` +
   `%pause`/`%continue` needs tmux ≥3.2 and solves a flood problem we
   haven't observed. Skipped in v1; the version floor stays at the
   preflight-enforced ≥3.1 (`refresh-client -C WxH` syntax).

## Consequences

- Scrollback is complete: QA F6's expectation becomes "scroll reaches
  line 1".
- node-pty and its postinstall hack are gone; the extension spawns only
  plain `tmux` processes.
- Every pane byte crosses stdout-pipe → extension host → postMessage —
  same hop count as the pty path, but tmux no longer drops data. If
  postMessage flooding appears, coalesce `%output` payloads per tick
  before posting.
- Command injection surface shrinks by construction: spawn uses an argv
  array (no shell), pane input is hex-encoded (`send-keys -H`), and
  session names remain Deck-sanitized. Conventions from `tmuxCli.ts`
  (`exactTarget()`, quoting) continue to apply to any command built
  from names.
- Open verification items for the spike (slice 1): all 1000 lines of
  `seq 1 1000` arrive via `%output`; SGR mouse sequences from inner TUIs
  (vim `mouse=a`) round-trip through `send-keys -H` (fallback:
  `send-keys -M`); large-paste chunk size for `send-keys -H` line
  length.
- Commit 0531645 (serialize-addon snapshot restore) is substantially
  reverted by decision 5.

## Known limitations

- **Seed cursor seam.** The reattach seed is `capture-pane` *text* replayed
  into xterm; `capture-pane` does not carry the cursor position, so the seed
  ends at the last content line (trailing blank rows stripped, no trailing
  newline) and the cursor lands there. This is correct for the common case —
  reattaching at an idle prompt — but if you reload at the *exact instant* a
  program is streaming output (cursor on a blank line below the last line,
  e.g. a sleeping `while …; do …; done`), the first live line concatenates
  onto the last seeded line: a one-line visual seam that self-corrects on the
  next output or keystroke. This is the same limitation **tmux-resurrect**
  (the de-facto tmux content-restore tool) has — text replay does not restore
  the cursor. The only known full fix is iTerm2's approach: capture history
  and visible screen separately, query `cursor_x`/`cursor_y` via
  `list-panes -F`, and reconstruct a fixed-dimension grid placing the cursor
  at absolute coordinates. That grid reconstruction is disproportionate to a
  rare, self-correcting, cosmetic artifact; deferred. An attempt to
  approximate it with line-counted trimming was rejected — `capture-pane`
  trailing-blank trimming and `-J` wrap-joining make capture-line ↔ tmux-row
  mapping unreliable, and it regressed the common idle-prompt case.

## Refines

- ADR-0011. Supersedes decision 3 (node-pty spawn) and the
  pty-relay half of decision 4; the webview message schema, custom
  editor surface, URI identity, kill-on-dispose, snapshot store, and
  cascade all carry forward. The "xterm.js owns the in-tab feel"
  decision 7 carries forward minus the serialize addon.
- ADR-0008. The Terminal model (§2–§5, §7, §8, §10–§15) is untouched —
  this ADR is one layer below ADR-0011's surface: the transport.

## Validation

- `tmux -C` over pipes (no tty) verified on tmux 3.6b: full protocol
  handshake, command replies, `%exit` on kill-server, exit code 0.
- `-CC` over pipes fails: `tcgetattr failed: Inappropriate ioctl for
  device`.
- `window-size latest` and `default-terminal tmux-256color` confirmed
  as server defaults (no deck.conf additions needed).

## Status

Accepted.
