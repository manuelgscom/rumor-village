#!/usr/bin/env bash
# Build a Linux prebuilt (phase 10).
#
#   scripts/dist-build.sh linux-cuda      CUDA 12.9, every NVIDIA card from the GTX 10 to the RTX 50
#   scripts/dist-build.sh linux-vulkan    Vulkan (NVIDIA, AMD and Intel)
#
# Compiles in docker/dist-linux.Dockerfile, without the GPU (the toolkit is
# enough), with dist/linux/build.sh: the binary and its libraries are left in
# build/dist-linux-<backend>/stage/. Then dist/package/assemble.sh, if it is
# there, makes the AppImage in build/dist/ (in the same image). DIST_JOBS sets
# the parallel jobs (default 6: nvcc takes a lot of memory per job).
set -euo pipefail
. "$(dirname "$0")/lib.sh"  # ROOT

target=${1:-}
case $target in
    linux-cuda) backend=cuda ;;
    linux-vulkan) backend=vulkan ;;
    *) echo "usage: $0 linux-cuda|linux-vulkan" >&2; exit 2 ;;
esac

# The image is tagged with the hash of its Dockerfile: a change builds a new one.
dockerfile=$ROOT/docker/dist-linux.Dockerfile
DIST_IMAGE=rumor-village-dist-linux:$(sha256sum "$dockerfile" | cut -c1-12)
docker image inspect "$DIST_IMAGE" >/dev/null 2>&1 ||
    docker build -q -f "$dockerfile" -t "$DIST_IMAGE" "$ROOT/docker" >&2

# What `rumor --version` says.
engine_commit=$(git -C "$ROOT" describe --always --dirty 2>/dev/null || echo unknown)
llama_commit=$(git -C "$ROOT/engine/third_party/llama.cpp" rev-parse HEAD 2>/dev/null || echo unknown)

docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$ROOT:/work" -w /work \
    -e "DIST_JOBS=${DIST_JOBS:-6}" -e "RUMOR_ENGINE_COMMIT=$engine_commit" \
    -e "RUMOR_LLAMA_COMMIT=$llama_commit" \
    "$DIST_IMAGE" dist/linux/build.sh "$backend"

stage=build/dist-linux-$backend/stage
if [ -x "$ROOT/dist/package/assemble.sh" ]; then
    (cd "$ROOT" && DIST_IMAGE=$DIST_IMAGE dist/package/assemble.sh "$target" "$stage")
else
    echo "dist-build: dist/package/assemble.sh not found (package D); the binary is in $stage" >&2
fi
