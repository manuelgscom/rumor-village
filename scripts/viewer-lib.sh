# Shared by the viewer shortcuts (viewer-test.sh, viewer-serve.sh,
# viewer-shot.sh, viewer-shots.sh). Source it, do not run it.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"  # ROOT
VIEWER_IMAGE=${VIEWER_IMAGE:-rumor-village-viewer:3}

# viewer_image: build the image the first time it is needed.
viewer_image() {
    docker image inspect "$VIEWER_IMAGE" >/dev/null 2>&1 ||
        docker build -q -f "$ROOT/docker/viewer.Dockerfile" -t "$VIEWER_IMAGE" "$ROOT/docker" >&2
}

# viewer_run [docker args...] -- <cmd...>: run a command in the viewer image,
# with the repo at /work, as the host user. The docker arguments before `--`
# go to `docker run` (ports, network).
viewer_run() {
    viewer_image
    local extra=()
    while [ $# -gt 0 ] && [ "$1" != -- ]; do
        extra+=("$1")
        shift
    done
    [ "${1:-}" = -- ] && shift
    docker run --rm -i --init --user "$(id -u):$(id -g)" -e HOME=/tmp \
        -v "$ROOT:/work" -w /work "${extra[@]}" "$VIEWER_IMAGE" "$@"
}
