use super::super::testing::*;
use super::super::{Block, Lang};

const E: Lang = Lang::En;

#[test]
fn misspellings_keep_case_and_spare_quotes() {
    assert_eq!(
        fixed(
            "en.word.misspelling",
            E,
            None,
            "Alot of people definately recieve it."
        ),
        "A lot of people definitely receive it."
    );
    assert_eq!(
        fixed("en.word.misspelling", E, None, "We could of won."),
        "We could have won."
    );
    assert!(hits("en.word.misspelling", E, None, "We could of course win.").is_empty());
    assert!(hits(
        "en.word.misspelling",
        E,
        None,
        "Never write “alot” in a report."
    )
    .is_empty());
    // Real words that look like misspellings stay.
    assert!(hits(
        "en.word.misspelling",
        E,
        None,
        "The calender rolls the cloth; a wether grazed."
    )
    .is_empty());
}

#[test]
fn apostrophe_plurals_but_not_possessives() {
    assert_eq!(
        fixed(
            "en.punct.apostrophe-plural",
            E,
            None,
            "In the 1990's we bought two PDF's."
        ),
        "In the 1990s we bought two PDFs."
    );
    for ok in [
        "NASA's mission was clear.",
        "Mind your p's and q's; she got A's.",
        "The 1990s were loud.",
    ] {
        assert!(
            hits("en.punct.apostrophe-plural", E, None, ok).is_empty(),
            "{ok}"
        );
    }
}

#[test]
fn double_hyphens_but_not_flags() {
    assert_eq!(
        fixed("en.punct.double-hyphen", E, None, "It was late--very late."),
        "It was late—very late."
    );
    assert_eq!(
        fixed(
            "en.punct.double-hyphen",
            E,
            None,
            "It was late -- very late."
        ),
        "It was late — very late."
    );
    assert!(hits(
        "en.punct.double-hyphen",
        E,
        None,
        "Run the tool with --verbose to see more."
    )
    .is_empty());
}

#[test]
fn articles_by_sound() {
    assert_eq!(
        fixed(
            "en.word.article",
            E,
            None,
            "It took a hour, an user said, a apple and an university."
        ),
        "It took an hour, a user said, an apple and a university."
    );
    for ok in [
        "an honest man",
        "a one-time fee",
        "a European city",
        "an umbrella",
        "a SQL query",
        "Plan A is fine",
        "an FAQ page",
        "a unanimous vote",
    ] {
        assert!(hits("en.word.article", E, None, ok).is_empty(), "{ok}");
    }
}

#[test]
fn headings_and_sentence_starts() {
    assert_eq!(
        hits_in(
            "en.heading.end-punct",
            E,
            None,
            "Getting started:",
            Block::Heading(2)
        ),
        one(":", "")
    );
    assert!(hits_in(
        "en.heading.end-punct",
        E,
        None,
        "Why now?",
        Block::Heading(2)
    )
    .is_empty());
    assert!(hits_in(
        "en.heading.end-punct",
        E,
        None,
        "To be continued...",
        Block::Heading(2)
    )
    .is_empty());
    assert_eq!(
        hits("en.num.sentence-start", E, None, "We met. 12 people came.").len(),
        1
    );
    assert!(hits("en.num.sentence-start", E, None, "We met. 2024 was busy.").is_empty());
    assert!(hits_in("en.num.sentence-start", E, None, "3 eggs", Block::ListItem).is_empty());
}

#[test]
fn spelling_variety_by_majority_or_preset() {
    let text = "The colour of the centre and the favourite flavor.";
    assert_eq!(
        hits("en.spelling.variety", E, None, text),
        one("flavor", "flavour")
    );
    assert!(hits("en.spelling.variety", E, None, "The color and the colour.").is_empty());
    assert_eq!(
        hits(
            "en.spelling.variety",
            E,
            Some("en-GB/govuk"),
            "We organize the center."
        ),
        vec![
            ("organize".into(), Some("organise".into())),
            ("center".into(), Some("centre".into()))
        ]
    );
    // Oxford spelling keeps -ize; proper nouns stay.
    assert_eq!(
        hits(
            "en.spelling.variety",
            E,
            Some("en-GB/oxford"),
            "We organize the center."
        ),
        one("center", "centre")
    );
    assert!(hits(
        "en.spelling.variety",
        E,
        Some("en-US/general"),
        "He joined the Labour Party."
    )
    .is_empty());
}

#[test]
fn serial_comma_only_with_a_preset() {
    let text = "We bought apples, pears and plums.";
    assert!(hits("en.punct.serial-comma", E, None, text).is_empty());
    assert_eq!(
        fixed("en.punct.serial-comma", E, Some("en-US/general"), text),
        "We bought apples, pears, and plums."
    );
    assert_eq!(
        fixed(
            "en.punct.serial-comma",
            E,
            Some("en-US/news"),
            "apples, pears, and plums"
        ),
        "apples, pears and plums"
    );
}

#[test]
fn consistency_of_dashes_quotes_and_clocks() {
    let text = "One—two and three—four, five—six, then seven — eight.";
    assert_eq!(hits("en.punct.dash-style", E, None, text), one(" — ", "—"));
    let q = "He said “yes” and “no” and then \"maybe\" twice “again”.";
    assert_eq!(hits("en.punct.quote-style", E, None, q).len(), 2);
    assert_eq!(
        hits("en.num.clock", E, None, "Doors at 7 pm, show at 19:30.").len(),
        1
    );
    assert!(hits("en.num.clock", E, None, "Doors at 7 pm, show at 8 pm.").is_empty());
}

#[test]
fn word_lists_and_style_hints() {
    assert_eq!(
        fixed(
            "en.word.etc",
            E,
            None,
            "Fruit such as apples, pears, etc. are fine."
        ),
        "Fruit such as apples, pears are fine."
    );
    assert_eq!(
        fixed(
            "en.word.wordy",
            E,
            None,
            "In order to start, prior to noon."
        ),
        "To start, before noon."
    );
    assert_eq!(
        fixed("en.word.inclusive", E, None, "Add it to the whitelist."),
        "Add it to the allowlist."
    );
    assert!(hits("en.word.inclusive", E, None, "The film “Fireman” opened.").is_empty());
    assert!(!hits(
        "en.word.plain",
        E,
        Some("en-GB/govuk"),
        "We will accomplish this."
    )
    .is_empty());
    assert!(hits("en.word.plain", E, None, "We will accomplish this.").is_empty());
    assert_eq!(
        hits(
            "en.word.please",
            E,
            Some("en-US/tech-google"),
            "Please click Save."
        )
        .len(),
        1
    );
    assert_eq!(
        fixed(
            "en.govuk.style",
            E,
            Some("en-GB/govuk"),
            "Fish & chips, e.g. cod."
        ),
        "Fish and chips, for example cod."
    );
    assert_eq!(
        hits(
            "en.style.caps",
            E,
            None,
            "THIS IS VERY IMPORTANT for the API."
        )
        .len(),
        1
    );
    assert!(hits("en.style.caps", E, None, "The USA and the EU signed.").is_empty());
    assert_eq!(
        hits(
            "en.style.passive",
            E,
            None,
            "The report was written by Ann."
        )
        .len(),
        1
    );
    assert!(hits("en.style.passive", E, None, "She was tired and interested.").is_empty());
    assert_eq!(
        hits(
            "en.style.ai-vocab",
            E,
            None,
            "We delve into a tapestry of ideas."
        )
        .len(),
        2
    );
    assert!(hits(
        "en.style.ai-vocab",
        E,
        None,
        "We used robust statistics and financial leverage."
    )
    .is_empty());
    assert_eq!(
        fixed("en.num.minus", E, None, "It fell to -5 degrees."),
        "It fell to \u{2212}5 degrees."
    );
    assert!(hits("en.num.minus", E, None, "Pages 3-5 on 2024-01-02.").is_empty());
    assert_eq!(
        hits(
            "en.word.slash",
            E,
            None,
            "Sign and/or return the document(s)."
        )
        .len(),
        2
    );
}

#[test]
fn never_flag_in_english() {
    let text = "To boldly go, the data is clear: she had had enough, and that that was it.";
    let all = findings(E, None, text, Block::Paragraph);
    assert!(all.is_empty(), "{all:?}");
    let long = (0..30).map(|_| "word").collect::<Vec<_>>().join(" ") + ".";
    assert_eq!(hits("en.style.sentence-length", E, None, &long).len(), 1);
}
