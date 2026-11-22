// Tests of rumor::check_text, the incoherent text detector, in both languages
// and with the real names of the vocabulary and the neighbors. Three groups:
// texts that agree with their claim, clear contradictions (marked, and in the
// right slot) and doubtful texts, which must never be marked.

#include <doctest/doctest.h>

#include <optional>
#include <ostream>  // doctest prints std::string_view (MSVC: not pulled in by <string>)
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "card/textcheck.h"
#include "core/population_api.h"

namespace rumor {
namespace {

const std::string kData = RUMOR_DATA_DIR;

// Day 0, 18:30: "hoy" is day 0 and "mañana" day 1.
constexpr Tick kNow = 18 * kTicksPerHour + 30;

TextCheckContext make_context(Lang lang) {
    TextCheckContext c;
    c.lang = lang;
    const Vocab vocab = load_vocab(kData, lang);
    c.places.assign(vocab.places.begin(), vocab.places.end());
    for (const Neighbor& n : make_population(kData, 100, Layout::village, 1).neighbors) {
        c.neighbors.push_back(n.name);
    }
    return c;
}

const TextCheckContext& context(Lang lang) {
    static const TextCheckContext es = make_context(Lang::es);
    static const TextCheckContext en = make_context(Lang::en);
    return lang == Lang::es ? es : en;
}

SlotValue index_of(const std::vector<std::string>& names, const std::string& name) {
    for (std::size_t i = 0; i < names.size(); ++i) {
        if (names[i] == name) return static_cast<SlotValue>(i + 1);
    }
    throw std::runtime_error("unknown name: " + name);
}

// The claim of a case, with names instead of identifiers. Empty fields are
// empty slots.
struct ClaimSpec {
    std::string who;
    std::string where;
    std::optional<int> day;  // with hour and minute: the when slot
    int hour = 0;
    int minute = 0;
    std::optional<SlotValue> amount;
};

Claim make_claim(Lang lang, const ClaimSpec& spec) {
    const TextCheckContext& c = context(lang);
    Claim claim;
    if (!spec.who.empty()) claim.slots[idx(Slot::who)] = index_of(c.neighbors, spec.who);
    if (!spec.where.empty()) claim.slots[idx(Slot::where)] = index_of(c.places, spec.where);
    if (spec.day) {
        claim.slots[idx(Slot::when)] =
            from_relative(RelativeWhen{*spec.day, spec.hour, spec.minute}, kNow).value();
    }
    claim.slots[idx(Slot::amount)] = spec.amount;
    return claim;
}

struct Case {
    ClaimSpec claim;
    std::string text;
    std::optional<Slot> marked;  // the only slot that must be marked; none for agreement

    Case(ClaimSpec c, std::string t, std::optional<Slot> m = std::nullopt)
        : claim(std::move(c)), text(std::move(t)), marked(m) {}
};

void run(Lang lang, const std::vector<Case>& cases) {
    for (const Case& c : cases) {
        INFO(c.text);
        const TextCheck result = check_text(context(lang), make_claim(lang, c.claim), kNow, c.text);
        for (const Slot slot : kSlots) {
            INFO("slot " << key(slot));
            CHECK(result.contradicts[idx(slot)] == (c.marked == slot));
        }
    }
}

constexpr int kToday = 0;
constexpr int kTomorrow = 1;

}  // namespace

TEST_SUITE("textcheck") {
    TEST_CASE("the names of the cases are those of the vocabulary and the village") {
        CHECK(index_of(context(Lang::es).places, "plaza") == 1);
        CHECK(index_of(context(Lang::en).places, "town hall") == 7);
        CHECK(index_of(context(Lang::es).neighbors, "Carmen") == 1);
        CHECK(context(Lang::es).neighbors.size() == 100);
    }

    TEST_CASE("es: texts that agree with their claim") {
        run(Lang::es, {
            {{"", "plaza", kToday, 22, 0, {}},
             "¿Sabes que hay fiesta en la plaza? Creo que era a las diez."},
            {{"Pedro", "", {}, 0, 0, 3000},
             "¡A Pedro le ha tocado la lotería! Nada menos que 3.000 euros."},
            {{"Teresa", "iglesia", kTomorrow, 12, 0, {}},
             "Teresa se casa mañana a las doce en la iglesia."},
            {{"", "escuela", kTomorrow, 8, 0, {}},
             "Mañana a las ocho empiezan las obras en la escuela."},
            {{"", "plaza", kToday, 21, 0, 50},
             "Esta noche hay fiesta en la plaza a las nueve, y vendrán 50 personas."},
            {{"", "", kToday, 21, 30, {}}, "La fiesta es a las nueve y media de la noche."},
            {{"", "plaza", kToday, 21, 0, {}}, "Es a las 21:00 en la plaza."},
            {{"", "", {}, 0, 0, 50}, "Dicen que vendrán cincuenta invitados."},
            {{"", "ayuntamiento", kTomorrow, 10, 0, {}},
             "Mañana a las diez de la mañana hay reunión en el ayuntamiento."},
            {{"", "bar", kToday, 22, 0, {}}, "A las diez de la noche, en el bar."},
            {{"", "", {}, 0, 0, 2000000}, "¡Dos millones de euros de herencia!"},
            {{"", "", kTomorrow, 0, 0, {}}, "Será esta noche, a medianoche."},
            {{"", "", kToday, 13, 0, {}}, "Es a la una de la tarde."},
            {{"", "plaza", kTomorrow, 22, 0, {}}, "MAÑANA, A LAS DIEZ, EN LA PLAZA."},
            {{"", "panadería", kToday, 19, 30, {}},
             "En la panaderia, a las siete y media de la tarde."},
            {{"", "", {}, 0, 0, 3500}, "Le han tocado tres mil quinientos euros."},
        });
    }

    TEST_CASE("es: clear contradictions are marked in their slot") {
        run(Lang::es, {
            {{"", "plaza", {}, 0, 0, {}}, "Hay fiesta en el bar esta noche.", Slot::where},
            {{"", "", kToday, 22, 0, {}}, "La fiesta es a las nueve.", Slot::when},
            {{"", "", kToday, 22, 0, {}}, "Hay fiesta mañana a las diez.", Slot::when},
            {{"Pedro", "", {}, 0, 0, 3000}, "A Pedro le han tocado 5.000 euros.", Slot::amount},
            {{"Teresa", "", {}, 0, 0, {}}, "¿Sabes que se casa Elena?", Slot::who},
            {{"", "", kToday, 21, 0, {}}, "Es a las 22:00.", Slot::when},
            {{"Teresa", "iglesia", {}, 0, 0, {}}, "Teresa se casa en la ermita.", Slot::where},
            {{"", "", {}, 0, 0, 50}, "Vendrán cien personas a la fiesta.", Slot::amount},
            {{"", "", kToday, 21, 30, {}}, "Empieza a las diez y media de la noche.",
             Slot::when},
            {{"", "plaza", kToday, 21, 0, {}}, "Es en la plaza, pero pasado mañana a las nueve.",
             Slot::when},
            {{"Pedro", "", {}, 0, 0, 3000}, "Le ha tocado la lotería a Antonio: tres mil euros.",
             Slot::who},
            {{"Manuel", "", {}, 0, 0, {}}, "Manuela lo ha heredado todo.", Slot::who},
            {{"", "", kToday, 21, 0, {}}, "Es a las nueve de la mañana.", Slot::when},
            {{"", "ayuntamiento", {}, 0, 0, {}}, "Es en la fuente del pueblo.", Slot::where},
        });
    }

    TEST_CASE("es: doubtful texts are never marked") {
        run(Lang::es, {
            // A name may be the listener, a source, an addressee or a list.
            {{"Pedro", "", {}, 0, 0, {}}, "Luis, ¿sabes lo de la lotería?"},
            {{"Pedro", "", {}, 0, 0, {}}, "¿Te has enterado de lo de la lotería, Luis?"},
            {{"Teresa", "iglesia", {}, 0, 0, {}}, "Me lo dijo Ana: hay boda en la iglesia."},
            {{"Teresa", "", kTomorrow, 12, 0, {}}, "Ana dice que hay boda mañana."},
            {{"Teresa", "", {}, 0, 0, {}}, "Pregúntale a Pedro, que él estuvo allí."},
            {{"Pedro", "", {}, 0, 0, {}}, "Se lo he contado a Luis y a Marta."},
            {{"Pedro", "", {}, 0, 0, {}}, "Hola Luis, ¿qué tal?"},
            {{"Teresa", "", {}, 0, 0, {}}, "Según Elena, alguien se casa."},
            // Twelve-hour hours, several values, the claim among them.
            {{"", "", kToday, 22, 0, {}}, "Creo que era a las diez."},
            {{"", "", kToday, 22, 0, {}}, "No sé si a las diez o a las once."},
            {{"", "plaza", {}, 0, 0, {}}, "Estoy en el bar, pero la fiesta es en la plaza."},
            // Whereabouts and sources are not the place of the fact.
            {{"", "plaza", {}, 0, 0, {}}, "Vengo del mercado y no sé nada más."},
            {{"", "plaza", {}, 0, 0, {}}, "Estaba en el mercado cuando me lo contaron."},
            {{"", "plaza", kToday, 22, 0, {}}, "Me lo contaron ayer en el bar."},
            {{"", "plaza", {}, 0, 0, {}}, "Voy al mercado, luego te cuento."},
            {{"", "plaza", {}, 0, 0, {}}, "Está junto a la fuente."},
            // Names inside other words are not mentions.
            {{"Pedro", "", {}, 0, 0, {}}, "Mañana se sabrá todo."},
            {{"", "plaza", {}, 0, 0, {}}, "En el barrio no se habla de otra cosa."},
            {{"", "plaza", {}, 0, 0, {}}, "Me han dicho que en el barrio alto no se habla de otra cosa."},
            // Numbers that are not amounts, or not exact.
            {{"", "", {}, 0, 0, 50}, "Vendrán más de 40 personas."},
            {{"", "", {}, 0, 0, 50}, "Seremos cincuenta, más o menos."},
            {{"", "", {}, 0, 0, 50}, "Vendrán unos cuarenta, o sea mucha gente."},
            {{"", "", {}, 0, 0, 3000}, "Le tocó el premio a las dos de la tarde."},
            {{"", "", {}, 0, 0, 3000}, "Se lo dije a las dos hermanas."},
            // Times of other things, relational times, farewells.
            {{"", "", kToday, 21, 0, {}}, "Hay fiesta a las nueve. ¡Hasta mañana!"},
            {{"", "", kToday, 21, 0, {}}, "Vente antes de las ocho de la tarde."},
            {{"", "", kToday, 22, 0, {}}, "Es a las diez, ¿vale? Ya son las siete de la tarde."},
            {{"", "", kToday, 22, 0, {}}, "Me lo dijo a las cinco, y es a las diez."},
            {{"", "", kToday, 22, 0, {}}, "El bar cierra a las dos."},
            {{"", "", kToday, 22, 0, {}}, "Hoy me han dicho que hay fiesta."},
            {{"", "", kTomorrow, 22, 0, {}}, "Hoy me han dicho que hay fiesta."},
            {{"", "", kToday, 22, 0, {}}, "Será sobre las nueve y media."},
            {{"", "", kToday, 21, 30, {}}, "A las nueve y cuarto o así."},
            // A slot the claim leaves empty is never marked.
            {{"", "", {}, 0, 0, {}}, "Es en el bar a las cinco con Elena, 300 euros."},
        });
    }

    TEST_CASE("odd input is never marked and never throws") {
        Claim claim;
        claim.slots = {SlotValue(2), SlotValue(1), TimeSlot(44), SlotValue(50)};
        for (const Lang lang : {Lang::es, Lang::en}) {
            for (const std::string& text :
                 {std::string(), std::string("\xff\xfe\xc3"), std::string("\xc3\xb1\xe2\x82"),
                  std::string("¿¡«»…—"), std::string(400, '9'), std::string("1.2.3,4:5:6")}) {
                INFO(text);
                CHECK_FALSE(check_text(context(lang), claim, kNow, text).any());
            }
        }
        // Values the names cannot resolve are not compared.
        Claim outside;
        outside.slots = {SlotValue(0), SlotValue(99), std::nullopt, std::nullopt};
        CHECK_FALSE(check_text(context(Lang::es), outside, kNow, "Lo dijo Ana: en el bar.").any());
        CHECK_FALSE(check_text(TextCheckContext{}, claim, kNow, "Elena, en el bar, a las 10.").any());
    }

    TEST_CASE("en: texts that agree with their claim") {
        run(Lang::en, {
            {{"", "square", kToday, 22, 0, {}},
             "Have you heard there's a party in the square? I think it was at ten."},
            {{"Pedro", "", {}, 0, 0, 3000}, "Pedro won the lottery, 3,000 euros!"},
            {{"Teresa", "church", kTomorrow, 12, 0, {}},
             "Teresa is getting married tomorrow at noon at the church."},
            {{"", "town hall", kTomorrow, 10, 0, {}},
             "There's a meeting at the town hall tomorrow at 10 am."},
            {{"", "", kToday, 21, 30, {}}, "It starts at half past nine tonight."},
            {{"", "", {}, 0, 0, 50}, "Fifty guests are coming."},
            {{"", "square", kToday, 21, 0, {}}, "The party is at 9 pm in the square."},
            {{"", "bar", kToday, 22, 0, {}}, "TONIGHT at TEN at the BAR!"},
            {{"", "", kTomorrow, 1, 0, {}}, "It's tonight at one."},
            {{"", "", kToday, 21, 0, {}}, "Nine o'clock, at the latest."},
            {{"", "", {}, 0, 0, 250}, "Two hundred and fifty euros, can you believe it?"},
            {{"", "river", kToday, 20, 0, {}}, "Down at the river at eight in the evening."},
            {{"", "", kToday, 21, 30, {}}, "It's at 9:30 p.m."},
        });
    }

    TEST_CASE("en: clear contradictions are marked in their slot") {
        run(Lang::en, {
            {{"", "square", {}, 0, 0, {}}, "There's a party at the bar tonight.", Slot::where},
            {{"", "", kToday, 22, 0, {}}, "The party is at nine.", Slot::when},
            {{"", "", kToday, 22, 0, {}}, "The party is tomorrow at ten.", Slot::when},
            {{"Pedro", "", {}, 0, 0, 3000}, "Pedro won five thousand euros!", Slot::amount},
            {{"Teresa", "", {}, 0, 0, {}}, "Did you know Elena is getting married?", Slot::who},
            {{"Teresa", "church", {}, 0, 0, {}}, "Teresa is getting married at the chapel.",
             Slot::where},
            {{"", "", kToday, 21, 30, {}}, "It starts at half past ten.", Slot::when},
            {{"", "", {}, 0, 0, 50}, "A hundred people are coming.", Slot::amount},
            {{"", "square", kToday, 21, 0, {}}, "It's at 22:00 in the square.", Slot::when},
            {{"", "town hall", {}, 0, 0, {}}, "The party is in the square.", Slot::where},
            {{"Manuel", "", {}, 0, 0, {}}, "Manuela inherited everything.", Slot::who},
            {{"", "", kToday, 21, 0, {}}, "It's at 9 am.", Slot::when},
            {{"", "", kTomorrow, 21, 0, {}}, "The concert is today at nine.", Slot::when},
            {{"", "", {}, 0, 0, 300}, "They gave him a fine of 500.", Slot::amount},
        });
    }

    TEST_CASE("en: doubtful texts are never marked") {
        run(Lang::en, {
            {{"Pedro", "", {}, 0, 0, {}}, "Luis, have you heard about the lottery?"},
            {{"Pedro", "", {}, 0, 0, {}}, "Have you heard about the lottery, Luis?"},
            {{"Teresa", "church", {}, 0, 0, {}}, "Ana told me there's a wedding at the church."},
            {{"Teresa", "", kTomorrow, 12, 0, {}},
             "According to Ana, there's a wedding tomorrow."},
            {{"Pedro", "", {}, 0, 0, {}}, "I told Luis and Marta already."},
            {{"Pedro", "", {}, 0, 0, {}}, "Ask Marta, she knows."},
            {{"Pedro", "", {}, 0, 0, {}}, "Hi Luis!"},
            {{"", "", kToday, 22, 0, {}}, "I think it was at ten."},
            {{"", "", kToday, 22, 0, {}}, "Is it at ten or at eleven?"},
            {{"", "square", {}, 0, 0, {}}, "I'm at the bar, but the party is in the square."},
            {{"", "square", {}, 0, 0, {}}, "I heard it at the market this morning."},
            {{"", "square", {}, 0, 0, {}}, "See you at the bar!"},
            {{"", "square", {}, 0, 0, {}}, "It's all fair and square."},
            {{"", "square", {}, 0, 0, {}}, "Ana lives next to the church."},
            {{"", "", {}, 0, 0, 50}, "About fifty people are coming."},
            {{"", "", {}, 0, 0, 50}, "More than 40 people, I'd say."},
            {{"", "", kToday, 21, 0, {}}, "The bar closes at two."},
            {{"", "", kToday, 21, 0, {}}, "Come before 8 pm."},
            {{"", "", kToday, 22, 0, {}}, "At one point I thought it was at ten."},
            {{"", "", kToday, 22, 0, {}}, "See you tomorrow!"},
            {{"", "", kToday, 22, 0, {}}, "Ana told me yesterday."},
            {{"", "", kToday, 22, 0, {}}, "Around ten or so."},
            {{"", "", kToday, 22, 0, {}}, "Ten people told me it's at ten."},
            {{"", "", {}, 0, 0, 3000}, "He won it at two in the afternoon."},
            {{"", "", {}, 0, 0, {}}, "It's at the bar at five with Elena, 300 euros."},
        });
    }
// Bubbles the E4B wrote in party-100: the listener is addressed after an
// interjection, which no vocative pattern catches. The log knows who listens.
TEST_CASE("the speaker and the listener of the turn never contradict who") {
    const ClaimSpec manuel = {"Manuel", "plaza", kToday, 21, 0, 50};
    const Claim claim = make_claim(Lang::es, manuel);
    TextCheckContext turn = context(Lang::es);
    turn.speaker = NeighborId(static_cast<std::uint32_t>(index_of(turn.neighbors, "Carmen")));
    const std::vector<std::pair<std::string, std::string>> cases = {
        {"Nerea", "¡Ay, Nerea, no me lo recuerdes! ¡Es una fiesta con 50 personas en la plaza hoy a las nueve!"},
        {"Lorenzo", "¡Pero Lorenzo, no te imaginas la fiesta que va a ser! ¡Cincuenta personas, en la plaza, hoy a las nueve!"},
        {"Paula", "¡Ay Paula! ¡Pero mira qué va a haber en la plaza! ¡Un festival que no olvidaremos, te lo juro!"},
        {"Marcos", "¡Pero Marcos, no me dices esto por primera vez! ¡Siempre está pasando algo en esta plaza!"},
    };
    for (const auto& [listener, text] : cases) {
        CAPTURE(text);
        turn.listener = NeighborId(static_cast<std::uint32_t>(index_of(turn.neighbors, listener)));
        CHECK_FALSE(check_text(turn, claim, kNow, text).any());
    }
    // The speaker naming herself, and a third neighbor: only the third counts.
    turn.listener = NeighborId(static_cast<std::uint32_t>(index_of(turn.neighbors, "Luis")));
    CHECK_FALSE(check_text(turn, claim, kNow, "Soy Carmen: hay fiesta en la plaza.").any());
    const TextCheck other = check_text(turn, claim, kNow, "La fiesta de Pedro es en la plaza.");
    CHECK(other.contradicts[idx(Slot::who)]);
    // A source after the verb, and the place where the two are talking.
    CHECK_FALSE(check_text(turn, claim, kNow, "Sí, me comentó Mario que habrá una fiesta en la plaza a las 21:00.").any());
    CHECK_FALSE(check_text(turn, claim, kNow, "Hay una fiesta en la plaza hoy a las nueve, dice Miguel que habrá cincuenta personas.").any());
    CHECK_FALSE(check_text(turn, claim, kNow, "Qué bien se está aquí en la iglesia. Por cierto, Manuel da una fiesta.").any());
    TextCheckContext en_turn = context(Lang::en);
    const Claim en_claim = make_claim(Lang::en, {"Manuel", "square", kToday, 21, 0, 50});
    CHECK_FALSE(check_text(en_turn, en_claim, kNow, "It's a shame we're discussing Manuel's party right here at the church.").any());
    CHECK(check_text(en_turn, en_claim, kNow, "Manuel's party is at the church tonight.").contradicts[idx(Slot::where)]);
    // The claim's own neighbor still clears the slot when he is the listener.
    turn.listener = NeighborId(static_cast<std::uint32_t>(index_of(turn.neighbors, "Manuel")));
    CHECK_FALSE(check_text(turn, claim, kNow, "Manuel, tu fiesta es en la plaza.").any());
}

}

}  // namespace rumor
