//! Russian rules. Never flagged: `?..` and `!..`, ё either way, `«В бой!».`
//! (a title that ends in ! inside a sentence).

use super::stats::minority;
use super::text::*;
use super::{Ctx, Out};
use regex::Regex;
use std::sync::LazyLock;

const NBSP: char = '\u{00A0}';

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    quote_style(t, ctx, out);
    period_outside(t, ctx, out);
    exclaim_period(t, ctx, out);
    dash(t, ctx, out);
    comma_dash(t, ctx, out);
    abbr(t, ctx, out);
    ending(t, ctx, out);
    unit(t, ctx, out);
    group(t, ctx, out);
    percent(t, ctx, out);
    dialogue(t, ctx, out);
}

/// ru.quote.style: straight or English quotes in prose -> «…»; quotes
/// inside «…» -> „…“.
fn quote_style(t: &Text, _ctx: &Ctx, out: &mut Out) {
    let msg = "В русском тексте кавычки «ёлочки», внутренние — „лапки“.";
    let marks: Vec<usize> = (0..t.len())
        .filter(|&i| t.chars[i] == '"' && !t.protected[i])
        .collect();
    if marks.len().is_multiple_of(2) {
        for pair in marks.chunks(2) {
            if t.chars[pair[0] + 1..pair[1]]
                .iter()
                .any(|&c| is_cyrillic(c))
            {
                out.fix("ru.quote.style", pair[0], pair[0] + 1, "«", msg);
                out.fix("ru.quote.style", pair[1], pair[1] + 1, "»", msg);
            }
        }
    }
    let mut i = 0;
    while i < t.len() {
        if t.chars[i] == '“' && t.before(i).is_none_or(|c| c.is_whitespace() || c == '(') {
            if let Some(j) = (i + 1..t.len()).find(|&j| t.chars[j] == '”') {
                out.fix("ru.quote.style", i, i + 1, "«", msg);
                out.fix("ru.quote.style", j, j + 1, "»", msg);
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    // «…«…»…»: the inner pair becomes „…“.
    let mut depth = 0;
    let mut inner_open: Option<usize> = None;
    for i in 0..t.len() {
        match t.chars[i] {
            '«' => {
                depth += 1;
                if depth == 2 {
                    inner_open = Some(i);
                }
            }
            '»' => {
                if depth == 2 {
                    if let Some(a) = inner_open.take() {
                        out.fix("ru.quote.style", a, a + 1, "„", msg);
                        out.fix("ru.quote.style", i, i + 1, "“", msg);
                    }
                }
                depth = (depth - 1).max(0);
            }
            _ => {}
        }
    }
}

/// ru.quote.period-outside: `.»` -> `».`, `,»` -> `»,`.
fn period_outside(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 1..t.len() {
        if t.chars[i] == '»' && matches!(t.chars[i - 1], '.' | ',') && t.before(i - 1) != Some('.')
        {
            let p = t.chars[i - 1];
            if t.at(i + 1) == Some(p) {
                out.fix(
                    "ru.quote.period-outside",
                    i - 1,
                    i + 1,
                    "»",
                    "Точка и запятая ставятся после закрывающей кавычки.",
                );
            } else {
                out.fix(
                    "ru.quote.period-outside",
                    i - 1,
                    i + 1,
                    format!("»{p}"),
                    "Точка и запятая ставятся после закрывающей кавычки.",
                );
            }
        }
    }
}

/// ru.quote.exclaim-period: `?».` `!».` - flag only: a title ending in !
/// inside a sentence (пьесу «В бой!».) is right.
fn exclaim_period(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in find_str(t, "?».").into_iter().chain(find_str(t, "!».")) {
        out.flag("ru.quote.exclaim-period", a, b, "Если в кавычках вопрос или восклицание, точка после кавычки обычно не нужна (кроме названий).");
    }
}

/// ru.punct.dash: " - " between words -> " — " with a no-break space
/// before it. Ranges between digits and minus signs stay.
fn dash(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 1..t.len().saturating_sub(1) {
        if matches!(t.chars[i], '-' | '–') && t.chars[i - 1] == ' ' && t.chars[i + 1] == ' ' {
            let l = t.chars[..i - 1].last().copied();
            let r = t.at(i + 2);
            if l.is_some_and(|c| c.is_alphabetic() || matches!(c, '»' | ')' | '"'))
                && r.is_some_and(|c| c.is_alphabetic() || c == '«')
            {
                out.fix(
                    "ru.punct.dash",
                    i - 1,
                    i + 1,
                    format!("{NBSP}—"),
                    "Тире — длинное (—), перед ним неразрывный пробел.",
                );
            }
        }
    }
}

/// ru.punct.comma-dash: `—,` -> `, —`.
fn comma_dash(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in find_str(t, "—,") {
        let a = if t.before(a) == Some(' ') { a - 1 } else { a };
        out.fix(
            "ru.punct.comma-dash",
            a,
            b,
            ", —",
            "Запятая ставится перед тире: «, —».",
        );
    }
}

/// ru.word.abbr: т.е. -> т. е., т.д., т.п., т.к., т.н. (no-break spaces).
fn abbr(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (from, to) in [
        ("т.е.", "т.\u{00A0}е."),
        ("т.д.", "т.\u{00A0}д."),
        ("т.п.", "т.\u{00A0}п."),
        ("т.к.", "т.\u{00A0}к."),
        ("т.н.", "т.\u{00A0}н."),
    ] {
        for (a, b) in find_str(t, from) {
            if t.before(a).is_some_and(char::is_alphabetic) {
                continue;
            }
            out.fix(
                "ru.word.abbr",
                a,
                b,
                to,
                format!(
                    "Сокращение пишется с пробелом: «{}».",
                    to.replace(NBSP, " ")
                ),
            );
        }
    }
}

static ENDING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d)-(ый|ой|ий|ая|ое|ого|ему|ому|ых|ым)\b").unwrap());

/// ru.num.ending: 5-ый, 2-ой, 5-ого, 3-ий -> 5-й, 2-й, 5-го, 3-й.
fn ending(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&ENDING) {
        let (Some((_, _)), Some((e1, e2))) = (caps[0], caps[2]) else {
            continue;
        };
        let short = match t.slice(e1, e2).as_str() {
            "ый" | "ой" | "ий" => "й",
            "ая" => "я",
            "ое" => "е",
            "ого" => "го",
            "ему" | "ому" => "му",
            "ых" => "х",
            "ым" => "м",
            _ => continue,
        };
        out.fix(
            "ru.num.ending",
            e1,
            e2,
            short,
            format!("Наращение после цифры — одна-две буквы: «-{short}»."),
        );
    }
}

static UNIT_TIGHT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d)(кг|км|см|мм|мл|кВт|Вт|ГБ|МБ|мин|ч|м|л)\b").unwrap());
static UNIT_PERIOD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d\s?(кг|км|см|мм|мл|мин)\.( \p{Ll})").unwrap());

/// ru.num.unit: 5кг -> 5 кг; кг. mid-sentence -> кг. (г. for a year is not
/// a unit; a sentence-final period stays.)
fn unit(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&UNIT_TIGHT) {
        let (Some((a, b)), Some((d, _)), Some((u1, u2))) = (caps[0], caps[1], caps[2]) else {
            continue;
        };
        out.fix(
            "ru.num.unit",
            a,
            b,
            format!("{}{NBSP}{}", t.chars[d], t.slice(u1, u2)),
            "Между числом и единицей измерения ставится пробел.",
        );
    }
    for caps in t.captures(&UNIT_PERIOD) {
        let Some((_, u2)) = caps[1] else { continue };
        out.fix(
            "ru.num.unit",
            u2,
            u2 + 1,
            "",
            "После обозначения единицы точка не ставится.",
        );
    }
}

static GROUPED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\d{1,3}(?:[.,]\d{3}){2,}\b|\b\d{2,3}\.\d{3}\b").unwrap());

/// ru.num.group: `1,000,000` or `10.000` as group separators -> no-break
/// spaces. `1,5` is a decimal: never.
fn group(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&GROUPED) {
        if t.before(a).is_some_and(|c| c.is_alphanumeric() || c == '.')
            || t.at(b).is_some_and(|c| c == '.' || c == ',')
                && t.at(b + 1).is_some_and(|c| c.is_ascii_digit())
        {
            continue;
        }
        let fixed: String = t.chars[a..b]
            .iter()
            .map(|&c| if c == '.' || c == ',' { NBSP } else { c })
            .collect();
        out.fix(
            "ru.num.group",
            a,
            b,
            fixed,
            "Разряды отделяются неразрывным пробелом.",
        );
    }
}

/// ru.num.percent: `80 %` and `80%` mixed in one document.
fn percent(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    let spaced_major = minority(s.pct_tight, s.pct_spaced);
    let tight_major = minority(s.pct_spaced, s.pct_tight);
    for i in 1..t.len() {
        if t.chars[i] != '%' {
            continue;
        }
        let prev = t.chars[i - 1];
        if spaced_major && prev.is_ascii_digit() {
            out.fix(
                "ru.num.percent",
                i - 1,
                i + 1,
                format!("{prev}{NBSP}%"),
                "Знак % в документе пишется то слитно, то раздельно.",
            );
        } else if tight_major
            && matches!(prev, ' ' | NBSP | '\u{202F}')
            && i >= 2
            && t.chars[i - 2].is_ascii_digit()
        {
            out.fix(
                "ru.num.percent",
                i - 2,
                i + 1,
                format!("{}%", t.chars[i - 2]),
                "Знак % в документе пишется то слитно, то раздельно.",
            );
        }
    }
}

/// ru.dialogue.dash: a dialogue paragraph opening with - or – -> "— ".
fn dialogue(t: &Text, ctx: &Ctx, out: &mut Out) {
    if matches!(ctx.block, super::Block::ListItem | super::Block::TableCell) || t.len() < 3 {
        return;
    }
    if matches!(t.chars[0], '-' | '–') && t.chars[1] == ' ' && is_cyrillic(t.chars[2]) {
        out.fix(
            "ru.dialogue.dash",
            0,
            2,
            "—\u{00A0}",
            "Реплика диалога начинается с тире (—).",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::super::Lang;

    const R: Lang = Lang::Ru;

    #[test]
    fn quotes() {
        assert_eq!(
            fixed("ru.quote.style", R, None, "Он сказал \"привет\" и “пока”."),
            "Он сказал «привет» и «пока»."
        );
        assert_eq!(
            fixed("ru.quote.style", R, None, "«Роман «Война и мир» хорош»"),
            "«Роман „Война и мир“ хорош»"
        );
        assert!(hits("ru.quote.style", R, None, "Файл \"config.json\" и `\"x\"`").is_empty());
        assert_eq!(
            fixed(
                "ru.quote.period-outside",
                R,
                None,
                "Он сказал «да.» Потом «нет,» и ушёл"
            ),
            "Он сказал «да». Потом «нет», и ушёл"
        );
        assert_eq!(
            hits("ru.quote.exclaim-period", R, None, "Он крикнул «Стой!».").len(),
            1
        );
    }

    #[test]
    fn dashes_abbreviations_and_numbers() {
        assert_eq!(
            fixed("ru.punct.dash", R, None, "Москва - столица."),
            "Москва\u{00A0}— столица."
        );
        assert!(hits("ru.punct.dash", R, None, "в 1990 - 1995 годах").is_empty());
        assert_eq!(
            fixed("ru.punct.comma-dash", R, None, "Он пришёл —, и всё"),
            "Он пришёл, — и всё"
        );
        assert_eq!(
            fixed("ru.word.abbr", R, None, "т.е. и т.д."),
            "т.\u{00A0}е. и т.\u{00A0}д."
        );
        assert_eq!(
            fixed("ru.num.ending", R, None, "5-ый, 2-ой, 5-ого, 3-ий"),
            "5-й, 2-й, 5-го, 3-й"
        );
        assert_eq!(
            fixed("ru.num.unit", R, None, "Вес 5кг, путь 10 км. и всё"),
            "Вес 5\u{00A0}кг, путь 10 км и всё"
        );
        assert!(hits("ru.num.unit", R, None, "В 2026 г. было 5 кг.").is_empty());
        assert_eq!(
            fixed("ru.num.group", R, None, "Всего 1,000,000 рублей"),
            "Всего 1\u{00A0}000\u{00A0}000 рублей"
        );
        assert!(hits("ru.num.group", R, None, "Это 1,5 литра").is_empty());
        assert_eq!(
            fixed("ru.dialogue.dash", R, None, "- Привет, — сказал он."),
            "—\u{00A0}Привет, — сказал он."
        );
    }

    #[test]
    fn never_flag_in_russian() {
        let text = "Неужели?.. Да!.. Ёлка и елка. Пьесу «В бой!» поставили.";
        let all = findings(R, None, text, super::super::Block::Paragraph);
        assert!(all.is_empty(), "{all:?}");
    }
}
