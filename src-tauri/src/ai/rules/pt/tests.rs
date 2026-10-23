use super::super::testing::*;
use super::super::Lang;

const P: Lang = Lang::Pt;

#[test]
fn spelling_and_hyphens() {
    assert_eq!(
        fixed(
            "pt.spell.pre-ao90",
            P,
            None,
            "Uma idéia para o vôo e a acção óptima"
        ),
        "Uma ideia para o voo e a ação ótima"
    );
    assert!(hits(
        "pt.spell.pre-ao90",
        P,
        None,
        "Ele pôde pôr o facto em contacto"
    )
    .is_empty());
    assert_eq!(
        fixed(
            "pt.spell.hyphen",
            P,
            None,
            "A auto-escola e o fim-de-semana; hei-de ir."
        ),
        "A autoescola e o fim de semana; hei de ir."
    );
    assert!(hits("pt.spell.hyphen", P, None, "cor-de-rosa e couve-flor").is_empty());
}

#[test]
fn quotes_ordinals_and_months() {
    assert_eq!(
        fixed("pt.quote.style", P, Some("pt-PT"), "Ele disse “sim”."),
        "Ele disse «sim»."
    );
    assert_eq!(
        fixed("pt.quote.style", P, Some("pt-BR"), "Ele disse «sim»."),
        "Ele disse “sim”."
    );
    assert!(hits("pt.quote.style", P, None, "Ele disse “sim”.").is_empty());
    assert_eq!(
        fixed("pt.num.ordinal", P, None, "Ficou em 1° lugar no 3° andar."),
        "Ficou em 1º lugar no 3º andar."
    );
    assert_eq!(
        fixed("pt.num.ordinal", P, Some("pt-PT"), "o 1° dia"),
        "o 1.º dia"
    );
    assert!(hits("pt.num.ordinal", P, None, "Fazia 30° C e 20 graus.").is_empty());
    assert_eq!(
        fixed(
            "pt.word.months",
            P,
            None,
            "Chega em 15 de Setembro, numa Segunda-feira."
        ),
        "Chega em 15 de setembro, numa segunda-feira."
    );
    assert!(hits("pt.word.months", P, None, "O feriado Sete de Setembro.").is_empty());
}

#[test]
fn official_profile() {
    let o = Some("pt-BR/official");
    assert_eq!(
        hits(
            "pt.official.address",
            P,
            o,
            "A Vossa Excelência, o Dr. Silva"
        )
        .len(),
        2
    );
    assert!(hits("pt.official.address", P, None, "A Vossa Excelência").is_empty());
    assert_eq!(
        fixed("pt.official.date", P, o, "Em 01 de janeiro e 05 de março"),
        "Em 1º de janeiro e 5 de março"
    );
}

#[test]
fn never_flag_optional_accents() {
    let all = findings(
        P,
        Some("pt-PT"),
        "Amámos e amamos, dêmos e demos, a fôrma e a forma.",
        super::super::Block::Paragraph,
    );
    assert!(all.is_empty(), "{all:?}");
}
