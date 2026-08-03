# ADR-0053: Terminal rows render from the TerminalModel; the TerminalPoll is its sole writer

## Context

The sidebar flickered: on most refreshes, most Worktree rows briefly showed
the loading spinner. A 21.6h instrumented trace (2026-07-22/23, 15
Repositories / ~30 expanded Worktrees / ~60 sessions) pinned the mechanism:

| Metric | Value |
|---|---|
| Full-tree fires | 164/day — 128 from the window-focus refresh (ADR-0052 §4), 8 external git, 8 session-set diff |
| Worktree `getChildren` fetches | 5,003/day (~30 per fire) |
| Actual terminal-list content changes | 11/day |
| Per-fetch latency inside the extension host | p50 40ms, max 551ms — zero fetches over 800ms |
| Burst spread (fire → last fetch resolved) | p50 1,650ms, p90 3,564ms, max 14,149ms |
| Bursts with rows past the spinner threshold | 183 of 195; median 23 rows each |

The spinner is VS Code's slow-twistie: a node whose `getChildren` Promise
takes >800ms gets the loading icon; a synchronous return never arms the timer
(`asyncDataTree.ts` `doRefreshNode` — the 800ms clock starts when the
*renderer* issues the request, so extension-host queueing counts). Each Deck
fetch was fast, but ~30 concurrent fetches per fire — each awaiting the
restore gate's `list-sessions` plus its own prefixed `list-sessions` —
serialize on the extension host; the burst tail routinely ran 1.6–3.5s. The
flicker cause is **fan-out queueing, not per-call slowness**; 99.8% of the
fetches re-derived unchanged rows.

ADR-0014 established that terminal rows resolve from live tmux and deleted
the persisted session-list cache, for reasons that remain correct: that cache
was a *persisted second truth*, hand-invalidated at four call sites, and the
bugs clustered in the truth/mirror seam. ADR-0014 §5 accepted async resolve
because `list-sessions` is cheap — true per call, and false at this fan-out.

## Decision

**Terminal rows render synchronously from an in-memory TerminalModel; the
TerminalPoll reconciles it; fires are scoped to the nodes whose model
entries changed.** (Domain terms: CONTEXT.md **TerminalModel**,
**TerminalPoll**.)

1. **TerminalModel.** An in-memory map worktree → terminal sessions, from
   which `getChildren` returns synchronously (no per-render subprocess — the
   sync path never arms VS Code's spinner timer). Three rules prevent
   ADR-0014's bug class from returning: never persisted (ADR-0008 §4 holds
   verbatim); single writer — only the reconciler writes, Deck's own commands
   trigger re-observation (`poll.wake()`) instead of editing entries, so no
   invalidation seam exists; tmux stays the source of truth — the model is a
   bounded-staleness read replica (≤1 tick, ≤2s focused). Tab-navigation
   uses model lookups. AgentStatus notifications also use the model normally,
   but on a miss may read one exact tmux session and match its name against the
   registered Worktrees. This notification-only fallback handles a Terminal
   created while the focus-gated poll is paused and never writes to the model.

2. **The TerminalPoll tick is the reconciler.** One unprefixed
   `list-sessions` per tick, partitioned by Deck's session-name grammar,
   diffed against the model. The tree's per-worktree listing path is deleted.
   The diff drives targeted relabels (ADR-0046) and structural add/remove;
   render-time subprocess load becomes zero. The poll remains the only
   `list-sessions` feed; a model-miss notification may additionally issue the
   exact-session lookup described above.

3. **Removals require a trusted observation.** The restore coordinator's
   taxonomy is computed from the tick's own data (0 sessions = down; only the
   anchor = bare; else restored). Only a `restored` observation may remove
   rows, prune TerminalOrders, or feed the exit sweep; `down`/`bare` leaves
   the model untouched and triggers the TerminalSnapshot restore. This
   replaces the per-render `ensureSnapshotRestored` gate (and its
   per-worktree `list-sessions`) in `getTerminalChildren`.

4. **Stable node identity; scoped fires.** Repository and Worktree nodes
   join `renderedTerminals` in identity maps, updated in place
   (render-signature pattern); `getParent` returns cached instances. Fires
   name the narrowest cached node: terminal-set change → its WorktreeNode;
   worktree-list change → its RepositoryNode; registry add/remove →
   root. Safety property making this sound: VS Code resolves fired elements
   by object reference (`extHostTreeViews` `_nodes: Map<T, TreeNode>`), so a
   fire for a never-handed-out instance is a silent no-op — harmless here,
   because an unfetched subtree re-reads the current model on expand;
   stale-on-expand is impossible.

5. **Trigger dispositions.** The window-focus full refresh (ADR-0052 §4) is
   deleted; the poll's session-set baseline now survives blur, so its first
   post-focus tick diffs against the pre-blur set — #151's
   discovery-on-refocus contract holds within one tick. Terminal commands
   `wake()` the poll. Worktree reconciles stop being render side-effects
   (`getChildren` no longer kicks background common-dir/worktree refreshes);
   they run on that repo's ExternalGitWatch event, its commands, activation,
   and manual refresh. Full-tree fires remain only for registry changes,
   view-visibility regain (reconcile-on-show; VS Code may drop refreshes
   delivered to hidden views), and `deck.refresh` — the manual escape hatch
   that bypasses everything (wake + all-repo reconcile + root fire).

6. **Worktree diffs compare the rendered projection**, not raw fields: a
   branch-checkout commit (head not rendered) is a no-op; a detached-HEAD
   move fires (its tooltip renders the short sha). No central refresh
   scheduler: with diff-gated scoped fires, the existing per-repo 250ms
   debounce suffices; the watcher additionally filters `index.lock`,
   per-worktree `index.lock`, and watchman cookies (as vscode's built-in git
   extension does, `repository.ts:470`).

7. **Decoration rollups are fed at model-write time.** The reconciler
   updates `knownTerminals`/worktree→repository mappings and fires decoration
   invalidations when it writes; the render-side `syncAgentStatusDecorations`
   calls are deleted. The regression case pinned by test: an agent status for
   a Terminal under a never-expanded Repository must still roll up to the
   visible row.

## Rejected

- **Persisted model seed for cold start.** Rendering starts empty and fills
  on the first trusted tick (during a reboot-restore, absence + the existing
  "Restoring terminals…" banner replaces spinners). A persisted seed is
  ADR-0014's deleted store.
- **First-access-async, then sync.** "Synchronous except sometimes" is the
  conditional that decays; the invariant is absolute.
- **tmux control-mode events as the feed (option D).** Still deferred per
  ADR-0014 §6 / ADR-0052: the housekeeping-session and reconnect costs stand,
  and the poll now feeds a reconciler instead of firing whole-tree refreshes
  — if the revisit trigger ever fires, the event client replaces the tick as
  the reconciler's input with no downstream change.

## Consequences

- The spinner is mechanically impossible on refresh: no Promise, no timer.
  Full-tree fires drop from 164/day to ~2 + manual.
- Accepted staleness: a Terminal killed outside Deck may linger ≤1 tick
  (≤2s focused) — the window ADR-0052 accepted for discovery, now also for
  disappearance. Deck-initiated changes appear within one wake-tick.
- Killing every session externally still resurrects from the snapshot (the
  server exits with the last session; the observation classifies `down`).
  Previously an accident of the render gate; now a written rule.
- A Switch reloads the window (`vscode.openFolder`), so no live
  active-worktree transition exists; active-repository resolution fires the
  affected RepositoryNodes only.
- `revealWithRetry` was removed after verification showed zero retries. A
  newly created Terminal is now revealed from its model-addition diff, once
  its stable tree node can be resolved.
- Verification: fresh instrumentation is added after implementation + QA,
  one comparable-workload day is traced against the table above, then the
  instrumentation is removed.

## Refines / supersedes

- **ADR-0014**: supersedes §1–3 (rows now render from an in-memory model);
  preserves and re-affirms its principles — no persisted terminal list, no
  hand-invalidated mirror — and its §6 deferral of the control-mode monitor.
- **ADR-0052**: amends §4 (refocus full refresh → baseline-across-blur diff);
  the poll-discovers decision itself is strengthened (the poll becomes the
  sole observer *and* reconciler).
- **ADR-0046**: unchanged; targeted relabels ride the same scoped-fire path.

## Validation

- VS Code (microsoft/vscode @ HEAD): 800ms slow-twistie armed only for
  Promise children (`asyncDataTree.ts` `doRefreshNode`); fired elements
  resolved by reference (`extHostTreeViews.ts` `_nodes`); root fires re-fetch
  every expanded node, element fires only that subtree; old children stay
  rendered until new ones resolve.
- Trace evidence: table above (raw log deleted with the instrumentation;
  method — JSONL trace of fires, fetch timings, and trigger labels).
- Built-in git extension (`extensions/git`): watcher lock-file filtering and
  debounce/idle-gate/supersession pipeline, the model for decision 6's
  filter.

## Status

Accepted.
