# Engine image for the phase 0 benchmarks: llama.cpp built with the CUDA and
# Vulkan backends in a single build. The backend is chosen at run time with
# --device (see `llama-server --list-devices`).
ARG CUDA_IMAGE=nvidia/cuda:12.9.2-devel-ubuntu24.04
FROM ${CUDA_IMAGE}

ARG LLAMA_REF
ARG LLAMA_COMMIT
# CMAKE_CUDA_ARCHITECTURES, from `nvidia-smi --query-gpu=compute_cap` (12.0 -> 120)
ARG CUDA_ARCH=120

ENV DEBIAN_FRONTEND=noninteractive

# Build tools, bench tools (curl, jq) and what Vulkan needs: headers and shader
# compiler to build, loader and X libraries for the NVIDIA ICD at run time.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake git ca-certificates curl jq bc util-linux \
        libssl-dev libgomp1 \
        libvulkan-dev glslc spirv-headers vulkan-tools \
        libx11-6 libxext6 libegl1 libglvnd0 \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch "${LLAMA_REF}" https://github.com/ggml-org/llama.cpp /src/llama.cpp \
    && test "$(git -C /src/llama.cpp rev-parse HEAD)" = "${LLAMA_COMMIT}"

# --allow-shlib-undefined: libcuda.so.1 belongs to the driver and only exists
# at run time, so the executables cannot resolve it while linking.
RUN cmake -S /src/llama.cpp -B /src/llama.cpp/build \
        -DCMAKE_BUILD_TYPE=Release \
        -DCMAKE_INSTALL_PREFIX=/opt/llama \
        -DGGML_CUDA=ON \
        -DGGML_VULKAN=ON \
        -DCMAKE_CUDA_ARCHITECTURES="${CUDA_ARCH}" \
        -DLLAMA_BUILD_TESTS=OFF \
        -DLLAMA_USE_PREBUILT_UI=OFF \
        -DLLAMA_TOOLS_INSTALL=ON \
        -DCMAKE_EXE_LINKER_FLAGS=-Wl,--allow-shlib-undefined \
    && cmake --build /src/llama.cpp/build -j"$(nproc)" \
    && cmake --install /src/llama.cpp/build

ENV PATH=/opt/llama/bin:${PATH} \
    LD_LIBRARY_PATH=/opt/llama/lib \
    CMAKE_PREFIX_PATH=/opt/llama \
    NVIDIA_DRIVER_CAPABILITIES=all

WORKDIR /work

# Without a GPU (scripts/bench-run.sh --tools) the driver library libcuda.so.1
# is absent and the llama.cpp tools do not start. The toolkit stub is enough for
# tools that never run a model (llama-tokenize). bench-run.sh adds this
# directory to LD_LIBRARY_PATH only in --tools mode.
RUN mkdir /opt/cuda-stub \
    && ln -s /usr/local/cuda/lib64/stubs/libcuda.so /opt/cuda-stub/libcuda.so.1

# The base image entrypoint prints a banner on stdout, which would end up in
# the files the bench scripts redirect.
ENTRYPOINT []
