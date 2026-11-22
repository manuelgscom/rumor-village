# Shared by the engine shortcuts (engine-build.sh, engine-test.sh, rumor.sh,
# serve.sh, sse-diff.sh).
# Source it, do not run it.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"  # ROOT, IMAGE (GPU image), MODELS_DIR, GPU_LOCK
ENGINE_IMAGE=${ENGINE_IMAGE:-rumor-village-engine-cpu:2}
# The model of the app, for the tests that need its tokenizer or the model.
ENGINE_MODEL_FILE=${ENGINE_MODEL_FILE:-gemma-4-E4B-it-qat-UD-Q4_K_XL.gguf}

# Test suites, named after the package folder under engine/tests/.
ENGINE_SUITES="core world people memory validate log policy metrics sim integration determinism \
llm_support llm card_render extract policy_model bench textcheck server record \
validate_cmd cards prompts answer launcher"
# Suites that also have cases that run the model: TEST_SUITE("<suite>_gpu").
ENGINE_GPU_SUITES="llm extract"

# Common docker arguments: repo at /work, as the host user.
_engine_docker_args() {
    echo --rm -i --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$ROOT:/work" -w /work
}

# Extra `docker run` options for engine_run and engine_gpu_run, set after
# sourcing this file (serve.sh: name, --init and the published port).
ENGINE_DOCKER_OPTS=()

# engine_run <cmd...>: run a command in the CPU image. The image is built the
# first time it is needed. The models folder, if there is one, is mounted read
# only: some tests read the tokenizer of the model (they never run it).
engine_run() {
    docker image inspect "$ENGINE_IMAGE" >/dev/null 2>&1 ||
        docker build -q -f "$ROOT/docker/engine-cpu.Dockerfile" -t "$ENGINE_IMAGE" "$ROOT/docker" >&2
    local args
    read -r -a args <<<"$(_engine_docker_args)"
    if [ -f "$MODELS_DIR/$ENGINE_MODEL_FILE" ]; then
        args+=(-v "$MODELS_DIR:/models:ro" -e "RUMOR_MODEL=/models/$ENGINE_MODEL_FILE")
    fi
    docker run "${args[@]}" "${ENGINE_DOCKER_OPTS[@]}" "$ENGINE_IMAGE" "$@"
}

# engine_gpu_build_run <cmd...>: run a command in the GPU image without the
# GPU: compiling with CUDA and Vulkan needs the toolkit, not the card.
engine_gpu_build_run() {
    local args
    read -r -a args <<<"$(_engine_docker_args)"
    docker run "${args[@]}" "$IMAGE" "$@"
}

# engine_gpu_run <cmd...>: run a command in the GPU image with the GPU and the
# models at /models. The GPU is unique: runs wait for the lock.
engine_gpu_run() {
    mkdir -p "$ROOT/build"
    local args
    read -r -a args <<<"$(_engine_docker_args)"
    args+=(--gpus all -e NVIDIA_DRIVER_CAPABILITIES=all -v "$MODELS_DIR:/models:ro"
        -e "RUMOR_MODEL=/models/$ENGINE_MODEL_FILE")
    flock "$GPU_LOCK" docker run "${args[@]}" "${ENGINE_DOCKER_OPTS[@]}" "$IMAGE" "$@"
}

# engine_src_dirs <suite>: the engine/src folders or file prefixes (besides
# core) that the isolated build of a package compiles. Fails for suites
# without one.
engine_src_dirs() {
    local sim="sim;policy/baseline;world;people;memory;log;metrics;card/validate;card/textcheck"
    case $1 in
        core) echo "" ;;
        world | people | memory | log) echo "$1" ;;
        metrics) echo "metrics;card/textcheck" ;;
        policy) echo "policy/baseline" ;;
        validate) echo "card/validate" ;;
        sim) echo "cli/cli;$sim" ;;
        llm_support) echo "llm/fake;llm/vocab" ;;
        llm) echo "llm" ;;
        card_render) echo "card/render;people;llm/vocab" ;;
        extract) echo "extract;people;llm/fake;llm/vocab" ;;
        policy_model) echo "policy/model;policy/answer;llm/fake;$sim" ;;
        bench) echo "cli/cli;cli/bench;$sim" ;;
        textcheck) echo "card/textcheck;people" ;;
        record) echo "card/record" ;;  # the card record of cards.jsonl (phase 4)
        # `rumor cards` (phase 4): the replay of a log with the simulation, the
        # card renderer and the extract prompt.
        cards) echo "cli/cards;card/record;card/render;extract;$sim" ;;
        # `rumor validate` (phase 4): the card record, reading and validating an
        # answer, the text detector, the extract validation and the names.
        validate_cmd) echo "cli/validate;card/record;card/validate;card/textcheck;policy/answer;extract;people" ;;
        # The live server: routes and queue (server), what it understood of a
        # fact (extract), a simulated model for /extract (llm/fake), and the
        # simulation with the baseline for a whole run served live.
        # cli/cli and cli/serve: `rumor run --serve`, with doubles for what the
        # command links but a baseline run does not use.
        # Phase 9: cli/play (`rumor play`, the game server and its control).
        server) echo "server;extract;llm/fake;cli/cli;cli/serve;cli/play;cli/stop_signal;$sim" ;;
        # `rumor prompts` and `rumor answer` (phase 5): the card record, the
        # renderer, the extract prompt, the tokenizer (prompts) and the batch
        # (answer, with the simulated model in its tests); bench_card for the
        # setup.json of `rumor bench`.
        prompts) echo "cli/prompts;card/record;card/render;extract;people;llm/vocab" ;;
        answer) echo "cli/answer;cli/prompts;cli/bench_card;card/record;card/render;extract;people;llm" ;;
        # The launcher (phase 10): `rumor-village` without a command, on top of
        # the game server of `rumor play` (the server package).
        launcher) echo "launcher;server;extract;llm/fake;cli/cli;cli/serve;cli/play;cli/stop_signal;$sim" ;;
        *) return 1 ;;
    esac
}

# engine_test_dirs <suite>: the engine/tests folders or file prefixes of the
# isolated build. stubs/doubles/ stands in for the packages a suite links
# against but does not test.
engine_test_dirs() {
    local s=stubs/doubles
    # The dataset commands (phase 4), for every suite that links cli/cli.
    local cmds="$s/cards_cmd;$s/validate_cmd;$s/prompts_cmd;$s/answer_cmd"
    # `rumor play` (phase 9), for the suites that link cli/cli without it.
    local play="$s/play_cmd"
    # The launcher (phase 10), for the suites that link cli/cli without it.
    local launcher=launcher/doubles
    case $1 in
        sim) echo "sim;$s;$launcher" ;;
        bench) echo "bench;$s/llama_batch;$s/render;$s/model_policy;$s/extract_cmd;$s/serve;$cmds;$play;$launcher" ;;
        server) echo "server;$s/llama_batch;$s/render;$s/model_policy;$s/extract_cmd;$s/bench_cmd;$cmds;$launcher" ;;
        # Only its own cases (launcher_*.cpp), not its double.
        launcher) echo "launcher/launcher_;$s/llama_batch;$s/render;$s/model_policy;$s/extract_cmd;$s/bench_cmd;$cmds" ;;
        extract) echo "extract;$s/llama_batch" ;;  # its GPU cases need the real batch
        *) echo "$1" ;;
    esac
}

# engine_needs_llama <suite>: whether the isolated build links llama.cpp.
engine_needs_llama() {
    case $1 in
        llm_support | llm | card_render | extract | server | prompts | answer | launcher) echo ON ;;  # server, launcher: cpp-httplib
        *) echo OFF ;;
    esac
}

# engine_build <mode> [suite]: configure and build.
#   full             everything, in build/engine      (rumor, rumor_tests)
#   sanitize         everything with ASan and UBSan, in build/engine-san
#   only <suite>     core plus one package and its tests, in build/engine-<suite>
# With ENGINE_CUDA=1 (not with sanitize) the build is made in the GPU image,
# with the CUDA and Vulkan backends of llama.cpp, in the same directory plus
# "-cuda". Prints the build directory (relative to the repo) on the last line
# of stdout.
engine_build() {
    local mode=$1 suite=${2:-} dir opts
    case $mode in
        full) dir=build/engine opts="" ;;
        sanitize) dir=build/engine-san opts="-DRUMOR_SANITIZE=ON" ;;
        only)
            local src
            src=$(engine_src_dirs "$suite") || {
                echo "engine: no isolated build for suite '$suite'" >&2
                return 2
            }
            dir=build/engine-$suite
            opts="-DRUMOR_ISOLATED=ON '-DRUMOR_SRC_DIRS=$src' '-DRUMOR_TEST_DIRS=$(engine_test_dirs "$suite")'"
            opts="$opts -DRUMOR_LLAMA=$(engine_needs_llama "$suite")"
            ;;
        *) echo "engine: unknown build mode '$mode'" >&2; return 2 ;;
    esac
    # What the binary says about itself in a results card.
    local engine_commit llama_commit
    engine_commit=$(git -C "$ROOT" describe --always --dirty 2>/dev/null || echo unknown)
    llama_commit=$(git -C "$ROOT/engine/third_party/llama.cpp" rev-parse HEAD 2>/dev/null || echo unknown)
    opts="$opts -DRUMOR_ENGINE_COMMIT=$engine_commit -DRUMOR_LLAMA_COMMIT=$llama_commit"

    if [ "${ENGINE_CUDA:-0}" = 1 ]; then
        [ "$mode" != sanitize ] || { echo "engine: no sanitizer build with CUDA" >&2; return 2; }
        local cap
        cap=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -n1)
        dir=$dir-cuda
        # --allow-shlib-undefined: libcuda.so.1 belongs to the driver and only
        # exists at run time.
        opts="$opts -DRUMOR_LLAMA=ON -DRUMOR_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=${cap/./}"
        opts="$opts -DCMAKE_EXE_LINKER_FLAGS=-Wl,--allow-shlib-undefined"
        engine_gpu_build_run sh -c "
            cmake -S engine -B '$dir' -DCMAKE_BUILD_TYPE=Release $opts >/dev/null &&
            cmake --build '$dir' -j\"\$(nproc)\"" >&2 || return 1
    else
        engine_run sh -c "
            cmake -S engine -B '$dir' -G Ninja -DCMAKE_BUILD_TYPE=Release $opts >/dev/null &&
            cmake --build '$dir'" >&2 || return 1
    fi
    echo "$dir"
}
