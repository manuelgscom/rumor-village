#!/usr/bin/env bash
# Checksums and sizes of the prebuilt packages in build/dist/ (phase 10).
#
#   scripts/dist-sums.sh
#
# Writes build/dist/SHA256SUMS (sha256sum of every .AppImage and .zip, with
# names relative to build/dist/, so `cd build/dist && sha256sum -c SHA256SUMS`
# checks them) and build/dist/sizes.txt (name, bytes, MB). Only what is there:
# a package that has not been built is left out.
set -euo pipefail
. "$(dirname "$0")/lib.sh"  # ROOT

dir=$ROOT/build/dist
[ -d "$dir" ] || { echo "dist-sums: no $dir (build a package first)" >&2; exit 1; }
cd "$dir"
mapfile -t files < <(find . -maxdepth 1 -type f \( -name '*.AppImage' -o -name '*.zip' \) -printf '%f\n' | LC_ALL=C sort)
[ ${#files[@]} -gt 0 ] || { echo "dist-sums: no .AppImage or .zip in build/dist/" >&2; exit 1; }

sha256sum -- "${files[@]}" >SHA256SUMS.tmp
mv SHA256SUMS.tmp SHA256SUMS
{
    printf '%-48s %12s %10s\n' name bytes MB
    for f in "${files[@]}"; do
        bytes=$(stat -c %s -- "$f")
        printf '%-48s %12s %10s\n' "$f" "$bytes" "$(LC_ALL=C awk -v b="$bytes" 'BEGIN { printf "%.2f", b / 1e6 }')"
    done
} >sizes.txt
cat SHA256SUMS sizes.txt
