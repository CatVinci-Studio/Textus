use super::super::testing::*;
use super::super::Lang;

const F: Lang = Lang::Fr;

#[test]
fn breaking_spaces_become_no_break_and_profiles_decide_the_rest() {
    // Automatic, no majority: only the breaking spaces are wrong.
    assert_eq!(
        fixed("fr.space.high-punct", F, None, "Vraiment ? Oui !"),
        "Vraiment\u{202F}? Oui\u{202F}!"
    );
    assert!(hits("fr.space.high-punct", F, None, "Vraiment? Oui!").is_empty());
    // A document that spaces: the missing one is added.
    let doc = "Quoi\u{202F}? Non\u{202F}! Si\u{202F}; enfin\u{202F}! Bon?";
    assert_eq!(
        hits("fr.space.high-punct", F, None, doc),
        one("?", "\u{202F}?")
    );
    // fr-CA: no space before ? ; but a no-break one before :
    assert_eq!(
        fixed(
            "fr.space.high-punct",
            F,
            Some("fr-CA"),
            "Vraiment ? Note : oui"
        ),
        "Vraiment? Note\u{00A0}: oui"
    );
    assert!(hits("fr.space.high-punct", F, Some("fr-CA"), "Vraiment? Oui!").is_empty());
    assert_eq!(
        fixed("fr.space.high-punct", F, Some("fr/eu"), "Il dit : « oui »"),
        "Il dit: «oui»"
    );
    assert_eq!(
        fixed("fr.space.high-punct", F, Some("fr-FR"), "Il dit «oui»"),
        "Il dit «\u{202F}oui\u{202F}»"
    );
    for ok in [
        "Rendez-vous à 13:52.",
        "Voir http://a.fr ou :) ou C:/x",
        "Quoi ?! Oui.",
    ] {
        let found = hits("fr.space.high-punct", F, Some("fr-FR"), ok);
        assert!(
            found
                .iter()
                .all(|(o, _)| !o.contains(':') || o.contains(' ')),
            "{ok}: {found:?}"
        );
    }
}

#[test]
fn ordinals_abbreviations_and_ligatures() {
    assert_eq!(
        fixed(
            "fr.num.ordinal",
            F,
            None,
            "la 1ère fois, le 2ème, le 3ième, le XIXème siècle"
        ),
        "la 1re fois, le 2e, le 3e, le XIXe siècle"
    );
    assert!(hits("fr.num.ordinal", F, None, "le Nième et le Xième").is_empty());
    assert_eq!(
        fixed("fr.word.mr", F, None, "J’ai vu Mr Dupont."),
        "J’ai vu M. Dupont."
    );
    assert_eq!(
        fixed("fr.word.euphonic-t", F, None, "Pourquoi a-t'il dit ça ?"),
        "Pourquoi a-t-il dit ça ?"
    );
    assert_eq!(
        fixed(
            "fr.word.ligature",
            F,
            None,
            "Le coeur et l'oeuvre de ma soeur"
        ),
        "Le cœur et l'œuvre de ma sœur"
    );
    assert!(hits("fr.word.ligature", F, None, "Le coefficient et coexister").is_empty());
    assert_eq!(
        fixed("fr.punct.etc", F, None, "des pommes, etc…"),
        "des pommes, etc."
    );
}

#[test]
fn symbols_capitals_and_consistency() {
    assert_eq!(
        fixed(
            "fr.num.symbol-space",
            F,
            None,
            "Il pèse 58kg et coûte 25€, soit 85%."
        ),
        "Il pèse 58\u{00A0}kg et coûte 25\u{00A0}€, soit 85\u{00A0}%."
    );
    assert!(hits("fr.num.symbol-space", F, Some("fr-CH"), "soit 85%.").is_empty());
    // An ordinary space before % or € becomes a no-break one; one
    // before a unit letter is left alone (« en 2 l'espace »).
    assert_eq!(
        fixed(
            "fr.num.symbol-space",
            F,
            None,
            "soit 85 % et 25 € en 2 l'espace."
        ),
        "soit 85\u{00A0}% et 25\u{00A0}€ en 2 l'espace."
    );
    assert_eq!(
        fixed(
            "fr.word.capital-accent",
            F,
            None,
            "A partir de demain, on part."
        ),
        "À partir de demain, on part."
    );
    assert!(hits("fr.word.capital-accent", F, None, "Il a partir.").is_empty());
    assert_eq!(
        hits(
            "fr.punct.apostrophe",
            F,
            None,
            "l’eau, l’air, d’abord, l'arbre"
        )
        .len(),
        1
    );
}

#[test]
fn never_flag_in_french() {
    // Both spellings of the 1990 rectifications; CA without spaces.
    let all = findings(
        F,
        Some("fr-CA"),
        "Il connait la clé; il connaît la clef? Oui! À 13:52.",
        super::super::Block::Paragraph,
    );
    assert!(all.is_empty(), "{all:?}");
}
