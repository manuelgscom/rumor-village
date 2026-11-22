#!/usr/bin/env bash
# Build and run the engine tests.
#
#   scripts/engine-test.sh [suite]              full build; all suites or one
#   scripts/engine-test.sh --sanitize [suite]   the same with ASan and UBSan
#   scripts/engine-test.sh --only <suite>       isolated build of one package
#                                               (core + its folders + its tests,
#                                               test doubles included)
#   scripts/engine-test.sh --gpu [suite]        the cases that run the model
#   scripts/engine-test.sh --gpu --only <suite> (TEST_SUITE("<suite>_gpu")), in
#                                               the GPU image, one run at a time
#
# Suites are named after the folder under engine/tests/:
#   core world people memory validate log policy metrics sim integration determinism
#   llm_support llm card_render extract policy_model bench textcheck server record
#   validate_cmd cards prompts answer launcher
# With --gpu: llm extract
#
# Without --gpu everything runs in the CPU image and no model is run. Some
# cases read the tokenizer of the model (models/, mounted read only); if the
# file is not there they are skipped, and this script says so.
set -euo pipefail
. "$(dirname "$0")/engine-lib.sh"

usage() {
    echo "usage: $0 [--sanitize] [suite] | --only <suite> | --gpu [--only] [suite]" >&2
    exit 2
}

mode=full gpu=0 suite=""
while [ $# -gt 0 ]; do
    case $1 in
        --sanitize) mode=sanitize ;;
        --only) mode=only ;;
        --gpu) gpu=1 ;;
        -*) usage ;;
        *) [ -z "$suite" ] || usage; suite=$1 ;;
    esac
    shift
done

if [ "$gpu" = 1 ]; then
    suites=$ENGINE_GPU_SUITES
    [ "$mode" != sanitize ] || usage
else
    suites=$ENGINE_SUITES
fi
if [ -n "$suite" ] && ! grep -qw -- "$suite" <<<"$suites"; then
    echo "engine-test: unknown suite '$suite' (one of: $suites)" >&2
    exit 2
fi
if [ "$mode" = only ] && [ -z "$suite" ]; then usage; fi

model=$MODELS_DIR/$ENGINE_MODEL_FILE
if [ "$gpu" = 1 ]; then
    [ -f "$model" ] || { echo "engine-test: $model not found" >&2; exit 1; }
    dir=$(ENGINE_CUDA=1 engine_build "$mode" "$suite")
    if [ -n "$suite" ]; then
        engine_gpu_run "$dir/rumor_tests" "--test-suite=${suite}_gpu"
    else
        engine_gpu_run "$dir/rumor_tests" "--test-suite=*_gpu"
    fi
    exit
fi

dir=$(engine_build "$mode" "$suite")
if [ -n "$suite" ]; then
    engine_run "$dir/rumor_tests" "--test-suite=$suite"
else
    engine_run "$dir/rumor_tests" "--test-suite-exclude=*_gpu"
fi
if [ ! -f "$model" ]; then
    echo "engine-test: WARNING: $model not found: the cases that need the tokenizer" \
        "of the model were SKIPPED" >&2
fi
