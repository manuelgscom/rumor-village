# CPU-only engine image (phase 1): compiler and CMake, no GPU libraries and no
# model runtime. The repo is mounted at /work; nothing is copied into the image.
# curl: the launcher of phase 10 downloads the model with the curl of the
# system, and its tests run it against a server of their own.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake ninja-build curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
