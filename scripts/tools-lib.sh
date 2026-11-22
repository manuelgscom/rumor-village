# Shared by the tools shortcuts (tools.sh, codex.sh). Source it, do not run it.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"  # ROOT
TOOLS_IMAGE=${TOOLS_IMAGE:-rumor-village-tools:1}

# Extra `docker run` options, set after sourcing this file.
TOOLS_DOCKER_OPTS=()

# tools_run <cmd...>: run a command in the tools image, repo at /work, as the
# host user. The image is built the first time it is needed.
tools_run() {
    docker image inspect "$TOOLS_IMAGE" >/dev/null 2>&1 ||
        docker build -q -f "$ROOT/docker/tools.Dockerfile" -t "$TOOLS_IMAGE" "$ROOT/docker" >&2
    docker run --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 \
        -v "$ROOT:/work" -w /work "${TOOLS_DOCKER_OPTS[@]}" "$TOOLS_IMAGE" "$@"
}
