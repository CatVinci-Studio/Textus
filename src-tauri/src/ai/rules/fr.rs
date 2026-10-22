//! French rules (CATALOGUE.md §3.8). Spacing before ; : ! ? and inside
//! « » differs by country (fr-FR no-break spaces, fr-CA and fr-CH none
//! before ; ! ?, the EU none at all): Automatic follows the document's
//! majority and turns a breaking space into a no-break one. Never flagged:
//! either spelling of the 1990 rectifications, no space before ; ! ? in
//! fr-CA, fr-CH or EU texts, times such as 13:52.

use super::stats::minority;
use super::text::*;
use super::{Ctx, Out};
use regex::Regex;
use std::sync::LazyLock;

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    high_punct(t, ctx, out);
    ordinal(t, ctx, out);
    mr(t, ctx, out);
    euphonic_t(t, ctx, out);
    ligature(t, ctx, out);
    symbol_space(t, ctx, out);
    super::es::etc(
        t,
        "fr.punct.etc",
        "Après « etc. », pas de points de suspension.",
        out,
    );
    capital_accent(t, ctx, out);
    apostrophe(t, ctx, out);
    dialogue(t, ctx, out);
}

const NBSP: char = '\u{00A0}';
const NNBSP: char = '\u{202F}';

/// What goes before ; ! ? (and :) - None: nothing.
#[derive(Clone, Copy, PartialEq)]
enum Space {
    None,
    Thin,
    Full,
}

/// fr.space.high-punct: by the profile, else the document's majority. A
/// regular space before ; : ! ? or inside « » becomes a no-break space; a
/// missing one is added only when the document clearly spaces (or the
/// profile is fr-FR). Not times (13:52), URLs, emoticons, `?!` clusters.
fn high_punct(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    let spacing = ctx
        .profile
        .opt("fr.spacing")
        .map(str::to_string)
        .or_else(|| {
            ctx.profile.explicit.then(|| {
                match (ctx.profile.region.as_deref(), ctx.profile.preset.as_deref()) {
                    (_, Some("eu")) => "eu",
                    (Some("CA"), _) => "fr-CA",
                    (Some("CH"), _) => "fr-CH",
                    _ => "fr-FR",
                }
                .to_string()
            })
        });
    let spaced_count = s.fr_space + s.fr_nbsp + s.fr_nnbsp;
    // (before ; ! ?, before :, inside « »), None = leave as typed.
    let (semi, colon, guillemet): (Option<Space>, Option<Space>, Option<Space>) =
        match spacing.as_deref() {
            Some("fr-FR") => (Some(Space::Thin), Some(Space::Full), Some(Space::Thin)),
            Some("fr-CA") => (Some(Space::None), Some(Space::Full), Some(Space::Full)),
            Some("fr-CH") => (Some(Space::None), Some(Space::None), Some(Space::Full)),
            Some("eu") => (Some(Space::None), Some(Space::None), Some(Space::None)),
            _ => {
                if minority(s.fr_none, spaced_count) {
                    (Some(Space::Thin), Some(Space::Full), Some(Space::Thin))
                } else {
                    // No clear majority, or the document leaves no space: only
                    // a breaking space is wrong (it can wrap before the mark).
                    (None, None, None)
                }
            }
        };
    let thin_or = |want: Space| match want {
        Space::Thin => {
            // Keep the document's own no-break choice.
            if s.fr_nbsp > s.fr_nnbsp {
                NBSP
            } else {
                NNBSP
            }
        }
        _ => NBSP,
    };
    let msg_nb = "Devant ce signe, l’espace doit être insécable.";
    for i in 0..t.len() {
        let c = t.chars[i];
        let prev = t.before(i);
        let next = t.at(i + 1);
        let want = match c {
            ';' | '!' | '?' => semi,
            ':' => colon,
            _ => continue,
        };
        if prev.is_none() || matches!(prev, Some('!' | '?')) {
            continue;
        }
        if prev.is_some_and(|p| p.is_ascii_digit()) && next.is_some_and(|q| q.is_ascii_digit()) {
            continue; // 13:52
        }
        if matches!(next, Some(')' | '(' | 'D' | 'P' | '-' | '/'))
            || next.is_some_and(|q| q.is_alphanumeric())
        {
            continue; // emoticons, URLs, "http:", "C:"
        }
        let p = prev.unwrap();
        match (p, want) {
            (' ', Some(Space::None)) => out.fix(
                "fr.space.high-punct",
                i - 1,
                i + 1,
                c.to_string(),
                "Pas d’espace devant ce signe dans la convention choisie.",
            ),
            (' ', Some(w)) => out.fix(
                "fr.space.high-punct",
                i - 1,
                i + 1,
                format!("{}{c}", thin_or(w)),
                msg_nb,
            ),
            (' ', None) => out.fix(
                "fr.space.high-punct",
                i - 1,
                i + 1,
                format!(
                    "{}{c}",
                    if s.fr_nbsp > s.fr_nnbsp || c == ':' {
                        NBSP
                    } else {
                        NNBSP
                    }
                ),
                msg_nb,
            ),
            (NBSP | NNBSP, Some(Space::None)) => out.fix(
                "fr.space.high-punct",
                i - 1,
                i + 1,
                c.to_string(),
                "Pas d’espace devant ce signe dans la convention choisie.",
            ),
            (q, Some(w))
                if w != Space::None
                    && (q.is_alphanumeric() || matches!(q, '»' | ')' | '"' | '”')) =>
            {
                out.fix(
                    "fr.space.high-punct",
                    i,
                    i + 1,
                    format!("{}{c}", thin_or(w)),
                    "Devant ce signe, on met une espace insécable.",
                );
            }
            _ => {}
        }
    }
    // Inside « ».
    for i in 0..t.len() {
        let c = t.chars[i];
        let (inner, at) = match c {
            '«' => (t.at(i + 1), i + 1),
            '»' if i > 0 => (t.before(i), i - 1),
            _ => continue,
        };
        let Some(inner) = inner else { continue };
        match (inner, guillemet) {
            (' ', Some(Space::None)) => out.fix(
                "fr.space.high-punct",
                at,
                at + 1,
                "",
                "Pas d’espace à l’intérieur des guillemets dans la convention choisie.",
            ),
            (' ', _) => out.fix(
                "fr.space.high-punct",
                at,
                at + 1,
                NBSP.to_string(),
                "À l’intérieur des guillemets, l’espace doit être insécable.",
            ),
            (q, Some(w)) if w != Space::None && q.is_alphanumeric() => {
                let (a, b, to) = if c == '«' {
                    (i, i + 1, format!("«{}", thin_or(w)))
                } else {
                    (i, i + 1, format!("{}»", thin_or(w)))
                };
                out.fix(
                    "fr.space.high-punct",
                    a,
                    b,
                    to,
                    "À l’intérieur des guillemets, on met une espace insécable.",
                );
            }
            _ => {}
        }
    }
}

static ORDINAL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(\d+|[IVXLC]{2,})(ère|ere|ème|ième|è|eme)(s?)\b").unwrap());

/// fr.num.ordinal: 1ère -> 1re, 2ème/2ième/2è -> 2e (Nième, Xième: letters).
fn ordinal(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&ORDINAL) {
        let (Some((a, b)), Some((x, y)), Some((s1, s2)), Some((p1, p2))) =
            (caps[0], caps[1], caps[2], caps[3])
        else {
            continue;
        };
        let num = t.slice(x, y);
        let suffix = t.slice(s1, s2);
        let to = if (suffix == "ère" || suffix == "ere") && num == "1" {
            "re"
        } else {
            "e"
        };
        out.fix(
            "fr.num.ordinal",
            a,
            b,
            format!("{num}{to}{}", t.slice(p1, p2)),
            format!("Abréviation de l’ordinal : « {num}{to} »."),
        );
    }
}

static MR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\bMr\.?\s(\p{Lu})").unwrap());

/// fr.word.mr: Mr -> M. before a name (not in English quotations).
fn mr(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&MR) {
        let Some((a, _)) = caps[0] else { continue };
        let end = if t.at(a + 2) == Some('.') {
            a + 3
        } else {
            a + 2
        };
        if !t.in_quotes(a, end) {
            out.fix(
                "fr.word.mr",
                a,
                end,
                "M.",
                "En français, « Monsieur » s’abrège « M. ».",
            );
        }
    }
}

static EUPHONIC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"-t['’](il|elle|on|ils|elles)\b").unwrap());

/// fr.word.euphonic-t: a-t'il -> a-t-il.
fn euphonic_t(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&EUPHONIC) {
        let (Some((a, b)), Some((x, y))) = (caps[0], caps[1]) else {
            continue;
        };
        out.fix(
            "fr.word.euphonic-t",
            a,
            b,
            format!("-t-{}", t.slice(x, y)),
            "Le « t » euphonique s’écrit entre traits d’union : « a-t-il ».",
        );
    }
}

const LIGATURES: &[(&str, &str)] = &[
    ("coeur", "cœur"),
    ("coeurs", "cœurs"),
    ("oeuvre", "œuvre"),
    ("oeuvres", "œuvres"),
    ("soeur", "sœur"),
    ("soeurs", "sœurs"),
    ("oeil", "œil"),
    ("boeuf", "bœuf"),
    ("boeufs", "bœufs"),
    ("oeuf", "œuf"),
    ("oeufs", "œufs"),
    ("voeu", "vœu"),
    ("voeux", "vœux"),
    ("noeud", "nœud"),
    ("noeuds", "nœuds"),
    ("manoeuvre", "manœuvre"),
    ("moeurs", "mœurs"),
    ("choeur", "chœur"),
    ("oesophage", "œsophage"),
    ("oedème", "œdème"),
    ("rancoeur", "rancœur"),
    ("oecuménique", "œcuménique"),
];

/// fr.word.ligature: coeur -> cœur (coefficient, coexister are other words).
fn ligature(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (from, to) in LIGATURES {
        for (a, b) in find_word(t, from, true) {
            out.fix(
                "fr.word.ligature",
                a,
                b,
                match_case(&t.slice(a, b), to),
                format!("S’écrit avec la ligature : « {to} »."),
            );
        }
    }
}

static SYMBOL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d)(%|€|\$|£|(?:kg|km|cm|mm|g|m|l|h|min)\b)").unwrap());
/// An ordinary space a line can break at, before the two symbols no French
/// word starts with (unit letters after a space are too often words).
static SPACED_SYMBOL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\d) (%|€)").unwrap());

/// fr.num.symbol-space: 85%, 25€, 58kg - or 85 % with an ordinary space,
/// which a line can break at - -> a no-break space before the
/// symbol (fr-CH and the EU differ for %).
fn symbol_space(t: &Text, ctx: &Ctx, out: &mut Out) {
    let no_pct_space = ctx.profile.region_is("CH") || ctx.profile.is("eu");
    for caps in t.captures(&SYMBOL).chain(t.captures(&SPACED_SYMBOL)) {
        let (Some((a, b)), Some((d, _)), Some((u1, u2))) = (caps[0], caps[1], caps[2]) else {
            continue;
        };
        let unit = t.slice(u1, u2);
        if unit == "%" && no_pct_space {
            continue;
        }
        if t.at(b).is_some_and(|c| c == '-' || c.is_alphanumeric()) {
            continue;
        }
        out.fix(
            "fr.num.symbol-space",
            a,
            b,
            format!("{}{NBSP}{unit}", t.chars[d]),
            "Une espace insécable sépare le nombre du symbole.",
        );
    }
}

static A_START: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\bA (partir|cette|ce|la|l['’]|demain|bientôt|nouveau|propos|travers|côté|moins|peine|cause|condition|Paris|Lyon|Marseille|Montréal|Bruxelles|Genève)\b").unwrap()
});

/// fr.word.capital-accent: "A partir de" at a sentence start -> "À".
fn capital_accent(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, _) in t.find(&A_START) {
        if t.sentence_start(a) {
            out.fix(
                "fr.word.capital-accent",
                a,
                a + 1,
                "À",
                "Les majuscules gardent leurs accents : « À ».",
            );
        }
    }
}

/// fr.punct.apostrophe: ' and ’ mixed in one document.
fn apostrophe(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    let (from, to) = if minority(s.apos_straight, s.apos_curly) {
        ('\'', '’')
    } else if minority(s.apos_curly, s.apos_straight) {
        ('’', '\'')
    } else {
        return;
    };
    for i in 1..t.len().saturating_sub(1) {
        if t.chars[i] == from && t.chars[i - 1].is_alphabetic() && t.chars[i + 1].is_alphabetic() {
            out.fix(
                "fr.punct.apostrophe",
                i,
                i + 1,
                to.to_string(),
                "Apostrophes droites et typographiques mélangées dans le document.",
            );
        }
    }
}

/// fr.dialogue.dash: – and — mixed for speaker changes in one document.
fn dialogue(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    let (from, to) = if minority(s.dialogue_en, s.dialogue_em) {
        ('–', '—')
    } else if minority(s.dialogue_em, s.dialogue_en) {
        ('—', '–')
    } else {
        return;
    };
    if t.chars.first() == Some(&from) {
        out.fix(
            "fr.dialogue.dash",
            0,
            1,
            to.to_string(),
            "Tirets de dialogue différents dans le document.",
        );
    }
}

#[cfg(test)]
mod tests;
