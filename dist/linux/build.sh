#!/usr/bin/env bash
# Build the binary of a Linux prebuilt (phase 10, package A). Runs inside
# docker/dist-linux.Dockerfile with the repo at /work: use
# scripts/dist-build.sh linux-cuda|linux-vulkan, not this script.
#
#   dist/linux/build.sh cuda|vulkan
#
# Configures the engine in build/dist-linux-<backend>/ (Release, one backend,
# RUMOR_DIST), builds only `rumor` and leaves in build/dist-linux-<backend>/stage/
# the binary and lib/ with the libraries it needs that are neither glibc nor
# the GPU driver's. Then checks the rpath and that nothing is missing.
#
# Environment: DIST_JOBS (parallel jobs, default 6: nvcc takes a lot of memory),
# RUMOR_ENGINE_COMMIT and RUMOR_LLAMA_COMMIT (what `rumor --version` says).
set -euo pipefail

backend=${1:-}
# Every NVIDIA generation from the GTX 10 to the RTX 50 as machine code, plus
# PTX of 8.9 for later cards (docs/fases/fase-10.md, point 1).
cuda_archs="61-real;75-real;86-real;89-real;120a-real;89-virtual"
case $backend in
    cuda)
        # GGML_CUDA_NCCL=OFF: the image has NCCL (only for several GPUs), and
        # ggml would link libnccl.so.2.
        opts=(-DRUMOR_CUDA=ON -DRUMOR_VULKAN=OFF "-DCMAKE_CUDA_ARCHITECTURES=$cuda_archs"
            -DGGML_CUDA_NCCL=OFF)
        # Libraries taken into lib/: the CUDA runtime and cuBLAS. Never
        # libcuda.so.1, which is the driver's (and not linked: GGML_CUDA_NO_VMM).
        bundle="libcudart.so.12 libcublas.so.12 libcublasLt.so.12"
        ;;
    vulkan)
        opts=(-DRUMOR_CUDA=OFF -DRUMOR_VULKAN=ON)
        # The Vulkan loader, so that the binary starts without Vulkan installed.
        bundle="libvulkan.so.1"
        ;;
    *) echo "usage: $0 cuda|vulkan" >&2; exit 2 ;;
esac

dir=build/dist-linux-$backend
stage=$dir/stage
jobs=${DIST_JOBS:-6}
log=$dir.configure.log
mkdir -p "$(dirname "$dir")"
start=$(date +%s)

# GGML_NATIVE=OFF and no AVX: the CPU part of ggml (little: the model runs on
# the GPU) must run on any x86-64 with SSE 4.2, not only on the build machine.
# (RUMOR_DIST already turns OpenMP off: no libgomp.)
cmake -S engine -B "$dir" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DRUMOR_LLAMA=ON -DRUMOR_DIST=ON "${opts[@]}" \
    -DGGML_NATIVE=OFF -DGGML_SSE42=ON -DGGML_AVX=OFF -DGGML_AVX2=OFF -DGGML_BMI2=OFF \
    -DGGML_FMA=OFF -DGGML_F16C=OFF -DGGML_AVX512=OFF \
    "-DRUMOR_ENGINE_COMMIT=${RUMOR_ENGINE_COMMIT:-unknown}" \
    "-DRUMOR_LLAMA_COMMIT=${RUMOR_LLAMA_COMMIT:-unknown}" \
    >"$log" 2>&1 || { tail -n 40 "$log" >&2; exit 1; }
# What CMake made of the architectures and of glslc.
grep -E "CUDA_ARCHITECTURES|Replacing|supported by glslc|Found Vulkan|Found CUDAToolkit" "$log" || true
cmake --build "$dir" --target rumor -j"$jobs"
built=$(date +%s)

# --- stage ----------------------------------------------------------------------
rm -rf "$stage"
mkdir -p "$stage/lib"
cp "$dir/rumor" "$stage/rumor"
# The libraries to ship, from where ldd finds them in the build image (cuBLAS
# loads cuBLASLt: ldd lists it too). The Vulkan loader is not on the library
# path of the image: it is taken from the SDK.
deps=$(ldd "$dir/rumor")
for name in $bundle; do
    path=$(awk -v n="$name" '$1 == n && $2 == "=>" {print $3}' <<<"$deps")
    [[ $path == /* ]] || [ -z "$path" ] || path=${VULKAN_SDK:-/nonexistent}/lib/$name
    [ -e "$path" ] || path=""
    [[ $path == /* ]] || { echo "dist-linux: $name is not a dependency of rumor" >&2; exit 1; }
    cp -L "$path" "$stage/lib/$name"
    # DT_RPATH $ORIGIN (cuBLAS comes with RUNPATH $ORIGIN, which LD_LIBRARY_PATH
    # overrides): cuBLASLt is always the one next to it, even when the user has
    # another CUDA on LD_LIBRARY_PATH.
    patchelf --force-rpath --set-rpath '$ORIGIN' "$stage/lib/$name"
done

# --- checks ---------------------------------------------------------------------
fail() { echo "dist-linux: $*" >&2; exit 1; }

# The rpath: exactly $ORIGIN/lib as DT_RPATH in the binary, and no path of the
# container in the libraries ($ORIGIN in cuBLAS is fine).
rpath=$(readelf -d "$stage/rumor" | sed -n 's/.*(RPATH).*\[\(.*\)\]/\1/p')
[ "$rpath" = '$ORIGIN/lib' ] || fail "rumor: RPATH is '$rpath', expected \$ORIGIN/lib"
! readelf -d "$stage/rumor" | grep -q RUNPATH || fail "rumor: has a RUNPATH"
for lib in "$stage"/lib/*; do
    paths=$(readelf -d "$lib" | sed -n 's/.*(R\(UN\)\{0,1\}PATH).*\[\(.*\)\]/\2/p')
    [ -z "$paths" ] || [ "$paths" = '$ORIGIN' ] || fail "$(basename "$lib"): rpath '$paths'"
done

# Everything resolves to lib/ or to the system: only glibc, libgcc_s (cuBLAS)
# and, for CUDA, the driver's libcuda.so.1 (loaded at run time, not linked).
system='^(linux-vdso\.so|libc\.so|libm\.so|libdl\.so|libpthread\.so|librt\.so|ld-linux-x86-64\.so|libgcc_s\.so)'
ldd "$stage/rumor" | while read -r name arrow path _; do
    [[ $name =~ $system ]] && continue
    [[ $name == /* ]] && continue  # the dynamic loader, by its path
    [ "$arrow" = "=>" ] || fail "unexpected ldd line: $name $arrow $path"
    [ "$path" != "not" ] || [[ $name == libcuda.so.1 ]] || fail "$name not found"
    [[ $path == "$PWD/$stage/lib/"* || $path == "$stage/lib/"* ]] ||
        fail "$name resolves to $path, outside lib/ and not a system library"
done
for lib in "$stage"/lib/*; do
    ! ldd "$lib" | grep -v '^\s*libcuda\.so\.1' | grep -q 'not found' ||
        fail "$(basename "$lib"): a dependency is not found"
done

# The newest glibc symbol version any shipped file needs.
glibc=$(for f in "$stage/rumor" "$stage"/lib/*; do objdump -T "$f"; done |
    grep -oE 'GLIBC_[0-9.]+' | sort -Vu | tail -n1)
! objdump -p "$stage/rumor" | grep -E 'NEEDED.*(libstdc\+\+|libgcc_s)' ||
    fail "rumor links libstdc++ or libgcc_s dynamically"

"$stage/rumor" --version

echo "--- dist-linux-$backend ---"
echo "stage:       $stage ($(du -sh "$stage" | cut -f1))"
(cd "$stage" && find . -type f -exec du -h {} + | sort -k2)
echo "rpath:       $rpath"
echo "needs glibc: ${glibc#GLIBC_}"
echo "build time:  $(((built - start) / 60)) min $(((built - start) % 60)) s (-j$jobs)"
