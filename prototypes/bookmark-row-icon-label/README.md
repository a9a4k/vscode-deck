# Prototype: what a Bookmark row's icon and label should be

Written for a **fresh session**. Self-contained; no prior context required.
Sibling prototype: `prototypes/bookmark-row-actions/` answers *where the add
action lives*. This one answers *what the resulting row looks like*.

## The questions

Deck is adding **Bookmarks** — pinned URLs rendered as rows under a Worktree,
beside its Terminals. A row needs an icon and a label. Every comparable tool
(Arc, Chrome, Safari, and VS Code's own Integrated Browser) shows **favicon +
page title**, because they bookmark the page you already have open. **Deck pins
a URL it has never loaded**, so it has neither the title nor the favicon.

1. Can a Deck tree row render a **remote favicon** at all — and what happens
   when the fetch fails, is slow, or you are offline?
2. How often does VS Code actually **re-request** it? Deck's tree refreshes on a
   ≤2s poll while focused; a naive remote `iconPath` could mean a request every
   tick.
3. Which **icon + label pairing** reads best at real panel width?

Answer with measurements, not preference. The outcome decides a v1 scope
question: favicons ship, or a static codicon ships and favicons become a
follow-up.

## Verified already — do not re-derive

- **Fetching the page title is ruled out.** Unauthenticated GitHub returns 404
  for private repos: `https://github.com/<org>/<private>` → `HTTP 404`,
  `<title>Page not found · GitHub · GitHub</title>`. Private PR pins — the main
  use case — would be labelled "Page not found".
- **The workbench CSP permits remote images.** From the shipped
  `workbench.html`: `img-src 'self' data: blob: vscode-remote-resource:
  vscode-managed-remote-resource: https:`. So an `https:` `iconPath` is not
  blocked outright. Encoding of non-`file:` Uris has a known bug:
  <https://github.com/microsoft/vscode/issues/58145>.
- **SVG icons render black in Deck's tree.** Recorded in
  `src/tree/repositoryTree.ts`: VS Code currently renders custom tree SVGs black
  (<https://github.com/microsoft/vscode/issues/311339>), which is why the Claude
  marks ship as raster. **Prefer `.ico` / `.png` favicons; expect `.svg` ones to
  come out black.**
- **Deck's tree icons are a contributed font glyph on purpose.** Per
  `docs/icon-guidelines.md` and ADR-0047, the non-agent Terminal glyph is a font
  glyph so VS Code can theme-tint and unfocus-dim it natively. **A raster
  favicon cannot be tinted or dimmed** — that tension is E4 below.
- **VS Code's Integrated Browser stores** `{url, title, icon: faviconHash,
  time}` with a hash-keyed favicon store and GC. It captures the favicon from
  the live page — a path unavailable to Deck.
- **Never icon-only.** NN/g: icons need text labels
  (<https://www.nngroup.com/articles/icon-usability/>). Favicons are brand marks
  rather than ambiguous command glyphs, but keep the text either way.

## Scaffold (built)

`src/tree/repositoryTree.ts` has a `PrototypeBookmarkNode`, gated on
`context.extensionMode === vscode.ExtensionMode.Development` (wired in
`extension.ts`) — on automatically under F5, off for `npm test`, an
installed VSIX, or any packaged build. Nothing to flip. To see the rows:

1. `npm run watch`, then F5 → "Run Extension".
2. The active Worktree gets a set of hardcoded Bookmark rows, before its
   Terminals. The original 5: `github.com/…/pull/1`, `…/pull/2` (E5
   host-collision case), a Linear issue, `localhost:5173` (nothing
   listening — hang/offline probe), and `example.com` (no `favicon.ico` —
   404 probe). `pull/1`/`pull/2`/the Linear row now render the flat-color
   silhouette icon, not the raw favicon — see "Follow-up spike" below.
   8 more rows follow those three, comparing the silhouette technique
   ported to pure JS (no native image-processing dependency) against the
   Python/Pillow baseline across 4 favicons and 2 resize algorithms — see
   "Pure-JS port" under "Follow-up spike" for what each row is.
4. `BOOKMARK_LABEL_VARIANT` (`'P1' | 'P2' | 'P3'`) switches the icon/label/
   description pairing per the E5 table below — flip and reload to compare.
5. `faviconUrl()` builds `<origin>/favicon.ico`; swap it to try the Google
   `s2/favicons` or DuckDuckGo `icons.duckduckgo.com` services for E1.

For E2, run `node prototypes/bookmark-row-icon-label/log-server.mjs` and
point a bookmark's favicon at `http://localhost:5173/favicon.ico` (already
the default for the `localhost:5173` row — swap its URL scheme/host in
`faviconUrl()` handling if you want it to hit the log server instead of
failing to connect). Add `CACHE=no-store` to re-run without HTTP caching.

### Icon candidates (no-favicon fallback), properly sized

The active Worktree also gets 8 rows below the 5 Bookmarks, one per
placeholder-icon candidate for when there's no favicon yet: `globe`, `link`,
`link-external`, `browser`, `bookmark`, `compass`, `book`, `pin` — researched
against real codicon ids (`microsoft/vscode-codicons` mapping.json) and
against browser convention (Chrome/Firefox use a globe as their own
no-favicon fallback, which is exactly Deck's situation: a URL that's never
been loaded has no captured icon). Each renders as `$(deck-bookmark-<name>)`,
a **custom padded glyph** — not a raw `new vscode.ThemeIcon('globe')` — baked
into `resources/deck-icons.woff` by `scripts/generate-tree-icons.py` at the
same `TERMINAL_INK_SCALE` / `TREE_MIDLINE` used for `deck-terminal` (see
`docs/icon-guidelines.md`, ADR-0047). A bare built-in codicon renders larger
than Terminal/agent rows — there's no runtime size knob on `ThemeIcon`, only
this padded-glyph generation step, which is why the candidates go through it
too. `deck-bookmark-*` icon ids are PROTOTYPE-only entries in
`package.json`'s `icons` contribution; drop them (and the matching glyphs in
the generator) if this doesn't ship.

To regenerate after editing `PROTOTYPE_ICON_PATHS` in the script:
```
python3 scripts/generate-tree-icons.py
git checkout -- resources/*-padded*.png resources/*-padded*.gif  # non-deterministic re-encode noise, unrelated to this prototype
```

## Desk research (done — see table below for what still needs eyes on a running window)

Checked in this session, no VS Code window involved:

- **Format/headers for real hosts** (`curl -sSD -`): `github.com/favicon.ico`
  → `200 image/x-icon`, `cache-control: max-age=315360000` (10 years).
  `linear.app/favicon.ico` → `200 image/x-icon`, `max-age=3600`.
  `icons.duckduckgo.com/ip3/github.com.ico` → `200 image/x-icon`,
  `max-age=2592000` (30 days). `google.com/s2/favicons?domain=…` → `301` to
  an `image/png`, `max-age=1800` (30 min) — it's a redirect, not a direct
  image; renders both size and format on the fly. **If VS Code's remote-image
  loader respects standard HTTP caching, the direct-origin and DuckDuckGo
  services should not re-fetch inside a 2-minute focused window; Google's
  30-minute cache would still hold across it.** This is a strong hint for E2,
  not a substitute for it — VS Code's tree renderer is Electron/Chromium and
  I have not confirmed it goes through the same cache a plain browser
  request would.
- **Failure shapes confirmed at the HTTP layer**: a host with no favicon
  (`example.com/favicon.ico`) → `404 text/html`. A bad path on a real host
  (`github.com/does-not-exist-favicon.ico`) → `404 text/plain`. Neither
  hangs. `localhost:5173` with nothing listening fails to connect
  immediately (no hang) — the log-server script above turns that into a
  controlled request-counting target instead.

**What I could not verify without a GUI**: whether the row actually paints a
favicon vs. blank vs. broken-image glyph, request counts inside a live
`vscode.TreeItem.iconPath`, offline/airplane-mode behavior, theming/dimming,
and the E5 side-by-side read at 340px. Those need someone to run steps 1–5
above and look. I can turn a screenshot or a copy-pasted terminal log from
the log-server into the findings table and go/no-go call below.

## Running findings (from screenshots, still open: E2 hit count, a real offline reload)

- **E1**: GitHub (`.ico`) and Linear (`.ico`) favicons both render, confirming
  format support. No SVG-black-render bug hit (nothing under test is SVG).
- **E1/E4 (the actual risk)**: GitHub's favicon is a black octocat with no
  background chip — legible on light theme, **nearly invisible on dark
  theme**. Same asset, opposite outcomes, purely from VS Code's own theme.
  Linear's mark survives both themes only because it happens to ship its own
  opaque background chip, not because favicons are generally safe. Deck has
  no way to detect or compensate for this per-bookmark.
- **E4 (focus)**: comparing sidebar-focused vs. clicked-into-editor
  screenshots (same theme), the Bookmark rows looked unchanged — no visible
  dim/tint on unfocus in that comparison. Inconclusive on its own: it wasn't
  a true window-blur test, and Deck's Terminal-row dimming may be driven by
  something other than raw editor-vs-sidebar focus.
- **E5**: P1 (favicon/codicon + path-tail label + host description) wins.
  With two GitHub pins on one Worktree, P1's bold label (`pull/1` / `pull/2`)
  differentiates them at a glance; P2 and P3 both put the identical host in
  the bold label, so telling the rows apart requires reading the dimmed
  description instead. P3 is strictly dominated (P2's text problem *and*
  P1's icon-contrast risk, no upside). **But** P1's own rationale — "the
  favicon already shows which site, so the label doesn't have to" — doesn't
  hold once the favicon is illegible; in practice P1 still relies on the
  dimmed host text for site identity, same as P2/P3, just via description
  instead of label. Net: **ship P1's label/description arrangement, paired
  with a codicon (P2's icon), not a favicon** — keeps the winning text
  hierarchy without gambling on per-site favicon contrast.
- **Icon choice**: see "Icon candidates" above — `globe` recommended,
  matches Chrome/Firefox's own no-favicon fallback convention.

## Experiments

Hardcode three or four Bookmark rows under the first Worktree. **No store, no
persistence, no add flow** — this is a rendering probe.

Test URLs: `https://github.com/<some>/<repo>/pull/1`, `https://linear.app/…`,
a `http://localhost:<port>` dev server, and one host with **no** favicon.

**E1 — Does it render?**
`iconPath: vscode.Uri.parse('https://github.com/favicon.ico')` on a `TreeItem`.
Renders / blank / broken-image? Compare `.ico`, `.png`, `.svg` (expect black per
the note above). Try the Google (`s2/favicons?domain=`) and DuckDuckGo icon
services as alternates — note that those route the user's bookmark hosts through
a third party, which is a privacy fact worth recording, not just a fallback.

**E2 — Request frequency (the one that could kill it).**
Point a Bookmark at a **local server you control** and log every hit. Leave the
window focused for two minutes while the tree refreshes on its poll. Count
requests. One-and-cached is fine; one-per-refresh is disqualifying. Repeat with
`Cache-Control: no-store` to see whether the image cache is what saves us.

**E3 — Failure and offline.**
Airplane mode, a 404 favicon, and a host that hangs. What renders — blank space,
a broken glyph, layout shift, an alignment break against neighbouring Terminal
rows? Does it retry, and how often? Is there a usable fallback to a codicon?

**E4 — Theming.**
Light and dark; focused and unfocused view. Terminal rows tint and dim; a raster
favicon will not. Screenshot a Bookmark row directly above and below a Terminal
row and judge whether the mismatch reads as broken. Check midline alignment
against `docs/icon-guidelines.md`.

**E5 — Icon + label pairing, at the real ~340px secondary-sidebar width.**
Three levels of indentation, no wide window. Render all three and screenshot:

| # | icon | `label` | `description` (dimmed) |
|---|---|---|---|
| P1 | favicon | path tail (`pull/1234`) | host |
| P2 | codicon | host (`github.com`) | path tail |
| P3 | favicon | host | path tail |

P1 is the hypothesis: the favicon says *which site*, so repeating the host in
the label wastes the width — the label should say *which page*. P3 is the
redundant control. Judge with two GitHub pins on one Worktree (`…/pull/1234` vs
`…/pull/1240`), which is the case that breaks a host-only label.

## Where to touch

| file | why |
|---|---|
| `src/tree/repositoryTree.ts` | `TerminalNode` is the model to copy; also holds the SVG-renders-black note |
| `src/tree/worktreeTreeItem.ts` | `describe*TreeItem` — label / description / icon shape |
| `docs/icon-guidelines.md`, ADR-0047 | alignment and tinting constraints |

## Running it

```
npm run watch          # then F5 → "Run Extension"
```

## Deliverable

A findings table in this directory, in the style of
`prototypes/control-mode/README.md`:

| # | question | result |
|---|---|---|
| E1 | remote favicon renders? which formats? | Yes — GitHub and Linear `.ico` favicons both rendered correctly in both themes. No SVG-black-render hit (nothing tested was SVG). Format support is not the problem. |
| E2 | requests per minute at ≤2s tree refresh | **Not closed out.** Desk research only: direct-origin/DuckDuckGo favicons carry long `max-age` cache headers, so *if* VS Code's image loader honors standard HTTP caching, a 2-minute focused window shouldn't re-fetch — but this was never confirmed against a live counting server. Anyone reviving favicons must run this for real before shipping. |
| E3 | offline / 404 / hang behaviour | Partially closed. At the HTTP layer: no-favicon and bad-path 404s return fast, no hang (curl-confirmed); `localhost` with nothing listening fails to connect immediately. In the tree: rows with a failed favicon render with **no icon and no layout shift** against neighboring rows (no broken-image glyph). **Not confirmed**: a live reload while offline — the one offline screenshot taken didn't reload the window, so it only showed icons already cached from before. |
| E4 | tint + dim + alignment vs Terminal rows | **This is what actually kills favicons.** GitHub's favicon (a black octocat, no background chip) is legible on light theme and **nearly invisible on dark theme** — same asset, opposite outcomes, purely from VS Code's theme. Deck cannot detect or compensate per-bookmark. Linear's mark survived both themes only because it happens to carry its own opaque background chip, not because favicons are generally safe. Focused-vs-unfocused comparison showed no visible dim/tint either way, but wasn't a true window-blur test. |
| E5 | which pairing reads best at 340px | **P1** (icon + path-tail label + host description) wins: bold text differs (`pull/1` vs `pull/2`), so two same-host pins are distinguishable at a glance. P2 and P3 both put the identical host in the bold label — differentiation only shows up in the dimmed description, a worse scan. P3 is strictly dominated (P2's label problem *and* P1's icon-contrast risk, no upside). Caveat: P1's own rationale ("the favicon already shows the site, so the label doesn't have to") breaks once the favicon is illegible — in practice site identity still comes from the *dimmed description text*, not the icon, in every variant. |

## Go / no-go: **no-go on favicons for v1**

Killed by **E4**, not E2 or E3 — those stayed open, but E4 alone is
disqualifying: a favicon's legibility depends entirely on that site's own
icon design against whatever theme the user runs, Deck has no lever to detect
or fix it, and the failure is silent (not a crash, not a blank — just an
icon that happens to blend into the background for some fraction of sites/
themes). That risk exists even in the best case where E2/E3 come back clean.

**Ship instead**: a **codicon**, not a favicon, as the leading icon — sized
as a custom padded glyph via `scripts/generate-tree-icons.py` (same
technique as `deck-terminal`), never a bare `new vscode.ThemeIcon(id)` at
native size. Icon candidate: **`globe`** — matches Chrome/Firefox's own
no-favicon fallback convention. (Earlier concern: `docs/bookmark-follow-
ups.md` #2 previously described v1's row-hover action as a dedicated
`$(globe)` "open in default browser" button, which would've collided with
`globe` as the leading identity icon on the same row — same glyph, two
meanings. Resolved: that per-Bookmark action is superseded by a single
workspace-level action that opens everything for a Worktree at once
[Terminals, Bookmarks, etc.], so `globe` is free.) Already baked as
`deck-bookmark-globe` in `deck-icons.woff` at the right size.

Label/description arrangement at the time of this go/no-go: **P1** (bold =
path tail, dimmed = host) — see "Label arrangement, revised" in the
follow-up section below for why the final choice moved to **P4** instead.

**Follow-up** (recorded in `docs/bookmark-follow-ups.md`): E4 was revisited
in the same effort — see "Follow-up spike" below. The contrast failure (and,
further on, the resulting icon's sizing) turned out to be fixable without a
third-party icon service. Still no-go for v1; E2 and a real E3 still need to
run against real code, from scratch, since neither was actually closed out
here.

## Follow-up spike: can a favicon be made theme-safe?

E4 killed favicons for v1 on a contrast failure, not a "favicons are
hopeless" verdict. Revisited later in the same effort: is there a way to
make a favicon safe in any theme, without routing through a third party?

### Root cause, verified

- **Opacity, not theme, is the actual variable.** GitHub's `favicon.ico`
  measured 60.5% transparent pixels; Linear's measured 98.4% opaque (it
  ships its own background field). That's why Linear survived both themes
  and GitHub didn't — nothing to do with which theme was active.
- Google's `s2/favicons` (the alternate raised at the end of the original
  go/no-go above) does solve this by rendering onto an opaque canvas, but at
  the cost of routing every bookmarked host through Google — already
  flagged as a privacy concern in the desk research section above.

### `.ico` decoding is solved in pure Node

`sharp` doesn't support `.ico`. GitHub's file uses legacy raw-BMP-in-ICO
frames (confirmed via the container header bytes: `28 00 00 00` =
`BITMAPINFOHEADER`), not the simpler embedded-PNG shortcut some `.ico`
files use. `icojs` (MIT, pure JS, ~292KB, zero native binaries) decoded
GitHub's real `favicon.ico` correctly, verified in an isolated scratchpad
against the real bytes — not just documentation claims. Never added as a
real dependency; this only proves the path is open.

### Prior art, read directly

- VS Code's own built-in Simple Browser never attempts page favicon/title
  at all — its webview panel title is a hardcoded static string
  (`extensions/simple-browser/src/simpleBrowserView.ts` in
  `microsoft/vscode`), always "Simple Browser".
- `microsoft/vscode-pull-request-github`'s `DataUri.avatarCirclesAsImageDataUris`
  (`src/common/uri.ts`) already solves nearly this exact problem for author
  avatars: self-fetch, retry once then fall back to a generic icon, own disk
  cache under `context.globalStorageUri` (hash-keyed, own eviction policy),
  composite by wrapping the fetched image in a hand-built
  `<svg><image href="data:..."/></svg>` string — no canvas/`sharp` needed.
  This also confirms Deck's own SVG-black-render bug
  (`microsoft/vscode#311339`) doesn't collide with this technique: that bug
  is specific to vector paths relying on inherited `currentColor`, not to
  SVGs embedding a raster `<image>`.

### Two compositing techniques spiked (`spike-composite/composite.py`)

1. **Full-color favicon on a background chip.** Fetch → decode → composite
   onto an opaque circular chip sized/positioned like the codicon glyph
   convention (chip diameter matching `TERMINAL_INK_SCALE`, centered on the
   tree's midline fraction). Fixed the E4 contrast failure — render-verified
   in Deck's actual tree, not just theorized — but at real tree-icon size
   the favicon-inside-a-chip reads as tiny and fussy: two nested scale-downs
   (chip-in-canvas, then favicon-in-chip) leave far less ink than a plain
   glyph gets, and a full-color favicon next to a flat chip looks visually
   inconsistent beside `deck-terminal`/`deck-bookmark-globe`.
2. **Flat-color silhouette (current, better).** Drop the chip. Take the
   favicon's shape only — its alpha channel for icons with a transparent
   background (GitHub), or an Otsu luminance threshold for icons that are
   already fully opaque and encode their mark in contrast rather than alpha
   (Linear: 98.4% opaque, so an alpha mask alone degenerates to a solid
   block) — and flood-fill that shape with a single flat color matching VS
   Code's own default `icon.foreground` per theme kind. Sized at
   `BOOKMARK_INK_SCALE` (0.70 — matches `deck-terminal`'s own
   `TERMINAL_INK_SCALE`; briefly tried smaller at 0.55, but that only reads
   as "deliberately compact" in isolation — once a native-size action icon
   landed in the same row for the external-open-action follow-up, 0.55 read
   as too small by contrast, so this reverted to matching `deck-terminal`
   rather than picking a new arbitrary number), so it reads as a bold glyph
   instead of a busy raster image, and immune to the contrast problem by
   construction — a flat silhouette has no ink color of its own left to
   clash with the background.
   - Ships as a `{light, dark}` icon pair, not a single URI — unlike a
     `ThemeIcon` font glyph, a baked-in solid color can't re-tint itself
     when the active theme changes.
   - Render-verified aligned with `deck-bookmark-globe`: measured by
     pixel-diffing an actual screenshot against its background color, not
     eyeballed. Size tracked closely from the start; horizontal position
     needed a closer look — a first pass nudged the silhouette's own
     midline fraction past `TREE_MIDLINE`'s 0.6 as an empirical fudge, but
     that turned out to be compensating for the wrong side of the problem.
     Tracing it down further found a **real bug in
     `build_padded_glyph()`** (`scripts/generate-tree-icons.py`): its
     `Transform` scaled a glyph's source SVG path without first subtracting
     that path's own bbox origin, so any path not already starting at
     `(0, 0)` rendered shifted by `source_bbox_origin × scale`. Invisible
     for `deck-terminal` (its hardcoded bbox happens to start at `x=0.0`),
     very visible for `globe` (bbox starts at `(1, 1)`) — confirmed by
     diffing the two glyphs' actual vs. expected bounding boxes directly,
     not just visually. Fixed at the source (opt-in via a
     `correct_source_origin` flag, so `deck-terminal`'s own already-shipped
     glyph stays byte-for-byte unchanged); the silhouette script's midline
     fraction reverted to the plain `9.6 / 16` — no fudge needed once
     `deck-bookmark-globe` itself renders where it was always supposed to.

### Label arrangement, revised: P4, not P1

The original go/no-go shipped **P1** (bold = path tail, dimmed = host)
specifically *because* E4 made the icon illegible — P1's own rationale ("the
icon already says which site, so the label doesn't have to") couldn't
actually be trusted yet, so the dimmed host text stayed as a crutch. Once
the silhouette fix above made the icon reliably legible in both themes, that
crutch stopped being necessary: **P4** (icon + single-line label, no
description at all — the Arc-pinned-tab shape) is P1's own hypothesis,
finally safe to act on. Final decision: **P4**, no description.

### Coverage gap, quantified

Surveyed `/favicon.ico` across 20 plausible bookmark targets (following
redirects, checking content-type): 15/20 succeeded. 3/20 had no favicon at
the well-known path at all — **notion.so, figma.com, app.asana.com** —
real, common bookmark targets that would fall back to the codicon no matter
how good the contrast/sizing fix is. Private/internal tools couldn't be
surveyed this way and are plausibly worse.

### Pure-JS port: does resize quality hold up without a native dependency?

The compositing pipeline above was spiked in Python/Pillow, which resizes
the ink mask with LANCZOS. A real implementation runs in Node, where
Pillow isn't available — the two realistic options are a native dependency
(`sharp`, which doesn't support `.ico` directly but can resize once `icojs`
decodes it) or a pure-JS resize with no native binary at all. This spike
answers whether the pure-JS path is good enough to skip a native dependency
entirely.

- **`.ico` decode ports cleanly.** `icojs` (already proven against GitHub's
  real favicon.ico in Round 1 above) plus `pngjs` (pure-JS PNG encode/
  decode) reproduce `fetchIcon` → `PNG.sync.read` with no native code.
- **Crop/scale/composite math ports 1:1.** A full JS port of `ink_mask`,
  `otsu_threshold`, and the crop/center/composite steps produced a bbox and
  center matching the Python reference closely (small differences traced to
  an inclusive/exclusive bbox-edge convention difference between the two
  languages' bbox helpers, not a real positioning bug).
- **Resize quality is the actual gap.** Two hand-rolled resize algorithms
  were compared against Pillow's LANCZOS: nearest-neighbor and bilinear.
  Both are visibly rougher than LANCZOS — most noticeable on circular/
  diagonal marks (Linear's cut lines, Airbnb's curved Bélo symbol) — bilinear
  is a modest improvement over nearest but neither approaches LANCZOS's
  smoothness. GitHub's mark (mostly straight edges) held up fine in all
  three; the gap widens on curvier shapes.
- **Verified across 4 favicons, not just GitHub/Linear.** Two more were
  added specifically to exercise the *other* half of `ink_mask`'s branching
  with a different shape family: **twitter/X** (fully opaque, Otsu-threshold
  path, bold geometric glyph) and **airbnb** (transparent background,
  alpha-shape path, rounder/curvier mark). Chosen after checking that a
  candidate's alpha shape wasn't hiding a two-tone badge — vercel and
  spotify were tried first and rejected: both have an opaque circular badge
  containing a differently-colored inner mark (a white triangle, a black
  soundwave), and the alpha-shape path can only see the outer badge's
  silhouette, not the inner mark — a real limitation of the alpha-vs-Otsu
  strategy, distinct from the resize-quality question this spike was
  actually testing.
- **Scaffold (built)**: 8 more rows in `PROTOTYPE_BOOKMARKS`, after the
  original 3 favicon rows and before the no-favicon (`localhost:5173`,
  `example.com`) rows — one per (site × resize algorithm) pairing:
  `GITHUB_SILHOUETTE_ICON_PURE_JS_BILINEAR`/`_NEAREST`,
  `LINEAR_SILHOUETTE_ICON_PURE_JS_BILINEAR`/`_NEAREST`,
  `TWITTER_SILHOUETTE_ICON_PURE_JS_BILINEAR`/`_NEAREST`,
  `AIRBNB_SILHOUETTE_ICON_PURE_JS_BILINEAR`/`_NEAREST`. Same `{light, dark}`
  pre-baked data-URI-pair shape as `GITHUB_SILHOUETTE_ICON`/
  `LINEAR_SILHOUETTE_ICON`, produced by the Node port instead of
  `composite.py`. Row URLs carry a `-pure-js`/`-pure-js-nearest`/
  `-pure-js-bilinear` suffix so they're identifiable against the Python-
  baked rows above them without a description field (P4 has none).
- **Verdict: feasible, not yet the final answer.** Decoding and the
  positioning math work in pure JS with zero native dependencies. But
  neither hand-rolled resize matches LANCZOS — a real implementation
  choosing the no-native-dependency path should reach for a proper (not
  hand-rolled) JS Lanczos/Mitchell resize implementation, not this
  bilinear pass as-is, or should accept `sharp` as a native dependency if
  build/packaging allows it.

### Net verdict

Favicons are not a dead end, and the remaining visual problems (contrast,
sizing, chip ugliness) are now solved in a spike, verified via screenshots.
**Still no-go for v1** — the real added scope is an actual
fetch/decode/composite/cache pipeline, not a v1-sized change, and two
things were never empirically run against real code (only against
pre-baked bytes and desk research):

- **E2 (request frequency)** — never run against a live fetch/cache
  implementation, only reasoned about via HTTP cache headers.
- **E3 (true offline reload)** — never run against a live implementation;
  only checked cold HTTP failure shapes via `curl`.

If revisited: self-fetch → `icojs` decode → alpha-or-Otsu silhouette
extraction → recolor to `icon.foreground` per theme → own disk cache
(mirroring `vscode-pull-request-github`'s avatar pattern), then actually
run E2 and E3 against that real code before shipping. The pure-JS port
above confirms this pipeline doesn't need a native dependency for decode or
positioning — only the final resize step needs a better algorithm than the
hand-rolled bilinear/nearest passes spiked here, or `sharp` if a native
dependency is acceptable. Budget for the ~25% real-world coverage gap up
front — the codicon fallback needs to stay a first-class rendering path,
not just an error case.

## Follow-up: the Bookmark row's external-open action icon

Settled separately: the Bookmark row **keeps** an inline "open in my default
browser" action (superseding `docs/bookmark-follow-ups.md` #2's claim that a
Worktree-level open-everything action replaces it — those differ in scope, in
frequency, and in target, and an open-everything action cannot express
"externally" for one row). It just can't use `$(globe)` any more, because
`globe` is now the row's own leading icon.

**Question: which icon reads as "open this one in the browser that has my
session"?**

Verified against the shipped codicon set (`simple-browser/media/codicon.css`,
VS Code 1.133) — **there is no bare diagonal-arrow codicon**. No
`arrow-up-right`. The arrow shape lives inside `link-external`.

A bare NE arrow (↗, no container) was tried as a fifth candidate — a
self-authored glyph, since nothing in the shipped codicon set has one — but
dropped after checking actual UI convention rather than going on instinct:
a diagonal arrow escaping a small box is the near-universal "opens
externally" signifier (Bootstrap's `box-arrow-up-right`, Font Awesome's
`arrow-up-right-from-square`, Material's `open_in_new`, Apple's SF Symbols
`arrow.up.forward.square`), and it's exactly what `link-external` already
is. A bare arrow alone reads as generic direction/movement, not
specifically "leaves the app" — the box is what carries that meaning. No
reason to spend a custom glyph reproducing what a free stock codicon
already gets right.

| candidate | shape | reads as |
|---|---|---|
| `link-external` | box with an arrow escaping upper-right | "opens outside" — VS Code's own convention for leaving the app, and the near-universal one industry-wide |
| `export` | arrow leaving a container | "sends it somewhere" |
| `link` | bare chain link | "it's a URL" — says nothing about *where* it opens |
| `window` | a window outline | "opens in another window" |

### Scaffold (built)

5 rows under the active Worktree, after the composite-spike rows and before
the Terminals — same `bookmarkPrototypeEnabled` gate as the rest of this
prototype (F5 only). Each row looks exactly like a real (P4) Bookmark row —
`globe` leading icon, single-line label, no description — so its inline
action can be judged in context, not isolation. Hover a row to reveal its
candidate's inline button (`view/item/context`, `group: inline`, matched by
a distinct `contextValue` per row):

| row label | candidate |
|---|---|
| `github.com/…/pull/1` | `link-external`, custom-baked bigger (`deck-bookmark-open-external`) |
| `github.com/…/pull/2` | `export` |
| `linear.app/…/DECK-123` | `link` |
| `localhost:5173` | `window` |
| `github.com/…/pull/3 (native size)` | `link-external`, plain stock codicon, native size |

The button is a no-op stand-in (`deck.bookmarkPrototype.openExternal.*` in
`extension.ts`, shows an info message) — this is an icon-choice probe, not
the real open-externally action.

### Why these need no glyph pipeline (mostly)

Action-bar icons, not leading tree icons. The oversize problem that forced
the padded-glyph pipeline (`BOOKMARK_INK_SCALE`) applies to a row's leading
icon. Deck's existing inline buttons — `$(add)`, `$(play)`, `$(trash)` — are
plain stock codicons and render correctly, so `export`, `link`, and
`window` above needed no glyph generation at all: swap the `icon` string in
`package.json`, reload, look.

`link-external` took a detour through a glyph pipeline anyway: once it won
the shape/meaning comparison and sat in the same row as the also-enlarged
`globe` leading icon (`BOOKMARK_INK_SCALE` 0.55 → 0.70, see "Two compositing
techniques spiked" above), the native-size action icon looked small by
contrast. A custom-baked bigger version (`deck-bookmark-open-external`,
`ink_scale = 0.95`) was built to fix that — same pipeline as the leading
icon's glyphs. Reverted once compared directly, native size to custom-bigger,
in the same row (the two `link-external` rows in the scaffold above) — see
Deliverable below.

### Deliverable: **`link-external`, at native (stock) size**

`link-external` itself was never in question — it matches both VS Code's
own convention for leaving the app and the near-universal cross-industry
convention for "opens externally" (see the shape/meaning table above);
`export`, `link`, and `window` all read as plausible but weaker or more
ambiguous, and none had a reason to displace the standard.

What was still open was **size**. A custom-baked bigger glyph
(`deck-bookmark-open-external`, `ink_scale = 0.95`) was tried after the
native-size icon looked small next to the enlarged `globe` leading icon —
but compared side by side against the plain native codicon in the live
tree, **native won**: it reads as more compact and proportionate in the
row, and it's exactly what VS Code's own Simple Browser uses for the same
action (`extensions/simple-browser/src/simpleBrowserView.ts`: `title="Open
in browser"`, `codicon-link-external`, no custom sizing) — confirmed
against the real `microsoft/vscode` source, not assumed from the codicon
name alone. Final choice: plain `$(link-external)`, no glyph pipeline
needed for this icon after all. The custom-bigger glyph stays baked in
`deck-icons.woff`/`package.json` for the record (same treatment as the
rejected `export`/`link`/`window` candidates) but is not the pick.
