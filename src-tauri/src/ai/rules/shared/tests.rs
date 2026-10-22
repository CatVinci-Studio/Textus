
use super::super::testing::*;
use super::super::Lang;

#[test]
fn nfc_strips_invisibles_and_composes_but_keeps_emoji_joiners() {
    assert_eq!(
        fixed(
            "shared.nfc",
            Lang::En,
            None,
            "zero\u{200B}width and e\u{301}t\u{e9}"
        ),
        "zerowidth and \u{e9}t\u{e9}"
    );
    // ZWJ inside a family emoji stays; a stray one goes.
    let family = "the 👩\u{200D}👩\u{200D}👧 emoji";
    assert!(hits("shared.nfc", Lang::En, None, family).is_empty());
    assert_eq!(fixed("shared.nfc", Lang::En, None, "a\u{200D}b"), "ab");
    // Decomposed Hangul composes.
    assert_eq!(
        fixed("shared.nfc", Lang::Ko, None, "\u{1112}\u{1161}\u{11AB}글"),
        "한글"
    );
    // Compatibility ideographs are zh.compat-ideograph's, not NFC's here.
    assert!(hits("shared.nfc", Lang::Ja, None, "\u{FA19}社").is_empty());
}

#[test]
fn spaces_before_punctuation_go_except_where_they_belong() {
    assert_eq!(
        fixed(
            "shared.space-before-punct",
            Lang::En,
            None,
            "Hello , world ! Is it ?"
        ),
        "Hello, world! Is it?"
    );
    assert_eq!(
        fixed(
            "shared.space-before-punct",
            Lang::Ru,
            None,
            "Да , конечно ."
        ),
        "Да, конечно."
    );
    for ok in [
        "Le prix : dix euros ; voilà !",
        "Ratio 1 : 5 and smile :) or :D",
        "Use .NET and the :root selector",
        "Wait ... what",
    ] {
        let lang = if ok.starts_with("Le") {
            Lang::Fr
        } else {
            Lang::En
        };
        assert!(
            hits("shared.space-before-punct", lang, None, ok).is_empty(),
            "{ok}"
        );
    }
    // Korean colons are ko.punct.colon-space's.
    assert!(hits("shared.space-before-punct", Lang::Ko, None, "장소 : 광화문").is_empty());
    assert_eq!(
        fixed("shared.space-before-punct", Lang::Ko, None, "좋습니다 ."),
        "좋습니다."
    );
}

#[test]
fn double_spaces_and_the_army_exception() {
    assert_eq!(
        fixed("shared.double-space", Lang::En, None, "two  spaces here"),
        "two spaces here"
    );
    assert!(hits(
        "shared.double-space",
        Lang::En,
        Some("en-US/army"),
        "End.  Next sentence."
    )
    .is_empty());
    assert_eq!(
        hits("shared.double-space", Lang::En, Some("en-US/army"), "a  b").len(),
        1
    );
}

#[test]
fn doubled_words_with_their_guards() {
    assert_eq!(
        hits(
            "shared.doubled-word",
            Lang::En,
            None,
            "Check the the value."
        ),
        one("the the", "the")
    );
    assert_eq!(
        hits("shared.doubled-word", Lang::Es, None, "Es de de verdad."),
        one("de de", "de")
    );
    for ok in [
        "She had had enough.",
        "He said that that was fine.",
        "We flew to Bora Bora.",
        "the end. The next",
    ] {
        assert!(
            hits("shared.doubled-word", Lang::En, None, ok).is_empty(),
            "{ok}"
        );
    }
    assert!(hits(
        "shared.doubled-word",
        Lang::De,
        None,
        "Ich weiß, dass das das Beste ist."
    )
    .is_empty());
    assert!(hits(
        "shared.doubled-word",
        Lang::Fr,
        None,
        "Nous nous levons tôt."
    )
    .is_empty());
    // Never in CJK: 常常, 看看 are grammar.
    assert!(hits(
        "shared.doubled-word",
        Lang::ZhHans,
        None,
        "我常常 常常去看看。"
    )
    .is_empty());
}

#[test]
fn residue_but_not_when_quoted() {
    assert_eq!(
        hits(
            "shared.residue",
            Lang::En,
            None,
            "The plan is ready. I hope this helps!"
        )
        .len(),
        1
    );
    assert_eq!(
        hits(
            "shared.residue",
            Lang::En,
            None,
            "Best regards, [Your Name]"
        )
        .len(),
        1
    );
    assert_eq!(
        hits(
            "shared.residue",
            Lang::ZhHans,
            None,
            "会议定于 2025-XX-XX 举行。希望这对您有帮助！"
        )
        .len(),
        2
    );
    assert!(hits(
        "shared.residue",
        Lang::En,
        None,
        "Never end with “I hope this helps” in a report."
    )
    .is_empty());
}

#[test]
fn near_misses_of_library_names() {
    assert_eq!(
        hits(
            "shared.library-name",
            Lang::En,
            None,
            "Then Elisabeth left."
        ),
        one("Elisabeth", "Elizabeth")
    );
    assert_eq!(
        hits("shared.library-name", Lang::En, None, "Elizbeth's coat."),
        one("Elizbeth", "Elizabeth")
    );
    assert!(hits(
        "shared.library-name",
        Lang::En,
        None,
        "Elizabeth and Edinburgh."
    )
    .is_empty());
    assert_eq!(
        hits("shared.library-name", Lang::ZhHans, None, "林黛王走进来。"),
        one("林黛王", "林黛玉")
    );
    assert!(hits(
        "shared.library-name",
        Lang::ZhHans,
        None,
        "林黛玉走进来，林子里很静。"
    )
    .is_empty());
}
