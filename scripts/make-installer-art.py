#!/usr/bin/env python3
"""Draws the two bitmaps the Windows installer shows (NSIS wants BMP, and
only BMP - it cannot read the PNGs the rest of the app is built from).

Run after changing the app icon or the brand colours:

    python3 scripts/make-installer-art.py

Outputs, both referenced from tauri.windows.conf.json:

  src-tauri/installer/header.bmp   150x57  - the strip along the top of every
                                             page after the welcome one. MUI
                                             paints the rest of that strip in
                                             MUI_BGCOLOR (white), so this one
                                             is white-backed and right-aligned
                                             to sit flush against the header
                                             text.
  src-tauri/installer/sidebar.bmp  164x314 - the full-height panel on the
                                             welcome and finish pages. Solid
                                             brand charcoal, so the installer
                                             reads as this app's rather than
                                             as the default NSIS grey.

Sizes are MUI2's; anything else is stretched to fit and looks it.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "src-tauri/icons/128x128@2x.png"
OUT = ROOT / "src-tauri/installer"

# Sampled from the app icon (src-tauri/icons/icon.png) so the installer, the
# taskbar button and the window it ends up launching are one palette.
CHARCOAL = (36, 37, 42)
GOLD = (212, 190, 166)
MUTED = (138, 138, 146)

# Georgia is the closest system face to the icon's serif "T"; the fallback
# only matters when regenerating on a machine without it.
SERIF = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
SANS = "/System/Library/Fonts/Supplemental/Arial.ttf"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default(size)


def centred(draw: ImageDraw.ImageDraw, y: int, text: str, f, fill, width: int):
    left, top, right, bottom = draw.textbbox((0, 0), text, font=f)
    draw.text(((width - (right - left)) / 2 - left, y - top), text, font=f, fill=fill)


def icon(size: int) -> Image.Image:
    return Image.open(ICON).convert("RGBA").resize((size, size), Image.LANCZOS)


def header() -> Image.Image:
    img = Image.new("RGB", (150, 57), (255, 255, 255))
    mark = icon(38)
    img.paste(mark, (150 - 38 - 12, (57 - 38) // 2), mark)
    return img


def sidebar() -> Image.Image:
    img = Image.new("RGB", (164, 314), CHARCOAL)
    draw = ImageDraw.Draw(img)

    mark = icon(76)
    img.paste(mark, ((164 - 76) // 2, 46), mark)

    centred(draw, 146, "Textus", font(SERIF, 30), GOLD, 164)
    draw.line([(52, 190), (112, 190)], fill=GOLD, width=1)
    centred(draw, 204, "Writing Environment", font(SANS, 11), MUTED, 164)

    # The icon's ribbon, continued across the foot of the panel: a slice of
    # an ellipse far wider than the frame, so what shows is one shallow rise
    # leaving at the right edge rather than a recognisable piece of circle.
    draw.arc([(-40, 262), (330, 470)], start=190, end=280, fill=GOLD, width=2)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Plain 24-bit BMP: NSIS refuses anything with an alpha channel, and
    # silently ships a black rectangle for a palette it does not expect.
    header().save(OUT / "header.bmp", format="BMP")
    sidebar().save(OUT / "sidebar.bmp", format="BMP")
    print(f"wrote {OUT}/header.bmp and {OUT}/sidebar.bmp")


if __name__ == "__main__":
    main()
