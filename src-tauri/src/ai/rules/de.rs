//! German rules, Duden-style by default. Never flagged: a comma before *und*,
//! `%` compounds (5%-Klausel, 100%ig), the infinitive comma after *versuchen*,
//! range-dash style (only inconsistency), Swiss `ss`.

use super::text::*;
use super::{Ctx, Out};
use regex::Regex;
use std::sync::LazyLock;

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    quote_style(t, ctx, out);
    reporting_comma(t, ctx, out);
    dash(t, ctx, out);
    abbr_space(t, ctx, out);
    removed_variant(t, ctx, out);
    percent(t, ctx, out);
    subordinate(t, ctx, out);
    adversative(t, ctx, out);
    date_zero_pad(t, ctx, out);
    group(t, ctx, out);
    eszett(t, ctx, out);
    gender_chars(t, ctx, out);
}

/// de.quote.style: straight or English curly quotes -> „…“ (de-CH «…»).
/// Book-style »…« is a valid house style and stays.
fn quote_style(t: &Text, ctx: &Ctx, out: &mut Out) {
    let swiss = ctx.profile.region_is("CH")
        || (!ctx.profile.explicit
            && ctx.stats.dq_guillemet > ctx.stats.dq_low
            && ctx.stats.dq_guillemet > 0);
    let (open, close, msg) = if swiss {
        ("«", "»", "In der Schweiz stehen Anführungszeichen als «…».")
    } else {
        ("„", "“", "Deutsche Anführungszeichen: „…“.")
    };
    // English pairs: “…” (U+201C … U+201D). An English opening “ starts a
    // word; the German closing “ ends one.
    let mut i = 0;
    while i < t.len() {
        let opens = t.chars[i] == '“'
            && t.before(i)
                .is_none_or(|c| c.is_whitespace() || matches!(c, '(' | '['));
        if opens {
            if let Some(j) = (i + 1..t.len()).find(|&j| t.chars[j] == '”') {
                out.fix("de.quote.style", i, i + 1, open, msg);
                out.fix("de.quote.style", j, j + 1, close, msg);
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    let marks: Vec<usize> = (0..t.len())
        .filter(|&i| t.chars[i] == '"' && !t.protected[i])
        .collect();
    if marks.len().is_multiple_of(2) {
        for pair in marks.chunks(2) {
            out.fix("de.quote.style", pair[0], pair[0] + 1, open, msg);
            out.fix("de.quote.style", pair[1], pair[1] + 1, close, msg);
        }
    }
    if ctx.profile.region_is("CH") {
        for i in 0..t.len() {
            match t.chars[i] {
                '„' => out.fix("de.quote.style", i, i + 1, "«", msg),
                '“' if t.chars[..i].contains(&'„') => {
                    out.fix("de.quote.style", i, i + 1, "»", msg)
                }
                _ => {}
            }
        }
    }
}

const SAYING: &str = "sagte|sagt|rief|ruft|fragte|fragt|meinte|meint|antwortete|antwortet|erwiderte|flüsterte|schrie|erklärte|betonte|murmelte|seufzte|lachte";
static REPORT_NO_COMMA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"([“«\x22])( )(?:{SAYING})\b")).unwrap());
static REPORT_PERIOD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(&format!(r"(\.)[“«\x22],? (?:{SAYING})\b")).unwrap());

/// de.quote.reporting-comma: „Komm her“ sagte er -> „Komm her“, sagte er;
/// and the quote's own full stop goes: „Komm her.“, sagte er.
fn reporting_comma(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&REPORT_NO_COMMA) {
        let (Some((q, _)), Some((_, end))) = (caps[1], caps[0]) else {
            continue;
        };
        // Direct speech is followed by who said it ("sagte er", "rief
        // Anna"); „Unterhaltungen“ meint im Folgenden... is a quoted word.
        let speaker = t.slice(end, t.len());
        let next = speaker.split_whitespace().next().unwrap_or("");
        const WHO: [&str; 12] = [
            "er", "sie", "es", "ich", "wir", "ihr", "du", "man", "der", "die", "das", "mein",
        ];
        let is_speaker = WHO.contains(
            &next
                .trim_matches(|c: char| !c.is_alphabetic())
                .to_lowercase()
                .as_str(),
        ) || next.chars().next().is_some_and(char::is_uppercase);
        if !is_speaker {
            continue;
        }
        out.fix(
            "de.quote.reporting-comma",
            q,
            q + 1,
            format!("{},", t.chars[q]),
            "Nach der wörtlichen Rede steht vor dem Begleitsatz ein Komma.",
        );
    }
    for caps in t.captures(&REPORT_PERIOD) {
        let Some((p, _)) = caps[1] else { continue };
        out.fix(
            "de.quote.reporting-comma",
            p,
            p + 1,
            "",
            "Der Punkt der wörtlichen Rede entfällt, wenn der Begleitsatz folgt.",
        );
    }
}

/// de.punct.dash: " - " between words -> " – " (ranges between digits stay).
fn dash(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 1..t.len().saturating_sub(1) {
        if t.chars[i] == '-' && t.chars[i - 1] == ' ' && t.chars[i + 1] == ' ' {
            let l = t.chars[..i - 1].last().copied();
            let r = t.at(i + 2);
            if l.is_some_and(char::is_alphabetic) && r.is_some_and(char::is_alphabetic) {
                out.fix(
                    "de.punct.dash",
                    i,
                    i + 1,
                    "–",
                    "Als Gedankenstrich steht der Halbgeviertstrich (–).",
                );
            }
        }
    }
}

const ABBRS: &[(&str, &str)] = &[
    ("z.B.", "z.\u{202F}B."),
    ("d.h.", "d.\u{202F}h."),
    ("u.a.", "u.\u{202F}a."),
    ("i.A.", "i.\u{202F}A."),
    ("u.U.", "u.\u{202F}U."),
    ("z.T.", "z.\u{202F}T."),
    ("o.Ä.", "o.\u{202F}Ä."),
    ("v.a.", "v.\u{202F}a."),
    ("m.E.", "m.\u{202F}E."),
    ("s.o.", "s.\u{202F}o."),
    ("s.u.", "s.\u{202F}u."),
    ("i.d.R.", "i.\u{202F}d.\u{202F}R."),
    ("u.Ä.", "u.\u{202F}Ä."),
];

/// de.word.abbr-space: z.B. -> z. B. (narrow no-break space). usw. and usf.
/// are single units.
fn abbr_space(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (from, to) in ABBRS {
        for (a, b) in find_str(t, from) {
            if t.before(a).is_some_and(char::is_alphanumeric) {
                continue;
            }
            out.fix(
                "de.word.abbr-space",
                a,
                b,
                *to,
                format!(
                    "Mehrteilige Abkürzungen mit (schmalem) Leerzeichen: „{}“.",
                    to.replace('\u{202F}', " ")
                ),
            );
        }
    }
}

/// de.word.removed-variant: spellings the 2024 Regelwerk removed.
fn removed_variant(t: &Text, _ctx: &Ctx, out: &mut Out) {
    const LIST: [(&str, &str); 7] = [
        ("Spagetti", "Spaghetti"),
        ("Jogurt", "Joghurt"),
        ("Tunfisch", "Thunfisch"),
        ("Ketschup", "Ketchup"),
        ("Majonäse", "Mayonnaise"),
        ("Portmonee", "Portemonnaie"),
        ("Grislibär", "Grizzlybär"),
    ];
    for (old, new) in LIST {
        for (a, b) in find_str(t, old) {
            out.fix(
                "de.word.removed-variant",
                a,
                b,
                new,
                format!("Seit 2024 nicht mehr zulässig: „{new}“."),
            );
        }
    }
}

/// de.num.percent: 5% -> 5 % (no-break). Never compounds or derivatives.
fn percent(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 1..t.len() {
        if t.chars[i] == '%' && t.chars[i - 1].is_ascii_digit() {
            if t.at(i + 1).is_some_and(|c| c == '-' || c.is_alphabetic()) {
                continue;
            }
            out.fix(
                "de.num.percent",
                i - 1,
                i + 1,
                format!("{}\u{00A0}%", t.chars[i - 1]),
                "Zwischen Zahl und Prozentzeichen steht ein (geschütztes) Leerzeichen.",
            );
        }
    }
}

static SUBORDINATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(\p{L}+) (dass|weil|obwohl|ob|damit)\b( \p{L}+ \p{L}+)?").unwrap()
});

/// de.comma.subordinate ("strict"): no comma before dass, weil, obwohl, ob,
/// damit mid-sentence. Not so dass/sodass, ohne dass, als ob, und ob, damit
/// as an adverb, or after und/oder.
fn subordinate(t: &Text, _ctx: &Ctx, out: &mut Out) {
    const BEFORE_OK: [&str; 12] = [
        "so", "ohne", "als", "und", "oder", "außer", "anstatt", "statt", "bis", "aber", "sondern",
        "nur",
    ];
    for caps in t.captures(&SUBORDINATE) {
        let (Some((w1, w2)), Some((c1, c2))) = (caps[1], caps[2]) else {
            continue;
        };
        let prev = t.slice(w1, w2).to_lowercase();
        let conj = t.slice(c1, c2);
        if BEFORE_OK.contains(&prev.as_str()) {
            continue;
        }
        if conj == "damit" && caps[3].is_none() {
            continue;
        }
        out.fix(
            "de.comma.subordinate",
            w2,
            c1,
            ", ",
            format!("Vor „{conj}“ steht in der Regel ein Komma."),
        );
    }
}

static SONDERN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\p{L}+) (sondern)\b").unwrap());

/// de.comma.adversative ("strict"): no comma before sondern.
fn adversative(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&SONDERN) {
        let (Some((_, w2)), Some((c1, _))) = (caps[1], caps[2]) else {
            continue;
        };
        out.fix(
            "de.comma.adversative",
            w2,
            c1,
            ", ",
            "Vor „sondern“ steht ein Komma.",
        );
    }
}

static DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b").unwrap());

/// de.date.zero-pad (DIN 5008, or de.dateZeroPad=on): 1.5.2026 -> 01.05.2026.
fn date_zero_pad(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !(ctx.profile.is("din5008") || ctx.profile.opt("de.dateZeroPad") == Some("on")) {
        return;
    }
    for caps in t.captures(&DATE) {
        let (Some((a, b)), Some(d), Some(m), Some(y)) = (caps[0], caps[1], caps[2], caps[3]) else {
            continue;
        };
        let (ds, ms) = (t.slice(d.0, d.1), t.slice(m.0, m.1));
        if ds.len() == 2 && ms.len() == 2 {
            continue;
        }
        out.fix(
            "de.date.zero-pad",
            a,
            b,
            format!("{:0>2}.{:0>2}.{}", ds, ms, t.slice(y.0, y.1)),
            "DIN 5008: Tag und Monat zweistellig.",
        );
    }
}

static BIG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(\d{5,})\b ?(€|Euro|EUR|Dollar|km|kg|t|Menschen|Einwohner|Mitarbeiter|Besucher|Stück|Jahre)\b").unwrap()
});

/// de.num.group: numbers of five or more digits before a unit or a counted
/// noun -> grouped with a narrow space (never postcodes, years or codes).
fn group(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&BIG) {
        let Some((x, y)) = caps[1] else { continue };
        let digits = t.slice(x, y);
        let mut grouped = String::new();
        for (k, ch) in digits.chars().enumerate() {
            if k > 0 && (digits.len() - k).is_multiple_of(3) {
                grouped.push('\u{202F}');
            }
            grouped.push(ch);
        }
        out.fix(
            "de.num.group",
            x,
            y,
            grouped,
            "Zahlen ab fünf Stellen werden in Dreiergruppen gegliedert.",
        );
    }
}

const ESZETT: &[(&str, &str)] = &[
    ("Strasse", "Straße"),
    ("strasse", "straße"),
    ("gross", "groß"),
    ("grosse", "große"),
    ("grossen", "großen"),
    ("Grösse", "Größe"),
    ("Gruss", "Gruß"),
    ("Grüsse", "Grüße"),
    ("Fuss", "Fuß"),
    ("heissen", "heißen"),
    ("heisst", "heißt"),
    ("weiss", "weiß"),
    ("schliesslich", "schließlich"),
    ("ausserdem", "außerdem"),
    ("aussen", "außen"),
    ("süss", "süß"),
    ("Massnahme", "Maßnahme"),
    ("Massnahmen", "Maßnahmen"),
    ("gemäss", "gemäß"),
    ("mässig", "mäßig"),
    ("fliessen", "fließen"),
    ("Fleiss", "Fleiß"),
    ("bloss", "bloß"),
    ("draussen", "draußen"),
];

/// de.word.eszett: ss after a long vowel (Strasse) -> ß - only where the
/// document also writes ß (a text without any could be Swiss), never under
/// de-CH, never for names.
fn eszett(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.region_is("CH") || !(ctx.stats.de_eszett > 0 || ctx.profile.explicit) {
        return;
    }
    for (from, to) in ESZETT {
        for (a, b) in find_word(t, from, false) {
            out.fix(
                "de.word.eszett",
                a,
                b,
                *to,
                format!("Nach langem Vokal steht ß: „{to}“."),
            );
        }
    }
}

static GENDER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{L}+[*:_·]innen\b").unwrap());

/// de.word.gender-chars (de.genderChars=flag): Lehrer*innen and similar.
fn gender_chars(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.opt("de.genderChars") != Some("flag") {
        return;
    }
    for (a, b) in t.find(&GENDER) {
        out.flag(
            "de.word.gender-chars",
            a,
            b,
            "Genderzeichen im Wortinneren sind im Regelwerk nicht vorgesehen.",
        );
    }
}

#[cfg(test)]
mod tests;
