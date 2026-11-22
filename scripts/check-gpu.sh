#!/usr/bin/env bash
# Check GPU support on the host and inside Docker. Nothing is installed: if a
# check fails, it says what is missing and stops.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "== 1. driver and GPU on the host"
nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv \
    || fail "nvidia-smi does not work: the NVIDIA driver is missing"

echo "== 2. nvidia runtime in Docker"
docker info --format '{{json .Runtimes}}' | grep -q '"nvidia"' \
    || fail "Docker has no 'nvidia' runtime: NVIDIA Container Toolkit is missing or not configured"
echo ok

echo "== 3. GPU visible inside a container"
docker run --rm --gpus all nvidia/cuda:12.9.2-base-ubuntu24.04 nvidia-smi -L \
    || fail "a container cannot see the GPU"

echo "== 4. CUDA and Vulkan devices in the engine image"
if ! docker image inspect "$IMAGE" > /dev/null 2>&1; then
    echo "skipped: $IMAGE is not built yet (scripts/build-image.sh)"
    exit 0
fi
devices=$("$ROOT/scripts/bench-run.sh" --gpu llama-server --list-devices 2>&1) || true
echo "$devices"
echo "$devices" | grep -q 'CUDA0' || fail "llama.cpp does not list a CUDA device"
echo "$devices" | grep -q 'Vulkan0' \
    || fail "llama.cpp does not list a Vulkan device inside the container (NVIDIA Vulkan ICD not visible)"
echo "all checks passed"
