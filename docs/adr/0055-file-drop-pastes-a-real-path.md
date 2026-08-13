# ADR-0055: FileDrop pastes a real path when the drag carries one

## Context

ADR-0054 accepts an external ImageDrop by materializing its bytes and pasting the
copy's path. That is the only route available for Finder: a webview `File` exposes
bytes but not its filesystem path. The same copy would be wrong for source files,
so ADR-0054 deliberately leaves non-image byte drags to the workbench.

VS Code-originated drags cross a different boundary. Measurement in an
instrumented Terminal webview found URI-list strings for Explorer files and
folders, editor tabs, and multi-selection. The internal `resourceurls` variant
preserves the full CRLF-separated selection; standard `text/uri-list` is
truncated to one entry upstream. The workbench disables pointer events on
webviews during an internal drag unless Shift is held
([microsoft/vscode#182449](https://github.com/microsoft/vscode/issues/182449),
[PR #209211](https://github.com/microsoft/vscode/pull/209211)).

## Decision

1. **A URI-carrying FileDrop pastes real paths.** The webview sends the raw URI
   list to the extension host. One pure function parses URI-list grammar,
   preserves order, keeps only `file:` URIs, and asks VS Code for each filesystem
   path. Nothing is copied.

2. **Prefer the complete payload.** The webview reads `resourceurls` before
   `text/uri-list`. The standard key remains a degraded fallback. A generated
   script test pins this order because host tests cannot observe truncation in
   the browser payload.

3. **Only `file:` is usable.** Browser links, untitled editors, Deck tree
   decoration URIs, and remote URIs yield no pane input and no notification.
   Filtering happens before path extraction so unsupported schemes cannot crash
   the message handler.

4. **Path and byte routes stay disjoint.** A drop checks for a URI list first and
   returns after posting it. Without one, the existing `image/*` byte route is
   unchanged. Non-image byte drags remain unclaimed.

5. **Both routes share one framing rule.** FileDrop owns the single bracketed
   paste containing every raw path, space separated, in drag order. ADR-0054's
   live-agent measurements still govern that wire format. ImageDrop now owns only
   image materialization.

6. **Shift is documented, not emulated.** Deck receives no internal drag events
   until the user holds Shift, so it cannot render an earlier hint or bypass the
   workbench gate. Once received, a URI list or image byte item gets the same
   file-drop overlay and capture-phase claim.

## Consequences

- Explorer files, multi-selections, folders, and saved editor tabs hand a
  Terminal their real absolute paths. Explorer images use their original path,
  while Finder images still use ADR-0054's temporary copy.
- A plain shell receives the same unexecuted bracketed paste as an agent. Paths
  with spaces remain raw by the measured attachment contract; shell quoting is
  outside this decision.
- Remote SSH is intentionally unsupported until its path semantics can be
  verified; `vscode-remote:` is silently ignored.
- ADR-0054 is narrowed, not superseded: its materialization reasoning remains
  correct for an ImageDrop with bytes and no usable path.

## Status

Accepted — implemented in #179.
