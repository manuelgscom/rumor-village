#pragma once
// Simulated time.
//
//   Tick      one simulated minute. Tick 0 is 00:00 of day 0 of the run; a run
//             starts at its scenario's start_tick (480 = 08:00 of day 0).
//   TimeSlot  the engine and log form of the `when` slot: half hours since
//             00:00 of day 0. Slot 42 is day 0, 21:00.
//
// The model never sees a TimeSlot. It reads and writes "<day word> HH:MM"
// ("hoy 21:00", "tomorrow 09:30"), relative to the day of the neighbor who is
// deciding; RelativeWhen is that form as data and the vocabulary supplies the
// two day words.

#include <cstdint>
#include <optional>
#include <string>

namespace rumor {

using Tick = std::int32_t;
using TimeSlot = std::int32_t;

inline constexpr int kTickSeconds = 60;
inline constexpr Tick kTicksPerHour = 60;
inline constexpr Tick kTicksPerSlot = 30;
inline constexpr Tick kTicksPerDay = 24 * kTicksPerHour;
inline constexpr int kSlotsPerDay = 48;

// Ticks and slots are never negative.
constexpr int day_of(Tick t) { return t / kTicksPerDay; }
constexpr int minute_of_day(Tick t) { return t % kTicksPerDay; }
constexpr int hour_of_day(Tick t) { return minute_of_day(t) / kTicksPerHour; }

// Day of the week of a tick: 0 is Monday. `start_weekday` is that of day 0.
constexpr int weekday_of(Tick t, int start_weekday) { return (start_weekday + day_of(t)) % 7; }

// The slot that contains a tick, and the tick at which a slot starts.
constexpr TimeSlot slot_of(Tick t) { return t / kTicksPerSlot; }
constexpr Tick tick_of(TimeSlot slot) { return slot * kTicksPerSlot; }

// A slot as the model writes it.
struct RelativeWhen {
    int day = 0;     // 0 = today, 1 = tomorrow
    int hour = 0;    // 0..23
    int minute = 0;  // 0 or 30

    friend constexpr bool operator==(const RelativeWhen&, const RelativeWhen&) = default;
};

// Model form of `slot` for a neighbor deciding at tick `now`. Empty when the
// slot is neither today nor tomorrow: the model vocabulary cannot say it.
constexpr std::optional<RelativeWhen> to_relative(TimeSlot slot, Tick now) {
    if (slot < 0) return std::nullopt;
    const int day = slot / kSlotsPerDay - day_of(now);
    if (day < 0 || day > 1) return std::nullopt;
    const int in_day = slot % kSlotsPerDay;
    return RelativeWhen{day, in_day / 2, (in_day % 2) * 30};
}

// The inverse. Empty when a field is out of range.
constexpr std::optional<TimeSlot> from_relative(const RelativeWhen& when, Tick now) {
    if (when.day < 0 || when.day > 1 || when.hour < 0 || when.hour > 23) return std::nullopt;
    if (when.minute != 0 && when.minute != 30) return std::nullopt;
    return (day_of(now) + when.day) * kSlotsPerDay + when.hour * 2 + when.minute / 30;
}

// "09:30". Digits in both languages (contract, section 5).
inline std::string clock_text(int hour, int minute) {
    std::string out;
    out += static_cast<char>('0' + hour / 10);
    out += static_cast<char>('0' + hour % 10);
    out += ':';
    out += static_cast<char>('0' + minute / 10);
    out += static_cast<char>('0' + minute % 10);
    return out;
}

}  // namespace rumor
