# ADR-0056: Bookmark rows interleave with Terminal rows; TerminalOrder becomes the Worktree's row order

## Context

Deck is gaining **Bookmarks** (CONTEXT.md): URLs a user pins to a Worktree,
rendered as rows beside its Terminals and opened in VS Code's Integrated
Browser. This is the first row kind Deck has added under a Worktree since
Terminals, and it arrives with an ownership model that inverts the one every
existing row has.

A Terminal's existence is owned by tmux. ADR-0014 deleted a persisted
session-list cache and ADR-0053 re-affirmed the rule — *Deck persists no
terminal list* — because that cache was a second truth, hand-invalidated at
four call sites, with the bugs clustered in the truth/mirror seam.
`TerminalOrder` (ADR-0028) survives that rule precisely because it stores
**order without existence**: `reconcileRowOrder` resolves each stored key
against its owning source and silently drops the ones neither source claims.

A Bookmark has no tmux. No process, no external registry, nothing that could
be re-observed. If Deck doesn't persist it, it doesn't exist.

The placement question was a real fork:

- **Grouped** — Bookmarks as a block above the Terminals. Keeps the two
  ownership models in separate stores, and keeps ADR-0028's append-at-bottom
  invariant untouched.
- **Interleaved** — one order spanning both kinds, so a Bookmark can sit
  between `term-2` and `term-3`.

Grouped was recommended and rejected by the product owner, whose reason was
that a Bookmark *is just another row* — a sibling of a Terminal row, not a
category. Interleaving is also what lets a dev-server preview sit directly
beside the Terminal that serves it, a pairing grouping structurally cannot
express.

## Decision

1. **Bookmark rows are siblings of Terminal rows, in one order.** No group, no
   collapsible sub-node. A Worktree's children are its rows, ordered by the
   user.

2. **`TerminalOrder` becomes the Worktree's row order.** It keeps its name
   (Terminals came first) but now holds keys of two kinds, each resolved
   against the source that owns it: a `sessionName` against the live tmux list,
   a URL against the Bookmark store. A key neither source claims is dropped.
   **No data migration** — the stored value was always an array of row keys.

3. **Deck persists Bookmark existence** in `globalState`, keyed by worktree
   path, alongside `WorktreeOrder` / `TerminalOrder`. This is *not* a breach of
   ADR-0014/ADR-0053. The invariant those ADRs protect is narrower than "never
   persist rows": **never persist a mirror of an existence owned elsewhere**,
   because a mirror needs invalidation and invalidation is where the bugs live.
   A Bookmark has no elsewhere; the store *is* the truth, so there is no seam
   to get wrong about its existence.

4. **A Bookmark's identity is its URL within its Worktree.** Pinning a URL
   already pinned there reveals and selects the existing row instead of
   creating a second.

5. **Pinning leaves row order untouched.** A pinned Bookmark is uncurated until
   the user drags a row in its Worktree. The reader places curated rows first,
   in stored order; uncurated Terminals next, by ascending `term-N`; and
   uncurated Bookmarks last, in Bookmark store insertion order. Reader-side
   placement therefore appends a new Bookmark at the bottom without making a
   partial order hide any uncurated Terminal below it.

6. **Bookmarks are portable; Terminals are bound.** A Bookmark may be dragged
   to another Worktree, which re-keys its store entry. The Terminal rule
   ("its Worktree is fixed when it is created and never changes") is a physical
   constraint — the session name encodes the worktree path and the shell has a
   working directory — not a design principle to copy. Nothing binds a URL to a
   directory except the user's say-so.

7. **Removal cascades like Terminals.** A WorktreeRemoval deletes that
   Worktree's Bookmarks, mirroring `TerminalCascade.killWorktree`. A
   `git worktree move` orphans them — exactly as it already orphans Terminals,
   whose session names encode the old path.

## Rejected

- **Grouped (Bookmarks above Terminals).** Cleanly separates the ownership
  models and needs no changes to `TerminalOrder` at all. Rejected: it imposes a
  taxonomy the user didn't ask for, and makes the preview-beside-its-server
  pairing unexpressible. Note the invariant argument cuts only one way —
  grouping Bookmarks *below* Terminals would have broken ADR-0028 by landing
  each new Terminal mid-subtree; interleaving does not, because a new Terminal
  still appends at the very bottom.
- **A collapsible "Bookmarks" sub-node.** Costs a click on every access, in an
  already three-deep tree, to save two rows of height.
- **A separate `BookmarkOrder` beside `TerminalOrder`.** Cannot express
  interleaving at all — two orders have no defined relationship to each other.
- **Keying Bookmarks by branch instead of worktree path.** Would survive a
  `git worktree move` and a remove→re-create of the same branch, and the
  *content* argues for it (a PR link is a property of a branch). Rejected
  because derived Bookmarks — the planned follow-up that computes the PR and
  ticket from the branch — read the branch at render time and need no store at
  all, so branch-shaped content does not require branch-shaped storage. Branch
  keying would also need a second key space for Detached Worktrees, which have
  no branch.

## Consequences

- **The order reconciler must be fed both sources.** `reconcileRowOrder` and
  `pruneRowOrder` require both the live Terminal and Bookmark sources. This
  prevents a call shaped around only the tmux session list from silently
  deleting **every** Bookmark key from every Worktree's order.
- **Only the reconciler removes keys from a row order; every other write is
  additive.** Removal is allowed solely behind ADR-0053's trusted-observation
  gate, where the prune already lives. Any other path — pinning, reordering,
  moving a Bookmark between Worktrees — may append or reposition keys, and must
  carry through every key it cannot currently resolve rather than rebuilding the
  order from what it happens to observe.

  This is written as an invariant because it was violated three separate times
  in the first implementation (#193, #195, #196), each in a different write
  path, each looking locally reasonable. The shape of the mistake is always the
  same: reconstructing a stored order from a live snapshot. It is silent when it
  goes wrong — a stale or empty observation quietly discards the user's
  arrangement, and the rows reappear later in fallback order with nothing to
  indicate anything was lost. A write path that needs the current rows should
  union them into the stored order, never replace it.
- Adding a Bookmark writes only its existence and leaves `TerminalOrder`
  untouched. The reader guarantees bottom placement; dragging a row later
  writes a complete visible order, including uncurated Bookmarks.
- Key spaces cannot collide: Deck's session names match `wt-…__term-N`, and a
  Bookmark key is a URL carrying a scheme.
- The tree gains rows that never disappear on their own. A Terminal dies on
  `exit`; a Bookmark leaves only by explicit removal or by its Worktree's.
- Removing a Bookmark destroys nothing outside Deck — unlike TerminalRemoval,
  which kills a live shell. The surfaced verb should not imply otherwise.
- A Worktree's rows now come from two sources with different staleness
  contracts: the TerminalModel is a bounded-staleness view (≤2s focused,
  ADR-0053), while the Bookmark store is exact and synchronous.

## Validation

- `src/tree/reconcileRowOrder.ts` — stored order resolved against live
  Terminals and stored Bookmarks, unknown keys dropped, uncurated Terminals
  appended by ascending `term-N`, then uncurated Bookmarks in store insertion
  order; confirms the overlay semantics decision 2 extends and the trap in
  Consequences.
- `src/tree/pruneRowOrder.ts` — mixed orders are pruned against both ownership
  sources, so observing only tmux cannot erase Bookmark positions.
- `src/terminal/terminalCascade.ts` — `killWorktree(worktreePath)` kills by
  session-name prefix and closes the matching tabs; the model for decision 7.
- CONTEXT.md **Terminal** — "Its Worktree is fixed when it is created and never
  changes"; the rule decision 6 deliberately does not copy.
- VS Code 1.133 shipped bundle — `workbench.action.browser.open`, arg
  `string | { url, openToSide, reuseUrlFilter, … }`, a real Electron
  `WebContentsView`, so framing headers do not apply. `engines.vscode` is
  `^1.110.0`, so the command is detected at runtime with `env.openExternal` as
  the fallback.

## Status

Accepted.
