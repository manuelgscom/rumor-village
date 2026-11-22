# The binary of a Linux prebuilt (phase 10, package A), included by
# engine/CMakeLists.txt with RUMOR_DIST after the `rumor` target exists.
#
# - Only glibc from the system: libstdc++ and libgcc are linked in.
# - The backend libraries (CUDA runtime and cuBLAS, or the Vulkan loader) go in
#   lib/ next to the binary: rpath $ORIGIN/lib and nothing else, so no path of
#   the build container ends up in the binary. DT_RPATH (--disable-new-dtags),
#   not DT_RUNPATH, so that it also applies to the dependencies of those
#   libraries.
target_link_options(rumor PRIVATE -static-libstdc++ -static-libgcc -Wl,--disable-new-dtags)
set_target_properties(rumor PROPERTIES
    BUILD_WITH_INSTALL_RPATH ON
    INSTALL_RPATH "\$ORIGIN/lib"
    INSTALL_RPATH_USE_LINK_PATH OFF)

# The warnings gate is the development build (GCC 13, scripts/engine-build.sh).
# Older compilers report false positives in libstdc++ (GCC 12: a -Wrestrict on
# std::string operator+, GCC bug 105329): shown, but not fatal here.
target_compile_options(rumor_lib PRIVATE -Wno-error)
target_compile_options(rumor PRIVATE -Wno-error)
