# ADR-0024: Image paste forwards Ctrl+V to the agent, not pixels to Deck

## Context

Pasting an image into a Deck Terminal running an AI agent (Claude Code, Codex,
pi) did nothing. The reported gesture was **Cmd+V**.

A Deck Terminal is an xterm.js **webview**, not a pty (ADR-0011), backed by a
tmux control-mode pane (ADR-0012). On **Cmd+V** the browser fires a `paste`
event; xterm reads `clipboardData` as **text** (empty for an image) and writes
nothing — so the agent never receives the keystroke. The webview's only other
paste path, the context-menu **Paste**, is `navigator.clipboard.readText()` —
also text-only.

The widely-repeated claim that **tmux** blocks clipboard images
([claude-code#25672](https://github.com/anthropics/claude-code/issues/25672),
various blogs) is **wrong for this stack** — empirically disproven: in a Deck
terminal, **Ctrl+V already attaches an image today**. The mechanism: TUI agents
do not receive image bytes over stdin; on Ctrl+V they read the **OS pasteboard
themselves**, locally. tmux is transparent to a local syscall, and the agent
under Deck's extension-host-spawned tmux has macOS pasteboard access. pi's source
confirms the pattern is universal, not Claude-specific — `readClipboardImage()`
(`@mariozechner/clipboard` native module on macOS) fired from its Ctrl+V handler.
Codex reads the pasteboard on the same gesture.

So the blocker was never tmux and never the agent — it was the **webview eating
Cmd+V**. The image is *already in the OS pasteboard*; the agent only needs the
keystroke.

## Decision

1. **On a webview `paste` event whose clipboard carries an image,
   `preventDefault()` and send `\x16` (Ctrl+V) to the pane** via the existing
   `{type:'input'}` → `transport.write` → `send-keys -H` path. The agent reads the
   pasteboard itself. Text paste (no image present) falls through to xterm
   untouched.

2. **For clipboard paste, Deck never reads, decodes, or stores the image.** No
   bytes cross the webview boundary; no temp files; no file-path injection; no
   `/image`; no agent detection. We forward a keystroke, nothing more.

3. **The context-menu Paste is image-aware too** — same branch: image present →
   `\x16`; otherwise the existing `readText()` text paste. Both routes behave
   identically.

4. **ImageDrop is a separate gesture and transport** (ADR-0054). Clipboard
   paste remains the one-byte forward described here; a dropped file is not in
   the pasteboard, so ImageDrop must materialize its bytes and bracketed-paste a
   path.

This is **agent-agnostic by construction**: Claude, Codex, and pi all read the
pasteboard on Ctrl+V, so the same forwarded keystroke serves every agent — and a
plain shell simply receives `^V` (harmless).

## Considered Options

- **Webview reads clipboard image bytes → host writes a temp file → inject the
  file path** — rejected for paste. The image is already in the OS pasteboard,
  so copying it through Deck adds a second input channel and temp-file lifecycle
  where a one-byte Ctrl+V forward works. This rejection does not apply to
  ImageDrop: a dropped file is absent from the pasteboard, and live-agent tests
  found that a bracketed raw path attaches in both Claude Code and Codex
  (ADR-0054).
- **The `tmux-paste-image` plugin model** (a tmux keybinding runs a script that
  reads the clipboard and `send-keys` a path / `/image`) — rejected. It is
  Linux-only (`xclip`/`wl-paste`), it binds a **prefix** key (the DeckSocket sets
  `prefix None` and `unbind -a`, ADR-0012/0022 — there is no prefix), and its
  Claude `/image` branch is Claude-only and outdated.
- **Do nothing; document "use Ctrl+V, not Cmd+V"** — rejected. Ctrl+V working is
  an accident of xterm forwarding the raw keystroke; making the user's natural
  reflex (Cmd+V) work is the actual fix and is trivial.

## Consequences

- **Cmd+V now attaches images for every agent.** Text paste is unaffected (the
  branch only fires when an image is present).
- **Deck stays a dumb pipe for paste.** It owns no image format/size policy — the
  agent's own clipboard reader does (PNG/JPEG/WebP/GIF, conversion, limits). One
  fewer thing to maintain.
- **ImageDrop is supported through ADR-0054.** VS Code's webview host yields an
  unclaimed all-file drag to the workbench, but explicitly keeps a drag that
  extension content claims with `preventDefault()`. Deck uses that path only for
  images; non-image files retain VS Code's editor-open behavior.
- **Linux/Windows caveat, unverified.** There the browser paste shortcut *is*
  Ctrl+V, which can race xterm's own `^V` from the keydown. The handler guards on
  an image being present and `preventDefault`s; Linux/Windows behavior is a
  follow-up (macOS is the verified target).

## Status

Accepted — shipped in v0.5.0.
