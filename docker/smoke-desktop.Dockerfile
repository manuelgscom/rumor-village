# A clean Ubuntu with what any Linux desktop has and the NVIDIA Vulkan driver
# needs at run time (libGLX_nvidia loads libX11; the same packages as
# docker/engine.Dockerfile), curl, which the launcher uses to download the
# model, and fuse3 (fusermount3), with which the AppImage mounts itself. No
# CUDA toolkit, no Vulkan loader: the prebuilt package brings its own. For
# `scripts/dist-smoke.sh --gpu` and `--fuse` (phase 10).
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        libx11-6 libxext6 libegl1 libglvnd0 curl ca-certificates fuse3 \
    && rm -rf /var/lib/apt/lists/*
