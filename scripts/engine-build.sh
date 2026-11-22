#!/usr/bin/env bash
# Build the engine.
#
#   scripts/engine-build.sh                  everything: build/engine/rumor and rumor_tests
#   scripts/engine-build.sh --sanitize       everything with ASan and UBSan (build/engine-san)
#   scripts/engine-build.sh --only <suite>   core plus one package and its tests
#                                            (build/engine-<suite>, tests only)
#   scripts/engine-build.sh --cuda [--only <suite>]
#                                            the same in the GPU image, with the CUDA and
#                                            Vulkan backends of llama.cpp (build/engine-cuda,
#                                            build/engine-<suite>-cuda)
#
# Without --cuda the build is made in the CPU image: llama.cpp is linked, but
# only to tokenize and to check grammars; nothing runs a model on the CPU.
# Warnings are errors. The isolated build lets several packages be developed
# at once in the same tree: it does not compile anybody else's folders.
set -euo pipefail
. "$(dirname "$0")/engine-lib.sh"

mode=full suite=""
while [ $# -gt 0 ]; do
    case $1 in
        --sanitize) mode=sanitize ;;
        --only) mode=only; suite=${2:?usage: $0 --only <suite>}; shift ;;
        --cuda) export ENGINE_CUDA=1 ;;
        *) echo "usage: $0 [--sanitize | --only <suite>] [--cuda]" >&2; exit 2 ;;
    esac
    shift
done
engine_build "$mode" "$suite" >/dev/null
