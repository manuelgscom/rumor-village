#!/usr/bin/env bash
# Assemble one prebuilt package (phase 10, package D).
#
#   dist/package/assemble.sh <linux-cuda|linux-vulkan|windows-cuda|windows-vulkan> <stage-dir>
#
# <stage-dir> is what a build leaves (dist/linux/build.sh, dist/windows/build.ps1):
#   Linux:   rumor (or rumor-village) and lib/ with the libraries it loads
#   Windows: rumor.exe (or rumor-village.exe) and the DLLs it needs
#
# Makes build/dist/rumor-village-<system>-<backend>-<version>/ with the
# executable renamed to rumor-village(.exe), lib/ (Linux) or the DLLs next to
# the executable (Windows), what dist/files.txt lists of viewer/ and data/,
# model.json, LICENSE, THIRD_PARTY_NOTICES.txt, licenses/ and the readmes of
# dist/readme/; then packs it next to it, reproducibly:
#   Linux:   an AppImage. The folder is a flat AppDir (AppRun -> rumor-village,
#            rumor-village.desktop, rumor-village.png and .DirIcon on top of the
#            above), packed by dist/linux/appimage.sh in the image of
#            docker/dist-linux.Dockerfile (squashfs + the static type 2 runtime).
#   Windows: a .zip (dist/package/archive.py, in the tools image).
# The package is checked at the end, on the list of what it holds: no tools,
# fixtures, web version, tests or models, and the notices are there. Prints the
# package path (relative to the repo) on the last line of stdout.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
. "$ROOT/scripts/tools-lib.sh"  # tools_run

die() { echo "assemble: $*" >&2; exit 1; }
warn() { echo "assemble: warning: $*" >&2; }

[ $# -eq 2 ] || { echo "usage: $0 <linux-cuda|linux-vulkan|windows-cuda|windows-vulkan> <stage-dir>" >&2; exit 2; }
target=$1
stage=$(cd "$2" 2>/dev/null && pwd) || die "no stage folder '$2'"
case $target in
    linux-cuda | linux-vulkan | windows-cuda | windows-vulkan) ;;
    *) die "unknown package '$target'" ;;
esac
system=${target%-*} backend=${target#*-}

version=$(tr -d '[:space:]' <"$ROOT/dist/VERSION")
[ -n "$version" ] || die "dist/VERSION is empty"
name=rumor-village-$target-$version
out=$ROOT/build/dist/$name
export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git -C "$ROOT" log -1 --format=%ct)}

rm -rf "$out"
mkdir -p "$out"
ok=0
trap '[ $ok = 1 ] || rm -rf "$out"' EXIT  # no half-made folder after an error

# --- The executable and its libraries ------------------------------------------
if [ "$system" = linux ]; then
    exe=""
    for f in rumor rumor-village; do [ -f "$stage/$f" ] && exe=$stage/$f && break; done
    [ -n "$exe" ] || die "no rumor executable in $stage"
    install -m 755 "$exe" "$out/rumor-village"
    if [ -d "$stage/lib" ]; then
        cp -a "$stage/lib" "$out/lib"  # -a: keep the soname links
    else
        warn "no lib/ in $stage"
    fi
    case $backend in
        cuda) need_libs="libcudart.so.* libcublas.so.* libcublasLt.so.*" ;;
        vulkan) need_libs="libvulkan.so.1" ;;
    esac
    for lib in $need_libs; do
        compgen -G "$out/lib/$lib" >/dev/null || die "lib/$lib missing in $stage (needed by $target)"
    done
else
    exe=""
    for f in rumor.exe rumor-village.exe; do [ -f "$stage/$f" ] && exe=$stage/$f && break; done
    [ -n "$exe" ] || die "no rumor.exe in $stage"
    install -m 755 "$exe" "$out/rumor-village.exe"
    shopt -s nullglob nocaseglob
    for dll in "$stage"/*.dll; do install -m 644 "$dll" "$out/"; done
    shopt -u nullglob nocaseglob
    if [ "$backend" = cuda ]; then
        for dll in cudart64_12.dll cublas64_12.dll cublasLt64_12.dll; do
            [ -f "$out/$dll" ] || die "$dll missing in $stage (needed by $target)"
        done
    fi
    # The Vulkan loader comes with the graphics driver on Windows; never ship it.
    [ ! -e "$out/vulkan-1.dll" ] || die "vulkan-1.dll must not be shipped on Windows"
fi

# --- viewer/ and data/, as dist/files.txt says ---------------------------------
# glob_regex <pattern>: the extended regex of a files.txt pattern. "**" is any
# number of folders (also none), "*" any name within one folder.
glob_regex() {
    local re
    re=$(printf '%s' "$1" | sed -e 's/[].[^$()+?{}|\\]/\\&/g' -e 's/\*\*/\x01/g' -e 's/\*/[^\/]*/g' \
        -e 's/\/\x01\//\/(.*\/)?/g' -e 's/^\x01\//(.*\/)?/' -e 's/\/\x01$/\/.*/' -e 's/\x01/.*/g')
    printf '^%s$' "$re"
}

rules=()  # "+<regex>" or "-<regex>", in file order; the last match decides
patterns=()
while IFS= read -r line || [ -n "$line" ]; do
    line=${line%%#*}
    line=$(printf '%s' "$line" | sed 's/[[:space:]]*$//; s/^[[:space:]]*//')
    [ -n "$line" ] || continue
    if [ "${line:0:1}" = '!' ]; then
        rules+=("-$(glob_regex "${line:1}")")
    else
        rules+=("+$(glob_regex "$line")")
    fi
    patterns+=("$line")
done <"$ROOT/dist/files.txt"

# The candidates: files of viewer/ and data/ that git tracks or would track
# (not the ignored ones), and that exist.
mapfile -t candidates < <(git -C "$ROOT" ls-files --cached --others --exclude-standard -- viewer data | LC_ALL=C sort -u)
declare -A used=()
picked=()
for f in "${candidates[@]}"; do
    [ -f "$ROOT/$f" ] || continue
    keep=0
    for i in "${!rules[@]}"; do
        r=${rules[$i]}
        if [[ $f =~ ${r:1} ]]; then
            used[$i]=1
            if [ "${r:0:1}" = + ]; then keep=1; else keep=0; fi
        fi
    done
    if [ $keep = 1 ]; then picked+=("$f"); fi
done
for i in "${!rules[@]}"; do
    if [ -z "${used[$i]:-}" ]; then
        if [ "${rules[$i]:0:1}" = + ]; then
            die "dist/files.txt: '${patterns[$i]}' matches no file"
        fi
        warn "dist/files.txt: '${patterns[$i]}' matches no file"
    fi
done
[ ${#picked[@]} -gt 0 ] || die "dist/files.txt picks no file"
(cd "$ROOT" && printf '%s\0' "${picked[@]}" | xargs -0 cp --parents -t "$out")
chmod -R u+rwX,go+rX,go-w "$out/viewer" "$out/data"

# --- model.json, license, notices and readmes ------------------------------------
install -m 644 "$ROOT/dist/model.json" "$out/model.json"
install -m 644 "$ROOT/LICENSE" "$out/LICENSE"
install -m 644 "$ROOT/dist/notices/THIRD_PARTY_NOTICES.txt" "$out/THIRD_PARTY_NOTICES.txt"
mkdir -p "$out/licenses"
install -m 644 "$ROOT"/dist/notices/licenses/* "$out/licenses/"
# DIST_README_DIR: another folder with the readmes, for tests before package E.
readme_dir=${DIST_README_DIR:-$ROOT/dist/readme}
for f in LEEME.txt README.txt; do
    if [ -f "$readme_dir/$f" ]; then
        install -m 644 "$readme_dir/$f" "$out/$f"
    else
        warn "$readme_dir/$f not found (package E): the package goes without it"
    fi
done

# --- Pack and check ------------------------------------------------------------------
case $system in
    linux) archive=build/dist/$name.AppImage ;;
    windows) archive=build/dist/$name.zip ;;
esac
rm -f "$ROOT/$archive"
if [ "$system" = linux ]; then
    # The AppDir: AppRun is a link, so that /proc/self/exe (the launcher's
    # exe_dir) is rumor-village at the root of the mounted image.
    ln -s rumor-village "$out/AppRun"
    install -m 644 "$ROOT/dist/linux/rumor-village.desktop" "$out/rumor-village.desktop"
    ln -s rumor-village.png "$out/.DirIcon"
    # The squashfs keeps the modes: the same ones whatever the umask.
    chmod -R u+rwX,go+rX,go-w "$out"
    # The image of docker/dist-linux.Dockerfile, tagged as scripts/dist-build.sh does.
    dockerfile=$ROOT/docker/dist-linux.Dockerfile
    DIST_IMAGE=${DIST_IMAGE:-rumor-village-dist-linux:$(sha256sum "$dockerfile" | cut -c1-12)}
    docker image inspect "$DIST_IMAGE" >/dev/null 2>&1 ||
        docker build -q -f "$dockerfile" -t "$DIST_IMAGE" "$ROOT/docker" >&2
    long=$(docker run --rm --network none --user "$(id -u):$(id -g)" -e HOME=/tmp \
        -e "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH" -v "$ROOT:/work" -w /work \
        "$DIST_IMAGE" dist/linux/appimage.sh "build/dist/$name" "$archive") ||
        { rm -f "$ROOT/$archive"; die "packing $archive failed"; }
    # unsquashfs -lls: "<mode> <owner> <size> <date> <time> <path>[ -> <target>]".
    long=$(grep -E '^[-dlcbps][-rwxsStT]{9} ' <<<"$long" || true)
    list=$(awk '{print $6}' <<<"$long")
else
    TOOLS_DOCKER_OPTS=(--network none -e "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH")
    list=$(tools_run python dist/package/archive.py "build/dist/$name" "$archive") ||
        die "packing $archive failed"
fi

fail() {
    rm -f "$ROOT/$archive"
    die "$archive: $* (archive removed)"
}
bad=$(printf '%s\n' "$list" | grep -E "^$name/(viewer/tools(/|$)|viewer/fixtures(/|$)|viewer/play-web\.html$|viewer/js/web(/|$))|\.test\.js$|\.gguf$" || true)
[ -z "$bad" ] || fail "has what must not ship:"$'\n'"$bad"
exe_name=rumor-village
if [ "$system" = windows ]; then exe_name=rumor-village.exe; fi
for must in "$exe_name" THIRD_PARTY_NOTICES.txt LICENSE model.json viewer/index.html \
    licenses/Apache-2.0.txt licenses/llama.cpp-ggml-MIT.txt; do
    grep -qxF "$name/$must" <<<"$list" || fail "$must missing"
done
grep -q "^$name/data/" <<<"$list" || fail "data/ missing"
if [ "$system" = linux ]; then
    # entry <path>: "<mode> <link target>" of a member of the squashfs.
    entry() { awk -v p="$name/$1" '$6 == p {print $1, $8}' <<<"$long"; }
    [[ $(entry AppRun) == "l"*" rumor-village" ]] || fail "AppRun is not a link to rumor-village: '$(entry AppRun)'"
    [[ $(entry .DirIcon) == "l"*" rumor-village.png" ]] || fail ".DirIcon is not a link to rumor-village.png"
    [[ $(entry rumor-village) == -rwxr-xr-x* ]] || fail "rumor-village is not executable: '$(entry rumor-village)'"
    [[ $(entry rumor-village.desktop) == -* ]] || fail "rumor-village.desktop missing"
    [[ $(entry rumor-village.png) == -* ]] || fail "rumor-village.png missing"
    [ -x "$ROOT/$archive" ] || fail "not executable"
fi

bytes=$(stat -c %s "$ROOT/$archive")
echo "assemble: $archive ($bytes bytes, $(printf '%s\n' "$list" | wc -l) entries)" >&2
ok=1
echo "$archive"
