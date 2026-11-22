# Build image of the Linux prebuilts (phase 10, package A): the engine with one
# GPU backend, CUDA or Vulkan, for scripts/dist-build.sh (dist/linux/build.sh).
# No GPU: compiling CUDA needs the toolkit, not the card. The repo is mounted at
# /work; nothing is copied into the image.
#
# Ubuntu 22.04, not 20.04: GCC 10 (the newest in 20.04) lacks std::from_chars
# for floating point, which the engine uses, and the glslc and the Vulkan
# loader of the LunarG SDK need glibc 2.34.
#
# GCC 11, not 12: the static libgcc of GCC 12 calls _dl_find_object, which
# raises the glibc the binary needs from 2.34 to 2.35 (RHEL 9 has 2.34).
FROM nvidia/cuda:12.9.2-devel-ubuntu22.04

# Pinned downloads, checked against their published SHA-256.
ARG CMAKE_VERSION=3.31.6
ARG CMAKE_SHA256=5a1133ff103c71eb5120e2cc3de922733e7d8a26a98ae716397e8676adb367bf
ARG VULKAN_SDK_VERSION=1.4.363.0
ARG VULKAN_SDK_SHA256=197962f5cbf80baf2775a03336a01cee7c8745686c65aaa70d3f751ade4d7e43

ENV DEBIAN_FRONTEND=noninteractive

# GCC 11, the default of 22.04, is the compiler of everything (host code, nvcc
# host compiler and the Vulkan shader generator, which looks for plain g++).
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc-11 g++-11 ninja-build patchelf file binutils xz-utils curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && test "$(readlink -f /usr/bin/g++)" = /usr/bin/x86_64-linux-gnu-g++-11

# CMake >= 3.25 (engine/CMakeLists.txt); 22.04 ships 3.22.
RUN curl -fsSL -o /tmp/cmake.tar.gz \
        "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-linux-x86_64.tar.gz" \
    && echo "${CMAKE_SHA256}  /tmp/cmake.tar.gz" | sha256sum -c - \
    && mkdir /opt/cmake && tar xzf /tmp/cmake.tar.gz -C /opt/cmake --strip-components=1 \
    && rm /tmp/cmake.tar.gz

# Vulkan: headers, glslc and the loader of the LunarG SDK. The ones of 22.04
# (1.3.204) are too old for the shaders of llama.cpp v0.9.0. Only what the
# build uses is kept: include/, bin/glslc, the loader (copied to lib/, where
# CMake's FindVulkan looks) and the CMake packages (SPIRV-Headers).
RUN V=${VULKAN_SDK_VERSION} \
    && curl -fsSL -o /tmp/vulkansdk.tar.xz \
        "https://sdk.lunarg.com/sdk/download/${V}/linux/vulkansdk-linux-x86_64-${V}.tar.xz" \
    && echo "${VULKAN_SDK_SHA256}  /tmp/vulkansdk.tar.xz" | sha256sum -c - \
    && mkdir /opt/vulkan-sdk \
    && tar xJf /tmp/vulkansdk.tar.xz -C /opt/vulkan-sdk --strip-components=2 \
        "${V}/x86_64/include" "${V}/x86_64/bin/glslc" "${V}/x86_64/lib/VulkanLoader" \
        "${V}/x86_64/share/cmake" \
    && cp -a /opt/vulkan-sdk/lib/VulkanLoader/lib/libvulkan.so* /opt/vulkan-sdk/lib/ \
    && rm /tmp/vulkansdk.tar.xz

# The AppImage (dist/package/assemble.sh): mksquashfs makes the image,
# rsvg-convert the icon, and the type 2 runtime of AppImage/type2-runtime goes
# in front of it. The static runtime: no libfuse2 on the player's machine, only
# fusermount3 (or fusermount). Release 20251108 (tag at commit dd6cebed).
ARG APPIMAGE_RUNTIME_VERSION=20251108
ARG APPIMAGE_RUNTIME_SHA256=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d
RUN apt-get update && apt-get install -y --no-install-recommends squashfs-tools librsvg2-bin \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/appimage \
    && curl -fsSL --retry 5 --retry-all-errors --max-time 120 -o /opt/appimage/runtime-x86_64 \
        "https://github.com/AppImage/type2-runtime/releases/download/${APPIMAGE_RUNTIME_VERSION}/runtime-x86_64" \
    && echo "${APPIMAGE_RUNTIME_SHA256}  /opt/appimage/runtime-x86_64" | sha256sum -c - \
    && chmod 644 /opt/appimage/runtime-x86_64

ENV PATH=/opt/cmake/bin:/opt/vulkan-sdk/bin:${PATH} \
    VULKAN_SDK=/opt/vulkan-sdk \
    CUDAHOSTCXX=/usr/bin/g++-11

WORKDIR /work

# The base image entrypoint prints a banner on stdout.
ENTRYPOINT []
