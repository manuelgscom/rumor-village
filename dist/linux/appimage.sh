#!/usr/bin/env bash
# Make the AppImage of a Linux prebuilt from its AppDir (phase 10). Runs inside
# docker/dist-linux.Dockerfile with the repo at /work; dist/package/assemble.sh
# calls it, not you.
#
#   dist/linux/appimage.sh <appdir> <file.AppImage>
#
# Draws the icon (viewer/assets/icon.svg -> <appdir>/rumor-village.png,
# 256x256), packs <appdir> into a squashfs image (zstd, owner root, every time
# SOURCE_DATE_EPOCH: the same bytes every time) and puts the static type 2
# runtime of the image (/opt/appimage/runtime-x86_64) in front of it. Prints
# the long listing of the squashfs (unsquashfs -lls, root named like the
# AppDir) for the checks of assemble.sh.
set -euo pipefail

[ $# -eq 2 ] || { echo "usage: $0 <appdir> <file.AppImage>" >&2; exit 2; }
appdir=${1%/} out=$2
runtime=/opt/appimage/runtime-x86_64
: "${SOURCE_DATE_EPOCH:?is not set}"  # mksquashfs dates the image and every file with it
[ -d "$appdir" ] || { echo "appimage: no folder $appdir" >&2; exit 1; }
[ -f "$runtime" ] || { echo "appimage: no $runtime (old docker/dist-linux.Dockerfile image?)" >&2; exit 1; }

rsvg-convert -w 256 -h 256 -f png -o "$appdir/rumor-village.png" viewer/assets/icon.svg
chmod 644 "$appdir/rumor-village.png"

# zstd at level 19 with 1 MiB blocks: the runtime reads only zlib and zstd,
# and 1 MiB blocks are smaller than 128 KiB ones and start as fast
# (docs/fases/fase-10.md has the numbers).
squash=$out.squashfs
rm -f "$squash" "$out"
mksquashfs "$appdir" "$squash" -noappend -quiet -no-progress -reproducible \
    -comp zstd -Xcompression-level 19 -b 1M \
    -all-root -no-xattrs >&2
cat "$runtime" "$squash" >"$out"
rm -f "$squash"
chmod 755 "$out"

unsquashfs -o "$(stat -c %s "$runtime")" -d "$(basename "$appdir")" -lls "$out"
