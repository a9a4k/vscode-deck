#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.transform import Transform
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from PIL import Image, ImageSequence


ROOT = Path(__file__).resolve().parents[1]
RESOURCES = ROOT / "resources"

SLOT = 96
SOURCE_SLOT = 16
TREE_MIDLINE = 9.6 / SOURCE_SLOT * SLOT
TAB_MIDLINE = SLOT / 2
DEFAULT_INK_SCALE = 0.80
TERMINAL_INK_SCALE = 0.70

# Codicons terminal glyph path. Source: microsoft/vscode-codicons, MIT.
TERMINAL_PATH = (
    "M13.5 1H2.5C1.1 1 0 2.1 0 3.5v9C0 13.9 1.1 15 2.5 15h11c1.4 0 "
    "2.5-1.1 2.5-2.5v-9C16 2.1 14.9 1 13.5 1zM15 12.5c0 .8-.7 "
    "1.5-1.5 1.5h-11C1.7 14 1 13.3 1 12.5v-9C1 2.7 1.7 2 2.5 "
    "2h11c.8 0 1.5.7 1.5 1.5v9zM4.1 11.7l3-3c.4-.4.4-1 0-1.4l-3-3-"
    ".7.7L6.3 8 3.4 11l.7.7zM8 11h5v1H8v-1z"
)

# Codicons globe glyph path. Source: microsoft/vscode-codicons, MIT.
GLOBE_PATH = (
    "M8 1C4.141 1 1 4.141 1 8C1 11.859 4.141 15 8 15C11.859 15 15 11.859 "
    "15 8C15 4.141 11.859 1 8 1ZM8 14C7.422 14 6.686 12.906 6.288 11H9.713C"
    "9.315 12.906 8.579 14 8.001 14H8ZM6.121 10C6.044 9.392 6 8.723 6 8C6 "
    "7.277 6.044 6.608 6.121 6H9.878C9.955 6.608 9.999 7.277 9.999 8C9.999 "
    "8.723 9.955 9.392 9.878 10H6.121ZM2 8C2 7.299 2.121 6.626 2.343 6H5.121"
    "C5.041 6.656 5 7.332 5 8C5 8.668 5.041 9.344 5.121 10H2.343C2.121 9.374"
    " 2 8.701 2 8ZM8 2C8.578 2 9.314 3.094 9.712 5H6.287C6.685 3.094 7.422 "
    "2 8 2ZM10.879 6H13.657C13.879 6.626 14 7.299 14 8C14 8.701 13.879 9.374"
    " 13.657 10H10.879C10.959 9.344 11 8.668 11 8C11 7.332 10.959 6.656 "
    "10.879 6ZM13.195 5H10.722C10.516 3.938 10.199 2.98 9.775 2.268C11.228 "
    "2.719 12.446 3.707 13.195 5ZM6.226 2.268C5.802 2.98 5.484 3.938 5.279 "
    "5H2.806C3.556 3.707 4.774 2.718 6.226 2.268ZM2.805 11H5.278C5.484 "
    "12.062 5.801 13.02 6.225 13.732C4.772 13.281 3.554 12.293 2.805 11ZM"
    "9.774 13.732C10.198 13.02 10.516 12.062 10.721 11H13.194C12.444 12.293"
    " 11.226 13.282 9.774 13.732Z"
)


@dataclass(frozen=True)
class RasterAsset:
    source: str
    tree: str
    tab: str
    ink_scale: float = DEFAULT_INK_SCALE
    knockout_white: bool = False


RASTERS = [
    RasterAsset(
        "claude-less-wide.png",
        "claude-code-padded.png",
        "claude-code-padded-center.png",
        knockout_white=True,
    ),
    RasterAsset(
        "claude-working.gif",
        "claude-working-padded.gif",
        "claude-working-padded-center.gif",
        ink_scale=0.74,
    ),
    RasterAsset("codex-code.png", "codex-code-padded.png", "codex-code-padded-center.png"),
    RasterAsset("codex-working.gif", "codex-working-padded.gif", "codex-working-padded-center.gif"),
]


def main() -> None:
    for asset in RASTERS:
        generate_raster(asset, asset.tree, TREE_MIDLINE)
        generate_raster(asset, asset.tab, TAB_MIDLINE)
    generate_terminal_font()


def generate_raster(asset: RasterAsset, output_name: str, midline: float) -> None:
    source = Image.open(RESOURCES / asset.source)
    frames = [prepare_frame(frame, asset.knockout_white) for frame in ImageSequence.Iterator(source)]
    bbox = union_bbox(frames)
    if bbox is None:
        raise ValueError(f"{asset.source} has no visible pixels")

    width = bbox[2] - bbox[0]
    height = bbox[3] - bbox[1]
    scale = (SLOT * asset.ink_scale) / max(width, height)
    target_width = round(width * scale)
    target_height = round(height * scale)
    left = round(midline - target_width / 2)
    top = round(TAB_MIDLINE - target_height / 2)

    rendered = []
    for frame in frames:
        crop = frame.crop(bbox)
        resized = crop.resize((target_width, target_height), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (SLOT, SLOT), (255, 255, 255, 0))
        canvas.alpha_composite(resized, (left, top))
        rendered.append(canvas)

    output = RESOURCES / output_name
    if output.suffix == ".gif":
        rendered[0].save(
            output,
            save_all=True,
            append_images=rendered[1:],
            duration=source.info.get("duration", 100),
            loop=source.info.get("loop", 0),
            disposal=2,
            optimize=False,
        )
        return

    rendered[0].save(output)


def prepare_frame(frame: Image.Image, knockout_white: bool) -> Image.Image:
    rgba = frame.convert("RGBA")
    if not knockout_white:
        return rgba

    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = pixels[x, y]
            if a and r > 240 and g > 240 and b > 240:
                pixels[x, y] = (r, g, b, 0)
    return rgba


def union_bbox(frames: list[Image.Image]) -> tuple[int, int, int, int] | None:
    union: tuple[int, int, int, int] | None = None
    for frame in frames:
        bbox = frame.getchannel("A").getbbox()
        if bbox is None:
            continue
        union = bbox if union is None else (
            min(union[0], bbox[0]),
            min(union[1], bbox[1]),
            max(union[2], bbox[2]),
            max(union[3], bbox[3]),
        )
    return union


def build_padded_glyph(
    name: str,
    svg_path: str,
    source_bbox: tuple[float, float, float, float],
    source_origin: tuple[float, float] = (0.0, 0.0),
) -> object:
    units_per_em = 1000
    source_width = source_bbox[2] - source_bbox[0]
    source_height = source_bbox[3] - source_bbox[1]
    target_size = units_per_em * TERMINAL_INK_SCALE
    scale = target_size / max(source_width, source_height)
    width = source_width * scale
    height = source_height * scale
    left = units_per_em * (TREE_MIDLINE / SLOT) - width / 2
    top = units_per_em * 0.5 - height / 2

    glyph_pen = TTGlyphPen(None)
    quad_pen = Cu2QuPen(glyph_pen, max_err=1.0)
    transform = Transform(
        scale,
        0,
        0,
        -scale,
        left - source_origin[0] * scale,
        units_per_em - top + source_origin[1] * scale,
    )
    parse_path(svg_path, TransformPen(quad_pen, transform))
    glyph = glyph_pen.glyph()
    glyph.recalcBounds({name: glyph})
    return glyph


def generate_terminal_font() -> None:
    units_per_em = 1000
    # Keep the Terminal's shipped origin behavior unchanged. New glyphs cancel
    # their source bounds' origin so their ink centers on the tree midline.
    glyphs = {
        "deck-terminal": build_padded_glyph(
            "deck-terminal", TERMINAL_PATH, (0.0, 1.0, 16.0, 15.0)
        ),
        "deck-bookmark-globe": build_padded_glyph(
            "deck-bookmark-globe", GLOBE_PATH, (1.0, 1.0, 15.0, 15.0), (1.0, 1.0)
        ),
    }

    fb = FontBuilder(units_per_em, isTTF=True)
    glyph_order = [".notdef", *glyphs]
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap({0xE001: "deck-terminal", 0xE002: "deck-bookmark-globe"})
    fb.setupGlyf({".notdef": TTGlyphPen(None).glyph(), **glyphs})
    # VS Code renders the glyph flush-left unless the hmtx LSB matches xMin.
    fb.setupHorizontalMetrics({
        ".notdef": (units_per_em, 0),
        **{name: (units_per_em, glyph.xMin) for name, glyph in glyphs.items()},
    })
    fb.setupHorizontalHeader(ascent=units_per_em, descent=0)
    fb.setupOS2(
        sTypoAscender=units_per_em,
        sTypoDescender=0,
        usWinAscent=units_per_em,
        usWinDescent=0,
    )
    fb.setupNameTable({
        "familyName": "Deck Icons",
        "styleName": "Regular",
        "uniqueFontIdentifier": "Deck Icons Regular",
        "fullName": "Deck Icons Regular",
        "psName": "DeckIcons-Regular",
    })
    fb.setupPost()
    fb.setupMaxp()

    font = fb.font
    font["head"].created = 0
    font["head"].modified = 0
    font.flavor = "woff"
    font.save(RESOURCES / "deck-icons.woff", reorderTables=True)


if __name__ == "__main__":
    main()
