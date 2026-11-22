#!/usr/bin/env bash
# Build a Windows prebuilt package on the Windows machine (phase 10).
#
#   scripts/dist-win.sh cuda|vulkan [--tests]
#
#   this tree ──tar──► <host>:<dir>\src ──► dist\windows\build.ps1 ──► <dir>\build\<backend>\stage
#   (HEAD + changes                                                         │
#    not committed + llama.cpp)                                             ▼
#   build/dist-windows-<backend>/stage/ ◄──────────scp──────────────────────┘
#        └──► dist/package/assemble.sh windows-<backend> <stage> (if it is there)
#
# The tree goes as it is on disk: tracked and untracked files that git does not
# ignore (so build/, models/, runs/ and out/ stay here), only the folders the
# build needs, and the files of the llama.cpp submodule (sent again only when
# its commit changes). Nothing is pushed. With --tests, rumor_tests.exe runs
# there without the GPU suites.
#
# RUMOR_WIN_HOST  the SSH host (default rumor-win, an alias of ~/.ssh/config)
# RUMOR_WIN_DIR   the folder on Windows (default C:\rv)
# The caller sets up the authentication (an SSH key, or SSH_ASKPASS): this
# script holds no password.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

usage() { echo "usage: $0 cuda|vulkan [--tests]" >&2; exit 2; }
backend=${1:-}
case $backend in cuda | vulkan) ;; *) usage ;; esac
shift
tests=0
while [ $# -gt 0 ]; do
    case $1 in
        --tests) tests=1 ;;
        *) usage ;;
    esac
    shift
done

host=${RUMOR_WIN_HOST:-rumor-win}
windir=${RUMOR_WIN_DIR:-'C:\rv'}
winfwd=${windir//\\//}   # C:/rv, for scp and tar
src="$windir\\src"
# Folders of the repo the build, the tests and smoke.ps1 need.
PARTS=(engine data viewer dist bench/prompts training/testset)
LLAMA=engine/third_party/llama.cpp

work=$(mktemp -d "$ROOT/build/.dist-win.XXXXXX" 2>/dev/null || { mkdir -p "$ROOT/build" && mktemp -d "$ROOT/build/.dist-win.XXXXXX"; })
trap 'rm -rf "$work"' EXIT

remote() { ssh "$host" "$@" </dev/null; }
# remote_ps <script>: run PowerShell code there (encoded: no quoting through cmd).
remote_ps() {
    local code="\$ProgressPreference = 'SilentlyContinue'
$1"
    remote powershell -NoProfile -NonInteractive -EncodedCommand "$(printf '%s' "$code" | iconv -t UTF-16LE | base64 -w0)"
}

# --- The tree -------------------------------------------------------------------
cd "$ROOT"
engine_commit=$(git describe --always --dirty 2>/dev/null || echo unknown)
llama_commit=$(git -C "$LLAMA" rev-parse HEAD)
git ls-files -co --exclude-standard -- "${PARTS[@]}" |
    while IFS= read -r f; do [ -f "$f" ] && [ ! -L "$f" ] && printf '%s\n' "$f"; done >"$work/files"

send_llama=1
if [ -z "$(git -C "$LLAMA" status --porcelain)" ] &&
    [ "$(remote_ps "Get-Content -ErrorAction SilentlyContinue '$src\\$LLAMA\\.rv-commit'" | tr -d '\r')" = "$llama_commit" ]; then
    send_llama=0
fi
if [ $send_llama = 1 ]; then
    git -C "$LLAMA" ls-files | while IFS= read -r f; do
        [ -f "$LLAMA/$f" ] && [ ! -L "$LLAMA/$f" ] && printf '%s\n' "$LLAMA/$f"
    done >>"$work/files"
    printf '%s\n' "$llama_commit" >"$work/.rv-commit"
fi
echo "dist-win: sending $(wc -l <"$work/files") files ($([ $send_llama = 1 ] && echo with || echo without) llama.cpp) to $host" >&2
tar -czf "$work/tree.tgz" -T "$work/files"

# Replace the tree there, keeping llama.cpp unless it is sent again.
keep_llama=$([ $send_llama = 1 ] && echo '$false' || echo '$true')
remote_ps "
\$ErrorActionPreference = 'Stop'
\$src = '$src'
New-Item -ItemType Directory -Force -Path \$src | Out-Null
foreach (\$part in '${PARTS[*]}'.Split(' ')) {
    \$path = Join-Path \$src \$part
    if (-not (Test-Path \$path)) { continue }
    if (\$part -eq 'engine' -and $keep_llama) {
        Get-ChildItem \$path -Force | Where-Object { \$_.Name -ne 'third_party' } | Remove-Item -Recurse -Force
        Get-ChildItem (Join-Path \$path 'third_party') -Force -ErrorAction SilentlyContinue |
            Where-Object { \$_.Name -ne 'llama.cpp' } | Remove-Item -Recurse -Force
    } else {
        Remove-Item -Recurse -Force \$path
    }
}
"
scp -q "$work/tree.tgz" "$host:$winfwd/src.tgz" </dev/null
remote "tar -xzf $winfwd/src.tgz -C $winfwd/src && del $windir\\src.tgz"
if [ $send_llama = 1 ]; then
    scp -q "$work/.rv-commit" "$host:$winfwd/src/$LLAMA/.rv-commit" </dev/null
fi

# --- Build, tests ---------------------------------------------------------------
build_args=(-Backend "$backend" -BuildRoot "$windir\\build" -EngineCommit "$engine_commit" -LlamaCommit "$llama_commit")
[ $tests = 1 ] && build_args+=(-Tests)
remote powershell -NoProfile -ExecutionPolicy Bypass -File "$src\\dist\\windows\\build.ps1" "${build_args[@]}"

if [ $tests = 1 ]; then
    echo "dist-win: rumor_tests.exe --test-suite-exclude=*_gpu" >&2
    # The CUDA DLLs are only in the stage: the tests find them on the PATH.
    remote "set PATH=$windir\\build\\$backend\\stage;%PATH% && cd /d $src && $windir\\build\\$backend\\rumor_tests.exe --test-suite-exclude=*_gpu"
fi

# --- The stage, back here ----------------------------------------------------------
out="$ROOT/build/dist-windows-$backend"
rm -rf "$out/stage"
mkdir -p "$out"
scp -q -r "$host:$winfwd/build/$backend/stage" "$out/" </dev/null
chmod -R u+rwX,go+rX "$out/stage"   # scp brings the Windows ACLs as odd modes
echo "dist-win: $(du -sh "$out/stage" | cut -f1) in build/dist-windows-$backend/stage" >&2

if [ -x "$ROOT/dist/package/assemble.sh" ]; then
    "$ROOT/dist/package/assemble.sh" "windows-$backend" "$out/stage"
else
    echo "dist-win: dist/package/assemble.sh not there yet: the stage is not packaged" >&2
fi
