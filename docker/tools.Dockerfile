# Tools image (phase 4): Python for the dataset scripts and the codex CLI that
# answers half of the dataset. No training dependencies (they arrive in phase 5).
# The repo is mounted at /work; nothing is copied into the image.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pytest python3-yaml ca-certificates git \
    && ln -s /usr/bin/python3 /usr/local/bin/python \
    && rm -rf /var/lib/apt/lists/*

ARG CODEX_VERSION=latest
RUN npm install -g @openai/codex@${CODEX_VERSION} && npm cache clean --force

WORKDIR /work
