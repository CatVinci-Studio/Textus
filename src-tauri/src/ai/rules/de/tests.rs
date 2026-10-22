
use super::super::testing::*;
use super::super::Lang;

const D: Lang = Lang::De;

#[test]
fn quotes_and_reporting_commas() {
    assert_eq!(
        fixed(
            "de.quote.style",
            D,
            None,
            "Er sagte \"Hallo\" und “Tschüss”."
        ),
        "Er sagte „Hallo“ und „Tschüss“."
    );
    assert!(hits("de.quote.style", D, None, "Er sagte „Hallo“ und »Tschüss«.").is_empty());
    assert_eq!(
        fixed("de.quote.style", D, Some("de-CH"), "Er sagte „Hallo“."),
        "Er sagte «Hallo»."
    );
    assert_eq!(
        fixed("de.quote.reporting-comma", D, None, "„Komm her“ sagte er."),
        "„Komm her“, sagte er."
    );
    let quoted_word = "„Unterhaltungen“ meint im Folgenden den KI-Bereich.";
    assert!(hits("de.quote.reporting-comma", D, None, quoted_word).is_empty());
    assert_eq!(
        fixed(
            "de.quote.reporting-comma",
            D,
            None,
            "„Komm her.“, sagte er."
        ),
        "„Komm her“, sagte er."
    );
}

#[test]
fn dashes_abbreviations_and_variants() {
    assert_eq!(
        fixed("de.punct.dash", D, None, "Er kam - und ging."),
        "Er kam – und ging."
    );
    assert!(hits("de.punct.dash", D, None, "Seiten 10 - 12").is_empty());
    assert_eq!(
        fixed("de.word.abbr-space", D, None, "Obst, z.B. Äpfel"),
        "Obst, z.\u{202F}B. Äpfel"
    );
    assert!(hits("de.word.abbr-space", D, None, "Obst usw. und z. B. Äpfel").is_empty());
    assert_eq!(
        fixed("de.word.removed-variant", D, None, "Jogurt mit Spagetti"),
        "Joghurt mit Spaghetti"
    );
}

#[test]
fn numbers_and_percent_compounds() {
    assert_eq!(
        fixed("de.num.percent", D, None, "Es sind 5% mehr."),
        "Es sind 5\u{00A0}% mehr."
    );
    for ok in ["die 5%-Klausel", "100%ig sicher", "eine 25%ige Lösung"] {
        assert!(hits("de.num.percent", D, None, ok).is_empty(), "{ok}");
    }
    assert_eq!(
        fixed("de.num.group", D, None, "Es kamen 12000 Besucher."),
        "Es kamen 12\u{202F}000 Besucher."
    );
    assert!(hits("de.num.group", D, None, "10115 Berlin, im Jahr 2026").is_empty());
    assert_eq!(
        fixed("de.date.zero-pad", D, Some("de-DE/din5008"), "am 1.5.2026"),
        "am 01.05.2026"
    );
    assert!(hits("de.date.zero-pad", D, None, "am 1.5.2026").is_empty());
}

#[test]
fn commas_eszett_and_gender() {
    assert_eq!(
        fixed("de.comma.subordinate", D, None, "Ich weiß dass er kommt."),
        "Ich weiß, dass er kommt."
    );
    for ok in [
        "Er lief, so dass er fiel.",
        "Er tat es ohne dass sie es merkte.",
        "Was machst du damit?",
        "Er tut als ob er schliefe.",
    ] {
        assert!(hits("de.comma.subordinate", D, None, ok).is_empty(), "{ok}");
    }
    assert_eq!(
        fixed(
            "de.comma.adversative",
            D,
            None,
            "Nicht heute sondern morgen."
        ),
        "Nicht heute, sondern morgen."
    );
    assert_eq!(
        fixed("de.word.eszett", D, None, "Die Strasse ist groß."),
        "Die Straße ist groß."
    );
    // No ß anywhere: it may be Swiss text.
    assert!(hits("de.word.eszett", D, None, "Die Strasse ist gross.").is_empty());
    assert!(hits("de.word.eszett", D, Some("de-CH"), "Die Strasse ist groß.").is_empty());
    assert!(hits("de.word.gender-chars", D, None, "Lehrer*innen").is_empty());
}

#[test]
fn never_flag_in_german() {
    let text = "Er kam, und sie ging. Er versuchte zu helfen. Seiten 10–12, die 5%-Klausel.";
    let all = findings(D, None, text, super::super::Block::Paragraph);
    assert!(all.is_empty(), "{all:?}");
}
