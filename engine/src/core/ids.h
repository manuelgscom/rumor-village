#pragma once
// Identifiers of neighbors, places, facts and conversations. They do not
// depend on the language: the model sees names, the engine and the log see
// these.
//
// Values start at 1 and 0 means "none". The text form is a letter and the
// number, zero-padded to a minimum width: n017, p03, f1, c12.

#include <compare>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace rumor {

template <char Prefix, int Width>
struct Id {
    std::uint32_t v = 0;

    constexpr Id() = default;
    constexpr explicit Id(std::uint32_t value) : v(value) {}

    constexpr bool valid() const { return v != 0; }
    constexpr explicit operator bool() const { return v != 0; }

    // Position in a container that holds one element per identifier, in order.
    // Only for valid identifiers.
    constexpr std::size_t index() const { return v - 1; }
    static constexpr Id from_index(std::size_t i) {
        return Id(static_cast<std::uint32_t>(i + 1));
    }

    friend constexpr auto operator<=>(Id, Id) = default;

    // "n017". The none identifier has no text form: do not call it on one.
    std::string str() const {
        std::string digits = std::to_string(v);
        std::string out(1, Prefix);
        if (digits.size() < static_cast<std::size_t>(Width)) {
            out.append(static_cast<std::size_t>(Width) - digits.size(), '0');
        }
        return out + digits;
    }

    // Accepts only the exact text that str() writes.
    static std::optional<Id> parse(std::string_view text) {
        if (text.size() < 2 || text.size() > 10 || text[0] != Prefix) return std::nullopt;
        std::uint32_t value = 0;
        for (char c : text.substr(1)) {
            if (c < '0' || c > '9') return std::nullopt;
            value = value * 10 + static_cast<std::uint32_t>(c - '0');
        }
        Id id(value);
        if (!id.valid() || id.str() != text) return std::nullopt;
        return id;
    }
};

using NeighborId = Id<'n', 3>;
using PlaceId = Id<'p', 2>;
using FactId = Id<'f', 1>;
using ConvId = Id<'c', 1>;

}  // namespace rumor
