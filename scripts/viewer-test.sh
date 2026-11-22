#!/usr/bin/env bash
# Run the viewer logic tests (node --test) in the viewer container.
#
#   scripts/viewer-test.sh          # every viewer/js/**/*.test.js
#   scripts/viewer-test.sh core     # only viewer/js/core/
#   scripts/viewer-test.sh render   # only viewer/js/render/
set -euo pipefail
. "$(dirname "$0")/viewer-lib.sh"

dir=${1:-}
if [ -n "$dir" ]; then
    if [ ! -d "$ROOT/viewer/js/$dir" ]; then
        echo "viewer-test: no folder viewer/js/$dir" >&2
        exit 2
    fi
    pattern="viewer/js/$dir/**/*.test.js"
else
    pattern="viewer/js/**/*.test.js"
fi
viewer_run -- node --test "$pattern"
