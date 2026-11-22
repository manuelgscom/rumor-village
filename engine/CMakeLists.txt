cmake_minimum_required(VERSION 3.25)
project(rumor LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

option(RUMOR_SANITIZE "Build with ASan and UBSan" OFF)

# The model runtime: llama.cpp, pinned as a submodule in third_party/. Off only
# in the isolated build of a package that never touches it.
option(RUMOR_LLAMA "Link llama.cpp" ON)
# GPU backends of llama.cpp: CUDA and Vulkan in one build, chosen at run time
# by device name. Without it llama.cpp is CPU-only, which is enough for the
# tests: they tokenize and check grammars, and nothing runs a model on the CPU.
option(RUMOR_CUDA "Build llama.cpp with the CUDA and Vulkan backends" OFF)
# Vulkan follows CUDA unless set: the pod builds CUDA alone
# (-DRUMOR_CUDA=ON -DRUMOR_VULKAN=OFF).
option(RUMOR_VULKAN "Build llama.cpp with the Vulkan backend" ${RUMOR_CUDA})
# The binary of a prebuilt package (phase 10, docs/fases/fase-10.md): one
# backend, starts without the GPU driver, its libraries next to it.
option(RUMOR_DIST "Build the binary of a prebuilt package (phase 10)" OFF)

# Isolated build of one work package: core plus the listed sources, tests only.
# Several packages can then be built at once in the same tree, each in its own
# build directory, without compiling one another's unfinished code. Test
# doubles (tests/<suite>/doubles/) are compiled only here: the full build links
# the real implementations instead.
#
# An entry of RUMOR_SRC_DIRS or RUMOR_TEST_DIRS is a folder ("people": every
# source under it) or a file prefix ("card/render": card/render*.cpp), because
# some packages share a folder.
option(RUMOR_ISOLATED "Build core plus RUMOR_SRC_DIRS and the tests in RUMOR_TEST_DIRS" OFF)
set(RUMOR_SRC_DIRS "" CACHE STRING "Folders or file prefixes of src/ to build besides core (isolated build)")
set(RUMOR_TEST_DIRS "" CACHE STRING "Folders or file prefixes of tests/ to build (isolated build)")

# What the binary says about itself in a results card. The build shortcuts pass
# them; "unknown" in a build made by hand.
set(RUMOR_ENGINE_COMMIT "unknown" CACHE STRING "git describe of the engine")
set(RUMOR_LLAMA_COMMIT "unknown" CACHE STRING "commit of the llama.cpp submodule")
# The version of the game (phase 10): dist/VERSION unless given.
set(RUMOR_VERSION_FILE ${CMAKE_CURRENT_SOURCE_DIR}/../dist/VERSION)
if(EXISTS ${RUMOR_VERSION_FILE})
    file(STRINGS ${RUMOR_VERSION_FILE} RUMOR_VERSION_DEFAULT LIMIT_COUNT 1)
else()
    set(RUMOR_VERSION_DEFAULT "unknown")
endif()
set(RUMOR_VERSION "${RUMOR_VERSION_DEFAULT}" CACHE STRING "version of the game (dist/VERSION)")

# The web version (phase 10, package F): with Emscripten only the engine of the
# Sin IA game is built, without llama.cpp, httplib or threads (cmake/web.cmake).
if(EMSCRIPTEN)
    set(SRC ${CMAKE_CURRENT_SOURCE_DIR}/src)
    include(cmake/web.cmake)
    return()
endif()

# MSVC (Windows, phase 10), before llama.cpp so that it gets them too. /utf-8:
# the sources are UTF-8 (llama.cpp sets it only in its own folders).
# /Zc:__cplusplus: llama.cpp reads __cplusplus to write its u8 literals under
# C++20, and MSVC says 199711L without it.
if(MSVC)
    add_compile_options("$<$<COMPILE_LANGUAGE:C,CXX>:/utf-8>" "$<$<COMPILE_LANGUAGE:CXX>:/Zc:__cplusplus>")
endif()

# llama.cpp comes first, so that the warning and sanitizer options below do not
# reach it. SYSTEM: its headers are not held to our warnings either.
if(RUMOR_LLAMA)
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_COMMON ON CACHE BOOL "" FORCE)  # chat templates (Jinja)
    set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
    set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
    set(GGML_CUDA ${RUMOR_CUDA} CACHE BOOL "" FORCE)
    set(GGML_VULKAN ${RUMOR_VULKAN} CACHE BOOL "" FORCE)
    if(RUMOR_DIST)
        # Without VMM ggml-cuda does not link the driver library (libcuda.so.1,
        # nvcuda.dll): cudart opens it at run time, so the binary starts on a
        # computer without NVIDIA and the launcher can say so.
        set(GGML_CUDA_NO_VMM ON CACHE BOOL "" FORCE)
        # No OpenMP runtime to ship (libgomp.so.1, vcomp140.dll): the model runs
        # on the GPU, and ggml has its own thread pool for the rest.
        set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
    endif()
    add_subdirectory(third_party/llama.cpp llama.cpp EXCLUDE_FROM_ALL SYSTEM)
endif()

if(MSVC)
    # Windows (phase 10, cmake/dist-windows.cmake refines it). Ours only: the
    # conforming preprocessor, for raw strings with \" in doctest's CHECK.
    set(RUMOR_WARNINGS /W4 /WX)
    add_compile_options(/Zc:preprocessor)
else()
    set(RUMOR_WARNINGS -Wall -Wextra -Wpedantic -Werror)
endif()
if(RUMOR_SANITIZE)
    # The instrumentation makes GCC 13 report out-of-bounds copies that are not
    # there (a 12-byte copy "out of the bounds [0, 12]"): shown, but not fatal.
    add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer -g)
    list(APPEND RUMOR_WARNINGS -Wno-error=array-bounds)
    add_link_options(-fsanitize=address,undefined)
endif()

set(SRC ${CMAKE_CURRENT_SOURCE_DIR}/src)
set(TESTS ${CMAKE_CURRENT_SOURCE_DIR}/tests)

# rumor_collect(<out> <base> <entries>): the sources of each entry, as a folder
# and as a file prefix.
function(rumor_collect out base entries)
    set(found "")
    foreach(entry IN LISTS entries)
        file(GLOB_RECURSE in_folder CONFIGURE_DEPENDS ${base}/${entry}/*.cpp)
        file(GLOB by_prefix CONFIGURE_DEPENDS ${base}/${entry}*.cpp)
        list(APPEND found ${in_folder} ${by_prefix})
    endforeach()
    list(REMOVE_DUPLICATES found)
    set(${out} ${found} PARENT_SCOPE)
endfunction()

# Sources are collected per folder, so no package has to edit this file.
if(RUMOR_ISOLATED)
    rumor_collect(LIB_SOURCES ${SRC} "core;${RUMOR_SRC_DIRS}")
    rumor_collect(TEST_SOURCES ${TESTS} "${RUMOR_TEST_DIRS}")
    list(APPEND TEST_SOURCES ${TESTS}/main.cpp)
else()
    file(GLOB_RECURSE LIB_SOURCES CONFIGURE_DEPENDS ${SRC}/*.cpp)
    file(GLOB_RECURSE TEST_SOURCES CONFIGURE_DEPENDS ${TESTS}/*.cpp)
    list(FILTER TEST_SOURCES EXCLUDE REGEX "/doubles/")
endif()
# The entry point of the command is not part of the library, and the web
# sources (src/web/) only build with Emscripten.
list(FILTER LIB_SOURCES EXCLUDE REGEX "/cli/main\\.cpp$")
list(FILTER LIB_SOURCES EXCLUDE REGEX "/src/web/")

add_library(rumor_lib STATIC ${LIB_SOURCES})
target_compile_options(rumor_lib PRIVATE ${RUMOR_WARNINGS})
target_include_directories(rumor_lib PUBLIC ${SRC})
target_include_directories(rumor_lib SYSTEM PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/third_party)
if(RUMOR_LLAMA)
    # cpp-httplib (vendored by llama.cpp, built with LLAMA_BUILD_COMMON) for the
    # live server. Its target does not export an include path: the vendor/ root
    # is added here, after ours, so it is included as <cpp-httplib/httplib.h>
    # (as llama.cpp does) and is not held to our warnings either.
    target_link_libraries(rumor_lib PUBLIC llama llama-common cpp-httplib)
    target_include_directories(rumor_lib SYSTEM PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party/llama.cpp/vendor)
endif()
# Only this file is rebuilt when the commit changes.
set(RUMOR_BACKENDS "")
if(RUMOR_LLAMA AND RUMOR_CUDA)
    list(APPEND RUMOR_BACKENDS cuda)
endif()
if(RUMOR_LLAMA AND RUMOR_VULKAN)
    list(APPEND RUMOR_BACKENDS vulkan)
endif()
if(RUMOR_BACKENDS)
    list(JOIN RUMOR_BACKENDS " " RUMOR_BACKENDS)
else()
    set(RUMOR_BACKENDS "none")
endif()
set_source_files_properties(${SRC}/core/build_info.cpp PROPERTIES COMPILE_DEFINITIONS
    "RUMOR_ENGINE_COMMIT=\"${RUMOR_ENGINE_COMMIT}\";RUMOR_LLAMA_COMMIT=\"${RUMOR_LLAMA_COMMIT}\";RUMOR_VERSION=\"${RUMOR_VERSION}\";RUMOR_BACKENDS=\"${RUMOR_BACKENDS}\"")

if(NOT RUMOR_ISOLATED)
    add_executable(rumor ${SRC}/cli/main.cpp)
    target_compile_options(rumor PRIVATE ${RUMOR_WARNINGS})
    target_link_libraries(rumor PRIVATE rumor_lib)
endif()

# The builds to hand out (phase 10): libraries next to the binary, the CUDA
# driver not linked, the runtime inside. One file per system, one owner each.
if(RUMOR_DIST)
    if(WIN32)
        include(cmake/dist-windows.cmake OPTIONAL)
    else()
        include(cmake/dist-linux.cmake OPTIONAL)
    endif()
endif()

add_executable(rumor_tests ${TEST_SOURCES})
target_compile_options(rumor_tests PRIVATE ${RUMOR_WARNINGS})
target_link_libraries(rumor_tests PRIVATE rumor_lib)
target_include_directories(rumor_tests PRIVATE ${TESTS})
# Tests read the data of the repo from here.
target_compile_definitions(rumor_tests PRIVATE
    RUMOR_DATA_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../data")
