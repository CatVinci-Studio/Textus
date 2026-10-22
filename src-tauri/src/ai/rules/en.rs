//! English rules (CATALOGUE.md §3.4). Automatic has no national norm for
//! English: conventions that style guides disagree on (serial comma, dash
//! style, quote style, -ize/-ise, clock) are checked for consistency only,
//! and a preset applies when the user chooses one. Never flagged: split
//! infinitives, "data is/are", the serial comma in Automatic, "had had",
//! US/UK vocabulary (suggestions only), anything in code.

use super::stats::{minority, EN_SPELLING};
use super::text::*;
use super::{Ctx, Out};
use regex::Regex;
use std::sync::LazyLock;

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    misspelling(t, ctx, out);
    apostrophe_plural(t, ctx, out);
    double_hyphen(t, ctx, out);
    article(t, ctx, out);
    heading_end(t, ctx, out);
    spelling_variety(t, ctx, out);
    serial_comma(t, ctx, out);
    dash_style(t, ctx, out);
    quote_style(t, ctx, out);
    sentence_start(t, ctx, out);
    clock(t, ctx, out);
    etc(t, ctx, out);
    phrases(t, ctx, out);
    caps(t, ctx, out);
    sentence_length(t, ctx, out);
    passive(t, ctx, out);
    ai_vocab(t, ctx, out);
    minus(t, ctx, out);
    slash(t, ctx, out);
}

const MISSPELLINGS: &[(&str, &str)] = &[
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

static COULD_OF: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(could|should|would|must|might)\s+of\b").unwrap());

/// en.word.misspelling: non-words and common misspellings, and "could
/// of" (not "could of course"). Not inside a quotation of the error.
fn misspelling(t: &Text, _ctx: &Ctx, out: &mut Out) {
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

static DECADE_APOS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(1[0-9]|20)(\d0)['’]s\b").unwrap());
static ABBR_APOS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i:\b(?:many|several|few|all|some|these|those|multiple|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)([A-Z]{2,})['’]s\b").unwrap()
});

/// en.punct.apostrophe-plural: 1990's -> 1990s; "two PDF's" -> PDFs (only
/// after a number or quantifier - "NASA's mission" is a possessive). Single
/// capital letters (A's) are left alone.
fn apostrophe_plural(t: &Text, _ctx: &Ctx, out: &mut Out) {
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

/// The document's dash, for replacing "--": a spaced en dash where the
/// document mostly uses those, else an em dash (the spacing as typed).
fn majority_dash(ctx: &Ctx) -> &'static str {
    let s = ctx.stats;
    if s.dash_en_spaced > s.dash_em_spaced + s.dash_em_tight {
        "–"
    } else {
        "—"
    }
}

/// en.punct.double-hyphen: "--" in prose -> the document's dash. Not
/// command-line flags ("--verbose").
fn double_hyphen(t: &Text, ctx: &Ctx, out: &mut Out) {
    let n = t.len();
    let mut i = 0;
    while i + 1 < n {
        if t.chars[i] == '-'
            && t.chars[i + 1] == '-'
            && t.at(i + 2) != Some('-')
            && t.before(i) != Some('-')
        {
            let prev = t.before(i);
            let next = t.at(i + 2);
            let flag = prev.is_some_and(|c| c.is_whitespace())
                && next.is_some_and(|c| c.is_alphanumeric());
            if !flag
                && (prev.is_some_and(|c| c.is_alphanumeric() || c == ' ')
                    && next.is_some_and(|c| c.is_alphanumeric() || c == ' '))
            {
                let dash = majority_dash(ctx);
                out.fix(
                    "en.punct.double-hyphen",
                    i,
                    i + 2,
                    dash,
                    format!("Use a dash (“{dash}”), not two hyphens."),
                );
            }
            i += 2;
        } else {
            i += 1;
        }
    }
}

const AN_WORDS: &[&str] = &[
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
const A_WORDS: &[&str] = &[
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
fn article(t: &Text, _ctx: &Ctx, out: &mut Out) {
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

/// en.heading.end-punct: a heading ending in "." or ":" (not "...").
fn heading_end(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !ctx.block.is_heading() {
        return;
    }
    let n = t.s.trim_end().chars().count();
    if n >= 2 && matches!(t.chars[n - 1], '.' | ':') && t.chars[n - 2] != '.' {
        out.fix(
            "en.heading.end-punct",
            n - 1,
            n,
            "",
            "Headings take no full stop or colon at the end.",
        );
    }
}

/// en.spelling.variety: US and UK spellings mixed - the minority flagged,
/// or (with a preset) the other variety's forms. Oxford spelling keeps
/// -ize; GOV.UK uses -ise. Proper nouns (Labour Party) are skipped.
fn spelling_variety(t: &Text, ctx: &Ctx, out: &mut Out) {
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

static SERIAL_YES: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\w+, \w+(?: \w+)?, (?:and|or) \w+").unwrap());
static SERIAL_NO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\w+, \w+(?: \w+)? (?:and|or) \w+").unwrap());

/// en.punct.serial-comma: only against a chosen preset (never in
/// Automatic): Chicago-like, Oxford, APA, MLA and the tech guides use it;
/// AP-like news and GOV.UK don't.
fn serial_comma(t: &Text, ctx: &Ctx, out: &mut Out) {
    let p = ctx.profile;
    if !p.explicit {
        return;
    }
    let wants = match p.preset.as_deref() {
        Some("general" | "oxford" | "apa" | "mla" | "tech-google" | "tech-microsoft") => true,
        Some("news" | "govuk") => false,
        _ => return,
    };
    if wants {
        for (a, b) in t.find(&SERIAL_NO) {
            let span = t.slice(a, b);
            if let Some(k) = span.rfind(" and ").or_else(|| span.rfind(" or ")) {
                let at = a + span[..k].chars().count();
                out.fix(
                    "en.punct.serial-comma",
                    at,
                    at + 1,
                    ", ",
                    "The chosen style uses the serial comma.",
                );
            }
        }
    } else {
        for (a, b) in t.find(&SERIAL_YES) {
            let span = t.slice(a, b);
            if let Some(k) = span.rfind(", and ").or_else(|| span.rfind(", or ")) {
                let at = a + span[..k].chars().count();
                out.fix(
                    "en.punct.serial-comma",
                    at,
                    at + 2,
                    " ",
                    "The chosen style doesn’t use the serial comma.",
                );
            }
        }
    }
}

/// en.punct.dash-style: em dashes closed up, em dashes spaced and spaced en
/// dashes mixed - the minority flagged. Ranges (1990–1995) aren't dashes.
fn dash_style(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    let total = s.dash_em_tight + s.dash_em_spaced + s.dash_en_spaced;
    let (major, count) = [
        ("em-tight", s.dash_em_tight),
        ("em-spaced", s.dash_em_spaced),
        ("en-spaced", s.dash_en_spaced),
    ]
    .into_iter()
    .max_by_key(|x| x.1)
    .unwrap();
    if !minority(total - count, count) {
        return;
    }
    let target = match major {
        "em-tight" => "—",
        "em-spaced" => " — ",
        _ => " – ",
    };
    for i in 0..t.len() {
        let c = t.chars[i];
        let (p, n) = (t.before(i), t.at(i + 1));
        let kind = match c {
            '—' if p == Some(' ') && n == Some(' ') => "em-spaced",
            '—' if p.is_some_and(char::is_alphabetic) && n.is_some_and(char::is_alphabetic) => {
                "em-tight"
            }
            '–' if p == Some(' ') && n == Some(' ') => "en-spaced",
            _ => continue,
        };
        if kind != major {
            let (a, b) = if p == Some(' ') {
                (i - 1, i + 2)
            } else {
                (i, i + 1)
            };
            out.fix(
                "en.punct.dash-style",
                a,
                b,
                target,
                "Dash style differs from the rest of the document.",
            );
        }
    }
}

/// en.punct.quote-style: straight and curly double quotes (or apostrophes)
/// mixed - the minority flagged.
fn quote_style(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    if minority(s.dq_straight, s.dq_curly) {
        let marks: Vec<usize> = (0..t.len())
            .filter(|&i| t.chars[i] == '"' && !t.protected[i])
            .collect();
        if marks.len().is_multiple_of(2) {
            for pair in marks.chunks(2) {
                out.fix(
                    "en.punct.quote-style",
                    pair[0],
                    pair[0] + 1,
                    "“",
                    "Quote style differs from the rest of the document (curly quotes).",
                );
                out.fix(
                    "en.punct.quote-style",
                    pair[1],
                    pair[1] + 1,
                    "”",
                    "Quote style differs from the rest of the document (curly quotes).",
                );
            }
        }
    } else if minority(s.dq_curly, s.dq_straight) {
        for i in 0..t.len() {
            if matches!(t.chars[i], '“' | '”') {
                out.fix(
                    "en.punct.quote-style",
                    i,
                    i + 1,
                    "\"",
                    "Quote style differs from the rest of the document (straight quotes).",
                );
            }
        }
    }
    let apostrophe = |i: usize| {
        t.before(i).is_some_and(char::is_alphabetic) && t.at(i + 1).is_some_and(char::is_alphabetic)
    };
    if minority(s.apos_straight, s.apos_curly) {
        for i in 0..t.len() {
            if t.chars[i] == '\'' && apostrophe(i) {
                out.fix(
                    "en.punct.quote-style",
                    i,
                    i + 1,
                    "’",
                    "Apostrophe style differs from the rest of the document.",
                );
            }
        }
    } else if minority(s.apos_curly, s.apos_straight) {
        for i in 0..t.len() {
            if t.chars[i] == '’' && apostrophe(i) {
                out.fix(
                    "en.punct.quote-style",
                    i,
                    i + 1,
                    "'",
                    "Apostrophe style differs from the rest of the document.",
                );
            }
        }
    }
}

static NUM_START: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d[\d,.]*").unwrap());

/// en.num.sentence-start: a sentence starting with a numeral (not a year,
/// not a heading or list item).
fn sentence_start(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.block.is_heading()
        || matches!(ctx.block, super::Block::ListItem | super::Block::TableCell)
        || ctx.profile.is("govuk")
    {
        return;
    }
    for (a, b) in t.find(&NUM_START) {
        if !t.sentence_start(a) || t.before(a).is_some_and(|c| !c.is_whitespace()) && a > 0 {
            continue;
        }
        let num = t.slice(a, b);
        let year = num.len() == 4 && (num.starts_with('1') || num.starts_with('2'));
        if !year && t.at(b).is_some_and(|c| c == ' ') {
            out.flag(
                "en.num.sentence-start",
                a,
                b,
                "Spell out a number that starts a sentence, or reword.",
            );
        }
    }
}

/// en.num.clock: 12-hour and 24-hour times in one document.
fn clock(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    if s.clock12 == 0 || s.clock24 == 0 {
        return;
    }
    static T24: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\b(?:1[3-9]|2[0-3]):[0-5]\d\b").unwrap());
    static T12: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\b\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)").unwrap());
    let re = if s.clock24 < s.clock12 { &*T24 } else { &*T12 };
    for (a, b) in t.find(re) {
        out.flag(
            "en.num.clock",
            a,
            b,
            "12-hour and 24-hour times are mixed in this document.",
        );
    }
}

static ETC_AFTER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?:such as|for example|for instance|e\.g\.|including)\b[^.!?;]*?,?\s+(etc\.?)",
    )
    .unwrap()
});

/// en.word.etc: "etc." after "such as", "for example", "e.g.".
fn etc(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&ETC_AFTER) {
        let Some((a, b)) = caps[1] else { continue };
        let mut start = a;
        while start > 0 && matches!(t.chars[start - 1], ' ' | ',') {
            start -= 1;
        }
        out.fix(
            "en.word.etc",
            start,
            b,
            "",
            "“Such as” and “for example” already say the list is incomplete: drop “etc.”.",
        );
    }
}

const WORDY: &[(&str, &str)] = &[
    ("in order to", "to"),
    ("a number of", "some"),
    ("at this point in time", "now"),
    ("at the present time", "now"),
    ("prior to", "before"),
    ("due to the fact that", "because"),
    ("owing to the fact that", "because"),
    ("in light of the fact that", "because"),
    ("in the event that", "if"),
    ("with regard to", "about"),
    ("in spite of the fact that", "although"),
    ("despite the fact that", "although"),
    ("for the purpose of", "for"),
    ("has the ability to", "can"),
    ("in the near future", "soon"),
    ("a large number of", "many"),
    ("the majority of", "most"),
    ("on a daily basis", "daily"),
    ("in close proximity to", "near"),
    ("until such time as", "until"),
    ("each and every", "every"),
    ("first and foremost", "first"),
    ("end result", "result"),
    ("past history", "history"),
    ("advance planning", "planning"),
    ("basic fundamentals", "fundamentals"),
];

const INCLUSIVE: &[(&str, &str)] = &[
    ("whitelist", "allowlist"),
    ("blacklist", "blocklist"),
    ("whitelisted", "allowlisted"),
    ("blacklisted", "blocklisted"),
    ("manpower", "workforce"),
    ("mankind", "humankind"),
    ("man-hours", "person-hours"),
    ("chairman", "chair"),
    ("policeman", "police officer"),
    ("policemen", "police officers"),
    ("fireman", "firefighter"),
    ("firemen", "firefighters"),
    ("stewardess", "flight attendant"),
    ("mailman", "mail carrier"),
    ("grandfathered", "exempted"),
    ("sanity check", "quick check"),
    ("dummy value", "placeholder value"),
];

const GOVUK_AVOID: &[(&str, &str)] = &[
    ("facilitate", "help"),
    ("utilise", "use"),
    ("utilize", "use"),
    ("leverage", "use"),
    ("empower", "allow"),
    ("streamline", "simplify"),
    ("deliver", "make"),
    ("deploy", "use"),
    ("liaise", "work with"),
    ("overarching", "main"),
    ("robust", "strong"),
    ("tackle", "deal with"),
    ("e.g.", "for example"),
    ("eg", "for example"),
    ("i.e.", "that is"),
    ("ie", "that is"),
];

/// Every whole-phrase occurrence of `phrase`, case-insensitive.
fn find_phrase(t: &Text, phrase: &str) -> Vec<(usize, usize)> {
    find_word(t, phrase, true)
}

/// en.word.wordy, en.word.plain (GOV.UK), en.word.please (tech guides),
/// en.word.inclusive and en.govuk.style: word lists, all suggestions, none
/// inside quotations, dialogue or titles of works.
fn phrases(t: &Text, ctx: &Ctx, out: &mut Out) {
    let fix_list =
        |out: &mut Out, rule: &'static str, list: &[(&str, &str)], why: &dyn Fn(&str) -> String| {
            for (from, to) in list {
                for (a, b) in find_phrase(t, from) {
                    if t.in_quotes(a, b) {
                        continue;
                    }
                    let fixed = match_case(&t.slice(a, b), to);
                    out.fix(rule, a, b, fixed, why(to));
                }
            }
        };
    fix_list(out, "en.word.wordy", WORDY, &|to| {
        format!("Wordy: “{to}” says the same.")
    });
    fix_list(out, "en.word.inclusive", INCLUSIVE, &|to| {
        format!("Consider “{to}”.")
    });
    let p = ctx.profile;
    if p.is("govuk") {
        for (from, to) in plain_words() {
            for (a, b) in find_phrase(t, from) {
                if !t.in_quotes(a, b) {
                    out.fix(
                        "en.word.plain",
                        a,
                        b,
                        match_case(&t.slice(a, b), to),
                        format!("Plain English: “{to}”."),
                    );
                }
            }
        }
        fix_list(out, "en.govuk.style", GOVUK_AVOID, &|to| {
            format!("GOV.UK style: “{to}”.")
        });
        for i in 0..t.len() {
            if t.chars[i] == '&' && t.before(i) == Some(' ') && t.at(i + 1) == Some(' ') {
                out.fix(
                    "en.govuk.style",
                    i,
                    i + 1,
                    "and",
                    "GOV.UK style: “and”, not “&”.",
                );
            }
        }
    }
    if p.is("tech-google") || p.is("tech-microsoft") {
        for (a, b) in find_word(t, "please", true) {
            out.flag(
                "en.word.please",
                a,
                b,
                "Technical instructions don’t need “please”.",
            );
        }
    }
}

/// The plain-words list (plainlanguage.gov archive, public domain):
/// (avoid, prefer - the first alternative).
fn plain_words() -> &'static [(&'static str, &'static str)] {
    static LIST: LazyLock<Vec<(&'static str, &'static str)>> = LazyLock::new(|| {
        include_str!("data/en-plain-words.csv")
            .lines()
            .skip(1)
            .filter_map(|line| {
                let (avoid, rest) = line.split_once(',')?;
                let prefer = rest.trim_start_matches('"');
                let first = prefer.split([',', '"', '(', ';']).next()?.trim();
                (!avoid.contains('/') && !first.is_empty() && !avoid.is_empty())
                    .then_some((avoid.trim(), first))
            })
            .collect()
    });
    &LIST
}

const ACRONYMS: &[&str] = &[
    "USA", "UK", "EU", "UN", "NASA", "FAQ", "API", "PDF", "HTML", "CSS", "URL", "CEO", "CFO",
    "CTO", "HR", "IT", "AI", "OK", "TV", "GDP", "NATO", "FBI", "CIA", "BBC", "USB", "CPU", "GPU",
    "RAM", "SQL", "JSON", "XML", "HTTP", "HTTPS", "ID", "PIN", "ATM", "DIY", "ASAP", "FYI", "RSVP",
    "NHS", "GOV",
];

/// en.style.caps: runs of three or more all-caps words that aren't
/// acronyms; "!!" and "?!" outside fiction.
fn caps(t: &Text, ctx: &Ctx, out: &mut Out) {
    let words = t.words();
    let shouty = |&(a, b): &(usize, usize)| {
        let w = t.slice(a, b);
        w.chars().count() >= 2
            && w.chars().all(|c| c.is_uppercase())
            && !ACRONYMS.contains(&w.as_str())
    };
    let mut i = 0;
    while i < words.len() {
        let mut j = i;
        while j < words.len() && shouty(&words[j]) {
            j += 1;
        }
        if j - i >= 3 {
            out.flag(
                "en.style.caps",
                words[i].0,
                words[j - 1].1,
                "Several words in capitals read as shouting.",
            );
            i = j;
        } else {
            i += 1;
        }
    }
    if !ctx.profile.is("fiction") {
        for (a, b) in find_str(t, "!!").into_iter().chain(find_str(t, "?!")) {
            out.flag(
                "en.style.caps",
                a,
                b,
                "Doubled exclamation marks are rarely needed outside fiction.",
            );
        }
    }
}

/// en.style.sentence-length: sentences over 25 words (info), over 40
/// (60 in fiction) flagged more firmly in the message.
fn sentence_length(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.block.is_heading()
        || matches!(ctx.block, super::Block::ListItem | super::Block::TableCell)
    {
        return;
    }
    let limit = if ctx.profile.is("fiction") { 60 } else { 40 };
    let mut start = 0;
    for i in 0..=t.len() {
        let end = i == t.len()
            || (matches!(t.chars[i], '.' | '!' | '?')
                && t.at(i + 1).is_none_or(char::is_whitespace));
        if end {
            let words = t.chars[start..i]
                .split(|c| c.is_whitespace())
                .filter(|w| w.iter().any(|c| c.is_alphanumeric()))
                .count();
            if words > 25 && !t.in_quotes(start, i) {
                let msg = if words > limit {
                    format!("Very long sentence ({words} words): split it.")
                } else {
                    format!("Long sentence ({words} words): consider splitting it.")
                };
                let a = start
                    + t.chars[start..i]
                        .iter()
                        .take_while(|c| c.is_whitespace())
                        .count();
                out.flag("en.style.sentence-length", a, i, msg);
            }
            start = i + 1;
        }
    }
}

static PASSIVE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(\w+ed|written|given|taken|made|done|seen|known|shown|found|told|built|sent|held|kept|left|paid|sold|brought|bought|thought|caught|taught|chosen|driven|eaten|forgotten|hidden|spoken|stolen|broken|frozen)\b").unwrap()
});
const ADJECTIVAL: &[&str] = &[
    "interested",
    "tired",
    "excited",
    "worried",
    "pleased",
    "surprised",
    "bored",
    "married",
    "supposed",
    "used",
    "based",
    "located",
    "concerned",
    "involved",
    "prepared",
    "scared",
    "confused",
    "satisfied",
    "disappointed",
    "amazed",
    "relaxed",
    "annoyed",
    "qualified",
    "experienced",
    "detailed",
    "advanced",
    "complicated",
    "dedicated",
    "limited",
    "related",
    "red",
    "bed",
    "need",
    "seed",
    "feed",
    "speed",
    "indeed",
    "shed",
];

/// en.style.passive ("strict" only): be + past participle.
fn passive(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&PASSIVE) {
        let (Some((a, b)), Some((p1, p2))) = (caps[0], caps[1]) else {
            continue;
        };
        let participle = t.slice(p1, p2).to_lowercase();
        if ADJECTIVAL.contains(&participle.as_str()) {
            continue;
        }
        out.flag(
            "en.style.passive",
            a,
            b,
            "Passive voice: say who does it, if that helps the reader.",
        );
    }
}

const AI_VOCAB: &[&str] = &[
    "delve",
    "delves",
    "delving",
    "tapestry",
    "testament to",
    "pivotal",
    "seamless",
    "seamlessly",
    "robust",
    "leverage",
    "leverages",
    "leveraging",
];

/// en.style.ai-vocab: words that cluster in generated text - info per
/// sighting, a warning at two or more in one paragraph. Technical senses
/// (robust statistics, financial leverage) are left alone.
fn ai_vocab(t: &Text, _ctx: &Ctx, out: &mut Out) {
    let mut hits = Vec::new();
    for w in AI_VOCAB {
        for (a, b) in find_phrase(t, w) {
            let next: String = t.chars[b..]
                .iter()
                .take(12)
                .collect::<String>()
                .to_lowercase();
            let prev: String = t.chars[a.saturating_sub(12)..a]
                .iter()
                .collect::<String>()
                .to_lowercase();
            let technical = (w.starts_with("robust")
                && (next.trim_start().starts_with("statistic")
                    || next.trim_start().starts_with("estimat")
                    || next.trim_start().starts_with("regression")))
                || (w.starts_with("leverag")
                    && (prev.contains("financial") || next.trim_start().starts_with("ratio")));
            if !technical && !t.in_quotes(a, b) {
                hits.push((a, b));
            }
        }
    }
    let msg = if hits.len() >= 2 {
        "Several words common in generated text in one paragraph: prefer plainer, more specific words."
    } else {
        "A word common in generated text: is a plainer, more specific word better here?"
    };
    for (a, b) in hits {
        out.flag("en.style.ai-vocab", a, b, msg);
    }
}

/// en.num.minus: a hyphen as a minus sign before a number -> U+2212.
fn minus(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 0..t.len().saturating_sub(1) {
        if t.chars[i] == '-'
            && t.chars[i + 1].is_ascii_digit()
            && t.before(i).is_none_or(|c| c == ' ' || c == '(')
            && !t.chars[..i].ends_with(&[' ', '-'])
        {
            // "from -5 to -10" yes; "pages 3-5", dates and codes have no space before.
            let prev_word_is_number = t.chars[..i]
                .iter()
                .rev()
                .skip(1)
                .take_while(|c| !c.is_whitespace())
                .all(|c| c.is_ascii_digit())
                && i > 1
                && t.chars[i - 2].is_ascii_digit();
            if !prev_word_is_number {
                out.fix(
                    "en.num.minus",
                    i,
                    i + 1,
                    "\u{2212}",
                    "A minus sign (−) reads better than a hyphen.",
                );
            }
        }
    }
}

static SLASH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:and/or|he/she|she/he|his/her|her/his|him/her|s/he)\b|\b\w+\(s\)").unwrap()
});

/// en.word.slash: and/or, he/she, s/he, document(s).
fn slash(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&SLASH) {
        if !t.in_quotes(a, b) {
            out.flag("en.word.slash", a, b, "Slashed or bracketed alternatives are hard to read: choose one, or write both out.");
        }
    }
}

#[cfg(test)]
mod tests;
