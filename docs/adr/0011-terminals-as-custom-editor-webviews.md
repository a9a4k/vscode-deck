# ADR-0011: Deck Terminals render as custom-editor webviews backed by tmux (supersedes ADR-0008 §6, §9)

## Context

ADR-0008 settled the *model* — each Deck Terminal is a single-window tmux
session on the DeckSocket (`tmux -L deck -f resources/deck.conf`), named
`wt-<sanitized(worktree.path)>__term-N`. The model is right and stays.

The *surface* it chose — attaching a VS Code terminal-in-editor to that
session via `shellPath: 'tmux', shellArgs: ['-L','deck','attach-session',
'-t','=<name>']` (§6), with reload persistence hydrated at activate time
via a name+cwd+PID liveness pass (§9, formalised by ADR-0008 §16 and
PRD #40) — turned out to be structurally fragile:

- `Terminal.creationOptions.shellArgs` is not faithfully reported after
  restoration. `terminalInstance.ts:549-558` fills `executable`/`args`
  from the default profile when the persisted `shellLaunchConfig` has no
  `executable` (which it never does — `IPtyHostAttachTarget` carries
  `id`/`pid`/`cwd`/`title`/`icon` but not `executable`/`args`). Any
  identification heuristic based on `shellArgs` is wrong by construction.
- Restored editor tabs do not reliably land in the editor area; recent
  fixes (commits 6b48f0a, 11f245e, 4a19ff2) are symptoms — VS Code's
  terminal restoration decides where the tab lives, not Deck.
- Across reboot, the pty host dies. Even with tmux-resurrect bringing
  back the `-L deck` sessions, VS Code re-launches restored tabs via the
  (overwritten default-profile) shellArgs, so the tab is attached to the
  user's default tmux server, not Deck's. PRD #40's dispose-recreate-
  reposition path papered over this, but the underlying problem is that
  the editor tab is VS Code's, not Deck's.

We want tab placement, identity, focus, snapshot, and pinned/active
state to be **Deck's** — not VS Code's-and-then-reconciled. The only
mechanism in VS Code's extension API that gives an extension ownership
of an editor tab is `CustomEditorProvider`.

Alternatives considered:

- **K. Keep ADR-0008 §6 + §9, harden the hydrator further.** PRD #40
  already pushed this approach to its limit. Each new VS Code release
  that touches terminal-restoration ergonomics is a regression vector,
  and the reboot path (dispose, recreate via Deck's attach args,
  reposition the new tab to the original strip slot) is unavoidably
  racy. Rejected: structurally fragile, ongoing maintenance tax.

- **W. Webview view (panel) only.** Render xterm.js inside a sidebar
  webview view container, not editor tabs. Rejected: kills split-screen
  workflows (one terminal per editor group), kills the "open this
  terminal in this column next to that file" intent ADR-0008 §6 was
  designed for, and is materially worse UX than what we have today.

- **C. `CustomEditorProvider` rendering xterm.js, backed by a node-pty
  child running `tmux -L deck new-session -A -s <name>`.** Selected.
  The custom editor's URI is the canonical identifier; VS Code re-resolves
  the same URI on reload; the `-A` flag makes `new-session` idempotent
  attach-or-create; xterm.js is the renderer VS Code itself uses for its
  built-in terminal so feature parity is reachable.

The decision is the *surface*, not the model. ADR-0008's tmux semantics
(§2–§5, §7, §8, §10, §11, §12, §13, §14, §15, §16-as-relates-to-
sessionName-derivation) carry forward verbatim. What changes is who owns
the editor tab and how reload is handled.

## Decision

> **Superseded in part by [ADR-0012](./0012-terminal-transport-tmux-control-mode.md),
> [ADR-0013](./0013-vscode-native-custom-editor-restore.md), and
> [ADR-0015](./0015-terminal-tab-uris-are-file-paths.md).**
> The custom-editor surface, URI identity, kill-on-dispose, and cascade all
> carry forward. What changed: the *transport* — decision 3 (one node-pty
> child per tab) and the pty-relay half of decision 4 — is replaced by a
> `tmux -C` control-mode client (`TerminalTransport`); node-pty and its
> `spawn-helper` postinstall hack are gone (ADR-0012). The reload-persistence
> mechanism in decision 8 (`TabSnapshotStore`) is deleted wholesale — VS Code
> restores custom-editor tabs natively across switches (ADR-0013). The URI
> shape in decision 2 is replaced by file-path URIs (ADR-0015). The
> `spawn-helper` consequence note below is therefore historical.

1. **Terminals are custom-editor tabs.** Register a `CustomEditorProvider`
   with `viewType: deck.terminal`. The custom editor renders an xterm.js
   webview attached to a tmux session on the DeckSocket. VS Code's
   built-in terminal-in-editor is no longer used for Deck Terminals.

2. **URI identifies a terminal as a file inside its Worktree.**
   Superseded by ADR-0015: tabs are addressed by
   `deck-terminal:/<worktreePath>/term-N`. There is no authority and no
   query. The provider's `resolveCustomEditor(document, panel)` decodes the
   URI to recover `(worktreePath, term, sessionName, cwd)`; `sessionName`
   still derives as `wt-<sanitized(worktree.path)>__term-N`, byte-identical
   to ADR-0008 §2.

3. **One node-pty child per tab, spawned through the DeckSocket wrapper.**
   On `resolveCustomEditor`, the provider mints a `TerminalPtyBridge`
   that spawns

   ```
   tmux -L deck -f resources/deck.conf \
        new-session -A -s <sessionName> -c <worktreePath>
   ```

   via node-pty. The `-A` flag makes the call idempotent: create on
   first open, attach on every subsequent open of the same URI. The
   `-L deck -f resources/deck.conf` prefix is the same `TmuxCli` flag
   convention used everywhere else in Deck (src/terminal/tmuxCli.ts:128);
   bare `tmux` is never invoked.

4. **Webview ↔ extension protocol.** Pure message schema:

   > **Historical as of [ADR-0057](./0057-terminal-context-menu-is-rendered-by-the-workbench.md).** The six messages below were the protocol at cutover; it has since grown to roughly fourteen. The code is the source of truth — no ADR restates the schema.


   ```
   Outbound (ext → webview):
     { type: 'data',   payload: string }
     { type: 'exit',   code: number }
     { type: 'config', payload: { theme, fontFamily, fontSize } }
   Inbound  (webview → ext):
     { type: 'ready' }
     { type: 'input',  payload: string }
     { type: 'resize', cols: number, rows: number }
   ```

   Encoded as JSON over `webview.postMessage`. The webview posts `ready`
   once mounted; the extension then starts the pty and begins relaying
   `data`. `input`/`resize` are forwarded to the pty unmodified. The
   bridge's `onExit` posts `exit`; the webview displays the code briefly
   and the extension disposes the panel via `panel.dispose()` (webviews
   cannot self-dispose).

   `data` and `input` payloads are UTF-8 strings. node-pty is configured
   with `encoding: 'utf8'`; non-UTF-8 binary output (rare in practice —
   `cat /dev/urandom > /dev/tty` and the like) degrades to U+FFFD
   replacement characters. Accepted as a non-issue for shell I/O.

5. **Reload reattaches by URI re-resolution, not PID matching.** VS Code
   persists `(uri, viewType)` for each custom-editor tab in workspace
   storage natively. On reload it re-invokes `resolveCustomEditor` with
   the same URI. The provider derives the same `sessionName`, spawns a
   fresh `TerminalPtyBridge` against `new-session -A`, and the pty
   attaches to the surviving tmux session. No hydrator, no PID store,
   no name+cwd heuristic. ADR-0008 §9 and §16 are superseded.

6. **Close-tab kills the tmux session.**
   > **Superseded by [ADR-0017](./0017-terminals-persist-across-tab-close.md):** close-tab now detaches and persists; only TerminalRemoval, shell `exit`, WorktreeRemoval, or RepositoryRemoval destroy a Terminal.

   Disposing the webview panel
   (user closes the tab, drag-closes the group, etc.) runs
   `tmux -L deck kill-session -t =<sessionName>` via TmuxCli. ADR-0008
   §10's lifecycle stays: inline X also kills, `exit` inside the shell
   kills the single window which kills the session which exits the pty
   which disposes the panel. The choice of *kill* over *detach* is
   deliberate — closing a terminal tab terminates its work. "Reopen by
   accident-recovery" is `+`, not zombie sessions.

7. **xterm.js owns the in-tab feel.**
   > **Narrowed by [ADR-0057](./0057-terminal-context-menu-is-rendered-by-the-workbench.md):** the *actions* live in the webview, but chrome the workbench can render is the workbench's. The context menu is contributed through `webview/context`; Cmd+F was already `deck.terminal.find`, a host command posting into the webview.

   Copy/paste, mouse selection,
   `Cmd/Ctrl+click` web links (xterm-addon-web-links), Cmd+F search
   (xterm-addon-search), scrollback inside the buffer (xterm's own,
   independent of tmux's `history-limit`), and live resize
   (xterm-addon-fit → `TerminalPtyBridge.resize` → node-pty resize →
   SIGWINCH) all live in the webview.

   **Theme via `--vscode-editor-*` CSS vars.** The earlier amendment of
   this decision claimed `--vscode-terminal-*` vars are injected into
   webviews; that was wrong. Verified empirically:
   `getComputedStyle(document.body).getPropertyValue('--vscode-terminal-foreground')`
   returns `''` inside a Deck custom-editor webview. The terminal-
   namespace colors live only inside the integrated terminal iframe.

   Webviews *do* get the editor-namespace vars, so the webview reads
   `--vscode-editor-background`, `--vscode-editor-foreground`,
   `--vscode-editorCursor-foreground`, `--vscode-editorCursor-background`,
   `--vscode-editor-selectionBackground`, and
   `--vscode-editor-selectionForeground` via `getComputedStyle` and
   feeds them to xterm.js's `theme` option at construction. The ANSI
   palette stays at xterm.js's built-in defaults, which approximate
   VS Code's default dark/light schemes. Result: the terminal matches
   the surrounding editor's background and foreground; custom themes
   that re-skin only the ANSI palette without changing the editor will
   not propagate. Worth a follow-up that posts the theme JSON's
   `colors['terminal.*']` block via the `config` message if/when ANSI-
   palette parity matters.

   A `MutationObserver` on `document.documentElement`'s `class` /
   `data-vscode-theme-kind` / `data-vscode-theme-name` triggers a re-read
   on theme change.

   **Font via `config` message.** Font family/size are *settings*, not CSS
   vars, so the extension posts a `config` message on resolve and on
   `onDidChangeConfiguration` for the relevant keys; the webview applies via
   xterm's options API. These are terminals to the user, so the resolved font
   prefers `terminal.integrated.fontFamily`/`fontSize` and falls back to
   `editor.fontFamily`/`fontSize` — matching how VS Code's own integrated
   terminal resolves its font.

8. **Per-worktree placement snapshot.** VS Code's per-folder workspace
   storage handles same-worktree reload of custom-editor tabs natively
   (decision 5). It does *not* survive SwitchOperation — a worktree
   switch reloads the window into a different folder, and the prior
   folder's custom-editor tab list is not re-played on return. Deck
   therefore captures a `TabSnapshotStore` per worktree:

   ```ts
   type WorktreeTerminalSnapshot = {
     schemaVersion: 1,
     layout: unknown,                     // executeCommand('vscode.getEditorLayout')
     tabs: Array<{
       sessionName: string,
       viewColumn: ViewColumn,
       index: number,                     // 0-based within group
       pinned: boolean,
       active: boolean,                   // exactly one true per group
     }>,
   }
   ```

   Stored in `workspaceState` under `deck.terminalSnapshot`. Capture
   runs in `worktreeSwitcher` immediately before `vscode.openFolder`;
   restore runs on activation after VS Code's native custom-editor
   restoration completes. Restore sequence: `setEditorLayout` → open
   each tab in `index` order per group via `vscode.openWith` → pin
   flagged tabs → reveal the active tab per group. Idempotent against
   tabs VS Code already restored natively (slice #46's per-window
   `Map<sessionName, panel>` intercepts duplicate `openWith` and reveals
   instead).

9. **Cross-worktree click intent is unchanged in shape.** ADR-0008 §14–
   §15's `deck.pendingTerminalOpen` flow stays: sidebar click on a row
   whose Worktree isn't mounted records the intent and triggers a
   SwitchOperation; activation post-switch consumes the intent and
   dispatches the open. The only change is the consumer dispatches
   `vscode.openWith(uri, 'deck.terminal', { viewColumn: Active })`
   against the URI minted by `SessionUriCodec`, not the old built-in-
   terminal command.

10. **Cascade closes tabs in addition to sessions.** `TerminalCascade`
    on WorktreeRemoval / RepositoryRemoval continues to kill matching tmux
    sessions; after this ADR it also closes matching Deck custom-editor
    tabs via `vscode.window.tabGroups.close(tab)`. Order: kill first,
    close tabs second. Redundant disposes are safe — `kill-session`
    against a dead session is a swallowed no-op in TmuxCli.

11. **No in-place migration of pre-cutover built-in Deck terminal tabs.**
    The cutover is atomic at the slice-#54 cleanup. Stale tabs from the
    pre-cutover surface that VS Code restores on first launch after the
    cutover remain visibly open as orphans — the new code doesn't
    recognise them, so it neither manages nor closes them. The user
    closes them manually; the underlying tmux sessions are intact on the
    DeckSocket and reachable by clicking the corresponding sidebar row,
    which opens a fresh custom-editor tab attached to the same session.
    Documented in release notes; no migration UI.

12. **What carries over from ADR-0008.** §2 (Terminal = single-window
    tmux session, naming scheme), §3 (label = `#{window_name}`), §4
    (source of truth = the DeckSocket, no Deck-side persisted list),
    §5 (lazy creation; `+` is `new-session -d -s … -n term-N -c …`),
    §7 (`.show(true)` on click — now `panel.reveal()`), §10 (lifecycle
    triggers), §11 (`deck.conf` contents), §12 (tmux ≥3.1 preflight +
    `deck.tmuxAvailable` context gating), §13 (refresh on event, not
    poll), §14 (cross-worktree click). The `Map<sessionName, vscode.
    Terminal>` of §8 becomes `Map<sessionName, vscode.WebviewPanel>`
    with the same semantics (focus-existing on re-click, clear on
    dispose).

13. **What is replaced wholesale.** §6 (attach via `shellPath: 'tmux'`)
    → replaced by `CustomEditorProvider` resolving a URI and minting a
    `TerminalPtyBridge`. §9 (reload persistence is hydrated via
    `onDidOpenTerminal` + PID liveness) → replaced by VS Code's native
    custom-editor restoration calling `resolveCustomEditor` with the
    same URI. §16 (cross-reload identification by name+cwd+PID, dispose-
    recreate-reposition) → deleted entirely; identity is the URI.

## Consequences

- **Hydrator / registry / PID store all deleted.** The PRD #40 stack
  (`EditorTerminalHydrator`, `TerminalSessionRegistry`, `workspaceState.
  deck.terminalPids`) loses its reason to exist. Atomic removal in
  slice #54.

- **Tab placement, pin, and active state are Deck's now.** The
  `TabSnapshotStore` is the source of truth across SwitchOperation;
  within a worktree, VS Code's native per-folder workspace storage is
  the source of truth. Two layers, clean handoff at switch boundary.

- **node-pty's `spawn-helper` ships without the execute bit on darwin
  prebuilds** ([microsoft/node-pty#850](https://github.com/microsoft/node-pty/issues/850)).
  Mode is 0644 in the npm tarball; `posix_spawnp` rejects it with the
  unhelpful message "posix_spawnp failed" — the failing binary is
  node-pty's own helper, not whatever you asked it to spawn. The
  symptom appears as a black terminal with no shell output. Worked
  around by a `postinstall` script that `chmod +x`'s the helper. Drop
  the workaround once upstream ships a fix.

- **xterm.js is a native dep.** Adds `@xterm/xterm`,
  `@xterm/addon-fit`, `@xterm/addon-serialize`, `@xterm/addon-web-links`,
  `@xterm/addon-search`, and the webview asset pipeline that bundles
  them. node-pty was already an implicit dep through VS Code's built-in
  terminal; it becomes an explicit dep here.

- **Feature parity with VS Code's built-in terminal is finite.** Shell
  integration markers (`OSC 633`), task runner output binding, terminal
  decorations API, terminal link providers from other extensions — none
  of these reach Deck terminals. Users wanting those keep their existing
  `vscode:${workspaceFolder}` flow on the default tmux socket, which
  ADR-0008's "two parallel tmux worlds" consequence already accommodates.

- **Reboot recovery still needs tmux-resurrect.** Custom-editor reload
  reattaches across window reloads only. If the tmux server dies, the
  sessions die with it; resurrect/continuum is the user's responsibility
  cross-reboot. Same boundary as PRD #40.

- **Multi-VS-Code-window collision unchanged.** ADR-0008's accepted
  limitation — two windows on the same Worktree both attach to the same
  single-window tmux session and share pane keystrokes — carries over
  unmodified.

- **Tests shift from end-to-end-mocked to unit.** `TerminalPtyBridge`
  and `SessionUriCodec` are deep, isolated, testable without VS Code.
  The hydrator's elaborate fake-Terminal + fake-tabGroups + fake-PID
  test scaffolding from PRD #40 is removed along with the hydrator.

## Refines

- ADR-0008. Supersedes §6, §9, §16 wholesale. §2–§5, §7–§8, §10–§15
  carry forward verbatim. The "Terminal model" decision is unchanged;
  only the "Terminal surface" changes.
- ADR-0007. The same stale-while-revalidate `globalState` cache shape
  for `list-sessions` continues to apply. `TabSnapshotStore` uses the
  same schema-version-gated `workspaceState` pattern.
- ADR-0006. Tree rows still live in the secondary sidebar; what they
  open is now a custom-editor tab instead of a built-in terminal tab.

## Validation

Two prototypes ran ahead of implementation to verify the load-bearing
claims:

- **Prototype 2** (decision 5 — URI re-resolution on reload).
  `CustomEditorProvider` restores virtual-scheme URIs across window
  reload and full quit without a `FileSystemProvider`. Tab placement
  (viewColumn, group, index, active) is preserved natively. No
  `DeckTerminalFileSystemProvider` module needed.
- **Prototype 3** (decision 6 — kill-on-dispose vs reload-reattach).
  `panel.onDidDispose` fires only on user-initiated close (Cmd+W, tab X,
  Close All, group close) and stays silent on `Developer: Reload
  Window`, full quit + reopen, and drag-between-groups. It is a clean
  discriminator on its own — no flag, no `tabGroups.onDidChangeTabs`
  cross-check, no debounce.

Results archived at `prototypes/terminal-restoration/` and
`prototypes/close-vs-reload/`. Prototype 3 also surfaced an
implementation pitfall worth recording: drag-between-groups emits
`tabs.closed` for the source tab without disposing the panel; any code
that ever listens to `tabs.closed` must cross-check against
`panel.onDidDispose` to avoid acting on drags.

## Status

Accepted.
