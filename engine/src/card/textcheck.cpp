// Incoherent text detector (contract, section 3). See card/textcheck.h.
//
// The text is folded (lower case, no accents) and split into tokens: words,
// numbers and punctuation. Each slot has its own finder, and a finder keeps a
// mention only when its frame leaves no doubt:
//
//   who     a neighbor name that is not a vocative ("Luis, ¿sabes...?"), a
//           source ("me lo dijo Ana", "Ana says") or a companion ("con Ana")
//   where   a public place after a locative preposition and an article ("en la
//           plaza", "at the town hall"), unless the clause is about where
//           somebody is, goes, lives or heard it ("estoy en el bar")
//   when    an hour in a time frame ("a las diez", "21:00", "ten pm", "half
//           past nine") and the day words ("hoy", "tomorrow"), unless the
//           clause is about when it was told or another event ("me lo dijo
//           ayer", "cierra a las dos") or is relational ("antes de las diez")
//   amount  a number next to a unit ("50 personas", "3.000 euros", "a fine of
//           300"), unless approximate ("unos 50", "more than 50")
//
// A slot is contradicted only when the claim has a value, the text states at
// least one value for that slot and none of the values it states is
// compatible with the claim. For who and where, any mention of the claim's
// own name, framed or not, also rules the contradiction out.

#include "card/textcheck.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace rumor {
namespace {

// --- Tokens -----------------------------------------------------------------

enum class Kind : std::uint8_t { word, number, punct };

struct Token {
    Kind kind;
    std::string text;
};

using Tokens = std::vector<Token>;

// Base letter of U+00C0..U+00DF (and, 0x20 above, of U+00E0..U+00FF).
// '*' marks the two signs of the block: U+00D7 and U+00F7.
constexpr std::string_view kLatin1Fold = "aaaaaaaceeeeiiiidnooooo*ouuuuyts";

// Decodes one UTF-8 code point at s[i]; `len` is set to the bytes it takes.
// Invalid sequences decode to U+FFFD, one byte at a time.
char32_t decode(std::string_view s, std::size_t i, std::size_t& len) {
    const auto byte = [&](std::size_t k) { return static_cast<unsigned char>(s[k]); };
    const auto cont = [&](std::size_t k) { return k < s.size() && (byte(k) & 0xC0) == 0x80; };
    const unsigned char b = byte(i);
    if (b < 0x80) {
        len = 1;
        return b;
    }
    if ((b >> 5) == 0x6 && cont(i + 1)) {
        len = 2;
        return (char32_t(b & 0x1F) << 6) | (byte(i + 1) & 0x3F);
    }
    if ((b >> 4) == 0xE && cont(i + 1) && cont(i + 2)) {
        len = 3;
        return (char32_t(b & 0x0F) << 12) | (char32_t(byte(i + 1) & 0x3F) << 6) |
               (byte(i + 2) & 0x3F);
    }
    if ((b >> 3) == 0x1E && cont(i + 1) && cont(i + 2) && cont(i + 3)) {
        len = 4;
        return (char32_t(b & 0x07) << 18) | (char32_t(byte(i + 1) & 0x3F) << 12) |
               (char32_t(byte(i + 2) & 0x3F) << 6) | (byte(i + 3) & 0x3F);
    }
    len = 1;
    return 0xFFFD;
}

// Words are runs of letters, numbers runs of digits ("9pm" is "9" and "pm").
// Each punctuation sign is a token; "'" (any apostrophe) and "-" join words,
// everything else ends a clause. "€" and "$" become the words "eur" and "usd".
Tokens tokenize(std::string_view s) {
    Tokens out;
    std::string cur;
    Kind kind = Kind::word;
    const auto flush = [&] {
        if (!cur.empty()) out.push_back({kind, std::move(cur)});
        cur.clear();
    };
    const auto put = [&](Kind k, char c) {
        if (!cur.empty() && kind != k) flush();
        kind = k;
        cur += c;
    };
    const auto push = [&](Kind k, std::string text) {
        flush();
        out.push_back({k, std::move(text)});
    };
    for (std::size_t i = 0; i < s.size();) {
        std::size_t len = 1;
        const char32_t cp = decode(s, i, len);
        i += len;
        if (cp < 0x80) {
            const char c = static_cast<char>(cp);
            if (c >= 'a' && c <= 'z') {
                put(Kind::word, c);
            } else if (c >= 'A' && c <= 'Z') {
                put(Kind::word, static_cast<char>(c - 'A' + 'a'));
            } else if (c >= '0' && c <= '9') {
                put(Kind::number, c);
            } else if (c <= ' ' || c == 0x7F) {
                flush();
            } else if (c == '$') {
                push(Kind::word, "usd");
            } else if (c == '`') {
                push(Kind::punct, "'");
            } else {
                push(Kind::punct, std::string(1, c));
            }
        } else if (cp >= 0xC0 && cp <= 0xFF) {
            const char base = cp == 0xFF ? 'y' : kLatin1Fold[(cp - 0xC0) & 0x1F];
            if (base == '*') {
                push(Kind::punct, "|");
            } else {
                put(Kind::word, base);
            }
        } else if (cp == 0x2018 || cp == 0x2019 || cp == 0xB4) {
            push(Kind::punct, "'");
        } else if (cp == 0x20AC) {
            push(Kind::word, "eur");
        } else if (cp == 0xA0 || cp == 0x202F || (cp >= 0x2000 && cp <= 0x200B)) {
            flush();
        } else {
            push(Kind::punct, "|");  // ¿ ¡ « » — … and anything else
        }
    }
    flush();
    return out;
}

// --- Vocabulary of the frames ----------------------------------------------

using Set = std::vector<std::string_view>;

bool in(const Set& set, std::string_view w) {
    for (const std::string_view x : set) {
        if (x == w) return true;
    }
    return false;
}

struct Lexicon {
    std::string_view stop;   // complementizer: the reported content starts after it
    Set greetings;           // a name right after one is a vocative
    Set who_before;          // a name after one is a source, an addressee or a companion
    Set who_after;           // a name before one is a source or a companion
    Set place_preps;         // locative prepositions (before the article)
    Set articles;
    Set place_contractions;  // preposition and article in one word ("al")
    Set place_relational;    // "junto a la plaza", "next to the bar": not the place itself
    Set place_cues;          // the clause is about somebody's whereabouts or a source
    Set place_cues_after;
    Set time_report;         // the time or day is that of the telling, or of another event
    Set time_relational;     // "antes de las diez", "after ten"
    Set time_followers;      // what may follow a bare hour word ("a las dos" ...)
    Set units;               // what makes a number an amount
    Set amount_nouns;        // "multa de 300", "fine of 300"
    std::string_view amount_of;
    Set amount_approx;       // "unos 50", "more than 50"
};

const Lexicon& lexicon(Lang lang) {
    static const Lexicon es{
        "que",
        {"hola", "oye", "mira", "buenas", "buenos", "dias", "tardes", "noches", "adios",
         "gracias", "luego", "hasta"},
        {"segun", "dijo", "dicho", "dije", "conto", "contado", "conte", "contaron", "oido", "oi",
         "escuche", "entere", "enterado", "por", "pregunta", "preguntale", "preguntaselo",
         "preguntar", "dile", "diselo", "decirle", "contarle", "cuentale", "avisa", "avisale",
         "con", "vi", "visto", "vio", "saluda", "saludale", "comento", "comenta", "comentaron",
         "dice", "dicen", "decia", "cuenta", "aviso", "explico", "asegura"},
        {"dice", "dicen", "dijo", "decia", "dicho", "cuenta", "conto", "contado", "contaba",
         "comenta", "comento", "cree", "creia", "piensa", "pensaba", "opina", "asegura", "jura",
         "sabe", "sabra", "supone", "yo", "vio", "conmigo"},
        {"en", "a", "hacia"},
        {"el", "la", "los", "las"},
        {"al"},
        {"junto", "frente", "cerca", "lado", "delante", "detras", "enfrente", "lejos"},
        {"estoy", "estaba", "estuve", "estamos", "estabamos", "estas", "estabas", "esta",
         "estan", "estaban", "vengo", "venia", "vienes", "viene", "voy", "vas", "va", "vamos",
         "iba", "ibamos", "vive", "vivo", "viven", "vives", "vi", "vimos", "visto", "vio", "oi",
         "oido", "escuche", "dijo", "dicho", "dicen", "dijeron", "conto", "contaron", "contado",
         "cuentan", "comentan", "comentaron", "entere", "enterado", "vemos", "veo", "quedamos",
         "trabaja", "trabajo", "trabajas", "paso", "pasaba", "compre", "aqui", "aca"},
        {"dicen", "dijeron", "comentan", "cuentan", "contaron", "oi", "escuche", "me", "nos"},
        {"dijo", "dijeron", "dije", "dicho", "conto", "contaron", "contado", "conte", "oi", "oido",
         "escuche", "entere", "enterado", "vi", "vimos", "visto", "vio", "comento", "comentaron",
         "avisaron", "vemos", "veo", "veremos", "quedamos", "quedado", "voy", "vamos", "ire",
         "iremos", "llego", "llegare", "salgo", "saldre", "pasare", "vengo", "cierra", "abre",
         "cierran", "abren", "termino", "acabo", "trabajo", "hasta"},
        {"antes", "despues", "desde", "hasta", "partir", "pasadas", "entre", "tras", "son",
         "eran"},
        {"y", "o", "u", "pero", "que", "de", "del", "en", "hoy", "manana", "esta", "por", "creo",
         "segun", "hay", "es", "era", "sera", "empieza", "empezara", "comienza", "se", "me", "te",
         "le", "lo", "nos", "ya", "no", "si", "como", "cuando", "al", "con", "aproximadamente",
         "exactamente", "justo", "mas", "empiezan", "empezaran", "comienzan", "comenzara"},
        {"euros", "euro", "eur", "pesetas", "personas", "invitados"},
        {"multa", "premio", "herencia", "loteria"},
        "de",
        {"unos", "unas", "sobre", "casi", "mas", "menos", "cerca", "hasta", "aproximadamente",
         "alrededor", "como", "apenas", "entre"},
    };
    static const Lexicon en{
        "that",
        {"hi", "hello", "hey", "listen", "look", "morning", "evening", "bye", "goodbye", "thanks"},
        {"according", "from", "by", "ask", "told", "tell", "heard", "with", "saw", "seen", "hi",
         "hello", "hey", "thank", "says", "said", "mentioned"},
        {"says", "said", "told", "tells", "thinks", "thought", "reckons", "heard", "hears",
         "mentioned", "knows", "swears", "believes", "saw", "me", "i"},
        {"in", "at", "to", "inside"},
        {"the"},
        {},
        {"next", "close", "near", "opposite", "outside", "behind", "far"},
        {"am", "m", "was", "were", "re", "live", "lives", "lived", "saw", "seen", "heard", "told",
         "said", "see", "meet", "met", "work", "works", "been", "go", "going", "went", "come",
         "coming", "head", "heading", "here"},
        {"say", "said", "told", "they", "i", "we", "people"},
        {"told", "said", "heard", "saw", "seen", "learned", "learnt", "mentioned", "see", "meet",
         "met", "go", "leave", "arrive", "come", "get", "closes", "opens", "close", "open",
         "finish", "work", "until", "till"},
        {"before", "after", "until", "till", "by", "from", "since", "between"},
        {"and", "or", "but", "so", "then", "tonight", "tomorrow", "today", "this", "in", "on",
         "at", "sharp", "i", "we", "you", "he", "she", "it", "they", "there", "with", "if", "for",
         "is", "was", "will", "the", "exactly"},
        {"euros", "euro", "eur", "dollars", "pounds", "usd", "people", "guests"},
        {"fine", "prize", "inheritance", "lottery"},
        "of",
        {"about", "around", "almost", "nearly", "over", "under", "more", "less", "than",
         "approximately", "roughly", "some", "up", "between", "least", "most"},
    };
    return lang == Lang::es ? es : en;
}

// --- Numbers ----------------------------------------------------------------

struct NumWord {
    std::string_view word;
    int value;
};

// 0..29 in Spanish, 0..19 in English: words that start or end a number.
const std::vector<NumWord>& small_words(Lang lang) {
    static const std::vector<NumWord> es = {
        {"cero", 0},        {"un", 1},          {"uno", 1},          {"una", 1},
        {"dos", 2},         {"tres", 3},        {"cuatro", 4},       {"cinco", 5},
        {"seis", 6},        {"siete", 7},       {"ocho", 8},         {"nueve", 9},
        {"diez", 10},       {"once", 11},       {"doce", 12},        {"trece", 13},
        {"catorce", 14},    {"quince", 15},     {"dieciseis", 16},   {"diecisiete", 17},
        {"dieciocho", 18},  {"diecinueve", 19}, {"veinte", 20},      {"veintiun", 21},
        {"veintiuno", 21},  {"veintiuna", 21},  {"veintidos", 22},   {"veintitres", 23},
        {"veinticuatro", 24}, {"veinticinco", 25}, {"veintiseis", 26}, {"veintisiete", 27},
        {"veintiocho", 28}, {"veintinueve", 29},
    };
    static const std::vector<NumWord> en = {
        {"zero", 0},     {"one", 1},       {"two", 2},        {"three", 3},     {"four", 4},
        {"five", 5},     {"six", 6},       {"seven", 7},      {"eight", 8},     {"nine", 9},
        {"ten", 10},     {"eleven", 11},   {"twelve", 12},    {"thirteen", 13}, {"fourteen", 14},
        {"fifteen", 15}, {"sixteen", 16},  {"seventeen", 17}, {"eighteen", 18}, {"nineteen", 19},
    };
    return lang == Lang::es ? es : en;
}

// Tens that may take a unit after them.
const std::vector<NumWord>& tens_words(Lang lang) {
    static const std::vector<NumWord> es = {
        {"treinta", 30}, {"cuarenta", 40}, {"cincuenta", 50}, {"sesenta", 60},
        {"setenta", 70}, {"ochenta", 80},  {"noventa", 90},
    };
    static const std::vector<NumWord> en = {
        {"twenty", 20}, {"thirty", 30},  {"forty", 40},  {"fifty", 50},
        {"sixty", 60},  {"seventy", 70}, {"eighty", 80}, {"ninety", 90},
    };
    return lang == Lang::es ? es : en;
}

// Spanish hundreds are single words.
const std::vector<NumWord>& hundreds_words() {
    static const std::vector<NumWord> es = {
        {"cien", 100},          {"ciento", 100},        {"doscientos", 200},
        {"doscientas", 200},    {"trescientos", 300},   {"trescientas", 300},
        {"cuatrocientos", 400}, {"cuatrocientas", 400}, {"quinientos", 500},
        {"quinientas", 500},    {"seiscientos", 600},   {"seiscientas", 600},
        {"setecientos", 700},   {"setecientas", 700},   {"ochocientos", 800},
        {"ochocientas", 800},   {"novecientos", 900},   {"novecientas", 900},
    };
    return es;
}

std::optional<int> lookup(const std::vector<NumWord>& words, std::string_view w) {
    for (const NumWord& n : words) {
        if (n.word == w) return n.value;
    }
    return std::nullopt;
}

// A number read from the text.
struct Number {
    std::int64_t value = 0;
    std::size_t end = 0;   // one past its last token
    bool decimal = false;  // "2,5": not a whole number, so it is not compared
};

// --- The scanned text -------------------------------------------------------

struct Scan {
    Tokens tokens;
    Lang lang;
    const Lexicon& lex;

    std::size_t size() const { return tokens.size(); }
    std::string_view at(std::size_t i) const {
        return i < tokens.size() ? std::string_view(tokens[i].text) : std::string_view();
    }
    bool is_word(std::size_t i) const { return i < tokens.size() && tokens[i].kind == Kind::word; }
    bool is_number(std::size_t i) const {
        return i < tokens.size() && tokens[i].kind == Kind::number;
    }
    bool is_joiner(std::size_t i) const {
        return i < tokens.size() && tokens[i].kind == Kind::punct &&
               (tokens[i].text == "'" || tokens[i].text == "-");
    }
    // Clause boundary: the edges of the text and every sign but the joiners.
    bool is_boundary(std::size_t i) const {
        return i >= tokens.size() || (tokens[i].kind == Kind::punct && !is_joiner(i));
    }
    bool is_sentence_end(std::size_t i) const {
        const std::string_view t = at(i);
        return i >= tokens.size() || t == "." || t == "?" || t == "!" || t == "|";
    }

    // Whether one of the `n` words before token `i` (or from token `i` on, for
    // after_has) is in `set`. The window stays inside the clause and stops at
    // the complementizer: in "dice que Ana..." the words before "que" are not
    // about Ana.
    bool before_has(std::size_t i, int n, const Set& set) const {
        int seen = 0;
        for (std::size_t j = i; j > 0 && seen < n;) {
            --j;
            if (is_joiner(j)) continue;
            if (is_boundary(j) || at(j) == lex.stop) break;
            if (in(set, at(j))) return true;
            ++seen;
        }
        return false;
    }
    bool after_has(std::size_t i, int n, const Set& set) const {
        int seen = 0;
        for (std::size_t j = i; j < tokens.size() && seen < n; ++j) {
            if (is_joiner(j)) continue;
            if (is_boundary(j) || at(j) == lex.stop) break;
            if (in(set, at(j))) return true;
            ++seen;
        }
        return false;
    }

    // The longest number that starts at token i: digits ("50", "3.000",
    // "3,000", "5 mil") or words ("cincuenta", "tres mil quinientos",
    // "two hundred and fifty", "a thousand").
    std::optional<Number> number(std::size_t i) const;
    // An hour word: 1..12 ("una" is the only Spanish 1, as in "a la una").
    std::optional<int> hour_word(std::size_t i) const {
        if (!is_word(i)) return std::nullopt;
        if (lang == Lang::es && (at(i) == "un" || at(i) == "uno")) return std::nullopt;
        const auto v = lookup(small_words(lang), at(i));
        if (v && *v >= 1 && *v <= 12) return v;
        return std::nullopt;
    }
};

std::optional<Number> Scan::number(std::size_t i) const {
    enum class Last : std::uint8_t { none, small, tens, hundred, thousand, million };
    Last last = Last::none;
    std::int64_t total = 0;
    std::int64_t cur = 0;
    bool any = false;
    bool article = false;  // English "a" before hundred/thousand/million
    std::size_t k = i;
    const bool es = lang == Lang::es;
    const auto is_mil = [&](std::string_view w) { return es ? w == "mil" : w == "thousand"; };
    const auto is_million = [&](std::string_view w) {
        return es ? (w == "millon" || w == "millones") : (w == "million" || w == "millions");
    };

    if (is_number(k)) {
        if (tokens[k].text.size() > 9) return std::nullopt;
        std::int64_t v = std::atoll(tokens[k].text.c_str());
        const bool groupable = tokens[k].text.size() <= 3;
        ++k;
        while ((at(k) == "." || at(k) == ",") && is_number(k + 1)) {
            if (!groupable || tokens[k + 1].text.size() != 3 || v > 999999) {
                Number n;
                n.end = k + 2;
                n.decimal = true;
                return n;
            }
            v = v * 1000 + std::atoll(tokens[k + 1].text.c_str());
            k += 2;
        }
        cur = v;
        any = true;
        last = Last::small;  // only multipliers may follow digits
        if (!is_mil(at(k)) && !is_million(at(k))) return Number{cur, k, false};
    } else if (!es && at(k) == "a" &&
               (at(k + 1) == "hundred" || is_mil(at(k + 1)) || is_million(at(k + 1)))) {
        article = true;
        ++k;
    }

    for (;; ++k) {
        if (!is_word(k)) break;
        const std::string_view w = at(k);
        if (any && last == Last::small && is_number(i) && !is_mil(w) && !is_million(w)) break;
        if (const auto v = lookup(small_words(lang), w)) {
            if (last == Last::none || last == Last::thousand || last == Last::million) {
                if (last != Last::none && cur != 0) break;
                cur = *v;
            } else if (last == Last::hundred || (last == Last::tens && *v >= 1 && *v <= 9)) {
                cur += *v;
            } else {
                break;
            }
            last = Last::small;
        } else if (const auto t = lookup(tens_words(lang), w)) {
            if (last == Last::none || last == Last::thousand || last == Last::million) {
                if (last != Last::none && cur != 0) break;
                cur = *t;
            } else if (last == Last::hundred) {
                cur += *t;
            } else {
                break;
            }
            last = Last::tens;
        } else if (const auto h = es ? lookup(hundreds_words(), w) : std::nullopt) {
            if (last != Last::none && last != Last::thousand && last != Last::million) break;
            if (cur != 0) break;
            cur = *h;
            last = Last::hundred;
        } else if (!es && w == "hundred") {
            if (article && !any) {
                cur = 100;
            } else if (any && cur >= 1 && cur <= 99 && last != Last::hundred) {
                cur *= 100;
            } else {
                break;
            }
            last = Last::hundred;
        } else if (is_mil(w)) {
            if (!any && !article && !es) break;
            if (last == Last::thousand || last == Last::million) break;
            total += (cur == 0 ? 1 : cur) * 1000;
            cur = 0;
            last = Last::thousand;
        } else if (is_million(w)) {
            if (!any && !article && !es) break;
            if (last == Last::million) break;
            total = (total + (cur == 0 ? 1 : cur)) * 1000000;
            cur = 0;
            last = Last::million;
        } else if ((es && w == "y") || (!es && w == "and")) {
            // "treinta y cinco", "two hundred and fifty"
            const bool ok = es ? last == Last::tens : (last == Last::hundred || last == Last::thousand);
            const bool next_number = lookup(small_words(lang), at(k + 1)).has_value() ||
                                     lookup(tens_words(lang), at(k + 1)).has_value();
            if (!ok || !next_number) break;
            continue;
        } else {
            break;
        }
        any = true;
        if (total > 1000000000000LL) return std::nullopt;
        // "twenty-five": the hyphen joins tens and unit.
        if (!es && last == Last::tens && at(k + 1) == "-" &&
            lookup(small_words(lang), at(k + 2)).has_value()) {
            ++k;
        }
    }
    if (!any) return std::nullopt;
    return Number{total + cur, k, false};
}

// --- Names: who and where ---------------------------------------------------

struct NameMatch {
    std::size_t begin = 0;
    std::size_t end = 0;
    std::size_t index = 0;  // position in the list of names
};

// Every mention of a name of `names`, longest first and without overlaps.
// Names are matched token by token, so "Ana" is not in "mañana" and "bar" is
// not in "barrio".
std::vector<NameMatch> find_names(const Scan& s, const std::vector<std::string>& names) {
    std::vector<Tokens> keys;
    keys.reserve(names.size());
    for (const std::string& n : names) keys.push_back(tokenize(n));
    std::vector<NameMatch> out;
    for (std::size_t i = 0; i < s.size();) {
        std::size_t best_len = 0;
        std::size_t best = 0;
        for (std::size_t n = 0; n < keys.size(); ++n) {
            const Tokens& key = keys[n];
            if (key.empty() || key.size() <= best_len || i + key.size() > s.size()) continue;
            bool same = true;
            for (std::size_t k = 0; k < key.size() && same; ++k) {
                same = s.tokens[i + k].text == key[k].text;
            }
            if (same) {
                best_len = key.size();
                best = n;
            }
        }
        if (best_len == 0) {
            ++i;
            continue;
        }
        out.push_back({i, i + best_len, best});
        i += best_len;
    }
    return out;
}

// Rule for who: a name counts as stated for the slot unless it is a vocative
// ("Luis, ¿sabes...?", "¿sabes, Luis?", "hola Luis"), a source or an addressee
// ("me lo dijo Ana", "según Ana", "Ana dice", "pregúntale a Ana", "Ana told
// me") or a companion ("con Ana", "Ana y yo"). The slot is contradicted when
// some name counts, the claim's neighbor is not named anywhere in the text
// and no counted name is the claim's. The speaker and the listener of the
// turn, when the context gives them, never count.
bool who_contradicts(const Scan& s, const TextCheckContext& context, SlotValue who) {
    const std::vector<std::string>& neighbors = context.neighbors;
    if (who < 1 || static_cast<std::size_t>(who) > neighbors.size()) return false;
    const std::size_t claimed = static_cast<std::size_t>(who) - 1;
    // The two neighbors of the turn, by name: mentioning them states nothing.
    const auto in_turn = [&](std::size_t index) {
        for (const NeighborId n : {context.speaker, context.listener}) {
            if (n.valid() && n.index() < neighbors.size() && neighbors[n.index()] == neighbors[index]) {
                return true;
            }
        }
        return false;
    };
    // Only "y", "and", "a", commas... between two names: they are a list.
    const auto joined = [&](std::size_t from, std::size_t to) {
        static const Set joins = {"y", "e", "o", "u", "a", "ni", "and", "or", ",", "nor"};
        for (std::size_t k = from; k < to; ++k) {
            if (!in(joins, s.at(k))) return false;
        }
        return true;
    };
    bool stated_other = false;
    std::optional<std::size_t> excluded_end;  // end of the last excluded name
    for (const NameMatch& m : find_names(s, neighbors)) {
        if (m.index == claimed || neighbors[m.index] == neighbors[claimed]) return false;
        if (in_turn(m.index)) continue;
        const std::string_view prev = m.begin > 0 ? s.at(m.begin - 1) : std::string_view();
        const bool opens = m.begin == 0 || (s.is_boundary(m.begin - 1) && prev != ",") ||
                           in(s.lex.greetings, prev);
        const bool vocative = (opens && s.is_boundary(m.end)) || in(s.lex.greetings, prev) ||
                              (prev == "," && s.is_sentence_end(m.end));
        // "se lo he contado a Luis y a Marta": a list shares the frame of its first name.
        const bool excluded = vocative || s.before_has(m.begin, 2, s.lex.who_before) ||
                              s.after_has(m.end, 3, s.lex.who_after) ||
                              (excluded_end && joined(*excluded_end, m.begin));
        if (excluded) {
            excluded_end = m.end;
            continue;
        }
        excluded_end.reset();
        stated_other = true;
    }
    return stated_other;
}

// Rule for where: only public places count (nothing happens in the home
// quarters, which name where people live), and only after "en/a/hacia +
// article" or "al" ("in/at/to/inside the"), with at most one word between the
// article and the place ("at the old mill"). A place next to another ("junto a
// la fuente") or in a clause about somebody's whereabouts or about where it
// was heard ("estoy en el bar", "en el mercado dicen") does not count.
bool where_contradicts(const Scan& s, const std::vector<std::string>& places, SlotValue where) {
    if (where < 1 || static_cast<std::size_t>(where) > places.size()) return false;
    const std::size_t claimed = static_cast<std::size_t>(where) - 1;
    bool stated_other = false;
    for (const NameMatch& m : find_names(s, places)) {
        if (m.index == claimed || places[m.index] == places[claimed]) return false;
        if (!is_public(PlaceId::from_index(m.index))) continue;
        // Find the preposition: "en la plaza", "en la vieja plaza", "al bar".
        std::optional<std::size_t> prep;
        for (std::size_t gap = 0; gap <= 1 && !prep; ++gap) {
            if (m.begin < gap + 1) break;
            const std::size_t art = m.begin - 1 - gap;
            if (gap == 1 && !s.is_word(m.begin - 1)) break;
            if (in(s.lex.place_contractions, s.at(art))) {
                prep = art;
            } else if (in(s.lex.articles, s.at(art)) && art > 0 &&
                       in(s.lex.place_preps, s.at(art - 1))) {
                prep = art - 1;
            }
        }
        if (!prep) continue;
        if (*prep > 0 && in(s.lex.place_relational, s.at(*prep - 1))) continue;
        if (s.before_has(*prep, 2, s.lex.place_cues)) continue;
        if (s.after_has(m.end, 2, s.lex.place_cues_after)) continue;
        stated_other = true;
    }
    return stated_other;
}

// --- When -------------------------------------------------------------------

// What the text says about the time of day: the minutes since 00:00 it may
// mean (two for a twelve-hour hour said without more) and how far from them a
// claim may be and still agree.
struct TimeMention {
    std::vector<int> minutes;
    int tolerance = 0;
};

enum class DayPart : std::uint8_t { none, morning, afternoon, night, early, noon };

struct Hour {
    int hour = 0;
    int minute = 0;
    std::size_t end = 0;
    bool exact24 = false;  // "21:00", "09:30": no twelve-hour reading
    bool strong = false;   // a clock, "h", "o'clock", "am" or "pm": it is a time for sure
    bool marked = false;   // minutes or a part of the day follow: not a bare hour
    int tolerance = 0;
    DayPart part = DayPart::none;
};

// An hour at token i: digits ("9", "21", "21:00", "21.30" when `dot`, "21h")
// or an hour word ("diez", "ten").
std::optional<Hour> read_hour(const Scan& s, std::size_t i, bool dot) {
    Hour h;
    if (s.is_number(i)) {
        const std::string& d = s.tokens[i].text;
        if (d.size() > 2) return std::nullopt;
        h.hour = std::atoi(d.c_str());
        if (h.hour > 24) return std::nullopt;
        h.end = i + 1;
        h.exact24 = h.hour > 12 || h.hour == 0 || d[0] == '0';
        const std::string_view sep = s.at(i + 1);
        if ((sep == ":" || (dot && sep == ".")) && s.is_number(i + 2) &&
            s.tokens[i + 2].text.size() == 2) {
            h.minute = std::atoi(s.tokens[i + 2].text.c_str());
            if (h.minute > 59) return std::nullopt;
            h.end = i + 3;
            h.strong = true;
            h.marked = true;
        } else if (sep == "h" || (s.lang == Lang::es && (sep == "horas" || sep == "hrs"))) {
            h.end = i + 2;
            h.strong = true;
            h.marked = true;
        }
        if (sep == "." && !h.marked && s.is_number(i + 2)) return std::nullopt;  // "3.000"
        return h;
    }
    const auto w = s.hour_word(i);
    if (!w) return std::nullopt;
    h.hour = *w;
    h.end = i + 1;
    return h;
}

// Minutes and part of the day after an hour: "y media", "menos cuarto",
// "y diez", "en punto", "de la noche"; "thirty", "o'clock", "pm", "p.m.",
// "in the evening", "at night".
void read_rest(const Scan& s, Hour& h) {
    std::size_t k = h.end;
    const bool es = s.lang == Lang::es;
    if (!h.marked) {
        if (es) {
            const std::string_view a = s.at(k);
            const std::string_view b = s.at(k + 1);
            if (a == "y" && b == "media") {
                h.minute = 30, k += 2, h.marked = true;
            } else if (a == "y" && b == "cuarto") {
                h.minute = 15, k += 2, h.marked = true;
            } else if (a == "menos" && b == "cuarto") {
                h.hour -= 1, h.minute = 45, k += 2, h.marked = true;
            } else if (a == "y" && b == "pico") {
                h.tolerance = 60, k += 2, h.marked = true;
            } else if (a == "en" && b == "punto") {
                k += 2, h.marked = true;
            } else if (a == "y" || a == "menos") {
                const auto n = s.number(k + 1);
                if (n && !n->decimal && n->value >= 1 && n->value <= 59 &&
                    (a == "y" || n->value <= 30)) {
                    if (a == "y") {
                        h.minute = static_cast<int>(n->value);
                    } else {
                        h.hour -= 1;
                        h.minute = 60 - static_cast<int>(n->value);
                    }
                    k = n->end;
                    h.marked = true;
                }
            }
        } else {
            if (s.at(k) == "thirty") {
                h.minute = 30, k += 1, h.marked = true;
            } else if (s.at(k) == "fifteen") {
                h.minute = 15, k += 1, h.marked = true;
            } else if (s.at(k) == "forty" && s.at(k + 1) == "-" && s.at(k + 2) == "five") {
                h.minute = 45, k += 3, h.marked = true;
            } else if (s.at(k) == "o" && s.at(k + 1) == "'" && s.at(k + 2) == "clock") {
                k += 3, h.strong = true, h.marked = true;
            } else if (s.at(k) == "oclock") {
                k += 1, h.strong = true, h.marked = true;
            }
        }
    }
    // The part of the day.
    const auto part_word = [&](std::string_view w) {
        if (es) {
            if (w == "manana") return DayPart::morning;
            if (w == "tarde") return DayPart::afternoon;
            if (w == "noche") return DayPart::night;
            if (w == "madrugada") return DayPart::early;
        } else {
            if (w == "morning") return DayPart::morning;
            if (w == "afternoon") return DayPart::afternoon;
            if (w == "evening") return DayPart::night;
        }
        return DayPart::none;
    };
    if (es) {
        if ((s.at(k) == "de" || s.at(k) == "por") && s.at(k + 1) == "la" &&
            part_word(s.at(k + 2)) != DayPart::none) {
            h.part = part_word(s.at(k + 2)), k += 3;
        } else if (s.at(k) == "del" && s.at(k + 1) == "mediodia") {
            h.part = DayPart::noon, k += 2;
        } else if (s.at(k) == "esta" && (s.at(k + 1) == "noche" || s.at(k + 1) == "tarde")) {
            h.part = part_word(s.at(k + 1));  // the day words are read on their own
        }
    } else {
        if (s.at(k) == "am") {
            h.part = DayPart::morning, k += 1, h.strong = true;
        } else if (s.at(k) == "pm") {
            h.part = DayPart::afternoon, k += 1, h.strong = true;
        } else if ((s.at(k) == "a" || s.at(k) == "p") && s.at(k + 1) == "." &&
                   s.at(k + 2) == "m") {
            h.part = s.at(k) == "a" ? DayPart::morning : DayPart::afternoon;
            k += s.at(k + 3) == "." ? 4 : 3;
            h.strong = true;
        } else if (s.at(k) == "in" && s.at(k + 1) == "the" &&
                   part_word(s.at(k + 2)) != DayPart::none) {
            h.part = part_word(s.at(k + 2)), k += 3;
        } else if (s.at(k) == "at" && s.at(k + 1) == "night") {
            h.part = DayPart::night, k += 2;
        } else if (s.at(k) == "tonight") {
            h.part = DayPart::night;
        } else if (s.at(k) == "this" && part_word(s.at(k + 1)) != DayPart::none) {
            h.part = part_word(s.at(k + 1));
        }
    }
    if (h.part != DayPart::none) h.marked = true;
    // Approximate: "o así", "más o menos", "aproximadamente", "or so", "-ish".
    if (es) {
        if ((s.at(k) == "o" && s.at(k + 1) == "asi") ||
            (s.at(k) == "mas" && s.at(k + 1) == "o" && s.at(k + 2) == "menos") ||
            s.at(k) == "aproximadamente") {
            h.tolerance = 60;
        }
    } else if ((s.at(k) == "or" && s.at(k + 1) == "so") ||
               (s.at(k) == "-" && s.at(k + 1) == "ish") || s.at(k) == "approximately") {
        h.tolerance = 60;
    }
    h.end = k;
}

TimeMention to_mention(const Hour& h) {
    TimeMention t;
    t.tolerance = h.tolerance;
    if (h.minute != 0 && h.minute != 30) t.tolerance = std::max(t.tolerance, 15);
    const int hour = (h.hour + 24) % 24;
    const auto add = [&](int hh) { t.minutes.push_back(((hh % 24) * 60 + h.minute) % 1440); };
    if (h.exact24) {
        add(hour);
        return t;
    }
    const int base = hour % 12;  // 12 o'clock is 0 here
    switch (h.part) {
        case DayPart::morning:
        case DayPart::early:
            add(base);
            if (hour == 12) add(12);  // "doce de la mañana" is said for noon too
            break;
        case DayPart::afternoon:
            add(base + 12);
            break;
        case DayPart::night:
            if (hour == 12) {
                add(0);
            } else if (base >= 6) {
                add(base + 12);
            } else {
                add(base);
                add(base + 12);
            }
            break;
        case DayPart::noon:
            add(base < 6 ? base + 12 : base);
            break;
        case DayPart::none:
            add(base);
            add(base + 12);
            break;
    }
    return t;
}

// Every time of day the text states, in frames that leave no doubt.
std::vector<TimeMention> find_times(const Scan& s) {
    std::vector<TimeMention> out;
    const bool es = s.lang == Lang::es;
    const Lexicon& lex = s.lex;
    // Keeps the mention from `start` (its frame) to `h.end` unless its clause
    // rules it out; `weak` when nothing but the frame says it is an hour, so
    // what follows must fit. A time read but not kept is still skipped.
    const auto accept = [&](std::size_t start, const Hour& h, bool weak) {
        if (weak && !h.marked && !h.strong && !s.is_boundary(h.end) &&
            !in(lex.time_followers, s.at(h.end))) {
            return;
        }
        if (s.before_has(start, 2, lex.time_relational)) return;
        if (s.before_has(start, 3, lex.time_report) || s.after_has(h.end, 3, lex.time_report)) {
            return;
        }
        out.push_back(to_mention(h));
    };
    const auto noon_or_midnight = [&](std::size_t i) -> std::optional<Hour> {
        Hour h;
        h.end = i + 1;
        h.exact24 = true;
        const std::string_view w = s.at(i);
        if (w == (es ? "medianoche" : "midnight")) {
            h.hour = 0, h.tolerance = 30;
        } else if (w == (es ? "mediodia" : "noon") || (!es && w == "midday")) {
            h.hour = 12, h.tolerance = es ? 120 : 30;
        } else {
            return std::nullopt;
        }
        return h;
    };

    for (std::size_t i = 0; i < s.size();) {
        std::size_t next = i + 1;
        if (es) {
            // "a las diez", "sobre las nueve y media", "a eso de las diez", "a la una",
            // "las diez de la noche".
            if ((s.at(i) == "las" || s.at(i) == "la")) {
                if (auto h = read_hour(s, i + 1, true)) {
                    read_rest(s, *h);
                    const bool one = h->hour == 1 && !h->exact24;
                    const bool article_ok = (s.at(i) == "la") == one || h->exact24;
                    const std::string_view p1 = i > 0 ? s.at(i - 1) : std::string_view();
                    const std::string_view p2 = i > 1 ? s.at(i - 2) : std::string_view();
                    bool frame = p1 == "a" || p1 == "sobre" || p1 == "hacia";
                    if (p1 == "de" && p2 == "eso") frame = true, h->tolerance = 60;
                    if (p1 == "sobre" || p1 == "hacia" || (p1 == "a" && p2 == "como")) {
                        h->tolerance = 60;
                    }
                    const std::size_t start = frame ? i - 1 : i;
                    if (article_ok && (frame || h->part != DayPart::none || h->strong)) {
                        accept(start, *h, frame);
                        next = h->end;
                    }
                }
            } else if ((s.at(i) == "a" || s.at(i) == "al") && noon_or_midnight(i + 1)) {
                accept(i, *noon_or_midnight(i + 1), false);
                next = i + 2;
            } else if (s.at(i) == "a" && s.at(i + 1) == "la" && noon_or_midnight(i + 2)) {
                accept(i, *noon_or_midnight(i + 2), false);
                next = i + 3;
            }
        } else {
            // "at ten", "at around nine", "around 9 pm", "at ten past nine".
            const std::string_view w = s.at(i);
            if (w == "at" || w == "around" || w == "about" || w == "approximately") {
                std::size_t k = i + 1;
                bool approx = w != "at";
                if (w == "at" && (s.at(k) == "around" || s.at(k) == "about")) approx = true, ++k;
                if (auto mn = noon_or_midnight(k)) {
                    if (approx) mn->tolerance = std::max(mn->tolerance, 60);
                    accept(i, *mn, false);
                    next = k + 1;
                } else if (auto h = read_hour(s, k, false)) {
                    // "ten past nine", "ten to nine"
                    if ((s.at(h->end) == "past" || s.at(h->end) == "to") && !h->marked) {
                        if (auto base = read_hour(s, h->end + 1, false)) {
                            const int n = h->hour;
                            const bool past = s.at(h->end) == "past";
                            *h = *base;
                            h->hour = past ? base->hour : base->hour - 1;
                            h->minute = past ? n : 60 - n;
                            h->marked = true;
                        }
                    }
                    read_rest(s, *h);
                    if (approx) h->tolerance = std::max(h->tolerance, 60);
                    // Without "at", only a marked hour or the end of the clause.
                    const bool fits = !approx || h->marked || h->strong || s.is_boundary(h->end);
                    if (fits) {
                        accept(i, *h, true);
                        next = h->end;
                    }
                }
            } else if ((w == "half" || w == "quarter") &&
                       (s.at(i + 1) == "past" || (w == "quarter" && s.at(i + 1) == "to"))) {
                if (auto h = read_hour(s, i + 2, false)) {
                    if (w == "half") {
                        h->minute = 30;
                    } else if (s.at(i + 1) == "past") {
                        h->minute = 15;
                    } else {
                        h->hour -= 1, h->minute = 45;
                    }
                    h->marked = true;
                    read_rest(s, *h);
                    std::size_t start = i;
                    if (start > 0 && (s.at(start - 1) == "a" || s.at(start - 1) == "at")) --start;
                    if (start > 0 && s.at(start - 1) == "at") --start;
                    accept(start, *h, false);
                    next = h->end;
                }
            }
        }
        // Anywhere, in both languages: "21:00", "21h", "9 pm", "ten o'clock".
        if (next == i + 1) {
            if (auto h = read_hour(s, i, false)) {
                read_rest(s, *h);
                if (h->strong) {
                    accept(i, *h, false);
                    next = h->end;
                }
            }
        }
        i = next;
    }
    return out;
}

// The day words: "hoy", "mañana", "esta noche", "pasado mañana", "ayer",
// "anoche"; "today", "tonight", "tomorrow", "this evening", "yesterday",
// "last night". The morning ("de la mañana", "por la mañana"), farewells
// ("hasta mañana", "see you tomorrow") and the day of the telling ("me lo dijo
// ayer") do not count.
std::vector<int> find_days(const Scan& s) {
    std::vector<int> out;
    const bool es = s.lang == Lang::es;
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (!s.is_word(i)) continue;
        const std::string_view w = s.at(i);
        const std::string_view prev = i > 0 ? s.at(i - 1) : std::string_view();
        const std::string_view prev2 = i > 1 ? s.at(i - 2) : std::string_view();
        std::optional<int> day;
        std::size_t end = i + 1;
        if (es) {
            if (w == "hoy") {
                if (s.at(i + 1) == "dia" || (s.at(i + 1) == "en" && s.at(i + 2) == "dia")) continue;
                day = 0;
            } else if (w == "manana") {
                if (prev == "pasado") {
                    day = 2;
                } else if (prev == "esta") {
                    day = 0;
                } else if (prev == "la" || prev == "las" || prev == "cada" || prev == "toda" ||
                           prev == "una" || prev == "buena" || prev == "buenas" ||
                           prev == "media" || prev == "hasta") {
                    continue;
                } else {
                    day = 1;
                }
            } else if (w == "esta" && (s.at(i + 1) == "noche" || s.at(i + 1) == "tarde")) {
                day = 0, end = i + 2;
            } else if (w == "ayer") {
                day = (prev == "de" && prev2 == "antes") ? -2 : -1;
            } else if (w == "anteayer") {
                day = -2;
            } else if (w == "anoche") {
                day = -1;
            }
        } else {
            if (w == "today" || w == "tonight") {
                day = 0;
            } else if (w == "this" && (s.at(i + 1) == "morning" || s.at(i + 1) == "afternoon" ||
                                       s.at(i + 1) == "evening")) {
                day = 0, end = i + 2;
            } else if (w == "tomorrow") {
                if (prev == "until" || prev == "till") continue;
                day = (prev == "after" && prev2 == "day") ? 2 : 1;
            } else if (w == "yesterday") {
                day = -1;
            } else if (w == "last" && s.at(i + 1) == "night") {
                day = -1, end = i + 2;
            }
        }
        if (!day) continue;
        if (s.before_has(i, 3, s.lex.time_report) || s.after_has(end, 3, s.lex.time_report)) {
            continue;
        }
        out.push_back(*day);
    }
    return out;
}

bool when_contradicts(const Scan& s, TimeSlot when, Tick now) {
    if (when < 0 || now < 0) return false;
    const int claim_minute = (when % kSlotsPerDay) * kTicksPerSlot;
    const int claim_day = when / kSlotsPerDay - day_of(now);

    const std::vector<TimeMention> times = find_times(s);
    bool time_ok = times.empty();
    for (const TimeMention& t : times) {
        for (const int m : t.minutes) {
            const int d = std::abs(m - claim_minute);
            if (std::min(d, 1440 - d) <= t.tolerance) time_ok = true;
        }
    }

    // Early hours belong to the night before as well: "esta noche a la una"
    // is tomorrow 01:00.
    const std::vector<int> days = find_days(s);
    bool day_ok = days.empty();
    for (const int d : days) {
        if (d == claim_day || (claim_minute < 6 * 60 && d == claim_day - 1)) day_ok = true;
    }
    return !time_ok || !day_ok;
}

// --- Amount -----------------------------------------------------------------

// Every amount the text states: a whole number before a unit ("50 personas",
// "3.000 euros", "dos millones de euros", "a hundred people"), after a currency
// sign ("€300") or after "multa de"/"fine of". Approximations ("unos 50",
// "más de 50", "50 o más", "about 50", "50 or so") do not count.
std::vector<std::int64_t> find_amounts(const Scan& s) {
    std::vector<std::int64_t> out;
    const bool es = s.lang == Lang::es;
    const Lexicon& lex = s.lex;
    const auto approx_after = [&](std::size_t k) {
        if (es) return s.at(k) == "o" && (s.at(k + 1) == "asi" || s.at(k + 1) == "mas" ||
                                          s.at(k + 1) == "menos");
        return (s.at(k) == "or" && (s.at(k + 1) == "so" || s.at(k + 1) == "more" ||
                                    s.at(k + 1) == "less")) ||
               s.at(k) == "plus";
    };
    const auto keep = [&](std::size_t start, const Number& n, std::size_t after) {
        if (n.decimal) return;
        if (s.before_has(start, 2, lex.amount_approx) || approx_after(after)) return;
        out.push_back(n.value);
    };
    std::vector<bool> used(s.size(), false);
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (!s.is_word(i) || !in(lex.units, s.at(i))) continue;
        // The number before the unit: the earliest start whose number ends there.
        std::size_t end = i;
        if (es && end >= 2 && s.at(end - 1) == "de" &&
            (s.at(end - 2) == "millon" || s.at(end - 2) == "millones")) {
            --end;
        }
        bool found = false;
        for (std::size_t start = end > 12 ? end - 12 : 0; start < end && !found; ++start) {
            const auto n = s.number(start);
            if (!n || n->end != end) continue;
            if (start > 1 && (s.at(start - 1) == "." || s.at(start - 1) == ",") &&
                s.is_number(start - 2)) {
                continue;  // inside "3.000"
            }
            found = true;
            for (std::size_t k = start; k < end; ++k) used[k] = true;
            keep(start, *n, i + 1);
        }
        // "€300", "$ 300"
        if (!found && (s.at(i) == "eur" || s.at(i) == "usd")) {
            if (const auto n = s.number(i + 1)) {
                for (std::size_t k = i + 1; k < n->end; ++k) used[k] = true;
                keep(i, *n, n->end);
            }
        }
    }
    // "una multa de 300", "a fine of 300" without a unit.
    for (std::size_t i = 0; i + 2 < s.size(); ++i) {
        if (!in(lex.amount_nouns, s.at(i)) || s.at(i + 1) != lex.amount_of) continue;
        if (used[i + 2]) continue;
        if (const auto n = s.number(i + 2)) {
            if (!s.is_boundary(n->end) && !s.is_joiner(n->end) && s.is_word(n->end) &&
                !in(lex.time_followers, s.at(n->end))) {
                continue;
            }
            keep(i + 2, *n, n->end);
        }
    }
    return out;
}

bool amount_contradicts(const Scan& s, SlotValue amount) {
    const std::vector<std::int64_t> amounts = find_amounts(s);
    if (amounts.empty()) return false;
    for (const std::int64_t a : amounts) {
        if (a == amount) return false;
    }
    return true;
}

}  // namespace

TextCheck check_text(const TextCheckContext& context, const Claim& claim, Tick now,
                     std::string_view text) {
    TextCheck out;
    if (text.empty()) return out;
    const Scan s{tokenize(text), context.lang, lexicon(context.lang)};
    if (const auto& v = claim.slots[idx(Slot::who)]) {
        out.contradicts[idx(Slot::who)] = who_contradicts(s, context, *v);
    }
    if (const auto& v = claim.slots[idx(Slot::where)]) {
        out.contradicts[idx(Slot::where)] = where_contradicts(s, context.places, *v);
    }
    if (const auto& v = claim.slots[idx(Slot::when)]) {
        out.contradicts[idx(Slot::when)] = when_contradicts(s, *v, now);
    }
    if (const auto& v = claim.slots[idx(Slot::amount)]) {
        out.contradicts[idx(Slot::amount)] = amount_contradicts(s, *v);
    }
    return out;
}

}  // namespace rumor
