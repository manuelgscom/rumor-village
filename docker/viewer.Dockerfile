# Viewer image (phase 3): Node for the logic tests and the static server, and
# headless Chromium for the screenshots. No npm packages: the tests use
# `node --test` and the screenshots talk to Chromium over its DevTools
# protocol with the WebSocket client that Node already has. The emoji font
# (phase 9-5) lets the captures show the icons of the game. The repo is mounted
# at /work; nothing is copied into the image. ffmpeg (phase 11) turns the
# frames of the film into video; libegl1 and libvulkan1 let Chromium draw on
# the NVIDIA card when the container gets it (film.mjs --gpu 1).
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium fonts-dejavu-core fonts-noto-color-emoji ffmpeg libegl1 libvulkan1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
