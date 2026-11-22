#pragma once
// The results card of docs/medicion.md, computed from a log already read.
// Implemented in src/metrics. It reads no file and needs nothing but the
// header and the events.

#include <vector>

#include <nlohmann/json_fwd.hpp>

#include "core/event.h"

namespace rumor {

// The card as JSON, with a fixed key order. Metrics that need a model
// (incoherent text, performance) are null.
nlohmann::ordered_json compute_metrics(const LogHeader& header, const std::vector<Event>& events);

}  // namespace rumor
