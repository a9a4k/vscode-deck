#!/usr/bin/env python3
"""
SPIKE (prototypes/bookmark-row-icon-label) — not shipped code.

Proves the compositing step: fetch a favicon, decode it, take its alpha
shape, and flood-fill that silhouette with a single flat theme-matched
color — turning it into a glyph-like icon that's both readable at
tree-icon size and immune to the transparent-favicon dark-theme contrast
failure (GitHub's octocat), without routing through a third-party favicon
service (Google's s2/favicons, which composites for us but sends every
bookmarked host to Google).

Run: python3 prototypes/bookmark-row-icon-label/spike-composite/composite.py
Outputs PNGs into this directory for visual inspection.
"""
from __future__ import annotations

import io
import urllib.request
from pathlib import Path

from PIL import Image

OUT = Path(__file__).parent

SITES = {
    "github": "https://github.com/favicon.ico",   # transparent — the failing case
    "linear": "https://linear.app/favicon.ico",    # already opaque — control
}

CANVAS_SIZE = 32
# A chip-behind-the-favicon fixed the dark-theme contrast problem, but at
# actual tree-icon size the favicon-within-a-chip reads as tiny and fussy
# next to deck-terminal/deck-bookmark-globe's bold single-color glyphs — two
# nested scale-downs (chip-in-canvas, then favicon-in-chip) shrink the ink to
# a fraction of what a plain glyph gets. Drop the chip: take the favicon's
# alpha shape only (its silhouette) and flood-fill it with a single flat
# color, exactly like a font glyph. That's also a second, simpler fix for
# the contrast problem — a flat-colored silhouette has no ink color of its
# own to clash with the background, unlike the original multi-color favicon.
# Matches BOOKMARK_INK_SCALE in scripts/generate-tree-icons.py. Was 0.55
# ("noticeably smaller than deck-terminal's own 0.70") — reverted once a
# native-size action icon in the same row made 0.55 read as too small by
# contrast; back to matching deck-terminal's ink scale instead of picking
# a new arbitrary number.
ICON_INK_SCALE = 0.70
# TREE_MIDLINE in scripts/generate-tree-icons.py (9.6/16 = 0.6, not 0.5) sits
# deck-terminal/deck-bookmark-globe's ink right of true center to clear the
# tree's indent guide. An earlier round measured deck-bookmark-globe's own
# rendered position sitting past this fraction and "fixed" it here with an
# empirical 0.665 fudge — traced since to a real bug in
# build_padded_glyph() (a missing subtraction of the source SVG path's own
# bbox origin before scaling, which shifted globe right by exactly
# source_bbox[0] * scale). That's fixed at the source now, so
# deck-bookmark-globe lands exactly on 0.6 — this constant reverts to the
# plain formula instead of carrying a compensating fudge for a bug that no
# longer exists.
MIDLINE_FRACTION = 9.6 / 16
# Matches VS Code's own default `icon.foreground` per theme kind, so a
# flat-colored favicon silhouette blends with native codicons instead of
# introducing a third, arbitrary color.
SILHOUETTE_COLORS = {
    "dark-theme": (197, 197, 198, 255),   # icon.foreground, Dark+ theme
    "light-theme": (66, 66, 66, 255),     # icon.foreground, Light+ theme
}


def fetch(url: str) -> Image.Image:
    with urllib.request.urlopen(url, timeout=5) as resp:  # noqa: S310 — spike only
        data = resp.read()
    return Image.open(io.BytesIO(data)).convert("RGBA")


def tight_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    bbox = img.getchannel("A").getbbox()
    return bbox if bbox is not None else (0, 0, img.width, img.height)


def otsu_threshold(gray: Image.Image) -> int:
    hist = gray.histogram()
    total = sum(hist)
    sum_total = sum(i * h for i, h in enumerate(hist))
    weight_bg, sum_bg, best_variance, threshold = 0, 0, 0.0, 0
    for level, count in enumerate(hist):
        weight_bg += count
        if weight_bg == 0:
            continue
        weight_fg = total - weight_bg
        if weight_fg == 0:
            break
        sum_bg += level * count
        mean_bg = sum_bg / weight_bg
        mean_fg = (sum_total - sum_bg) / weight_fg
        variance = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
        if variance > best_variance:
            best_variance, threshold = variance, level
    return threshold


def ink_mask(icon: Image.Image) -> Image.Image:
    """Alpha shape for icons with a transparent background (GitHub); for
    icons that are already fully opaque (Linear — the mark lives in
    luminance contrast, not alpha) an alpha-only mask would just be a solid
    block, so fall back to Otsu-thresholding the flattened grayscale and
    keeping whichever side of the split is the minority (the mark, not the
    field it sits on). Gate on the *fraction* of transparent pixels, not
    just whether any exist — a handful of anti-aliased rounded-corner
    pixels (Linear's favicon has a few) would otherwise wrongly trip the
    alpha-shape path on an icon that's actually opaque.
    """
    alpha = icon.getchannel("A")
    transparent_fraction = sum(1 for a in alpha.getdata() if a < 128) / (alpha.width * alpha.height)
    if transparent_fraction > 0.15:
        return alpha

    gray = icon.convert("RGB").convert("L")
    threshold = otsu_threshold(gray)
    dark_count = sum(c for level, c in enumerate(gray.histogram()) if level <= threshold)
    is_dark_minority = dark_count <= gray.width * gray.height / 2
    cutoff = threshold
    return gray.point(lambda p, cutoff=cutoff: 255 if (p <= cutoff) == is_dark_minority else 0)


def recolor_silhouette(icon: Image.Image, rgba: tuple[int, int, int, int]) -> Image.Image:
    mask = ink_mask(icon)
    bbox = mask.getbbox() or (0, 0, mask.width, mask.height)
    alpha = mask.crop(bbox)
    scale = (CANVAS_SIZE * ICON_INK_SCALE) / max(alpha.width, alpha.height)
    target = (round(alpha.width * scale), round(alpha.height * scale))
    alpha = alpha.resize(target, Image.Resampling.LANCZOS)

    silhouette = Image.new("RGBA", target, rgba)
    silhouette.putalpha(alpha)

    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    center_x = CANVAS_SIZE * MIDLINE_FRACTION
    center_y = CANVAS_SIZE / 2
    left = round(center_x - target[0] / 2)
    top = round(center_y - target[1] / 2)
    canvas.alpha_composite(silhouette, (left, top))
    return canvas


def main() -> None:
    for name, url in SITES.items():
        icon = fetch(url)
        alpha = icon.getchannel("A")
        is_transparent = alpha.getextrema()[0] < 255
        print(f"{name}: fetched {icon.size} {icon.mode}, transparent={is_transparent}")

        icon.resize((CANVAS_SIZE, CANVAS_SIZE)).save(OUT / f"{name}-raw.png")
        for theme_name, rgba in SILHOUETTE_COLORS.items():
            silhouette = recolor_silhouette(icon, rgba)
            out_path = OUT / f"{name}-{theme_name}.png"
            silhouette.save(out_path)
            print(f"  -> {out_path.name} ({out_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
