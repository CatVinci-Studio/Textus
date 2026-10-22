
use super::super::testing::*;
use super::super::{Block, Lang};

const S: Lang = Lang::Es;

#[test]
fn inverted_marks_and_final_points() {
    assert_eq!(
        hits("es.punct.inverted", S, None, "Vienes mañana? Sí."),
        flagged("?")
    );
    for ok in [
        "¿Vienes mañana?",
        "Si llueve, ¿vamos?",
        "¡Qué bien!",
        "¿Qué?!",
    ] {
        assert!(hits("es.punct.inverted", S, None, ok).is_empty(), "{ok}");
    }
    assert!(hits_in(
        "es.punct.inverted",
        S,
        None,
        "Por qué leer?",
        Block::Heading(2)
    )
    .is_empty());
    assert_eq!(
        fixed("es.punct.double-final", S, None, "¿Vienes?. Ya…."),
        "¿Vienes? Ya…"
    );
    assert!(hits(
        "es.punct.double-final",
        S,
        None,
        "Dijo «¿vienes?». Y (¿quién?)…"
    )
    .is_empty());
}

#[test]
fn quotes_accents_and_capitals() {
    assert_eq!(
        fixed("es.quote.period-outside", S, None, "Dijo «ya voy.» Luego"),
        "Dijo «ya voy». Luego"
    );
    assert!(hits(
        "es.quote.period-outside",
        S,
        None,
        "Trajo libros, cuadernos, etc.» y más"
    )
    .is_empty());
    assert_eq!(
        fixed(
            "es.word.monosyllable",
            S,
            None,
            "Fué él quien dió el guión."
        ),
        "Fue él quien dio el guion."
    );
    // Diacritic pairs keep their accent.
    assert!(hits("es.word.monosyllable", S, None, "Tú y él, sí, más té.").is_empty());
    assert!(hits("es.word.solo", S, None, "Sólo uno.").is_empty());
    assert_eq!(
        fixed("es.word.months", S, None, "Llegó el Lunes 3 de Marzo."),
        "Llegó el lunes 3 de marzo."
    );
    for ok in [
        "Enero fue frío.",
        "En Viernes Santo salimos.",
        "Habló Plácido Domingo ayer.",
    ] {
        assert!(hits("es.word.months", S, None, ok).is_empty(), "{ok}");
    }
}

#[test]
fn numbers_and_etc() {
    assert_eq!(
        fixed("es.punct.etc", S, None, "Frutas, verduras, etc..."),
        "Frutas, verduras, etc."
    );
    assert_eq!(
        fixed("es.num.group", S, None, "Hay 12.500 personas"),
        "Hay 12\u{00A0}500 personas"
    );
    for ok in ["En 1.500 casos", "El año 2026", "Código 12.500.3a"] {
        assert!(hits("es.num.group", S, None, ok).is_empty(), "{ok}");
    }
    assert!(hits("es.num.group", S, Some("es-419"), "Hay 12.500 personas").is_empty());
    assert_eq!(
        fixed("es.num.ordinal", S, None, "el 1º y la 2ª"),
        "el 1.º y la 2.ª"
    );
    assert_eq!(
        fixed("es.num.percent", S, Some("es-ES"), "un 10% más"),
        "un 10\u{00A0}% más"
    );
    assert!(hits("es.num.percent", S, None, "un 10% más").is_empty());
    assert_eq!(
        fixed("es.word.ex", S, None, "el ex-presidente y la ex-SS"),
        "el expresidente y la ex-SS"
    );
    assert_eq!(
        hits("es.num.word-unit", S, None, "Corrió veinte km.").len(),
        1
    );
}

#[test]
fn dialogue_raya() {
    assert_eq!(
        fixed("es.dialogue.raya", S, None, "- Hola, dijo."),
        "—Hola, dijo."
    );
    assert_eq!(fixed("es.dialogue.raya", S, None, "— Hola."), "—Hola.");
    assert!(hits("es.dialogue.raya", S, None, "—Hola.").is_empty());
    assert!(hits_in("es.dialogue.raya", S, None, "- uno", Block::ListItem).is_empty());
}
