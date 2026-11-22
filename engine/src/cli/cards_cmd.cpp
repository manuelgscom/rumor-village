// `rumor cards --log <run.jsonl> --out <cards.jsonl> --prefixes <prefixes.jsonl>
//              [--data <dir>] [--rival-twins]` (cli/cards.h). Package A of phase 4.
//
// Everything is built in memory first: if the replay does not give the log
// back, nothing is written. Both outputs are overwritten.

#include <cstddef>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "cli/cards.h"
#include "cli/usage.h"
#include "core/log_api.h"

namespace rumor {
namespace {

void write_lines(const std::string& path, const std::vector<std::string>& lines) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("cannot open '" + path + "'");
    for (const std::string& line : lines) out << line << '\n';
    out.flush();
    if (!out) throw std::runtime_error("cannot write '" + path + "'");
}

}  // namespace

int cards_command(int argc, char** argv) {
    std::string log_path, out_path, prefixes_path, data_dir = "data";
    bool rival_twins = false;
    for (int i = 2; i < argc; i += 2) {
        const std::string_view flag = argv[i];
        if (flag == "--rival-twins") {
            rival_twins = true;
            --i;  // no value
            continue;
        }
        if (i + 1 >= argc) throw UsageError("missing value for " + std::string(flag));
        const std::string value = argv[i + 1];
        if (flag == "--log") log_path = value;
        else if (flag == "--out") out_path = value;
        else if (flag == "--prefixes") prefixes_path = value;
        else if (flag == "--data") data_dir = value;
        else throw UsageError("unknown option '" + std::string(flag) + "'");
    }
    if (log_path.empty() || out_path.empty() || prefixes_path.empty()) {
        throw UsageError("cards needs --log, --out and --prefixes");
    }
    if (out_path == prefixes_path) throw UsageError("--out and --prefixes are the same file");

    std::ifstream in(log_path, std::ios::binary);
    if (!in) throw std::runtime_error("cannot open '" + log_path + "'");
    Log log;
    try {
        log = read_log(in);
    } catch (const LogError& e) {
        throw std::runtime_error(log_path + ": " + e.what());
    }

    CardSet set;
    try {
        set = build_cards(log, log_path, data_dir, rival_twins);
    } catch (const std::exception& e) {
        throw std::runtime_error(log_path + ": " + e.what());
    }

    std::vector<std::string> cards, prefixes;
    int decide = 0, twins = 0;
    for (const CardRecord& r : set.cards) {
        cards.push_back(write_card(r));
        if (r.source.variant) ++twins;
        else if (r.task == CardTask::decide) ++decide;
    }
    for (const CardPrefix& p : set.prefixes) prefixes.push_back(write_prefix(p));
    write_lines(out_path, cards);
    write_lines(prefixes_path, prefixes);
    std::cerr << "cards: " << log_path << ": " << decide << " decide, "
              << set.cards.size() - static_cast<std::size_t>(decide + twins) << " extract, "
              << twins << " rival twins\n";
    return 0;
}

}  // namespace rumor
