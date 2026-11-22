# The Windows binary of a prebuilt package (phase 10, docs/fases/fase-10.md).
# Included by CMakeLists.txt with RUMOR_DIST on Windows, after the `rumor`
# target exists. dist/windows/build.ps1 configures it; by hand:
#
#   cmake -S engine -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
#         -DRUMOR_DIST=ON -DRUMOR_CUDA=ON|OFF -DRUMOR_VULKAN=OFF|ON
#         -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded -DGGML_NATIVE=OFF
#
# - The MSVC runtime is linked statically (/MT), so nothing has to be
#   installed. It must reach llama.cpp and ggml too, and those targets exist
#   before this file runs: the value is given when configuring, and checked here.
# - The Vulkan loader (vulkan-1.dll) is delay-loaded: the binary starts on a
#   computer without it, and the launcher checks it with LoadLibrary before
#   anything touches ggml.
# - The process code page is UTF-8 (dist/windows/rumor.manifest): the engine
#   opens files with narrow paths, which then work in folders with accents.
# - CUDA: GGML_CUDA_NO_VMM (CMakeLists.txt) keeps nvcuda.dll out; cudart,
#   cublas and cublasLt are DLLs next to the binary (build.ps1 copies them).
#   cublas64_12.dll is delay-loaded: with cublasLt it is about 770 MB, and
#   loading it before main left the console empty for seconds. Only the model
#   uses it, so Sin IA never loads it. cudart stays a normal import: the fatbin
#   registration of nvcc calls it from static initializers anyway, and it is small.

if(NOT CMAKE_MSVC_RUNTIME_LIBRARY STREQUAL "MultiThreaded")
    message(FATAL_ERROR "RUMOR_DIST on Windows needs -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded "
        "(the static MSVC runtime, also for llama.cpp)")
endif()

if(RUMOR_VULKAN AND TARGET rumor)
    target_link_options(rumor PRIVATE /DELAYLOAD:vulkan-1.dll)
    target_link_libraries(rumor PRIVATE delayimp)
endif()

if(RUMOR_CUDA AND TARGET rumor)
    target_link_options(rumor PRIVATE /DELAYLOAD:cublas64_12.dll)
    target_link_libraries(rumor PRIVATE delayimp)
endif()

# CMake embeds a .manifest source with the linker (/MANIFESTINPUT).
if(TARGET rumor)
    target_sources(rumor PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../dist/windows/rumor.manifest)
endif()
