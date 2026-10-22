//! English spelling: common misspellings, plural apostrophes, a or an,
//! and British and American spelling mixed.

use super::*;

pub(crate) const MISSPELLINGS: &[(&str, &str)] = &[
    ("alot", "a lot"),
    ("irregardless", "regardless"),
    ("definately", "definitely"),
    ("definitly", "definitely"),
    ("seperate", "separate"),
    ("seperately", "separately"),
    ("recieve", "receive"),
    ("recieved", "received"),
    ("occured", "occurred"),
    ("occurence", "occurrence"),
    ("untill", "until"),
    ("wich", "which"),
    ("accomodate", "accommodate"),
    ("accomodation", "accommodation"),
    ("acheive", "achieve"),
    ("beleive", "believe"),
    ("beleif", "belief"),
    ("comming", "coming"),
    ("concious", "conscious"),
    ("embarass", "embarrass"),
    ("enviroment", "environment"),
    ("existance", "existence"),
    ("goverment", "government"),
    ("grammer", "grammar"),
    ("independant", "independent"),
    ("neccessary", "necessary"),
    ("necessery", "necessary"),
    ("noticable", "noticeable"),
    ("occassion", "occasion"),
    ("persue", "pursue"),
    ("posession", "possession"),
    ("publically", "publicly"),
    ("recomend", "recommend"),
    ("reccomend", "recommend"),
    ("refered", "referred"),
    ("relevent", "relevant"),
    ("sucess", "success"),
    ("succesful", "successful"),
    ("tommorow", "tomorrow"),
    ("tommorrow", "tomorrow"),
    ("truely", "truly"),
    ("wierd", "weird"),
    ("thier", "their"),
    ("arguement", "argument"),
    ("begining", "beginning"),
    ("buisness", "business"),
    ("commitee", "committee"),
    ("completly", "completely"),
    ("foward", "forward"),
    ("freind", "friend"),
    ("garantee", "guarantee"),
    ("harrass", "harass"),
    ("immediatly", "immediately"),
    ("knowlege", "knowledge"),
    ("liason", "liaison"),
    ("millenium", "millennium"),
    ("mispell", "misspell"),
    ("paralell", "parallel"),
    ("prefered", "preferred"),
    ("privelege", "privilege"),
    ("rythm", "rhythm"),
    ("seige", "siege"),
    ("threshhold", "threshold"),
    ("tounge", "tongue"),
    ("whereever", "wherever"),
    ("writting", "writing"),
];

pub(crate) static COULD_OF: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(could|should|would|must|might)\s+of\b").unwrap());

/// en.word.misspelling: non-words and common misspellings, and "could
/// of" (not "could of course"). Not inside a quotation of the error.
pub(crate) fn misspelling(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (wrong, right) in MISSPELLINGS {
        for (a, b) in find_word(t, wrong, true) {
            if !t.in_quotes(a, b) {
                let fixed = match_case(&t.slice(a, b), right);
                out.fix(
                    "en.word.misspelling",
                    a,
                    b,
                    fixed,
                    format!("Misspelling: “{right}”."),
                );
            }
        }
    }
    for caps in t.captures(&COULD_OF) {
        let (Some((a, b)), Some((m1, m2))) = (caps[0], caps[1]) else {
            continue;
        };
        let rest: String = t.chars[b..]
            .iter()
            .take(8)
            .collect::<String>()
            .to_lowercase();
        if rest.trim_start().starts_with("course") || t.in_quotes(a, b) {
            continue;
        }
        let modal = t.slice(m1, m2);
        out.fix(
            "en.word.misspelling",
            a,
            b,
            format!("{modal} have"),
            format!(
                "“{} of” is a mishearing of “{} have”.",
                modal.to_lowercase(),
                modal.to_lowercase()
            ),
        );
    }
}

pub(crate) static DECADE_APOS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(1[0-9]|20)(\d0)['’]s\b").unwrap());

pub(crate) static ABBR_APOS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i:\b(?:many|several|few|all|some|these|those|multiple|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)([A-Z]{2,})['’]s\b").unwrap()
});

/// en.punct.apostrophe-plural: 1990's -> 1990s; "two PDF's" -> PDFs (only
/// after a number or quantifier - "NASA's mission" is a possessive). Single
/// capital letters (A's) are left alone.
pub(crate) fn apostrophe_plural(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&DECADE_APOS) {
        let fixed: String = t.chars[a..b]
            .iter()
            .filter(|&&c| c != '\'' && c != '’')
            .collect();
        out.fix(
            "en.punct.apostrophe-plural",
            a,
            b,
            fixed,
            "Plurals take no apostrophe: “1990s”.",
        );
    }
    for caps in t.captures(&ABBR_APOS) {
        let Some((x, y)) = caps[1] else { continue };
        let end = y + 2;
        out.fix(
            "en.punct.apostrophe-plural",
            x,
            end,
            format!("{}s", t.slice(x, y)),
            "Plurals of abbreviations take no apostrophe: “PDFs”.",
        );
    }
}

pub(crate) const AN_WORDS: &[&str] = &[
    "hour",
    "hours",
    "hourly",
    "honest",
    "honestly",
    "honesty",
    "honor",
    "honors",
    "honour",
    "honourable",
    "honorable",
    "heir",
    "heirs",
    "heiress",
];

pub(crate) const A_WORDS: &[&str] = &[
    "user",
    "users",
    "union",
    "unit",
    "united",
    "unique",
    "university",
    "universal",
    "usual",
    "usually",
    "useful",
    "use",
    "used",
    "usage",
    "uniform",
    "utility",
    "euro",
    "european",
    "eulogy",
    "ewe",
    "one",
    "once",
    "one-time",
    "unicorn",
    "uranium",
    "urinal",
    "usurper",
    "utopia",
    "ubiquitous",
    "unanimous",
    "unary",
];

/// en.word.article: a/an by sound, from closed lists and the first letter.
/// Acronyms are skipped (their pronunciation varies: "a SQL", "an SQL").
pub(crate) fn article(t: &Text, _ctx: &Ctx, out: &mut Out) {
    let words = t.words();
    for pair in words.windows(2) {
        let ((a1, b1), (a2, b2)) = (pair[0], pair[1]);
        if !t.chars[b1..a2].iter().all(|&c| c == ' ') || a2 == b1 {
            continue;
        }
        let art = t.slice(a1, b1);
        if !matches!(art.as_str(), "a" | "an" | "A" | "An") {
            continue;
        }
        let word = t.slice(a2, b2);
        let first = word.chars().next().unwrap_or(' ');
        // A capital A mid-sentence is a letter ("Plan A is"), not an article.
        if !first.is_lowercase() || (art.starts_with('A') && !t.sentence_start(a1)) {
            continue; // acronyms, names, "Plan A is"
        }
        let lw = word.to_lowercase();
        let base = lw.split(['-', '\'']).next().unwrap_or("");
        let vowel_letter = matches!(first, 'a' | 'e' | 'i' | 'o' | 'u');
        let wants_an = if AN_WORDS.contains(&base) || AN_WORDS.contains(&lw.as_str()) {
            true
        } else if A_WORDS.contains(&base)
            || A_WORDS.contains(&lw.as_str())
            || lw.starts_with("uni")
            || lw.starts_with("eu")
            || lw.starts_with("one")
            || lw.starts_with("use")
            || lw.starts_with("usu")
            || lw.starts_with("uti")
        {
            false
        } else if first == 'u' {
            // un-, up-, us-, ul-, um-: a vowel sound.
            true
        } else {
            vowel_letter
        };
        let is_an = art.eq_ignore_ascii_case("an");
        if wants_an != is_an {
            let fixed = match (art.as_str(), wants_an) {
                ("a", true) => "an",
                ("A", true) => "An",
                ("an", false) => "a",
                _ => "A",
            };
            out.fix(
                "en.word.article",
                a1,
                b1,
                fixed,
                format!("“{word}” takes “{}”.", fixed.to_lowercase()),
            );
        }
    }
}

/// en.spelling.variety: US and UK spellings mixed - the minority flagged,
/// or (with a preset) the other variety's forms. Oxford spelling keeps
/// -ize; GOV.UK uses -ise. Proper nouns (Labour Party) are skipped.
pub(crate) fn spelling_variety(t: &Text, ctx: &Ctx, out: &mut Out) {
    let p = ctx.profile;
    let s = ctx.stats;
    let target_uk = if p.region_is("GB") || p.region_is("AU") {
        Some(true)
    } else if p.region_is("US") {
        Some(false)
    } else if minority(s.en_us, s.en_uk) {
        Some(true)
    } else if minority(s.en_uk, s.en_us) {
        Some(false)
    } else {
        None
    };
    let Some(uk) = target_uk else { return };
    for (a, b) in t.words() {
        let w = t.slice(a, b);
        if w.chars().next().is_some_and(char::is_uppercase) && !t.sentence_start(a) {
            continue;
        }
        if t.in_quotes(a, b) {
            continue;
        }
        let lw = w.to_lowercase();
        let pair = EN_SPELLING
            .iter()
            .find(|(us, gb)| if uk { *us == lw } else { *gb == lw });
        let Some((us, gb)) = pair else { continue };
        // Oxford spelling: British, but -ize.
        if uk && p.is("oxford") && us.contains("iz") {
            continue;
        }
        let to = if uk { gb } else { us };
        let why = if p.explicit {
            "the chosen style"
        } else {
            "most of this document"
        };
        out.fix(
            "en.spelling.variety",
            a,
            b,
            match_case(&w, to),
            format!("Spelling variety: {why} uses “{to}”."),
        );
    }
}
