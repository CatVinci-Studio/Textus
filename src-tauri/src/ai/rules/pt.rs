//! Portuguese rules, Brazilian by default, with the AO90 spelling on. Never
//! flagged: optional accents (amámos/amamos, fôrma/forma), pôde/pode, pôr/por.

use super::stats::minority;
use super::text::*;
use super::{Ctx, Out};
use regex::Regex;
use std::sync::LazyLock;

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    quote_style(t, ctx, out);
    pre_ao90(t, ctx, out);
    hyphen(t, ctx, out);
    ordinal(t, ctx, out);
    months(t, ctx, out);
    official(t, ctx, out);
    group(t, ctx, out);
}

/// pt.quote.style: quotes against the variant (pt-BR “ ”, pt-PT « »); in
/// Automatic only the minority system of the document.
fn quote_style(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    let to_guillemets = if ctx.profile.explicit {
        ctx.profile.region_is("PT")
    } else if minority(s.dq_curly, s.dq_guillemet) {
        true
    } else if minority(s.dq_guillemet, s.dq_curly) {
        false
    } else {
        return;
    };
    let (from_open, from_close, open, close, msg) = if to_guillemets {
        ('“', '”', "«", "»", "Em português europeu as aspas são « ».")
    } else {
        (
            '«',
            '»',
            "“",
            "”",
            "No português do Brasil as aspas são “ ”.",
        )
    };
    let mut i = 0;
    while i < t.len() {
        if t.chars[i] == from_open {
            if let Some(j) = (i + 1..t.len()).find(|&j| t.chars[j] == from_close) {
                out.fix("pt.quote.style", i, i + 1, open, msg);
                out.fix("pt.quote.style", j, j + 1, close, msg);
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
}

const PRE_AO90: &[(&str, &str)] = &[
    ("idéia", "ideia"),
    ("idéias", "ideias"),
    ("heróico", "heroico"),
    ("heróica", "heroica"),
    ("vôo", "voo"),
    ("vôos", "voos"),
    ("crêem", "creem"),
    ("lêem", "leem"),
    ("dêem", "deem"),
    ("vêem", "veem"),
    ("enjôo", "enjoo"),
    ("abençôo", "abençoo"),
    ("pára", "para"),
    ("pêlo", "pelo"),
    ("pólo", "polo"),
    ("lingüiça", "linguiça"),
    ("freqüente", "frequente"),
    ("freqüência", "frequência"),
    ("conseqüência", "consequência"),
    ("tranqüilo", "tranquilo"),
    ("agüentar", "aguentar"),
    ("cinqüenta", "cinquenta"),
    ("bilíngüe", "bilíngue"),
    ("assembléia", "assembleia"),
    ("européia", "europeia"),
    ("européias", "europeias"),
    ("jibóia", "jiboia"),
    ("estréia", "estreia"),
    ("platéia", "plateia"),
    ("colméia", "colmeia"),
    ("paranóico", "paranoico"),
    ("geléia", "geleia"),
    ("acção", "ação"),
    ("acções", "ações"),
    ("óptimo", "ótimo"),
    ("óptima", "ótima"),
    ("director", "diretor"),
    ("directora", "diretora"),
    ("actual", "atual"),
    ("actualmente", "atualmente"),
    ("colecção", "coleção"),
    ("direcção", "direção"),
    ("efectivo", "efetivo"),
    ("exacto", "exato"),
    ("exactamente", "exatamente"),
    ("correcto", "correto"),
    ("projecto", "projeto"),
    ("projectos", "projetos"),
    ("objectivo", "objetivo"),
    ("objectivos", "objetivos"),
    ("adopção", "adoção"),
    ("baptismo", "batismo"),
    ("eléctrico", "elétrico"),
    ("eléctrica", "elétrica"),
    ("selecção", "seleção"),
    ("protecção", "proteção"),
    ("acto", "ato"),
    ("actos", "atos"),
];

/// pt.spell.pre-ao90: spellings the 1990 agreement replaced (idéia, vôo,
/// lingüiça; acção, óptimo, director) - unless pt.ao90=off.
fn pre_ao90(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.opt("pt.ao90") == Some("off") {
        return;
    }
    for (old, new) in PRE_AO90 {
        for (a, b) in find_word(t, old, true) {
            out.fix(
                "pt.spell.pre-ao90",
                a,
                b,
                match_case(&t.slice(a, b), new),
                format!("Grafia anterior ao Acordo Ortográfico de 1990: «{new}»."),
            );
        }
    }
}

const HYPHENS: &[(&str, &str)] = &[
    ("anti-religioso", "antirreligioso"),
    ("anti-semita", "antissemita"),
    ("auto-escola", "autoescola"),
    ("auto-estrada", "autoestrada"),
    ("contra-regra", "contrarregra"),
    ("extra-escolar", "extraescolar"),
    ("mini-saia", "minissaia"),
    ("infra-estrutura", "infraestrutura"),
    ("semi-árido", "semiárido"),
    ("ultra-som", "ultrassom"),
    ("anti-social", "antissocial"),
    ("co-autor", "coautor"),
    ("hei-de", "hei de"),
    ("há-de", "há de"),
    ("hás-de", "hás de"),
    ("hão-de", "hão de"),
    ("fim-de-semana", "fim de semana"),
    ("dia-a-dia", "dia a dia"),
];

/// pt.spell.hyphen: the AO90 hyphenation list.
fn hyphen(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.opt("pt.ao90") == Some("off") {
        return;
    }
    for (old, new) in HYPHENS {
        for (a, b) in find_word(t, old, true) {
            out.fix(
                "pt.spell.hyphen",
                a,
                b,
                match_case(&t.slice(a, b), new),
                format!("Com o Acordo de 1990: «{new}»."),
            );
        }
    }
}

static DEGREE_ORDINAL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(\d{1,3})°").unwrap());

/// pt.num.ordinal: 1° (a degree sign) as an ordinal -> 1º (BR) or 1.º (PT).
/// Temperatures and angles stay.
fn ordinal(t: &Text, ctx: &Ctx, out: &mut Out) {
    const BEFORE: [&str; 12] = [
        "o", "a", "no", "na", "do", "da", "ao", "pelo", "pela", "os", "as", "em",
    ];
    const AFTER: [&str; 14] = [
        "lugar",
        "andar",
        "ano",
        "dia",
        "edição",
        "turno",
        "período",
        "semestre",
        "trimestre",
        "colocado",
        "capítulo",
        "artigo",
        "parágrafo",
        "grau",
    ];
    for caps in t.captures(&DEGREE_ORDINAL) {
        let (Some((a, b)), Some((x, y))) = (caps[0], caps[1]) else {
            continue;
        };
        if t.at(b).is_some_and(|c| matches!(c, 'C' | 'F' | 'c' | 'f')) {
            continue;
        }
        let prev_word = t
            .slice(0, a)
            .split_whitespace()
            .last()
            .map(str::to_lowercase)
            .unwrap_or_default();
        let next_word = t
            .slice(b, t.len())
            .split_whitespace()
            .next()
            .map(|w| w.trim_matches(|c: char| !c.is_alphabetic()).to_lowercase())
            .unwrap_or_default();
        if !(BEFORE.contains(&prev_word.as_str()) || AFTER.contains(&next_word.as_str()))
            || next_word.starts_with("graus")
            || next_word == "celsius"
        {
            continue;
        }
        let mark = if ctx.profile.region_is("PT") {
            ".º"
        } else {
            "º"
        };
        out.fix(
            "pt.num.ordinal",
            a,
            b,
            format!("{}{mark}", t.slice(x, y)),
            "O ordinal usa o indicador «º», não o símbolo de grau «°».",
        );
    }
}

const PT_MONTHS: &[&str] = &[
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado",
    "Domingo",
];

/// pt.word.months: capitalised months and weekdays mid-sentence (AO90).
fn months(t: &Text, _ctx: &Ctx, out: &mut Out) {
    super::es::capitalised_names(
        t,
        "pt.word.months",
        PT_MONTHS,
        "Com o Acordo de 1990, meses e dias da semana escrevem-se com minúscula.",
        out,
    );
}

static ADDRESS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(?:Vossa Excelência|Excelentíssim[oa]s?|Ilustríssim[oa]s?|Digníssim[oa]s?|Vossa Senhoria)\b|\b(?:Dr\.|Doutor[a]?)\s\p{Lu}").unwrap()
});
static PADDED_DATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b0(\d) de (?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)").unwrap()
});

/// pt-BR/official: forms of address the Decreto 9.758/2019 replaced with
/// "senhor/senhora", and 01 de janeiro -> 1º de janeiro.
fn official(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !(ctx.profile.is("official") && ctx.profile.region_is("BR")) {
        return;
    }
    for (a, b) in t.find(&ADDRESS) {
        out.flag(
            "pt.official.address",
            a,
            b,
            "O Decreto 9.758/2019 adota «senhor/senhora» como forma de tratamento.",
        );
    }
    for caps in t.captures(&PADDED_DATE) {
        let (Some((a, _)), Some((d1, d2))) = (caps[0], caps[1]) else {
            continue;
        };
        let day = t.slice(d1, d2);
        let to = if day == "1" { "1º".to_string() } else { day };
        out.fix(
            "pt.official.date",
            a,
            d2,
            to,
            "Datas oficiais sem zero à esquerda; o primeiro dia do mês é «1º».",
        );
    }
}

static GROUPED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\d{1,3}(?:([. \u{00A0}])\d{3})+\b").unwrap());

/// pt.num.group: `1.000` and `1 000` grouping mixed in one document.
fn group(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    let target = if minority(s.group_space, s.group_dot) {
        '.'
    } else if minority(s.group_dot, s.group_space) {
        '\u{00A0}'
    } else {
        return;
    };
    for caps in t.captures(&GROUPED) {
        let (Some((a, b)), Some((sep, _))) = (caps[0], caps[1]) else {
            continue;
        };
        let c = t.chars[sep];
        let is_space = c != '.';
        if b - a < 6 || (is_space == (target != '.')) {
            continue;
        }
        let fixed: String = t.chars[a..b]
            .iter()
            .map(|&ch| if ch == c { target } else { ch })
            .collect();
        out.fix(
            "pt.num.group",
            a,
            b,
            fixed,
            "Separador de milhares diferente do resto do documento.",
        );
    }
}

#[cfg(test)]
mod tests;
