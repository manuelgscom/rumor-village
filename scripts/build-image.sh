#!/usr/bin/env bash
# Build the engine image: llama.cpp at the ref pinned in docker/LLAMA_COMMIT,
# with the CUDA and Vulkan backends.
set -euo pipefail
. "$(dirname "$0")/lib.sh"

cap=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -n1)
cuda_arch=${cap/./}

echo "image: $IMAGE  llama.cpp: $LLAMA_REF ($LLAMA_COMMIT)  CUDA arch: $cuda_arch"
docker build \
    -f "$ROOT/docker/engine.Dockerfile" \
    --build-arg LLAMA_REF="$LLAMA_REF" \
    --build-arg LLAMA_COMMIT="$LLAMA_COMMIT" \
    --build-arg CUDA_ARCH="$cuda_arch" \
    -t "$IMAGE" \
    "$ROOT/docker"
