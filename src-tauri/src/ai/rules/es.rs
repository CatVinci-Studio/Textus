//! Spanish rules, after the RAE (summarised). Automatic has no national
//! profile: es-ES, es-419 and the EU differ on grouping and percent spacing,
//! which are suggestions only.

use super::stats::minority;
use super::text::*;
use super::{Ctx, Out};
use regex::Regex;
use std::sync::LazyLock;

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    inverted(t, ctx, out);
    double_final(t, ctx, out);
    period_outside(t, ctx, out);
    monosyllable(t, ctx, out);
    solo(t, ctx, out);
    months(t, ctx, out);
    etc(
        t,
        "es.punct.etc",
        "Tras «etc.» no se añaden puntos suspensivos.",
        out,
    );
    group(t, ctx, out);
    ordinal(t, ctx, out);
    percent(t, ctx, out);
    ex(t, ctx, out);
    word_unit(t, ctx, out);
    raya(t, ctx, out);
}

/// es.punct.inverted: a sentence ending in ? or ! with no opening ¿ or ¡
/// anywhere in it. The question may start mid-sentence ("Si llueve,
/// ¿vamos?"), so this flags only. Not headings.
fn inverted(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.block.is_heading() {
        return;
    }
    let mut start = 0;
    for i in 0..t.len() {
        let c = t.chars[i];
        if matches!(c, '.' | '…' | '\n' | ';') {
            start = i + 1;
            continue;
        }
        if matches!(c, '?' | '!') {
            // The end of a run like "?!" or "!!!".
            if t.at(i + 1).is_some_and(|n| matches!(n, '?' | '!')) {
                continue;
            }
            let opener = if c == '?' { '¿' } else { '¡' };
            let sentence = &t.chars[start..i];
            let has_letters = sentence.iter().any(|c| c.is_alphabetic());
            if has_letters
                && !sentence.contains(&opener)
                && !sentence.contains(&'¿')
                && !sentence.contains(&'¡')
                && !t.guarded(start, i + 1)
            {
                out.flag(
                    "es.punct.inverted",
                    i,
                    i + 1,
                    format!("Falta el signo de apertura «{opener}»."),
                );
            }
            start = i + 1;
        }
    }
}

/// es.punct.double-final: `?.` `!.` `….` with nothing between -> drop the
/// period. `?».`, `?)`, `?…` are right.
fn double_final(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 1..t.len() {
        if t.chars[i] == '.'
            && matches!(t.chars[i - 1], '?' | '!' | '…')
            && t.at(i + 1) != Some('.')
        {
            out.fix(
                "es.punct.double-final",
                i - 1,
                i + 1,
                t.chars[i - 1].to_string(),
                "Tras «?», «!» o «…» no se escribe punto.",
            );
        }
    }
}

const ABBREVIATIONS: &[&str] = &[
    "etc", "Sr", "Sra", "Dr", "Dra", "pág", "núm", "art", "Ud", "Uds", "vol", "cap", "admón",
];

/// es.quote.period-outside: `.»` `."` `.”` -> the period after the quote.
fn period_outside(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 1..t.len() {
        let q = t.chars[i];
        if !matches!(q, '»' | '"' | '”') || t.chars[i - 1] != '.' {
            continue;
        }
        if t.at(i + 1).is_some_and(|c| c.is_alphanumeric()) {
            continue; // an opening straight quote
        }
        let word: String = t.chars[..i - 1]
            .iter()
            .rev()
            .take_while(|c| c.is_alphabetic())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        if ABBREVIATIONS.contains(&word.as_str()) || t.before(i - 1) == Some('.') {
            continue;
        }
        let after_period = t.at(i + 1) == Some('.');
        let fixed = if after_period {
            q.to_string()
        } else {
            format!("{q}.")
        };
        out.fix(
            "es.quote.period-outside",
            i - 1,
            i + 1,
            fixed,
            "El punto va después de las comillas de cierre: «…».",
        );
    }
}

/// es.word.monosyllable: monosyllables take no accent (2010 Ortografía):
/// fué, dió, vió, guión, truhán, rió...
fn monosyllable(t: &Text, _ctx: &Ctx, out: &mut Out) {
    const WORDS: [(&str, &str); 11] = [
        ("fué", "fue"),
        ("fuí", "fui"),
        ("dió", "dio"),
        ("vió", "vio"),
        ("guión", "guion"),
        ("truhán", "truhan"),
        ("rió", "rio"),
        ("crió", "crio"),
        ("guió", "guio"),
        ("lió", "lio"),
        ("fié", "fie"),
    ];
    for (wrong, right) in WORDS {
        for (a, b) in find_word(t, wrong, true) {
            let fixed = match_case(&t.slice(a, b), right);
            out.fix(
                "es.word.monosyllable",
                a,
                b,
                fixed,
                format!("Los monosílabos no llevan tilde: «{right}»."),
            );
        }
    }
}

/// es.word.solo (es.soloAccent=flag): sólo, éste, ése, aquél.
fn solo(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.opt("es.soloAccent") != Some("flag") {
        return;
    }
    for (w, to) in [
        ("sólo", "solo"),
        ("éste", "este"),
        ("ésta", "esta"),
        ("éstos", "estos"),
        ("éstas", "estas"),
        ("ése", "ese"),
        ("ésa", "esa"),
        ("ésos", "esos"),
        ("ésas", "esas"),
        ("aquél", "aquel"),
        ("aquélla", "aquella"),
    ] {
        for (a, b) in find_word(t, w, true) {
            out.fix(
                "es.word.solo",
                a,
                b,
                match_case(&t.slice(a, b), to),
                "La RAE recomienda escribir sin tilde el adverbio «solo» y los demostrativos.",
            );
        }
    }
}

pub(crate) const ES_MONTHS: &[&str] = &[
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Setiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo",
    "Primavera",
    "Verano",
    "Otoño",
    "Invierno",
];

/// Capitalised month or day names mid-sentence (es and pt): not at a
/// sentence start, not part of a name (Viernes Santo, Domingo de Ramos,
/// Sete de Setembro), not after another capitalised word.
pub(crate) fn capitalised_names(
    t: &Text,
    rule: &'static str,
    names: &[&str],
    msg: &str,
    out: &mut Out,
) {
    for name in names {
        for (a, b) in find_word(t, name, false) {
            if t.sentence_start(a) || t.in_quotes(a, b) {
                continue;
            }
            let next_cap = t.chars[b..]
                .iter()
                .skip_while(|c| **c == ' ')
                .take(1)
                .any(|c| c.is_uppercase())
                && t.at(b) == Some(' ');
            let words_before: Vec<String> = t
                .slice(0, a)
                .split_whitespace()
                .rev()
                .take(2)
                .map(str::to_string)
                .collect();
            let prev_cap = words_before.first().is_some_and(|w| {
                w.chars().next().is_some_and(char::is_uppercase)
                    && !w.ends_with(['.', ':', '!', '?'])
            });
            let de_name = words_before.first().is_some_and(|w| w == "de")
                && words_before
                    .get(1)
                    .is_some_and(|w| w.chars().next().is_some_and(char::is_uppercase));
            if next_cap || prev_cap || de_name {
                continue;
            }
            out.fix(rule, a, b, t.slice(a, b).to_lowercase(), msg);
        }
    }
}

fn months(t: &Text, _ctx: &Ctx, out: &mut Out) {
    capitalised_names(
        t,
        "es.word.months",
        ES_MONTHS,
        "Los meses, los días y las estaciones se escriben con minúscula.",
        out,
    );
}

static ETC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\betc(?:\.{2,}|\.?…\.?)").unwrap());

/// es.punct.etc and fr.punct.etc: etc... / etc.… -> etc.
pub(crate) fn etc(t: &Text, rule: &'static str, msg: &str, out: &mut Out) {
    for (a, b) in t.find(&ETC) {
        out.fix(rule, a, b, "etc.", msg);
    }
}

static GROUPED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\d{1,3}(?:\.\d{3})+\b|\b\d{1,3}(?:,\d{3}){2,}\b").unwrap());

/// es.num.group: `.` or `,` as a thousands separator in 5+ digit numbers ->
/// a (no-break) space. Four-digit numbers and identifiers never. es-419
/// groups with commas, so there it is never flagged.
fn group(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.region_is("419") {
        return;
    }
    for (a, b) in t.find(&GROUPED) {
        let digits = t.chars[a..b].iter().filter(|c| c.is_ascii_digit()).count();
        let continues = t.at(b).is_some_and(|c| matches!(c, '.' | ',' | '-' | '/'))
            && t.at(b + 1).is_some_and(char::is_alphanumeric);
        if digits < 5
            || continues
            || t.before(a)
                .is_some_and(|c| c.is_alphanumeric() || c == '.' || c == ',')
        {
            continue;
        }
        let fixed: String = t.chars[a..b]
            .iter()
            .map(|&c| if c == '.' || c == ',' { '\u{00A0}' } else { c })
            .collect();
        out.fix("es.num.group", a, b, fixed, "Las cifras de más de cuatro dígitos se separan en grupos de tres con un espacio, no con punto ni coma.");
    }
}

static ORDINAL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(\d+)([ºª])").unwrap());

/// es.num.ordinal: 1º -> 1.º
fn ordinal(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&ORDINAL) {
        let (Some((a, b)), Some((x, y))) = (caps[0], caps[1]) else {
            continue;
        };
        if t.before(a) == Some('.') {
            continue;
        }
        out.fix(
            "es.num.ordinal",
            a,
            b,
            format!("{}.{}", t.slice(x, y), t.chars[b - 1]),
            "Las abreviaturas de los ordinales llevan punto: «1.º».",
        );
    }
}

/// es.num.percent: 10% -> 10 % (RAE) under es-ES, or where the document
/// mostly spaces it.
fn percent(t: &Text, ctx: &Ctx, out: &mut Out) {
    let spaced = ctx.profile.region_is("ES") || minority(ctx.stats.pct_tight, ctx.stats.pct_spaced);
    if !spaced {
        return;
    }
    for i in 1..t.len() {
        if t.chars[i] == '%' && t.chars[i - 1].is_ascii_digit() {
            out.fix(
                "es.num.percent",
                i - 1,
                i + 1,
                format!("{}\u{00A0}%", t.chars[i - 1]),
                "El signo de porcentaje se separa de la cifra con un espacio: «10 %».",
            );
        }
    }
}

static EX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b([Ee]x)-(\p{Ll}+)").unwrap());

/// es.word.ex: ex-presidente -> expresidente (ex-SS and multi-word bases stay).
fn ex(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&EX) {
        let (Some((a, b)), Some((p, q)), Some((x, y))) = (caps[0], caps[1], caps[2]) else {
            continue;
        };
        out.fix(
            "es.word.ex",
            a,
            b,
            format!("{}{}", t.slice(p, q), t.slice(x, y)),
            "El prefijo «ex-» se une a la palabra: «expresidente».",
        );
    }
}

static WORD_UNIT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|veinte|treinta|cuarenta|cincuenta|cien|mil)\s(?:km|kg|cm|mm|m|g|l|h|min|s)\b").unwrap()
});

/// es.num.word-unit: a number word with a unit symbol (veinte km).
fn word_unit(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&WORD_UNIT) {
        out.flag(
            "es.num.word-unit",
            a,
            b,
            "Con símbolos de unidad, la cantidad va en cifras: «20 km».",
        );
    }
}

/// es.dialogue.raya: a dialogue paragraph opening with - or – -> —, and no
/// space after the opening raya.
fn raya(t: &Text, ctx: &Ctx, out: &mut Out) {
    if matches!(ctx.block, super::Block::ListItem | super::Block::TableCell) || t.len() < 3 {
        return;
    }
    let (c, d) = (t.chars[0], t.chars[1]);
    if matches!(c, '-' | '–')
        && (d.is_alphabetic() || d == '¿' || d == '¡' || (d == ' ' && t.chars[2].is_alphabetic()))
    {
        let end = if d == ' ' { 2 } else { 1 };
        out.fix(
            "es.dialogue.raya",
            0,
            end,
            "—",
            "Los diálogos se abren con raya (—), sin espacio después.",
        );
    } else if c == '—' && d == ' ' {
        out.fix(
            "es.dialogue.raya",
            0,
            2,
            "—",
            "Tras la raya de diálogo no se deja espacio.",
        );
    }
}

#[cfg(test)]
mod tests;
