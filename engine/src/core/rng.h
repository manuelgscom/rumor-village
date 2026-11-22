#pragma once
// Deterministic randomness. Everything random in the engine comes from here:
// the same run seed gives the same log byte for byte, on any machine.
//
// Rules for every package:
//   - Never use std::*_distribution, std::shuffle, rand() or a wall clock:
//     their results change between standard libraries or runs.
//   - Never keep a generator alive across ticks. Derive a fresh one from
//     (run seed, tick, entity, stream) where it is needed, so a result does not
//     depend on the order in which things are processed.
//   - Probabilities are integers in parts per million; there is no floating
//     point in the engine state.

#include <cstddef>
#include <cstdint>
#include <utility>
#include <vector>

#include "core/ids.h"
#include "core/time.h"

namespace rumor {

inline constexpr std::uint32_t kPpm = 1'000'000;

// What a derived seed is for. Two uses never share a stream.
enum class Stream : std::uint32_t {
    turn = 1,        // seed of a `turn` decision
    plan = 2,        // seed of a `plan` decision
    forget = 3,      // forgetting of one neighbor's memory in one tick
    encounter = 4,   // who starts talking at one place in one tick
    schedule = 5,    // per-neighbor variation of the timetable
    population = 6,  // jobs, traits and social graph
    scenario = 7,    // anything else a scenario needs
};

// SplitMix64 finalizer: a bijective mix of 64 bits.
constexpr std::uint64_t mix64(std::uint64_t x) {
    x ^= x >> 30;
    x *= 0xBF58476D1CE4E5B9ULL;
    x ^= x >> 27;
    x *= 0x94D049BB133111EBULL;
    x ^= x >> 31;
    return x;
}

// Seed for one use: `entity` is the value of a neighbor or place identifier,
// or 0 when the use is global.
constexpr std::uint64_t derive_seed(std::uint64_t run_seed, Tick tick, std::uint32_t entity,
                                    Stream stream) {
    std::uint64_t h = mix64(run_seed + 0x9E3779B97F4A7C15ULL);
    h = mix64(h ^ (static_cast<std::uint64_t>(static_cast<std::uint32_t>(tick)) +
                   0xD1B54A32D192ED03ULL));
    h = mix64(h ^ ((static_cast<std::uint64_t>(entity) << 32) |
                   static_cast<std::uint64_t>(stream)));
    return h;
}
constexpr std::uint64_t derive_seed(std::uint64_t run_seed, Tick tick, NeighborId who,
                                    Stream stream) {
    return derive_seed(run_seed, tick, who.v, stream);
}

// SplitMix64 generator.
class Rng {
  public:
    constexpr explicit Rng(std::uint64_t seed) : state_(seed) {}

    constexpr std::uint64_t next() {
        state_ += 0x9E3779B97F4A7C15ULL;
        return mix64(state_);
    }

    // Uniform in [0, n). n must be positive. Unbiased (Lemire's method).
    constexpr std::uint32_t below(std::uint32_t n) {
        std::uint64_t m = (next() >> 32) * static_cast<std::uint64_t>(n);
        auto low = static_cast<std::uint32_t>(m);
        if (low < n) {
            const std::uint32_t threshold = (0u - n) % n;
            while (low < threshold) {
                m = (next() >> 32) * static_cast<std::uint64_t>(n);
                low = static_cast<std::uint32_t>(m);
            }
        }
        return static_cast<std::uint32_t>(m >> 32);
    }

    // Uniform in [lo, hi], both included. lo <= hi.
    constexpr int range(int lo, int hi) {
        return lo + static_cast<int>(below(static_cast<std::uint32_t>(hi - lo) + 1u));
    }

    // True with probability ppm / 1'000'000. 0 is never, 1'000'000 is always.
    constexpr bool chance_ppm(std::uint32_t ppm) { return below(kPpm) < ppm; }

    // Fisher-Yates.
    template <class T>
    void shuffle(std::vector<T>& items) {
        for (std::size_t i = items.size(); i > 1; --i) {
            const std::size_t j = below(static_cast<std::uint32_t>(i));
            std::swap(items[i - 1], items[j]);
        }
    }

    // A uniformly chosen element. The vector must not be empty.
    template <class T>
    const T& pick(const std::vector<T>& items) {
        return items[below(static_cast<std::uint32_t>(items.size()))];
    }

  private:
    std::uint64_t state_;
};

}  // namespace rumor
