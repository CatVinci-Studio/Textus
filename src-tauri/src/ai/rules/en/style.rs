//! English style: sentence starts and length, times, wordy, exclusive
//! or vague phrases, capitals, the passive, and words AI text overuses.

use super::*;

pub(crate) static NUM_START: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d[\d,.]*").unwrap());

/// en.num.sentence-start: a sentence starting with a numeral (not a year,
/// not a heading or list item).
pub(crate) fn sentence_start(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.block.is_heading()
        || matches!(ctx.block, Block::ListItem | Block::TableCell)
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
pub(crate) fn clock(t: &Text, ctx: &Ctx, out: &mut Out) {
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

pub(crate) const WORDY: &[(&str, &str)] = &[
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

pub(crate) const INCLUSIVE: &[(&str, &str)] = &[
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

pub(crate) const GOVUK_AVOID: &[(&str, &str)] = &[
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
pub(crate) fn find_phrase(t: &Text, phrase: &str) -> Vec<(usize, usize)> {
    find_word(t, phrase, true)
}

/// en.word.wordy, en.word.plain (GOV.UK), en.word.please (tech guides),
/// en.word.inclusive and en.govuk.style: word lists, all suggestions, none
/// inside quotations, dialogue or titles of works.
pub(crate) fn phrases(t: &Text, ctx: &Ctx, out: &mut Out) {
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
pub(crate) fn plain_words() -> &'static [(&'static str, &'static str)] {
    static LIST: LazyLock<Vec<(&'static str, &'static str)>> = LazyLock::new(|| {
        include_str!("../data/en-plain-words.csv")
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

pub(crate) const ACRONYMS: &[&str] = &[
    "USA", "UK", "EU", "UN", "NASA", "FAQ", "API", "PDF", "HTML", "CSS", "URL", "CEO", "CFO",
    "CTO", "HR", "IT", "AI", "OK", "TV", "GDP", "NATO", "FBI", "CIA", "BBC", "USB", "CPU", "GPU",
    "RAM", "SQL", "JSON", "XML", "HTTP", "HTTPS", "ID", "PIN", "ATM", "DIY", "ASAP", "FYI", "RSVP",
    "NHS", "GOV",
];

/// en.style.caps: runs of three or more all-caps words that aren't
/// acronyms; "!!" and "?!" outside fiction.
pub(crate) fn caps(t: &Text, ctx: &Ctx, out: &mut Out) {
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
pub(crate) fn sentence_length(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.block.is_heading() || matches!(ctx.block, Block::ListItem | Block::TableCell) {
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

pub(crate) static PASSIVE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?(\w+ed|written|given|taken|made|done|seen|known|shown|found|told|built|sent|held|kept|left|paid|sold|brought|bought|thought|caught|taught|chosen|driven|eaten|forgotten|hidden|spoken|stolen|broken|frozen)\b").unwrap()
});

pub(crate) const ADJECTIVAL: &[&str] = &[
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
pub(crate) fn passive(t: &Text, _ctx: &Ctx, out: &mut Out) {
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

pub(crate) const AI_VOCAB: &[&str] = &[
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
pub(crate) fn ai_vocab(t: &Text, _ctx: &Ctx, out: &mut Out) {
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
