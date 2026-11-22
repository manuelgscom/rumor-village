#!/usr/bin/env bash
# Run a command in the tools image (Python, pytest, pyyaml), from the repo root.
#
#   scripts/tools.sh pytest training
#   scripts/tools.sh python training/sample/check.py runs/dataset/v1/cards.jsonl
#
# No network: the dataset scripts only read and write files of the repo.
set -euo pipefail
. "$(dirname "$0")/tools-lib.sh"
TOOLS_DOCKER_OPTS=(--network none)
tools_run "$@"
