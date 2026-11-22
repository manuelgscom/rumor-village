#pragma once
// Writing and reading the event log as JSONL (contract, section 6).
// Implemented in src/log. The format is the one described in core/event.h.

#include <istream>
#include <stdexcept>
#include <string>
#include <vector>

#include "core/event.h"

namespace rumor {

// One line of JSON, compact, without the final newline. The same value always
// gives the same bytes.
std::string write_header(const LogHeader& header);
std::string write_event(const Event& event);

struct Log {
    LogHeader header;
    std::vector<Event> events;
};

// A log that cannot be read. what() says the line and the reason:
// "line 12: unknown event type 'jump'".
class LogError : public std::runtime_error {
  public:
    LogError(int line, const std::string& message)
        : std::runtime_error("line " + std::to_string(line) + ": " + message), line_(line) {}
    int line() const { return line_; }

  private:
    int line_;
};

// Reads a whole log: the header on the first line and one event per line.
// Empty lines are an error. Throws LogError on malformed JSON, a missing or
// unknown key, a wrong type, an unknown event type or a format other than
// kLogFormat.
Log read_log(std::istream& in);

}  // namespace rumor
