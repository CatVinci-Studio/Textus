//! Rules for every language (CATALOGUE.md §3.1). Messages come from
//! messages/<code>.txt in the language of the text.

use super::messages;
use super::text::*;
use super::{Ctx, Lang, Out};
use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    nfc(t, ctx, out);
    space_before_punct(t, ctx, out);
    double_space(t, ctx, out);
    doubled_word(t, ctx, out);
    residue(t, ctx, out);
    library_name(t, ctx, out);
}

fn is_emoji(c: char) -> bool {
    matches!(c as u32, 0x1F000..=0x1FAFF | 0x2600..=0x27BF | 0x2B00..=0x2BFF) || c == '\u{FE0F}'
}

/// Conjoining Hangul vowels and finals: decomposed Korean syllables.
fn is_jamo_tail(c: char) -> bool {
    matches!(c, '\u{1160}'..='\u{11FF}')
}

/// Compatibility ideographs NFC would change: left to zh.compat-ideograph,
/// since Japanese names can depend on them.
fn is_compat_ideograph(c: char) -> bool {
    matches!(c, '\u{F900}'..='\u{FAFF}' | '\u{2F800}'..='\u{2FA1F}')
}

/// shared.nfc: invisible and control characters, and decomposed accents
/// or Hangul that NFC composes. A zero-width joiner inside an emoji
/// sequence is part of the emoji.
pub(crate) fn nfc(t: &Text, ctx: &Ctx, out: &mut Out) {
    let n = t.len();
    let mut i = 0;
    while i < n {
        let c = t.chars[i];
        let invisible = match c {
            '\u{200B}' | '\u{2060}' | '\u{FEFF}' | '\u{200E}' | '\u{200F}' => true,
            '\u{200D}' => !(t.before(i).is_some_and(is_emoji) && t.at(i + 1).is_some_and(is_emoji)),
            c if c.is_control() => !matches!(c, '\t' | '\n' | '\r'),
            _ => false,
        };
        if invisible {
            out.fix(
                "shared.nfc",
                i,
                i + 1,
                "",
                messages::get("shared.nfc.invisible", ctx.messages, &[]),
            );
            i += 1;
            continue;
        }
        // A base character and the combining marks after it.
        let mut j = i + 1;
        while j < n && (is_combining_mark(t.chars[j]) || is_jamo_tail(t.chars[j])) {
            j += 1;
        }
        if j > i + 1 && !t.chars[i..j].iter().any(|&c| is_compat_ideograph(c)) {
            let run: String = t.chars[i..j].iter().collect();
            let composed: String = run.nfc().collect();
            if composed != run {
                out.fix(
                    "shared.nfc",
                    i,
                    j,
                    composed,
                    messages::get("shared.nfc.compose", ctx.messages, &[]),
                );
            }
        }
        i = j;
    }
}

/// shared.space-before-punct: "word ," -> "word,". Not French (which
/// spaces before ; : ! ?), not ratios ("1 : 5"), emoticons, ellipses, or
/// marks that start a token (".NET", ":root").
fn space_before_punct(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !matches!(
        ctx.lang,
        Lang::En | Lang::Es | Lang::De | Lang::Ru | Lang::Pt | Lang::Ko
    ) {
        return;
    }
    let n = t.len();
    for i in 1..n {
        let c = t.chars[i];
        if !matches!(c, ',' | '.' | ';' | ':' | '?' | '!') {
            continue;
        }
        // Korean colons belong to ko.punct.colon-space.
        if ctx.lang == Lang::Ko && c == ':' {
            continue;
        }
        if t.chars[i - 1] != ' ' {
            continue;
        }
        let mut s = i - 1;
        while s > 0 && t.chars[s - 1] == ' ' {
            s -= 1;
        }
        if s == 0 {
            continue;
        }
        let before = t.chars[s - 1];
        if !(before.is_alphanumeric() || matches!(before, ')' | ']' | '"' | '”' | '’' | '»' | '“'))
        {
            continue;
        }
        let next = t.at(i + 1);
        if next.is_some_and(|q| {
            q.is_alphanumeric() || matches!(q, '.' | ')' | '(' | '-' | '/' | '\\' | '=' | '_' | '*')
        }) {
            continue;
        }
        if matches!(next, Some('D' | 'P' | 'p' | 'O' | 'o' | '3' | '|')) {
            continue;
        }
        // "1 : 5", "Halle 2 ; Stand 4": a mark between digits is a ratio or
        // a separator someone spaced on purpose.
        if before.is_ascii_digit() && matches!(c, ':' | ';') {
            continue;
        }
        if c == '.' && (t.before(i - (i - s)) == Some('.') || next == Some('.')) {
            continue;
        }
        out.fix(
            "shared.space-before-punct",
            s,
            i + 1,
            c.to_string(),
            messages::get("shared.space-before-punct", ctx.messages, &[]),
        );
    }
}

/// shared.double-space: two or more spaces between words. A typewriter's
/// two spaces after a sentence are the army correspondence preset's rule.
pub(crate) fn double_space(t: &Text, ctx: &Ctx, out: &mut Out) {
    let n = t.len();
    let mut i = 1;
    while i < n {
        if t.chars[i] == ' ' && t.chars[i - 1] != ' ' && !t.chars[i - 1].is_whitespace() {
            let mut j = i;
            while j < n && t.chars[j] == ' ' {
                j += 1;
            }
            let after_sentence = matches!(t.chars[i - 1], '.' | '?' | '!');
            if j - i >= 2
                && j < n
                && !t.chars[j].is_whitespace()
                && !(after_sentence && ctx.profile.is("army"))
            {
                let from = i - 1;
                let to = j + 1;
                let fixed = format!("{} {}", t.chars[i - 1], t.chars[j]);
                out.fix(
                    "shared.double-space",
                    from,
                    to,
                    fixed,
                    messages::get("shared.double-space", ctx.messages, &[]),
                );
            }
            i = j;
        } else {
            i += 1;
        }
    }
}

/// Doubled words that are grammatical or idiomatic, per language.
fn doubling_allowed(lang: Lang, word: &str) -> bool {
    let list: &[&str] = match lang {
        Lang::En => &[
            "had", "that", "is", "do", "does", "did", "very", "so", "no", "ha", "bye", "now",
            "there", "really", "far", "knock", "tut", "chop", "boo", "hush", "pom", "yeah",
        ],
        Lang::Fr => &["nous", "vous", "si"],
        Lang::De => &["das", "die", "der", "sie", "es", "den"],
        Lang::Es => &["que", "se"],
        Lang::Pt => &["que", "se"],
        Lang::Ru => &["что", "так", "да", "нет"],
        _ => &[],
    };
    list.contains(&word)
}

/// shared.doubled-word: "the the" -> "the" (Latin and Cyrillic scripts
/// only; reduplication is grammar in Chinese and Japanese). Suggest only.
fn doubled_word(t: &Text, ctx: &Ctx, out: &mut Out) {
    if matches!(ctx.lang, Lang::ZhHans | Lang::ZhHant | Lang::Ja | Lang::Ko) {
        return;
    }
    let words = t.words();
    for pair in words.windows(2) {
        let ((a1, b1), (a2, b2)) = (pair[0], pair[1]);
        if !t.chars[b1..a2].iter().all(|&c| c == ' ') || a2 == b1 {
            continue;
        }
        let w1 = t.slice(a1, b1);
        let w2 = t.slice(a2, b2);
        if w1.to_lowercase() != w2.to_lowercase() {
            continue;
        }
        let alphabetic = w1
            .chars()
            .all(|c| is_latin_letter(c) || is_cyrillic(c) || c == '\'' || c == '’');
        if !alphabetic || doubling_allowed(ctx.lang, &w1.to_lowercase()) {
            continue;
        }
        // "Bora Bora", "Sing Sing": a capitalised pair is a name.
        let cap = |w: &str| w.chars().next().is_some_and(char::is_uppercase);
        if cap(&w1) && cap(&w2) {
            continue;
        }
        out.fix(
            "shared.doubled-word",
            a1,
            b2,
            w1.clone(),
            messages::get("shared.doubled-word", ctx.messages, &[&w1]),
        );
    }
}

const RESIDUE_PHRASES: &[&str] = &[
    "as an ai language model",
    "as an ai model",
    "as a large language model",
    "i hope this helps",
    "let me know if you'd like",
    "let me know if you would like",
    "certainly! here",
    "sure! here",
    "here is the revised",
    "here's the revised",
    "希望这对您有帮助",
    "希望对你有所帮助",
    "希望对您有所帮助",
    "希望这能帮到你",
    "希望這對您有幫助",
    "作为一个ai语言模型",
    "作为一个人工智能",
    "作為一個人工智慧",
    "以下是修改后的",
    "以下是修改後的",
    "ai 언어 모델로서",
    "como modelo de lenguaje",
    "en tant que modèle de langage",
    "als ki-sprachmodell",
    "как языковая модель",
    "como um modelo de linguagem",
];

static PLACEHOLDER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\[(?:your|insert|company|recipient|date|name|first name|last name|title|address|phone|email)[^\]\n]{0,30}\]|\b(?:INSERT|PLACEHOLDER)_[A-Z_]+\b|\b(?:20[0-9X]{2}|XXXX)-XX-XX\b|[［\[](?:您的|你的|貴方の|あなたの)?(?:姓名|名字|名前|公司名称|公司名稱|会社名|日期|日付|联系方式|聯絡方式)[］\]]|XXXX年XX月XX日|20XX年|○○年○○月○○日").unwrap()
});

/// shared.residue: chatbot phrases and placeholders left in body text.
/// Quoted text is someone talking about the phrase, not residue. A blank
/// in full-width brackets (【开幕日期】) is not residue: the Agent writes
/// unknown facts that way on purpose, for the author to fill in one click.
fn residue(t: &Text, ctx: &Ctx, out: &mut Out) {
    let lower: Vec<char> = t.chars.iter().flat_map(|c| c.to_lowercase()).collect();
    if lower.len() == t.len() {
        for phrase in RESIDUE_PHRASES {
            let p: Vec<char> = phrase.chars().collect();
            if p.len() > lower.len() {
                continue;
            }
            for i in 0..=lower.len() - p.len() {
                if lower[i..i + p.len()] == p[..] && !t.in_quotes(i, i + p.len()) {
                    out.flag(
                        "shared.residue",
                        i,
                        i + p.len(),
                        messages::get("shared.residue", ctx.messages, &[]),
                    );
                }
            }
        }
    }
    for (a, b) in t.find(&PLACEHOLDER_RE) {
        if !t.in_quotes(a, b) {
            out.flag(
                "shared.residue",
                a,
                b,
                messages::get("shared.residue", ctx.messages, &[]),
            );
        }
    }
}

fn edit_distance(a: &[char], b: &[char]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut cur = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            let sub = prev[j] + usize::from(ca != cb);
            cur.push(sub.min(prev[j + 1] + 1).min(cur[j] + 1));
        }
        prev = cur;
    }
    prev[b.len()]
}

/// shared.library-name: a near miss of a library name - "Elisabeth" for
/// "Elizabeth", "林黛王" for "林黛玉". Latin names of four or more
/// letters, capitalised words with the same first letter, within one edit
/// (two for names over six letters); Chinese names of three characters,
/// with the surname right and one other character different.
fn library_name(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.library.is_empty() {
        return;
    }
    let known: Vec<String> = ctx.library.iter().map(|n| n.to_lowercase()).collect();
    let words = t.words();
    for name in ctx.library {
        let nc: Vec<char> = name.chars().collect();
        if nc.len() >= 4 && nc.iter().all(|c| is_latin_letter(*c)) && nc[0].is_uppercase() {
            let max = if nc.len() > 6 { 2 } else { 1 };
            for &(a, b) in &words {
                let mut w: Vec<char> = t.chars[a..b].to_vec();
                if w.len() > 2 && matches!(w[w.len() - 2], '\'' | '’') && w[w.len() - 1] == 's' {
                    w.truncate(w.len() - 2);
                }
                let wl: String = w.iter().collect::<String>().to_lowercase();
                if w.len() < 3
                    || !w[0].is_uppercase()
                    || w[0] != nc[0]
                    || known.contains(&wl)
                    || w.len().abs_diff(nc.len()) > max
                {
                    continue;
                }
                let d = edit_distance(
                    &w.iter().flat_map(|c| c.to_lowercase()).collect::<Vec<_>>(),
                    &nc.iter().flat_map(|c| c.to_lowercase()).collect::<Vec<_>>(),
                );
                if d >= 1 && d <= max {
                    out.fix(
                        "shared.library-name",
                        a,
                        a + w.len(),
                        name.clone(),
                        messages::get("shared.library-name", ctx.messages, &[name]),
                    );
                }
            }
        } else if nc.len() == 3 && nc.iter().all(|&c| is_han(c)) {
            let n = t.len();
            if n < 3 {
                continue;
            }
            for i in 0..=n - 3 {
                let w = &t.chars[i..i + 3];
                if !w.iter().all(|&c| is_han(c)) || w[0] != nc[0] {
                    continue;
                }
                let diff = (0..3).filter(|&k| w[k] != nc[k]).count();
                let ws: String = w.iter().collect();
                if diff == 1
                    && !known.contains(&ws)
                    && find_str(t, name).iter().all(|&(a, b)| b <= i || a >= i + 3)
                {
                    out.fix(
                        "shared.library-name",
                        i,
                        i + 3,
                        name.clone(),
                        messages::get("shared.library-name", ctx.messages, &[name]),
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::super::Lang;

    #[test]
    fn nfc_strips_invisibles_and_composes_but_keeps_emoji_joiners() {
        assert_eq!(
            fixed(
                "shared.nfc",
                Lang::En,
                None,
                "zero\u{200B}width and e\u{301}t\u{e9}"
            ),
            "zerowidth and \u{e9}t\u{e9}"
        );
        // ZWJ inside a family emoji stays; a stray one goes.
        let family = "the 👩\u{200D}👩\u{200D}👧 emoji";
        assert!(hits("shared.nfc", Lang::En, None, family).is_empty());
        assert_eq!(fixed("shared.nfc", Lang::En, None, "a\u{200D}b"), "ab");
        // Decomposed Hangul composes.
        assert_eq!(
            fixed("shared.nfc", Lang::Ko, None, "\u{1112}\u{1161}\u{11AB}글"),
            "한글"
        );
        // Compatibility ideographs are zh.compat-ideograph's, not NFC's here.
        assert!(hits("shared.nfc", Lang::Ja, None, "\u{FA19}社").is_empty());
    }

    #[test]
    fn spaces_before_punctuation_go_except_where_they_belong() {
        assert_eq!(
            fixed(
                "shared.space-before-punct",
                Lang::En,
                None,
                "Hello , world ! Is it ?"
            ),
            "Hello, world! Is it?"
        );
        assert_eq!(
            fixed(
                "shared.space-before-punct",
                Lang::Ru,
                None,
                "Да , конечно ."
            ),
            "Да, конечно."
        );
        for ok in [
            "Le prix : dix euros ; voilà !",
            "Ratio 1 : 5 and smile :) or :D",
            "Use .NET and the :root selector",
            "Wait ... what",
        ] {
            let lang = if ok.starts_with("Le") {
                Lang::Fr
            } else {
                Lang::En
            };
            assert!(
                hits("shared.space-before-punct", lang, None, ok).is_empty(),
                "{ok}"
            );
        }
        // Korean colons are ko.punct.colon-space's.
        assert!(hits("shared.space-before-punct", Lang::Ko, None, "장소 : 광화문").is_empty());
        assert_eq!(
            fixed("shared.space-before-punct", Lang::Ko, None, "좋습니다 ."),
            "좋습니다."
        );
    }

    #[test]
    fn double_spaces_and_the_army_exception() {
        assert_eq!(
            fixed("shared.double-space", Lang::En, None, "two  spaces here"),
            "two spaces here"
        );
        assert!(hits(
            "shared.double-space",
            Lang::En,
            Some("en-US/army"),
            "End.  Next sentence."
        )
        .is_empty());
        assert_eq!(
            hits("shared.double-space", Lang::En, Some("en-US/army"), "a  b").len(),
            1
        );
    }

    #[test]
    fn doubled_words_with_their_guards() {
        assert_eq!(
            hits(
                "shared.doubled-word",
                Lang::En,
                None,
                "Check the the value."
            ),
            one("the the", "the")
        );
        assert_eq!(
            hits("shared.doubled-word", Lang::Es, None, "Es de de verdad."),
            one("de de", "de")
        );
        for ok in [
            "She had had enough.",
            "He said that that was fine.",
            "We flew to Bora Bora.",
            "the end. The next",
        ] {
            assert!(
                hits("shared.doubled-word", Lang::En, None, ok).is_empty(),
                "{ok}"
            );
        }
        assert!(hits(
            "shared.doubled-word",
            Lang::De,
            None,
            "Ich weiß, dass das das Beste ist."
        )
        .is_empty());
        assert!(hits(
            "shared.doubled-word",
            Lang::Fr,
            None,
            "Nous nous levons tôt."
        )
        .is_empty());
        // Never in CJK: 常常, 看看 are grammar.
        assert!(hits(
            "shared.doubled-word",
            Lang::ZhHans,
            None,
            "我常常 常常去看看。"
        )
        .is_empty());
    }

    #[test]
    fn a_blank_to_fill_is_not_residue() {
        assert!(hits(
            "shared.residue",
            Lang::ZhHans,
            None,
            "展览将于【开幕日期】在【场馆】开幕，联系【联系方式】。"
        )
        .is_empty());
        // The square-bracket chatbot form still is.
        assert_eq!(
            hits("shared.residue", Lang::ZhHans, None, "请联系[联系方式]。").len(),
            1
        );
    }

    #[test]
    fn residue_but_not_when_quoted() {
        assert_eq!(
            hits(
                "shared.residue",
                Lang::En,
                None,
                "The plan is ready. I hope this helps!"
            )
            .len(),
            1
        );
        assert_eq!(
            hits(
                "shared.residue",
                Lang::En,
                None,
                "Best regards, [Your Name]"
            )
            .len(),
            1
        );
        assert_eq!(
            hits(
                "shared.residue",
                Lang::ZhHans,
                None,
                "会议定于 2025-XX-XX 举行。希望这对您有帮助！"
            )
            .len(),
            2
        );
        assert!(hits(
            "shared.residue",
            Lang::En,
            None,
            "Never end with “I hope this helps” in a report."
        )
        .is_empty());
    }

    #[test]
    fn near_misses_of_library_names() {
        assert_eq!(
            hits(
                "shared.library-name",
                Lang::En,
                None,
                "Then Elisabeth left."
            ),
            one("Elisabeth", "Elizabeth")
        );
        assert_eq!(
            hits("shared.library-name", Lang::En, None, "Elizbeth's coat."),
            one("Elizbeth", "Elizabeth")
        );
        assert!(hits(
            "shared.library-name",
            Lang::En,
            None,
            "Elizabeth and Edinburgh."
        )
        .is_empty());
        assert_eq!(
            hits("shared.library-name", Lang::ZhHans, None, "林黛王走进来。"),
            one("林黛王", "林黛玉")
        );
        assert!(hits(
            "shared.library-name",
            Lang::ZhHans,
            None,
            "林黛玉走进来，林子里很静。"
        )
        .is_empty());
    }
}
