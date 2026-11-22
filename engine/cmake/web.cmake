# The web version (phase 10, package F; src/web/README.md): the engine of the
# game Sin IA compiled to WebAssembly with Emscripten, without llama.cpp,
# httplib, threads, the command line or the servers. Included by
# CMakeLists.txt only when Emscripten compiles; SRC is set there.
#
#   rumor_web.js + rumor_web.wasm   (the data of the game embedded at /data)

set(RUMOR_DATA ${CMAKE_CURRENT_SOURCE_DIR}/../data)

# The simulation with the baseline (the "sim" set of scripts/engine-lib.sh),
# the draft, the cards and the game files of `rumor play`, and the parsing of
# a fact that the draft needs (extract/).
set(RUMOR_WEB_DIRS sim world people memory log metrics core)
set(RUMOR_WEB_SOURCES
    ${SRC}/policy/baseline.cpp
    ${SRC}/card/validate.cpp
    ${SRC}/card/textcheck.cpp
    ${SRC}/server/game_draft.cpp
    ${SRC}/server/draft_parse.cpp
    ${SRC}/server/card_recorder.cpp
    ${SRC}/server/game_files.cpp
    ${SRC}/extract/extract.cpp
    ${SRC}/extract/prompt.cpp)
foreach(dir IN LISTS RUMOR_WEB_DIRS)
    file(GLOB found CONFIGURE_DEPENDS ${SRC}/${dir}/*.cpp)
    list(APPEND RUMOR_WEB_SOURCES ${found})
endforeach()
file(GLOB web_found CONFIGURE_DEPENDS ${SRC}/web/*.cpp)
list(APPEND RUMOR_WEB_SOURCES ${web_found})

# What the game reads from data/ (no prompts, and of the scenarios only the
# ones of the game): embedded in the .wasm at /data.
set(RUMOR_WEB_DATA
    world/places.json world/paths.json world/timetable.json
    vocab/es.json vocab/en.json
    people/people.json
    game/settings.json
    scenarios/party-10.json scenarios/party-25.json scenarios/party-50.json
    scenarios/party-70.json scenarios/party-100.json scenarios/telephone-20.json)
file(GLOB challenge_files RELATIVE ${RUMOR_DATA} CONFIGURE_DEPENDS ${RUMOR_DATA}/challenges/*.json)
list(APPEND RUMOR_WEB_DATA ${challenge_files})
set(RUMOR_WEB_EMBED "")
set(RUMOR_WEB_DATA_DEPS "")
foreach(f IN LISTS RUMOR_WEB_DATA)
    list(APPEND RUMOR_WEB_EMBED "--embed-file=${RUMOR_DATA}/${f}@/data/${f}")
    list(APPEND RUMOR_WEB_DATA_DEPS ${RUMOR_DATA}/${f})
endforeach()

add_executable(rumor_web ${RUMOR_WEB_SOURCES})
target_include_directories(rumor_web PRIVATE ${SRC})
target_include_directories(rumor_web SYSTEM PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/third_party)
target_compile_options(rumor_web PRIVATE -Wall -Wextra -Wpedantic -Werror -fwasm-exceptions)
set_source_files_properties(${SRC}/core/build_info.cpp PROPERTIES COMPILE_DEFINITIONS
    "RUMOR_ENGINE_COMMIT=\"${RUMOR_ENGINE_COMMIT}\";RUMOR_LLAMA_COMMIT=\"none\";RUMOR_VERSION=\"${RUMOR_VERSION}\";RUMOR_BACKENDS=\"none\"")
target_link_options(rumor_web PRIVATE
    -fwasm-exceptions
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=createRumorWeb
    -sENVIRONMENT=web,worker,node
    -sALLOW_MEMORY_GROWTH=1
    -sEXPORTED_FUNCTIONS=_rw_call
    -sEXPORTED_RUNTIME_METHODS=ccall
    ${RUMOR_WEB_EMBED})
set_target_properties(rumor_web PROPERTIES SUFFIX ".js" LINK_DEPENDS "${RUMOR_WEB_DATA_DEPS}")
