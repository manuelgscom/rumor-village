#pragma once
// SHA-256, for the fingerprint of a decision request and to check a
// downloaded model (phase 10), which is fed in pieces.

#include <array>
#include <cstdint>
#include <string>
#include <string_view>

namespace rumor {

// Lowercase hexadecimal digest: 64 characters.
std::string sha256_hex(std::string_view data);

// The same digest of data given in pieces: update() any number of times, then
// hex() once.
class Sha256 {
public:
    Sha256();
    void update(std::string_view data);
    std::string hex();

private:
    std::array<std::uint32_t, 8> state_;
    std::array<unsigned char, 64> block_{};
    std::size_t used_ = 0;
    std::uint64_t total_ = 0;
};

}  // namespace rumor
