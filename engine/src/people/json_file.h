#pragma once
// Reading of the data files of the people package.

#include <fstream>
#include <stdexcept>
#include <string>

#include <nlohmann/json.hpp>

namespace rumor::people {

using Json = nlohmann::json;

inline Json read_json_file(const std::string& path) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("cannot open " + path);
    try {
        return Json::parse(in);
    } catch (const Json::exception& e) {
        throw std::runtime_error(path + ": " + e.what());
    }
}

// A non-empty string member of `obj`, or an error that names `where`.
inline std::string string_member(const Json& obj, const char* member, const std::string& where) {
    const auto it = obj.find(member);
    if (it == obj.end() || !it->is_string() || it->get<std::string>().empty()) {
        throw std::runtime_error(where + ": '" + member + "' must be a non-empty string");
    }
    return it->get<std::string>();
}

}  // namespace rumor::people
