//! English punctuation: dashes, the serial comma, quotes, the end of a
//! heading, etc., minus signs and slashes.

use super::*;

/// The document's dash, for replacing "--": a spaced en dash where the
/// document mostly uses those, else an em dash (the spacing as typed).
pub(crate) fn majority_dash(ctx: &Ctx) -> &'static str {
    let s = ctx.stats;
    if s.dash_en_spaced > s.dash_em_spaced + s.dash_em_tight {
        "–"
    } else {
        "—"
    }
}

/// en.punct.double-hyphen: "--" in prose -> the document's dash. Not
/// command-line flags ("--verbose").
pub(crate) fn double_hyphen(t: &Text, ctx: &Ctx, out: &mut Out) {
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

/// en.heading.end-punct: a heading ending in "." or ":" (not "...").
pub(crate) fn heading_end(t: &Text, ctx: &Ctx, out: &mut Out) {
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

pub(crate) static SERIAL_YES: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\w+, \w+(?: \w+)?, (?:and|or) \w+").unwrap());

pub(crate) static SERIAL_NO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\w+, \w+(?: \w+)? (?:and|or) \w+").unwrap());

/// en.punct.serial-comma: only against a chosen preset, never in Automatic.
pub(crate) fn serial_comma(t: &Text, ctx: &Ctx, out: &mut Out) {
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
pub(crate) fn dash_style(t: &Text, ctx: &Ctx, out: &mut Out) {
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
pub(crate) fn quote_style(t: &Text, ctx: &Ctx, out: &mut Out) {
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

pub(crate) static ETC_AFTER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?:such as|for example|for instance|e\.g\.|including)\b[^.!?;]*?,?\s+(etc\.?)",
    )
    .unwrap()
});

/// en.word.etc: "etc." after "such as", "for example", "e.g.".
pub(crate) fn etc(t: &Text, _ctx: &Ctx, out: &mut Out) {
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

/// en.num.minus: a hyphen as a minus sign before a number -> U+2212.
pub(crate) fn minus(t: &Text, _ctx: &Ctx, out: &mut Out) {
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

pub(crate) static SLASH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:and/or|he/she|she/he|his/her|her/his|him/her|s/he)\b|\b\w+\(s\)").unwrap()
});

/// en.word.slash: and/or, he/she, s/he, document(s).
pub(crate) fn slash(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&SLASH) {
        if !t.in_quotes(a, b) {
            out.flag("en.word.slash", a, b, "Slashed or bracketed alternatives are hard to read: choose one, or write both out.");
        }
    }
}
