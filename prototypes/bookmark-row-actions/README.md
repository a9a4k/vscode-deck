# Handoff: prototyping the Worktree row's action affordances for Bookmarks

Written for a **fresh session**. Everything needed is here; no prior context
required.

Sibling prototype: `prototypes/bookmark-row-icon-label/` answers what the
resulting row *looks like* (favicon feasibility, label shape). Both touch
`package.json` and `src/tree/worktreeTreeItem.ts` — don't run them in the same
working tree at the same time.

## The one question

Deck is adding **Bookmarks** — pinned URLs that render as rows under a Worktree,
beside its Terminals. Adding one needs an entry point. The Worktree row already
carries two inline buttons:

| command | icon | tooltip | menu group |
|---|---|---|---|
| `deck.addTerminal` | `$(add)` | Add Terminal | `inline` |
| `deck.runLauncher` | `$(play)` | Run Terminal Launcher | `inline@5` |

**Where does "Add Bookmark…" go?** Build the variants below in the real
extension, use them, and report back. Do not settle it by argument — that is
what this prototype exists to replace.

## Frozen decisions — do not re-litigate

Settled in a design session; the prototype is about *affordance placement only*.

- **Bookmark** is the domain term (now in `CONTEXT.md`, with an `_Avoid_` list).
  Not "browser row", not "favorite", not "pin".
- Scope is **per-Worktree**, hand-pinned. Repository-level and derived
  (PR-from-branch) Bookmarks are follow-ups.
- **Identity is the URL** within a Worktree — pinning a duplicate reveals the
  existing row rather than creating a second.
- Rows are **interleaved** with Terminal rows, not grouped. `TerminalOrder`
  generalises into the Worktree's row order: one overlay keyed by
  `sessionName` *or* URL, resolved against two existence sources (live tmux;
  the Bookmark store). Stored values stay valid — today's arrays are already
  row keys, so there is no data migration.
- **Click opens VS Code's Integrated Browser.** The Bookmark row **keeps** its
  own inline "open in default browser" action, at **`$(link-external)`, native
  (stock) size** — the cross-industry convention, and exactly what VS Code's own
  Simple Browser uses for this action. (A Worktree-level "open everything"
  action was floated as a replacement and rejected: different scope, frequency
  and target. It remains an un-grilled idea — see
  `docs/bookmark-follow-ups.md` #2.) Per-Bookmark targeting is a follow-up.
- Row shows **icon + label only, no description** ("P4"): `pull/1234`, leading
  `globe` codicon baked as a custom padded glyph at `BOOKMARK_INK_SCALE = 0.70`
  (matching `deck-terminal`'s `TERMINAL_INK_SCALE`). **No favicons** in v1 —
  settled by `prototypes/bookmark-row-icon-label/`.
- Bookmarks persist in **`globalState`, keyed by worktree path** — same store as
  `WorktreeOrder` / `TerminalOrder`, so the row order and the rows it references
  can never disagree about which Bookmarks exist.

> **⚠ These variants are stale on one point.** All five give `deck.addBookmark`
> the icon `$(globe)`, chosen before the row's icons were decided. Two glyphs
> are now taken on a Bookmark row: **`globe`** is its leading icon and
> **`link-external`** is its open-externally action. Variants b/d/e would put a
> globe button on the Worktree row directly above child rows wearing globe
> icons. Re-pick the add-button icon — `$(add-link)`, `$(link)` and
> `$(star-empty)` are all still free — before judging those three on looks.

Related reading: `CONTEXT.md` (Bookmarks section), `docs/bookmark-follow-ups.md`,
ADR-0043 (launchers via Quick Pick), ADR-0028 (order overlay), ADR-0047 (tree
icons).

## What the owner actually does (corrects a wrong assumption)

The first analysis assumed New Terminal is the dominant action and the launcher
is the variant — the classic split-button shape. **That is backwards for this
user:** they open Claude or Codex *through a launcher*, so `deck.runLauncher` is
the hot path and the bare `$(add)` terminal is comparatively rare.

This matters. If the dominant action already costs button + pick, then folding
Bookmarks into that same pick is nearly free, and variant **C** below stops
being obviously wrong. Prototype accordingly — and while you are in there, note
whether the primary/variant assignment itself is mis-cast.

## Variants to build

**A — Context menu only (no new chrome).**
`Add Bookmark…` in `view/item/context` group `navigation`, alongside Switch /
Open in New Window / Delete Worktree…. Two inline buttons unchanged. Free
Command Palette entry.

**B — Third inline button.**
`deck.addBookmark` with `$(add-link)` or `$(globe)` as `inline@6`. Exactly at
VS Code's stated cap of three actions per item; leaves zero headroom.

**C — One sectioned menu.**
Drop `$(add)`. A single button opens a Quick Pick with separators:
`Terminal` (New Terminal, then launchers) / `Bookmark` (Add Bookmark…).
`runLauncherCommand.ts:106` already builds separators, so this is a small edit.
Costs the bare New Terminal a selection — cheap if launchers dominate.

**D — Two buttons, re-cast.**
Keep two, but re-assign: button 1 = the sectioned "open something here" pick
(C's menu), button 2 = `$(globe)` Add Bookmark. Tests whether Bookmark
authoring deserves permanent real estate at all.

**E — One flat menu.** *(not in the original brief; added by the prototyping
session)* One button, but the pick has no section chrome at the top: New
Terminal and Add Bookmark… sit as the first two entries, launcher groups follow
under separators. Answers the correction above directly — both primaries are
visible, and the launcher list stays one glance below without scrolling past
headers.

## Built variants

Each is a standalone patch against the current tree — `git apply
prototypes/bookmark-row-actions/variant-x.diff`, run, then `git checkout .`
before the next. All stub `deck.addBookmark` as `showInputBox` +
`showInformationMessage`; no store, no rows.

| diff | shape |
|---|---|
| `variant-a.diff` | context menu only, `navigation@3`; inline buttons untouched |
| `variant-b.diff` | third inline button, `$(globe)` at `inline@6` |
| `variant-c.diff` | one `Open…` button → sectioned pick (*Terminal* / *Bookmark*) |
| `variant-d.diff` | two buttons — sectioned pick + `$(globe)` at `inline@6` |
| `variant-e.diff` | one `Open…` button → flat pick, both primaries on top |

Worth trying while you are there: **New Terminal as the first item in the
launcher Quick Pick**. The split-button pattern says mirror the primary as the
menu's first entry so keyboard and screen-reader users get the same options.
Deck does not do this today. Logged as follow-up #6 — but it changes how C and D
*feel*, so build it into them.

## Hard constraints — verified, don't re-derive

- **Max three actions per tree item.** VS Code UX guidelines, Tree Views,
  ❌ Don't list, verbatim: *"Add more than three actions to an item"*.
  <https://code.visualstudio.com/api/ux-guidelines/views>
- **`inline`-group items do not appear in the context menu.** That is why the
  Worktree's right-click menu holds only Switch / Open in New Window / Delete
  today, and why A costs nothing visually.
- **No per-row dynamic menu buttons.** VS Code cannot render a button per
  launcher on a row — this is precisely why ADR-0043 chose a Quick Pick.
- **Width is the real cost.** The Deck view sits in the secondary sidebar
  (~340px). At three indent levels, Worktree labels already truncate *at rest*
  (`ins-4568-migrate-signup-api-to-au…`). Inline icons render over the label
  while hovering — exactly when it is being read. Screenshot each variant at the
  real panel width; do not judge on a wide window.
- **`when` clauses need all four Worktree contextValues:** `deck.worktree`,
  `deck.worktree.active`, `deck.worktree.main`, `deck.worktree.main.active`
  (see the existing `deck.addTerminal` clause in `package.json`).
- **Opening the Integrated Browser** (verified against the shipped 1.133
  bundle): `workbench.action.browser.open`, arg
  `string | { url, openToSide, reuseUrlFilter, … }`. It is a real Electron
  `WebContentsView`, so `X-Frame-Options` / `frame-ancestors` do **not** apply —
  github.com renders fine, unlike in a webview. `reuseUrlFilter` focuses an
  already-open tab instead of duplicating it; `.openExternal` is its external
  sibling, though `vscode.env.openExternal` is the plainer API.
- **Version gate.** `engines.vscode` is `^1.110.0`; the Integrated Browser is
  much newer. Detect the command, don't assume it. For prototyping, a stub
  `showInformationMessage` is fine — the pick/menu shape is what is under test.
- **The Integrated Browser has its own cookie jar**
  (`workbench.browser.dataStorage`, forced to `ephemeral` in an untrusted
  workspace). Authenticated sites will show signed-out inside VS Code until you
  sign in there once. Expected; not a bug in the prototype.

## Where to touch

| file | why |
|---|---|
| `package.json` → `contributes.menus["view/item/context"]` | the whole A/B/D difference lives here |
| `src/terminal/runLauncherCommand.ts` | Quick Pick + separators for C/D (`toQuickPickItems`, `groupItems`) |
| `src/tree/repositoryTree.ts` | node kinds; `RepositoryTreeNode` union, `TerminalNode` is the model to copy |
| `src/tree/worktreeTreeItem.ts` | `describe*TreeItem` label/description/contextValue |
| `src/tree/nodeRegistry.ts` | node identity/lookup |

A throwaway `deck.addBookmark` that only calls `showInputBox` +
`showInformationMessage` is enough — **no store, no rows, no persistence.**
Resist building the feature; this is about the entry point.

## Running it

```
npm run watch          # then F5 → "Run Extension"
```

`.vscode/launch.json` also has *Run Extension (fresh machine)* and *(no agents)*
if a clean profile helps. `npm test` is vitest; `npm run typecheck` is tsc.

## Deliverable

A findings table in this directory, in the style of
`prototypes/control-mode/README.md` — one row per variant:

| variant | time to pin a URL | cost to the hot path (launcher) | label width at 340px | discoverable without being told? | headroom left |

Then a recommendation with the reasoning, and screenshots at real panel width.
Report the answer, not a preference.
