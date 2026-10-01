# ADR-0058: OSC 52 writes use the host clipboard; reads are disabled

## Context

A program in a Terminal can request a clipboard write with OSC 52. xterm.js
parses that sequence but Deck previously registered no handler, so the request
was dropped. This is especially visible in Remote-SSH windows: a program on the
remote host cannot use a local `pbcopy`, `xclip`, or equivalent, leaving OSC 52
as its route to the user's clipboard.

The obvious webview implementation is not sufficient. Chromium gates
`navigator.clipboard.writeText` on document focus. Deck retains hidden Terminal
webviews so they continue to parse output, but a hidden webview cannot satisfy
that focus requirement. Deferring the write until focus returns changes both
its timing and its target: a later copy could be overwritten by an older queued
request.

OSC 52 also supports clipboard read queries. Answering one would send clipboard
contents to whatever is running in the Terminal, including a remote process or
an untrusted file whose control sequences were printed to the pane.

## Decision

1. **OSC 52 is write-only.** A `?` payload is ignored and Deck sends no reply.
   Malformed base64, invalid UTF-8, and bodies without a selection separator are
   also ignored. An empty payload writes an empty string.

2. **The webview recognises and forwards; the host decodes and writes.** Every
   Terminal registers xterm.js's OSC handler for identifier 52. The handler
   posts the raw OSC body as `{ type: 'clipboardWrite', payload }` and returns
   `true`. `TerminalEditorProvider` passes that body through one pure decoder
   and writes successful results with `vscode.env.clipboard.writeText`.

3. **Selections collapse to the one system clipboard.** `c`, `p`, `s`, `q`,
   numbered cut buffers, multiple targets, and an empty selection field all
   take the same write path. Deck requires only that the separator is present.

4. **Clipboard write failures are ignored.** There is no useful recovery action
   for the user, and retrying on focus would reintroduce stale delayed writes.

## Considered Options

- **Write with `navigator.clipboard` in the webview, optionally retrying on
  focus.** Rejected: background and hidden Terminals cannot write immediately;
  retrying later can overwrite newer clipboard contents.

- **Use `@xterm/addon-clipboard`.** Rejected: its default provider uses
  `navigator.clipboard` and it supports read queries. Replacing both the
  provider and codec leaves only the parser registration, which Deck can own
  without another shipped asset.

- **Scan the tmux output stream in the extension host.** Rejected: it would
  duplicate xterm.js's handling of chunk boundaries and BEL/ST terminators.
  Hidden Terminal webviews stay alive and already parse the live byte stream.

- **Unwrap tmux DCS passthrough.** Rejected until a real program requires it.
  xterm.js does not unwrap `ESC P tmux; ... ESC \\`, and programs known to Deck
  emit a plain OSC 52 sequence as well as the wrapped form.

## Consequences

- Clipboard writes happen when parsed, without requiring the Terminal tab or
  VS Code window to be focused.
- `vscode.env.clipboard` targets the system clipboard exposed by the VS Code UI,
  including the user's side of a Remote-SSH window.
- Programs in a Terminal cannot read or exfiltrate the clipboard through OSC
  52.
- The decoder is a pure, unit-tested module; the provider tests only the
  observable host clipboard effect.
- Reattach scrollback does not replay prior writes: xterm sees OSC 52 only in
  live pane output, while the reattach seed is rendered pane content.
