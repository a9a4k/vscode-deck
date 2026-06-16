# Handoff: Custom Terminal Launchers (prototype Option B)

**Status:** prototype spike. Not yet an ADR — write one only if the slot-pool/SVG
mechanism survives the spike (it's hard to reverse and surprising).

**Goal in one line:** let the user define commands that each open a new Deck
Terminal and run that command in it, surfaced as **lettered inline buttons next
to the `+` (Add Terminal) button** on a Worktree row.

## Decision so far

Framing chosen: **B — parameterized Add Terminal**, not a new domain concept and
not a Superset-style agent preset.

- A launcher is just "Add Terminal, then type one command." No new glossary term.
  CONTEXT.md gets at most a one-line note: *a Terminal may be created with an
  initial command.*
- Deck still does **not** own the agent lifecycle. If a launcher's command is
  `claude`, the existing `DECK_SESSION` env + agent-hook + snapshot machinery
  observes and resumes it exactly as today — **for free**. This is a nice
  property to preserve: send the command the same way a user would type it.
- Rejected **C (Superset agent presets)**: prompt transports / templates are
  overkill and collide with the `AgentSession` concept.

## The hard platform constraint (verified)

VS Code **cannot** render N user-defined inline buttons, each with its own custom
icon, from settings. Menu contributions are **frozen in `package.json` at install
time**; only *visibility* flexes at runtime via `when` clauses + context keys
(`setContext`). Command `icon` is restricted to a **codicon `$(name)` or a static
image path** — never arbitrary text, so a "letter" badge must be a generated
image.

Sources:
- https://code.visualstudio.com/api/extension-guides/tree-view
- https://code.visualstudio.com/api/references/contribution-points
- microsoft/vscode#110218 (dynamic submenus — still not supported)

## Option B mechanism: fixed slot pool + regenerated SVGs

Because menus are static, pre-declare a **fixed pool of slot commands** and gate
each by a count context key. Paint each slot's letter by **regenerating the SVG
file** that the slot's command icon points at.

1. **Pool of commands** in `package.json > contributes.commands`:
   `deck.launcher.0` … `deck.launcher.{MAX-1}`, each with
   `"icon": "media/launchers/slot-N.svg"` (or `{light,dark}` if needed).
2. **Pool of inline menu items** in `view/item/context`, group `inline@1X`
   (after the existing `+`), each gated:
   `view == deck.repositories && (viewItem == deck.worktree || ...active || ...main)
    && deck.tmuxAvailable && deck.launcherCount > N`.
3. **At activation + on config change:** read launchers from settings;
   - regenerate `media/launchers/slot-i.svg` to paint launcher *i*'s letter +
     color;
   - `setContext('deck.launcherCount', launchers.length)`.
4. **Handler `deck.launcher.i(node)`:** look up launcher *i*, run the
   Add-Terminal flow, then send the command (see below).

**MAX:** pick a small cap (proposed **5**). Confirm with the user; it's the count
of slot commands/menus we hard-declare.

### ⚠️ Risk #1 — spike this FIRST, before building anything else

Does rewriting `slot-i.svg`'s **contents at a fixed path** actually update the
inline button icon **without a window reload**? VS Code may cache icons by path.
If it caches, "custom letter" degrades.

- **Spike:** declare one slot command with an icon path, write an SVG with letter
  "A", render the tree; then overwrite the same file with "B" and call refresh /
  `setContext`. Does the button change?
- **If cached:** fallbacks, in order of preference:
  1. Ship 26 pre-generated static letter SVGs (`media/letters/{A..Z}.svg`) and
     **copy** `letters/X.svg → slot-i.svg` at activation (same path, may hit the
     same cache — test it).
  2. Degrade to **Option C**: generic identical codicons per slot, launcher label
     only on hover. Loses the letter but keeps inline buttons.
  3. Degrade to **Option A**: one `$(play)` button → Quick Pick of launchers
     (codicon per item shown in the picker). Unlimited, simplest, but not
     literally per-row buttons.

Also verify inline **ordering**: existing `+` (`deck.addTerminal`, group
`inline`) should stay adjacent; slot items use `inline@10`, `inline@11`, … to sit
after it. Confirm the order renders as intended.

## Proposed settings schema

Add to `package.json > contributes.configuration.properties`:

```jsonc
"deck.terminalLaunchers": {
  "type": "array",
  "default": [],
  "markdownDescription": "User-defined commands that open a new Terminal and run in it. Each appears as a lettered inline button on a Worktree row (max 5).",
  "items": {
    "type": "object",
    "required": ["label", "command"],
    "properties": {
      "label":   { "type": "string", "description": "Hover title for the button." },
      "command": { "type": "string", "description": "Shell command typed into the new Terminal." },
      "letter":  { "type": "string", "maxLength": 1, "description": "Single character painted on the button. Defaults to label[0]." },
      "color":   { "type": "string", "description": "Optional badge color (theme color id or hex)." }
    }
  }
}
```

Global (user) settings is the right scope to start — matches every other `deck.*`
setting. Per-repo/per-worktree scoping is a deferred question (below).

## How to run the command in the new Terminal

Reuse the existing creation flow, then send the command as keystrokes (same path a
user's typing takes, so hooks/snapshot observe it).

- **Create:** `src/terminal/addTerminalCommand.ts:21` `run(node)` already does
  `ensureSession` + `vscode.openWith`. Factor its body so a launcher handler can
  call it and get back the `session` name + `termN`.
- **Session creation:** `src/terminal/tmuxCli.ts:63` `ensureSession()` runs
  `tmux new-session -d -s <session> -e DECK_SESSION=<session> -c <cwd>`. The
  `DECK_SESSION` env is what makes agent observation work — unchanged.
- **Send the command:** the control client already sends keys at
  `src/terminal/tmuxControlClient.ts:164`. For a one-shot launch the simplest is a
  CLI `tmux send-keys -t <session> '<command>' Enter`. **Check** whether `tmuxCli`
  has a `sendKeys` method; if not, add a thin one. Send *after* `ensureSession`
  resolves. (Decide: send before or after `openWith`? After-create-before-open is
  fine since tmux buffers; verify nothing races the control client attach.)
- **Compare with resume injection** for the pattern: `src/agent/resumeTemplate.ts`
  + `src/agent/snapshotRewriter.ts` show how Deck templates/injects a command on
  *restore*. Launch is the simpler live-send analog; you do **not** need the
  snapshot rewriter for initial launch.

## Key files (from exploration)

| File | Role / why you'll touch it |
|---|---|
| `package.json` | add config schema, slot commands, inline menus, context-key gating |
| `src/terminal/addTerminalCommand.ts:21` | creation flow to reuse for launchers |
| `src/terminal/tmuxCli.ts:63` | `ensureSession`; add/confirm `sendKeys` |
| `src/terminal/tmuxControlClient.ts:164` | existing `send-keys` precedent |
| `src/extension.ts:175` | command registration pattern (`deck.addTerminal`) — register `deck.launcher.0..N` here |
| `src/extension.ts` (activation) | regenerate slot SVGs + `setContext('deck.launcherCount', …)`; re-run on `workspace.onDidChangeConfiguration` for `deck.terminalLaunchers` |
| `src/agent/resumeTemplate.ts`, `src/agent/snapshotRewriter.ts` | reference only — command-injection precedent |

## Build / verify

- `npm run build` (clean + tsc + copy webview assets). Add `media/launchers/` to
  the asset copy if SVGs live alongside other media — check
  `scripts/copy-webview-assets.mjs`.
- `npm run test` (vitest). Add a unit test for the SVG painter (letter → svg
  string) and for slot→launcher resolution.
- Manual: define 2 launchers in settings, confirm two lettered buttons appear,
  click each, confirm a Terminal opens and the command runs.

## First-session order of work

1. **Spike Risk #1** (SVG-contents-at-fixed-path refresh). Decide B vs fallback
   before writing the real feature. ~30 min, saves the whole approach.
2. Settings schema + read/parse launchers.
3. Slot commands + inline menus + `launcherCount` context key (start with generic
   codicons to get buttons clickable end-to-end).
4. Launch handler: factor `addTerminalCommand`, add `sendKeys`, wire command run.
5. Swap generic icons for generated lettered SVGs (only if step 1 passed).

## Deferred / open questions (don't block the spike)

- **MAX slot count** — proposed 5, confirm with user.
- **Scope** — global only for now; per-repo / per-worktree launchers later?
- **Letter caching fallback** — which degrade path if Risk #1 fails (C vs A)?
- **`cwd`** — launcher always runs in the Worktree root (inherited from
  `ensureSession -c <worktree>`). Any need to override? Assume no.
- **Restore semantics** — launch command is one-shot at creation; on reboot the
  Terminal restores as a normal Terminal (scrollback/cwd, or agent-resume if it
  ran an agent). The launch command does **not** re-run. Confirm this is the
  desired model.
