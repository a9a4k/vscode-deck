# Manual QA — #176 + #177 + #178 + #179: FileDrop

Verifies both FileDrop routes: a Shift-drag from **inside VS Code** pastes each
real path, while an image dragged from **outside VS Code** still materializes a
copy and pastes that path. It also retains the #177 corrections (every image in a
multi-image drop, in order; loud failures; no wedged writer).

Everything here needs a real drag, which is why none of it is automated. The unit
suite covers URI-list parsing, ImageDrop materialization, and host message
handling; what it cannot cover is the webview's drag claim, the workbench's
reaction to it, and what the agent's TUI does with the pasted path.

- **#176** — claim `image/*` drags in the Terminal webview, materialize the bytes,
  bracketed-paste the raw path (ADR-0054).
- **#177** — multi-image drops attach every image in drag order; failures surface;
  a stray file at the drops path no longer wedges the writer.
- **#178** — a file dropped on the tree is ignored instead of being reported as
  a failed Repository registration.
- **#179** — Shift-drag a VS Code file, folder, or editor tab onto a Terminal and
  paste its real path; keep ImageDrop as the bytes-only fallback.

## Preconditions

- Either press **F5** → "VS Code Extension Development" after `npm run build`, or
  package and install a vsix (`npx @vscode/vsce package --out deck-<version>-qa.vsix`
  then `code --install-extension … --force` and reload). This run used the vsix, in
  the normal window rather than the Dev Host — which matters for scenario 9, since
  wedging the drops path then affects the real session and must be undone.
- Fixtures live in **`~/Documents/deck-imagedrop-qa/`**, ready to drag from Finder.
  Do not keep them under `/tmp`: the first run put them in a scratchpad there and
  the OS reaped them mid-QA — the same reaping ADR-0054 relies on for dropped
  images.

  | File | Purpose |
  | --- | --- |
  | `1-red.png`, `2-green.png`, `3-blue.png` | multi-image ordering — solid colours the agent can name back in order |
  | `My Screenshot (final).png` | spaces and parentheses in the basename |
  | `photo.jpg` | JPEG, MIME→extension mapping (`.jpg`) |
  | `diagram.svg` | unusual format — Deck must not filter it |
  | `big-noise.png` (7.3 MB) | no size cap |
  | `notes.ts` | non-image control |

- A Terminal running **Claude Code**, and a second running **Codex**.
- A third Terminal at a **plain shell** (no agent).

The drops directory is `$TMPDIR/deck-drops` for the extension host's environment.
Watch it throughout:

```sh
ls -lt "$TMPDIR/deck-drops" 2>/dev/null || ls -lt /tmp/deck-drops
```

Confirmed absent before QA starts, so anything in it came from these scenarios.

## Scenarios

### 1. Single image onto an agent Terminal (#176, the reported defect)

Drag `photo.jpg` from Finder onto the Claude Terminal's tab.

- **While dragging:** Deck's overlay ("Drop files into Terminal") appears over the
  terminal surface.
- **On drop:** the prompt shows an attachment (`[Image #1]`), **not** a path as
  text, and **no editor tab opens**.
- A file appears in the drops directory named `<epochMs>-photo.jpg`.
- Submit "describe this image in five words" — the agent answers from the image
  **without a Read tool call**. A Read call means the path was pasted as text and
  the attachment path failed.

### 2. No competing overlay (the fragile interaction with the workbench)

During scenario 1, watch the whole editor area, not just the Terminal.

- **Only** Deck's overlay may appear. VS Code's own editor drop overlay flashing
  alongside it means `stopPropagation` lost the race to VS Code's dragover
  forwarding, and the drop is one timing change away from being stolen.

### 3. Multi-image drop, in order (#177 finding 1 + 4)

Select `1-red.png`, `2-green.png`, `3-blue.png` in Finder and drag all three at
once onto the Claude Terminal.

- Three attachments appear, not one. (Before #177, only the first survived.)
- Submit "name the colour of each image in the order you received them".
- The answer is **red, green, blue**. Any other order is a #177 regression.
- Three files appear in the drops directory.

Note: Finder's own drag order is what Deck receives; if the reported order is
consistently reversed, check the Finder selection order before filing a bug.

### 4. Sanitized name, spaces and parentheses

Drag `My Screenshot (final).png`.

- Attaches normally.
- The written filename has no spaces or parentheses (e.g.
  `…-My-Screenshot-final.png`).

### 5. Format is the agent's business, not Deck's

Drag `diagram.svg`, then `big-noise.png` (7.3 MB).

- Deck claims both — the overlay appears, no editor tab opens, a file lands in
  the drops directory each time.
- Whether the agent *accepts* an SVG is the agent's call. Deck rejecting either
  one would contradict ADR-0024's no-format/no-size-policy stance.
- The large file should not visibly stall the window.

### 6. Non-image control

Drag `notes.ts` onto a Terminal.

- **No** Deck overlay.
- It opens in an editor tab, exactly as before ImageDrop existed.
- Nothing is pasted into the pane, and nothing is written to the drops directory.

### 7. Plain shell — inert, not destructive

Drag `photo.jpg` onto the shell Terminal.

- An unquoted path appears on the command line and **nothing executes**.
- Ctrl+U clears it. (Bracketed paste is why this is safe; if the shell runs
  anything, that is a serious bug.)

### 8. Codex parity

Repeat scenario 1 and scenario 3 against the Codex Terminal.

- Same results. This is what makes the agent-agnostic claim real rather than
  inherited.

### 9. Failure is loud (#177 finding 3)

Wedge the writer deliberately, with the Dev Host running:

```sh
rm -rf "$TMPDIR/deck-drops" && touch "$TMPDIR/deck-drops"     # a *file* where the directory goes
```

Drag `photo.jpg` onto a Terminal.

- A VS Code error notification appears: "Cannot attach dropped images: …".
- Nothing is pasted into the pane, and the window does not hang. Before #177 this
  spun forever in silence.

Clean up:

```sh
rm -f "$TMPDIR/deck-drops"
```

### 10. Overlay does not stick (#177 finding 5 — the unverified one)

Start dragging `photo.jpg` over a Terminal, then press **Escape** without
releasing.

- The overlay clears.
- If it stays and covers the terminal output until the next drag, the `dragend`
  listener is not firing — expected, since `dragend` fires at the drag's *source*
  node and a Finder drag has none inside the webview. ADR-0054 §8 currently claims
  this case is covered; if the overlay sticks, the fix and the ADR both need
  correcting.

Also drag an image over a Terminal and out of the VS Code window entirely — the
overlay should clear on the way out.

### 11. Known limit, not a bug

Drag an image from **VS Code's own Explorer** onto a Terminal.

- Nothing happens (the file does not attach, no editor tab opens).
- Hold **Shift** while dragging and the webview becomes droppable again — Deck
  does not yet read the URI that drag carries, so it still will not attach. This
  is the workbench-level block (microsoft/vscode#182449, #209211) and remains
  deferred.

### 13. Shift-gated drag sources

Every image fixture above comes from Finder, which is exactly the gap this
scenario closes: a drag can be blocked before the webview sees it, and Finder
drags never are.

- **13a** — take a screenshot (⌘⇧4) and drag the **floating thumbnail** onto a
  Terminal **without** Shift. The image opens in an editor tab and nothing
  attaches. Expected, not a regression: the webview receives no drag events at
  all for this source.
- **13b** — repeat holding **Shift** from the start of the drag. It attaches
  normally, and a file appears in the drops directory with the screenshot's
  sanitized name.
- **13c** — drag `photo.jpg` from Finder while holding Shift. Still attaches;
  Shift must not disturb the sources that already work.

Diagnosing 13a needs instrumentation, not observation — a build that reports each
drag phase's `dataTransfer.types` and item `kind:type` to an output channel. Without
it, "nothing happened" cannot be distinguished from "claimed but not attached",
which is the same blind spot recorded in scenario 11.

### 12. Tree ignores a dropped file (#178)

Six drags, because the guard filters by *payload* rather than by drop target — so
proving the cause is fixed means checking rows the report never mentioned, and
proving the guard is not over-reaching means checking that folder drops are
untouched.

**Registration dedupes by git common dir**, so a repo that is already registered
returns silently and looks exactly like a failure. Read the registry before
choosing a folder to drag:

```sh
sqlite3 "$HOME/Library/Application Support/Code/User/globalStorage/state.vscdb" \
  "select value from ItemTable where key='a9a4k.deck';" \
  | python3 -c "import json,sys; print(*json.load(sys.stdin)['deck.repositoryRegistry'], sep='\n')"
```

- **12a** — drag `photo.jpg` from Finder onto a **Terminal row**: no notification
  (in particular no "not a git repository"), no editor tab, no Repository added,
  and tree selection and expansion unchanged.
- **12b** — the same drag onto a **Repository row**, a **Worktree row**, and
  **empty space** below the tree. Identical silence in all three. This is the half
  a target-based guard would have missed; empty space is the least-exercised
  branch, where the drop target is undefined.
- **12c** — drag an **unregistered** git repo folder: it registers and shows
  "Added repository *X*." with Switch / Open in New Window.
- **12d** — drag a folder that is **not** a git repository (the fixtures directory
  itself works, as long as it is not inside a repo). This **must still** error with
  "Cannot add …: not a git repository." — that is the registration gesture failing
  honestly, and its disappearance would mean the filter is over-reaching.
- **12e** — drag a git repo folder **and** an image together: the folder registers,
  the image is ignored, no error.
- **12f** — drag `photo.jpg` onto an agent Terminal's **tab**: still attaches, since
  #178 must not touch ImageDrop.

### 14. Shift-drag real paths from VS Code (#179)

Use files inside the mounted Worktree so the pasted identity is visible. Hold
**Shift from the start of every drag**; without it the workbench disables the
Terminal webview.

- **14a — one Explorer file:** Shift-drag `notes.ts` onto an agent Terminal. The
  real absolute Worktree path appears in the prompt, no editor tab opens, and no
  file appears under `deck-drops`.
- **14b — ordered multi-selection:** select three files in a known order and
  Shift-drag them together. One paste carries all three real paths in that order.
- **14c — folder:** Shift-drag a folder from Explorer. Its real absolute path is
  pasted; files inside it are not expanded.
- **14d — editor tab:** Shift-drag a saved editor tab. Its real absolute path is
  pasted. Repeat with an untitled editor: the hover overlay may appear because
  drag data is protected until drop, but no path, notification, or editor tab
  follows.
- **14e — Explorer image:** Shift-drag `photo.jpg` from Explorer. The agent sees
  the original Worktree path and can attach it; no copy appears under
  `deck-drops`.
- **14f — spaced path:** Shift-drag a file below a `My Documents` folder. The
  whole raw path remains present in one bracketed paste. At a plain shell it is
  visibly unquoted and nothing executes; this is the accepted contract.
- **14g — unusable sources:** drag a browser link and a Deck Repository,
  Worktree, or Terminal row onto the tab. Each is silent: no URL or decoration
  identifier is pasted and no notification appears.
- **14h — Finder regression:** repeat scenarios 1, 3, and 6 without Shift.
  Images still materialize and attach; non-images still open in an editor tab.
- **14i — Linux parity:** repeat 14a–14h on Linux. The route has no pasteboard or
  platform branch, so results must match macOS.

## Results — 2026-08-11, Claude Code v2.1.222 + Codex (gpt-5.6-sol), vsix build

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Single image, agent Terminal | **PASS** — attachment chip, no Read tool call, written bytes identical to the source, name shape `<epochMs>-<stem><ext>` |
| 2 | No competing overlay | **PASS** — Deck's overlay appeared; VS Code's never did |
| 3 | Three images, in order | **PASS** — red/green/blue as dropped, though the files completed writing blue/red/green |
| 4 | Sanitized filename | **PASS** — `My Screenshot (final).png` → `…-My-Screenshot-final.png` |
| 5a | 7.3 MB PNG, no cap | **PASS** — attached, byte-identical, no stall |
| 5b | SVG | **PASS for Deck** — materialized and pasted; both agents declined it inline, and Codex then read the path with its file tools |
| 6 | Non-image opens an editor tab | **PASS** — no overlay, tab opened, nothing pasted, nothing written |
| 7 | Plain shell inert | **PASS** — unquoted path on the command line, nothing executed |
| 8 | Codex parity | **PASS** — single and multi-image both attach |
| 9 | Wedged writer reports an error | **PASS** — "Cannot attach dropped images: EEXIST … mkdir '…/deck-drops'", nothing pasted, no hang |
| 10 | Overlay clears on Escape | **PASS** |
| 11 | Explorer drag is a no-op | **PASS** for the plain drag. The Shift variant has **no observable effect** and cannot have one: Deck does not claim URI-carrying drags, so "Shift restored the iframe and Deck ignored it" is indistinguishable from "Shift did nothing". Checking it would need the workbench's own overlay as a proxy, or webview instrumentation. |

### Results — scenario 13, 2026-08-12, published 0.21.0

| # | Scenario | Result |
| --- | --- | --- |
| 13a | Screenshot thumbnail, no Shift | **Blocked** — image opens in an editor tab; the webview receives no drag events (measured) |
| 13b | Screenshot thumbnail + Shift | **PASS** — arrives as `file:image/png` at dragenter and attaches on the shipped predicate |
| 13c | Finder drag + Shift | **PASS** — unaffected |

### Results — #178, 2026-08-12, vsix build

| # | Scenario | Result |
| --- | --- | --- |
| 12a | File on a Terminal row | **PASS** — silent; no notification, no tab, nothing registered |
| 12b | File on Repository / Worktree rows and empty space | **PASS** — identically silent on all three |
| 12c | Unregistered repo folder still registers | **PASS** — registered with the post-add prompt |
| 12d | Non-repo folder still errors | **PASS** — "not a git repository" preserved, so the filter is not over-reaching |
| 12e | Mixed folder + image drop | **PASS** — folder registered, image ignored, no error |
| 12f | ImageDrop on the tab unaffected | **PASS** |

### Results — #179, 2026-08-13, vsix build (after the uri-list key fix)

| # | Scenario | Result |
| --- | --- | --- |
| 14a | One Explorer file | **PASS** — real absolute path pasted, no editor tab, nothing written to the drops directory |
| 14b | Ordered multi-selection | **PASS** — one paste, all three real paths, in drag order |
| 14c | Folder | **PASS** — the folder's own path, contents not expanded |
| 14c′ | Two folders together | **PASS** — both paths. Only the uri-list key can express this; `resourceurls` omits directories entirely |
| 14d | Saved editor tab, then untitled | **PASS** — real path (a file *outside* the mounted Worktree, so the route is not workspace-scoped); untitled pastes nothing |
| 14e | Explorer image | **PASS** — the agent attached it and reported the **original** repo path; no copy under `deck-drops` |
| 14f | Spaced path | **PASS** — `…/My Documents/spaced notes.ts` whole and raw, spaces in both directory and filename |
| 14g | Unusable sources | **PASS** — `https:` (link dragged from a page), `untitled:`, and `deck-status:` all silent. The overlay flashes on each, as designed: drag data is protected until drop, so the overlay promises Deck will take the drop, not that anything will attach |
| 14h | Finder regression, no Shift | **PASS** — single image and three images still materialize copies and attach in drag order; `notes.ts` shows no overlay and opens an editor tab |
| 14i | Linux parity | Not run |

Dragging a browser **tab** cannot be tested: that is a window-detach gesture and
delivers no payload. A link dragged from inside a page is the equivalent, and is
what 14g used.

Scenario 3's recorded baseline (red/green/blue) was taken with Finder sorted
ascending; this run's Finder was sorted descending and the paste order matched
the display order exactly. Deck preserves the order the OS hands it — the
scenario's own note about checking Finder's selection order first is the reason
this was not filed as a regression.

### Found by this QA run

**A batch was pasted as one paste per image, and that is wrong twice over.**
Visible first in a mixed batch as `…-diagram.svg[Image #2]` — a declined SVG's
path abutting the next payload, which merges two declined paths into one unusable
token. The first fix batched the pastes into a single write and made it worse: the
agent then lost the *first* path's text entirely. Both failures and the measurements
are in ADR-0054 §8; the shipped shape is **one bracketed paste carrying every path,
space separated**, which attaches every recognized image and leaves every declined
path readable.

Re-verified after the fix: two dropped SVGs arrive as two whole paths, and a
five-file drop (2 attachable images, 2 declined SVGs, 1 non-image) attaches two,
leaves both SVG paths readable, and ignores the non-image.

Neither the unit suite nor design review caught the original defect, and the first
fix's regression was caught only by dragging again — the webview script is asserted
as a rendered string, so nothing automated sees what reaches the pane.

**Timestamps do not disambiguate a batch.** All images in one drop share a
millisecond, so filename uniqueness comes from the stems, and the collision suffix
only matters for two identically-named images dropped together.

**Removing an attachment does not remove the temp file.** Deck materializes on
drop; the agent discarding the chip afterwards is invisible to it. Orphans are by
design — the OS reaps them.

**A declined format leaves a bare path in the prompt.** ADR-0024's no-format-policy
stance means Deck cannot know what an agent ingests, so this stays. Milder than it
looks: the path is still a working handle the agent can read.

**#179 shipped reading the wrong key, and the whole feature was dead.** The webview
read `resourceurls`, which carries a **JSON array** of URI strings rather than
uri-list grammar. Parsed as a uri-list it gave `Uri.parse` the scheme `["file`,
which throws, so every drag carrying that key — one file, several files, an editor
tab, an Explorer image — rejected the host's message handler and pasted nothing.
Only folder drags worked, by falling through to the truncated `text/uri-list`, and
a multi-folder drag silently kept just the first.

The full suite passed throughout. The unit tests fed only well-formed uri-lists,
and the one generated-script assertion added specifically to guard the key
preference had pinned the wrong key — so nothing anywhere saw the format the
webview actually read. **A test that asserts a format should be fed the bytes the
producer really emits**, which for a browser payload means the measured string,
not a hand-written example of the format it was assumed to be.

Agents attach a real path exactly as they attach a temp copy (14e), so routing
Explorer images through the path route costs nothing and drops the copy entirely.
