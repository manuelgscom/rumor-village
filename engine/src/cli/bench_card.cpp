// The results card of `rumor bench`: the metrics of every run merged into mean
// and bootstrap interval, the description of the setup, and the Markdown view.

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

#include "cli/bench_card.h"
#include "core/build_info.h"
#include "core/rng.h"

namespace rumor {
namespace {

using Json = nlohmann::ordered_json;

// Keys of compute_metrics that identify a run rather than measure it.
constexpr std::string_view kIdentityKeys[] = {"format", "scenario", "lang",
                                              "policy", "model",    "seed"};

Json interval_json(const std::vector<double>& values) {
    const Interval iv = bootstrap(values);
    Json j;
    j["runs"] = iv.runs;
    if (iv.runs == 0) {
        j["mean"] = nullptr;
        j["lo"] = nullptr;
        j["hi"] = nullptr;
    } else {
        j["mean"] = iv.mean;
        j["lo"] = iv.lo;
        j["hi"] = iv.hi;
    }
    return j;
}

// One position of the tree in every run; nullptr where a run lacks it.
Json merge(const std::vector<const Json*>& items) {
    bool any_object = false, any_array = false, any_string = false;
    for (const Json* p : items) {
        if (!p) continue;
        any_object = any_object || p->is_object();
        any_array = any_array || p->is_array();
        any_string = any_string || p->is_string();
    }

    if (any_object) {
        std::vector<std::string> keys;
        for (const Json* p : items) {
            if (!p || !p->is_object()) continue;
            for (const auto& [k, v] : p->items()) {
                if (std::find(keys.begin(), keys.end(), k) == keys.end()) keys.push_back(k);
            }
        }
        Json out = Json::object();
        for (const std::string& k : keys) {
            std::vector<const Json*> children;
            for (const Json* p : items) {
                const Json* child = nullptr;
                if (p && p->is_object()) {
                    const auto it = p->find(k);
                    if (it != p->end()) child = &*it;
                }
                children.push_back(child);
            }
            out[k] = merge(children);
        }
        return out;
    }

    if (any_array) {
        std::size_t size = 0;
        for (const Json* p : items) {
            if (p && p->is_array()) size = std::max(size, p->size());
        }
        Json out = Json::array();
        for (std::size_t i = 0; i < size; ++i) {
            std::vector<const Json*> children;
            for (const Json* p : items) {
                children.push_back(p && p->is_array() && i < p->size() ? &(*p)[i] : nullptr);
            }
            out.push_back(merge(children));
        }
        return out;
    }

    if (any_string) {
        const Json* first = nullptr;
        for (const Json* p : items) {
            if (!p || !p->is_string()) continue;
            if (!first) first = p;
            else if (*p != *first) return Json(nullptr);
        }
        return *first;
    }

    std::vector<double> values;
    for (const Json* p : items) {
        if (p && p->is_number()) values.push_back(p->get<double>());
    }
    return interval_json(values);
}

// --- Markdown ---------------------------------------------------------------------

const Json* find_path(const Json& root, std::initializer_list<std::string_view> path) {
    const Json* j = &root;
    for (std::string_view k : path) {
        if (!j->is_object()) return nullptr;
        const auto it = j->find(std::string(k));
        if (it == j->end()) return nullptr;
        j = &*it;
    }
    return j;
}

bool is_leaf(const Json* j) {
    return j && j->is_object() && j->contains("runs") && j->contains("mean");
}

enum class Scale { count, percent, two, seconds };

std::string number(double v, Scale scale) {
    int decimals = 1;
    switch (scale) {
        case Scale::count: decimals = 1; break;
        case Scale::percent: v *= 100.0; decimals = 1; break;
        case Scale::two: decimals = 2; break;
        case Scale::seconds: v /= 1000.0; decimals = 2; break;
    }
    if (std::fabs(v) < 0.5 * std::pow(10.0, -decimals)) v = 0.0;  // no "-0,0"
    char buf[64];
    std::snprintf(buf, sizeof buf, "%.*f", decimals, v);
    std::string s = buf;
    std::replace(s.begin(), s.end(), '.', ',');
    if (scale == Scale::percent) s += " %";
    return s;
}

// "m [lo – hi]", "(k/N)" when not every run brings it, "—" when none does.
std::string cell(const Json* leaf, int runs, Scale scale) {
    if (!is_leaf(leaf) || (*leaf)["runs"].get<int>() == 0) return "—";
    const Json& l = *leaf;
    const std::string mean = number(l["mean"].get<double>(), scale);
    const std::string lo = number(l["lo"].get<double>(), scale);
    const std::string hi = number(l["hi"].get<double>(), scale);
    std::string s = mean;
    if (lo != mean || hi != mean) s += " [" + lo + " – " + hi + "]";
    const int k = l["runs"].get<int>();
    if (k < runs) s += " (" + std::to_string(k) + "/" + std::to_string(runs) + ")";
    return s;
}

Scale scale_of_key(std::string_view k) { return k == "rate" ? Scale::percent : Scale::count; }

struct Table {
    std::string& md;
    const Json& m;
    int runs;

    void head(const std::string& title) {
        md += "\n## " + title + "\n\n| Cifra | Media [IC 95 %] |\n|---|---|\n";
    }
    void row(const std::string& label, std::initializer_list<std::string_view> path,
             Scale scale = Scale::count) {
        md += "| " + label + " | " + cell(find_path(m, path), runs, scale) + " |\n";
    }
    // A row for every number under `node`, whatever its shape.
    void leaves(const std::string& label, const Json* node) {
        if (!node || is_leaf(node) || !node->is_object()) {
            md += "| " + label + " | " + cell(node, runs, Scale::percent) + " |\n";
            return;
        }
        for (const auto& [k, v] : node->items()) {
            if (is_leaf(&v)) {
                md += "| " + label + " · " + k + " | " + cell(&v, runs, scale_of_key(k)) + " |\n";
            } else if (v.is_object()) {
                leaves(label + " · " + k, &v);
            }
        }
    }
};

std::string text_or(const Json& j, const char* fallback) {
    return j.is_string() ? j.get<std::string>() : std::string(fallback);
}

std::string seeds_text(const Json& seeds) {
    if (!seeds.is_array() || seeds.empty()) return "—";
    const auto first = seeds.front().get<std::uint64_t>();
    const auto last = seeds.back().get<std::uint64_t>();
    if (last - first + 1 == seeds.size()) {
        return seeds.size() == 1 ? std::to_string(first)
                                 : std::to_string(first) + "–" + std::to_string(last);
    }
    std::string s;
    for (const Json& v : seeds) s += (s.empty() ? "" : ", ") + std::to_string(v.get<std::uint64_t>());
    return s;
}

}  // namespace

Interval bootstrap(const std::vector<double>& values) {
    Interval iv;
    iv.runs = static_cast<int>(values.size());
    if (values.empty()) return iv;
    const auto n = static_cast<std::uint32_t>(values.size());
    double sum = 0;
    for (const double v : values) sum += v;
    iv.mean = sum / n;
    if (n == 1) {
        iv.lo = iv.hi = iv.mean;
        return iv;
    }
    Rng rng(kBootstrapSeed);
    std::vector<double> means(kBootstrapResamples);
    for (double& m : means) {
        double s = 0;
        for (std::uint32_t i = 0; i < n; ++i) s += values[rng.below(n)];
        m = s / n;
    }
    std::sort(means.begin(), means.end());
    const auto tail = static_cast<std::size_t>(
        std::lround(kBootstrapResamples * (1.0 - kConfidence) / 2.0));
    iv.lo = means[tail];
    iv.hi = means[means.size() - 1 - tail];
    return iv;
}

nlohmann::ordered_json aggregate_metrics(const std::vector<nlohmann::ordered_json>& runs) {
    std::vector<Json> trimmed = runs;
    for (Json& j : trimmed) {
        if (!j.is_object()) continue;
        for (std::string_view k : kIdentityKeys) j.erase(std::string(k));
    }
    std::vector<const Json*> items;
    for (const Json& j : trimmed) items.push_back(&j);
    if (items.empty()) return Json::object();
    return merge(items);
}

nlohmann::ordered_json make_card(const BenchSetup& setup,
                                 const std::vector<nlohmann::ordered_json>& metrics) {
    Json card;
    card["card"] = kBenchCardFormat;
    card["contract_version"] = kContractVersion;
    card["engine_commit"] = std::string(engine_commit());
    card["llama_commit"] = std::string(llama_commit());
    card["scenario"] = setup.scenario;
    card["lang"] = std::string(key(setup.lang));
    card["policy"] = setup.policy;
    if (setup.model) {
        const llm::ModelInfo& info = *setup.model;
        Json m;
        m["file"] = info.file;
        m["description"] = info.description;
        m["device"] = info.device;
        m["n_parallel"] = info.n_parallel;
        m["temperature"] = info.temperature;
        m["top_k"] = info.top_k;
        m["top_p"] = info.top_p;
        card["model"] = std::move(m);
        card["text"] = std::string(key(setup.text));
        card["prompt"] = std::string(key(setup.prompt));
    } else {
        card["model"] = nullptr;
        card["text"] = nullptr;
        card["prompt"] = nullptr;
    }
    card["runs"] = setup.seeds.size();
    card["seeds"] = setup.seeds;
    Json& interval = card["interval"];
    interval["method"] = "bootstrap";
    interval["confidence"] = kConfidence;
    interval["resamples"] = kBootstrapResamples;
    interval["seed"] = kBootstrapSeed;
    card["metrics"] = aggregate_metrics(metrics);
    return card;
}

std::string card_markdown(const nlohmann::ordered_json& card) {
    const int runs = card.value("runs", 0);
    const Json& m = card["metrics"];
    const bool with_model = card["model"].is_object();
    std::string md;

    md += "# Ficha de resultados: " + text_or(card["scenario"], "?") + " · " +
          text_or(card["lang"], "?") + "\n\n";
    md += "| | |\n|---|---|\n";
    md += "| Escenario | " + text_or(card["scenario"], "—") + " |\n";
    md += "| Idioma | " + text_or(card["lang"], "—") + " |\n";
    if (with_model) {
        const Json& model = card["model"];
        md += "| Política | modelo |\n";
        md += "| Modelo | " + text_or(model["file"], "—") + " |\n";
        md += "| Descripción (cuantización) | " + text_or(model["description"], "—") + " |\n";
        md += "| Tarjeta | " + text_or(model["device"], "—") + " |\n";
        md += "| Lote | " + std::to_string(model.value("n_parallel", 0)) + " |\n";
        md += "| Muestreo | temperatura " + number(model.value("temperature", 0.0), Scale::two) +
              ", top_k " + std::to_string(model.value("top_k", 0)) + ", top_p " +
              number(model.value("top_p", 0.0), Scale::two) + " |\n";
        md += "| Texto | " + text_or(card["text"], "—") + " |\n";
        md += "| Prompt | " + text_or(card["prompt"], "—") + " |\n";
    } else {
        md += "| Política | " + text_or(card["policy"], "—") + " (línea base, sin modelo) |\n";
    }
    md += "| Ejecuciones | " + std::to_string(runs) + " (semillas " + seeds_text(card["seeds"]) +
          ") |\n";
    md += "| Versión del contrato | " + std::to_string(card.value("contract_version", 0)) + " |\n";
    md += "| Commit del motor | " + text_or(card["engine_commit"], "—") + " |\n";
    md += "| Commit de llama.cpp | " + text_or(card["llama_commit"], "—") + " |\n";

    md += "\nCada cifra es la media de las ejecuciones y, entre corchetes, su intervalo de "
          "confianza del 95 % (bootstrap de " +
          std::to_string(kBootstrapResamples) +
          " remuestras con semilla fija). «(k/N)»: solo k de las N ejecuciones traen la cifra; "
          "«—»: ninguna. Todas las cifras, en `card.json`; todas salen de los registros "
          "`seed-<s>.jsonl` de esta carpeta.\n";

    Table t{md, m, runs};
    t.head("Decisiones y rechazadas");
    t.row("Decisiones por ejecución", {"decisions", "total"});
    t.row("Turnos", {"decisions", "turns"});
    t.row("Planes", {"decisions", "plans"});
    t.row("Rechazadas", {"rejected", "rate"}, Scale::percent);
    t.row("Rechazadas (número)", {"rejected", "count"});
    if (const Json* by = find_path(m, {"rejected", "by_reason"}); by && by->is_object()) {
        for (const auto& [k, v] : by->items()) {
            md += "| Rechazadas por " + k + " | " + cell(&v, runs, Scale::count) + " |\n";
        }
    }
    t.row("`go` sin lugar u hora (no rechazado)", {"decisions", "go_incomplete"});

    t.head("Fallos del modelo");
    t.row("Huecos dichos", {"slots_said"});
    t.row("Recuerdos inventados", {"invented", "rate"}, Scale::percent);
    t.row("Contradicciones", {"contradictions", "rate"}, Scale::percent);
    t.row("Dudas endurecidas", {"hardened_doubts", "rate"}, Scale::percent);
    t.leaves("Texto incoherente", find_path(m, {"incoherent_text"}));

    t.head("Alcance y asistencia (vecinos, al final)");
    t.row("Vecinos", {"neighbors"});
    t.row("Conocen el hecho", {"reach", "informed"});
    t.row("Versión correcta", {"reach", "correct"});
    t.row("Versión incompleta", {"reach", "incomplete"});
    t.row("Versión deformada", {"reach", "wrong"});
    t.row("Planean ir", {"attendance", "planned"});
    t.row("Llegan", {"attendance", "arrived"});
    t.row("Sitio y hora correctos", {"attendance", "right"});
    t.row("Otra hora", {"attendance", "other_time"});
    t.row("Otro sitio", {"attendance", "other_place"});

    md += "\n## Deformación por salto\n\nSaltos por ejecución: " +
          cell(find_path(m, {"deformation", "hops"}), runs, Scale::count) +
          ". Por hueco: probabilidad de que cambie en un salto, y cambios por causa "
          "(número por ejecución).\n\n";
    md += "| Hueco | Saltos | Cambia | forgot | guess | doubt_dropped | model | hardened | omission |\n";
    md += "|---|---|---|---|---|---|---|---|---|\n";
    if (const Json* slots = find_path(m, {"deformation", "by_slot"}); slots && slots->is_object()) {
        for (const auto& [slot, d] : slots->items()) {
            md += "| " + slot + " | " + cell(find_path(d, {"hops"}), runs, Scale::count) + " | " +
                  cell(find_path(d, {"rate"}), runs, Scale::percent);
            for (const char* cause :
                 {"forgot", "guess", "doubt_dropped", "model", "hardened", "omission"}) {
                md += " | " + cell(find_path(d, {"by_cause", cause}), runs, Scale::count);
            }
            md += " |\n";
        }
    }

    t.head("Decisión de contar y cortesía");
    t.row("Ocasiones de contar", {"telling", "opportunities"});
    t.row("Cuenta", {"telling", "rate"}, Scale::percent);
    t.row("Conversaciones", {"courtesy", "conversations"});
    t.row("Acaban por tope de turnos", {"courtesy", "rate"}, Scale::percent);
    t.row("Repeticiones al mismo oyente", {"courtesy", "repeats"});

    t.head("Rendimiento");
    t.row("Decisiones por tick (media)", {"performance", "decisions_per_tick", "mean"});
    t.row("Decisiones por tick (p95)", {"performance", "decisions_per_tick", "p95"});
    t.row("Decisiones por tick (máximo)", {"performance", "decisions_per_tick", "max"});
    t.row("Decisiones/s", {"performance", "decisions_per_s"}, Scale::two);
    t.row("Tokens de salida/s", {"performance", "tokens_per_s"});
    t.row("Segundos por tick (media)", {"performance", "ms_per_tick", "mean"}, Scale::seconds);
    t.row("Segundos por tick (p95)", {"performance", "ms_per_tick", "p95"}, Scale::seconds);
    t.row("Milisegundos por decisión (media)", {"performance", "ms_per_decision", "mean"});
    t.row("Milisegundos por decisión (p95)", {"performance", "ms_per_decision", "p95"});
    t.row("Lote medio", {"performance", "batch", "mean"});
    t.row("VRAM pico (MB)", {"performance", "vram_mb"});
    t.row("Tokens de entrada por ejecución", {"performance", "tokens_in"});
    t.row("Tokens de salida por ejecución", {"performance", "tokens_out"});
    if (!with_model) {
        md += "\nLa línea base no genera: el rendimiento y el texto incoherente no se miden.\n";
    }
    return md;
}

std::filesystem::path bench_default_out(const RunOptions& options,
                                        const llm::BatchOptions& batch) {
    const bool with_model = options.policy == "model";
    const std::string who =
        with_model ? std::filesystem::path(batch.model_path).stem().string() : "baseline";
    std::string leaf = options.scenario + "-" + std::string(key(options.lang));
    if (with_model && options.text == TextMode::none) leaf += "-notext";
    if (with_model && options.text == TextMode::camera) leaf += "-camera";
    if (with_model && options.prompt == PromptMode::card) leaf += "-card";
    return std::filesystem::path("runs") / "bench" / who / leaf;
}

Json bench_setup(const RunOptions& options) {
    const bool with_model = options.policy == "model";
    Json setup;
    setup["prompt"] = with_model ? Json(std::string(key(options.prompt))) : Json(nullptr);
    setup["text"] = with_model ? Json(std::string(key(options.text))) : Json(nullptr);
    return setup;
}

void claim_bench_setup(const std::filesystem::path& out, const RunOptions& options) {
    namespace fs = std::filesystem;
    const Json want = bench_setup(options);
    const fs::path path = out / "setup.json";
    std::error_code ec;
    if (fs::exists(path, ec)) {
        std::ifstream in(path, std::ios::binary);
        const Json have = Json::parse(in, nullptr, false);
        if (have != want) {
            throw std::runtime_error(path.string() + " says " +
                                     (have.is_discarded() ? std::string("nothing readable")
                                                          : have.dump()) +
                                     ", not " + want.dump() + "; use another --out");
        }
        return;
    }
    if (options.policy == "model" && options.prompt != PromptMode::full) {
        for (const fs::directory_entry& e : fs::directory_iterator(out)) {
            const std::string name = e.path().filename().string();
            if (name.starts_with("seed-") && name.ends_with(".jsonl")) {
                throw std::runtime_error(out.string() + " has runs without setup.json (prompt full), "
                                         "not " + want.dump() + "; use another --out");
            }
        }
    }
    const fs::path tmp = out / "setup.json.part";
    {
        std::ofstream file(tmp, std::ios::binary | std::ios::trunc);
        file << want.dump(2) << '\n';
        file.close();
        if (!file) throw std::runtime_error("cannot write '" + tmp.string() + "'");
    }
    fs::rename(tmp, path);
}

}  // namespace rumor
