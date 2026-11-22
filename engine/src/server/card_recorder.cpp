// The cards of a game, written and read back (card_recorder.h).

#include "server/card_recorder.h"

#include <exception>
#include <fstream>

#include "core/enum_keys.h"
#include "core/game_api.h"

namespace rumor {
namespace {

using Ordered = nlohmann::ordered_json;

Ordered rule_json(const RuleExplanation& why) {
    Ordered rolls = Ordered::array();
    for (const RuleRoll& roll : why.rolls) {
        Ordered r;
        r["name"] = roll.name;
        r["chance_ppm"] = roll.chance_ppm;
        r["roll_ppm"] = roll.roll_ppm;
        r["hit"] = roll.hit;
        rolls.push_back(std::move(r));
    }
    Ordered out;
    out["rule"] = why.rule;
    out["rolls"] = std::move(rolls);
    return out;
}

}  // namespace

CardRecorder::CardRecorder(Policy& inner, std::ostream& out, const Renderer* renderer)
    : inner_(inner), out_(out), renderer_(renderer) {}

std::vector<Decision> CardRecorder::decide(std::span<const DecisionRequest> batch) {
    std::vector<Decision> decisions = inner_.decide(batch);
    // Only presentation from here: nothing below may reach `decisions`.
    for (const DecisionRequest& request : batch) {
        Ordered line;
        line["tick"] = request.tick;
        line["who"] = request.self.valid() ? request.self.str() : std::string();
        line["kind"] = std::string(key(request.kind));
        line["card"] = nullptr;
        line["rule"] = nullptr;
        try {
            if (renderer_) line["card"] = renderer_->card(request);
            else line["rule"] = rule_json(explain_baseline(request));
        } catch (const std::exception&) {
            // A card that cannot be written leaves the line without it.
        }
        out_ << line.dump() << '\n';
    }
    out_.flush();
    return decisions;
}

std::optional<nlohmann::json> find_card(const std::string& path, Tick tick, const std::string& who,
                                        const std::optional<std::string>& kind) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    // The lines start with the keys in a fixed order, so most lines are told
    // apart without parsing them.
    const std::string prefix =
        "{\"tick\":" + std::to_string(tick) + ",\"who\":" + nlohmann::json(who).dump() + ",";
    for (std::string line; std::getline(in, line);) {
        if (line.compare(0, prefix.size(), prefix) != 0) continue;
        nlohmann::json j = nlohmann::json::parse(line, nullptr, false);
        if (j.is_discarded() || !j.is_object()) continue;  // a line still being written
        if (kind && j.value("kind", std::string()) != *kind) continue;
        return j;
    }
    return std::nullopt;
}

}  // namespace rumor
