#pragma once
// Text keys of the closed enumerations. Each enum lists its keys once, in the
// order of its values; `key` and `from_key` are the only conversions the engine
// uses, so the log, the data files and the model vocabulary cannot drift apart.

#include <array>
#include <cstddef>
#include <optional>
#include <string_view>

namespace rumor {

// Specialized per enum with RUMOR_ENUM_KEYS.
template <class E>
struct EnumKeys;

#define RUMOR_ENUM_KEYS(E, ...)                                                    \
    template <>                                                                    \
    struct EnumKeys<E> {                                                           \
        static constexpr auto keys = std::to_array<std::string_view>({__VA_ARGS__}); \
    }

// Number of values of the enum.
template <class E>
inline constexpr std::size_t enum_count = EnumKeys<E>::keys.size();

template <class E>
constexpr std::string_view key(E value) {
    return EnumKeys<E>::keys[static_cast<std::size_t>(value)];
}

template <class E>
constexpr std::optional<E> from_key(std::string_view text) {
    for (std::size_t i = 0; i < EnumKeys<E>::keys.size(); ++i) {
        if (EnumKeys<E>::keys[i] == text) return static_cast<E>(i);
    }
    return std::nullopt;
}

}  // namespace rumor
