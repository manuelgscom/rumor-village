#pragma once
// Incoherent text (contract, section 3): a bubble that says something other
// than the claim of its own action. The engine looks in `text` for neighbors,
// places, hours and amounts of the vocabulary, in digits and in words ("a las
// diez", "nueve y media", "ten pm", "half past nine"), and marks the slots
// that clearly contradict the claim. The detection is conservative: when in
// doubt, it does not mark. Implemented in src/card/textcheck*.
//
// The metrics call it on each `turn` of a log: text, claim and names all come
// from the log, so the figure can be recomputed from the file alone.

#include <string>
#include <string_view>
#include <vector>

#include "core/action.h"
#include "core/catalog.h"
#include "core/fact.h"
#include "core/ids.h"
#include "core/time.h"

namespace rumor {

// The names the text may mention, as the log header gives them.
struct TextCheckContext {
    Lang lang = Lang::es;
    // places[p.index()]: name of each place in the language of the run.
    std::vector<std::string> places;
    // neighbors[n.index()]: name of each neighbor of the run.
    std::vector<std::string> neighbors;
    // Who speaks and who listens in the turn, when known (the log gives both).
    // Their names in the text are never a statement about `who`: a bubble
    // addresses the listener ("¡Ay, Nerea, ...!") and may name its speaker.
    NeighborId speaker;
    NeighborId listener;
};

struct TextCheck {
    // contradicts[idx(slot)]: the text states a value for the slot that is not
    // the one of the claim.
    PerSlot<bool> contradicts = {};

    bool any() const {
        for (const bool c : contradicts) {
            if (c) return true;
        }
        return false;
    }
};

// `claim` as the model proposed it, with engine values (who: value of a
// NeighborId, where: value of a PlaceId, when: a TimeSlot, amount). `now` is
// the tick of the turn: the day words of the text are relative to it. A slot
// the claim leaves empty is never marked.
TextCheck check_text(const TextCheckContext& context, const Claim& claim, Tick now,
                     std::string_view text);

}  // namespace rumor
