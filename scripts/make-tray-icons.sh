#!/bin/sh
# Makes the tray icons in src-tauri/icons/tray/ from the app icon
# (src-tauri/icons/icon.png), for src-tauri/src/background/tray.rs. Needs
# ImageMagick 7 (`magick`). Run again whenever the app icon changes.
#
# - macos-template.png: the menu bar's. A template image: only its alpha
#   counts, and macOS paints it in the menu bar's colour, so it is right in
#   light and dark menu bars and under a tinted wallpaper. The quill's ink
#   becomes the shape and the cream between its barbs stays see-through, as
#   in the app icon. 36 px square: tray-icon shows it 18 pt high, so this is
#   exact at 2x.
# - windows-<n>.png: the notification area's, at the small-icon sizes of
#   100-300% display scaling (16, 20, 24, 32, 40, 48); tray.rs picks the one
#   Windows asks for. The app icon's rounded square, cropped to its edge, so
#   it reads on the light and the dark taskbar alike.
# - linux.png: the same square at 64 px; the panel scales it.
set -eu
cd "$(dirname "$0")/../src-tauri/icons"
mkdir -p tray
src=icon.png

# The rounded square, without the margin around it.
magick "$src" -trim +repage tray/.square.png

# The ink: dark pixels opaque, the cream background and barbs clear.
magick tray/.square.png -alpha off -colorspace Gray -level 50%,72% -negate tray/.ink.png
magick tray/.square.png -alpha extract tray/.inside.png
magick tray/.ink.png tray/.inside.png -compose Multiply -composite -morphology Dilate Disk:2.5 tray/.mask.png
magick -size "$(magick identify -format '%wx%h' tray/.mask.png)" xc:black \
    tray/.mask.png -alpha off -compose CopyOpacity -composite -trim +repage tray/.quill.png
magick tray/.quill.png -resize 34x34 -gravity center -background none -extent 36x36 \
    -strip PNG32:tray/macos-template.png

for size in 16 20 24 32 40 48; do
    magick tray/.square.png -resize "${size}x${size}" -strip "PNG32:tray/windows-$size.png"
done
magick tray/.square.png -resize 64x64 -strip PNG32:tray/linux.png

rm tray/.square.png tray/.ink.png tray/.inside.png tray/.mask.png tray/.quill.png
