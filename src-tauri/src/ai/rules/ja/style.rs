//! Japanese style: polite and plain forms mixed, ra-nuki, repeated
//! particles, double negatives, redundancy, long sentences, double
//! honorifics and spelling variants.

use super::*;

pub(crate) static DESU_END: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:です|ます|でした|ました|ません|でしょう|ましょう)[。！？]").unwrap()
});

pub(crate) static DEARU_END: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:である|であった|ではない|だった|のだ|なのだ)[。！？]").unwrap()
});

/// ja.style.register-mix: です・ます and である in one document's body -
/// the minority's sentence endings flagged. Not quotations, list items or
/// headings.
pub(crate) fn register_mix(t: &Text, ctx: &Ctx, out: &mut Out) {
    if matches!(
        ctx.block,
        Block::Heading(_) | Block::ListItem | Block::TableCell | Block::Quote
    ) {
        return;
    }
    let s = ctx.stats;
    let (re, msg) = if minority(s.ja_desu, s.ja_dearu) {
        (
            &*DESU_END,
            "です・ます調とである調が混在しています（本文の多くは「である」調）。",
        )
    } else if minority(s.ja_dearu, s.ja_desu) {
        (
            &*DEARU_END,
            "です・ます調とである調が混在しています（本文の多くは「です・ます」調）。",
        )
    } else {
        return;
    };
    for (a, b) in t.find(re) {
        if !t.in_quotes(a, b) {
            out.flag("ja.style.register-mix", a, b - 1, msg);
        }
    }
}

pub(crate) const RANUKI_STEMS: &[&str] = &[
    "見", "来", "食べ", "寝", "着", "出", "起き", "決め", "考え", "信じ", "変え", "投げ", "降り",
    "借り", "浴び", "答え", "教え",
];

/// ja.word.ranuki: ら抜き言葉 from a closed list (見れる -> 見られる). Not
/// 見れば (a conditional), not in dialogue or fiction.
pub(crate) fn ranuki(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.is("fiction") {
        return;
    }
    for stem in RANUKI_STEMS {
        let needle = format!("{stem}れ");
        for (a, b) in find_str(t, &needle) {
            let rest: String = t.chars[b..].iter().take(4).collect();
            let conj = ["る", "ない", "ます", "ません", "た", "なかった", "て"]
                .iter()
                .any(|s| rest.starts_with(s));
            // 出れ in 出れる only after a word boundary: 思い出れ is not.
            let joined = t
                .before(a)
                .is_some_and(|c| is_han(c) || c == 'い' && *stem == "出");
            if conj && !joined && !t.in_quotes(a, b) {
                out.fix(
                    "ja.word.ranuki",
                    a,
                    b,
                    format!("{stem}られ"),
                    format!("ら抜き言葉です。「{stem}られ…」が標準的です。"),
                );
            }
        }
    }
}

/// ja.style.no-repeat: three or more の in one clause.
pub(crate) fn no_repeat(t: &Text, _ctx: &Ctx, out: &mut Out) {
    let mut start = 0;
    for i in 0..=t.len() {
        if i == t.len()
            || matches!(
                t.chars[i],
                '、' | '。' | '，' | '．' | '！' | '？' | '「' | '」'
            )
        {
            // The particle の follows a noun: not the の of その, この,
            // どの, もの (after hiragana).
            let count = (start..i)
                .filter(|&k| {
                    t.chars[k] == 'の'
                        && k > 0
                        && !matches!(t.chars[k - 1], '\u{3041}'..='\u{309F}')
                })
                .count();
            if count >= 3 {
                out.flag(
                    "ja.style.no-repeat",
                    start,
                    i,
                    "「の」が三回以上続いています。言い換えを検討してください。",
                );
            }
            start = i + 1;
        }
    }
}

pub(crate) static DOUBLE_NEG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"ないわけではない|なくはない|ないこともない|ないとは言えない|ないではない").unwrap()
});

/// ja.style.double-negative.
pub(crate) fn double_negative(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&DOUBLE_NEG) {
        out.flag(
            "ja.style.double-negative",
            a,
            b,
            "二重否定は意味が取りにくくなります。",
        );
    }
}

pub(crate) static ABOUT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"約[^。、]{1,10}?(?:くらい|ぐらい|ほど|程度)").unwrap());

pub(crate) static EACH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"各[^。、]{1,10}?ごとに").unwrap());

pub(crate) static NTH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"第\d+(?:番|回|日|位)目").unwrap());

/// ja.word.redundant: することができる, 約…くらい, 各…ごとに, 第…目.
pub(crate) fn redundant(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in find_str(t, "することができ") {
        out.fix(
            "ja.word.redundant",
            a,
            b,
            "でき",
            "「することができる」は「できる」で十分です。",
        );
    }
    for (a, b) in t.find(&ABOUT).chain(t.find(&EACH)) {
        out.flag(
            "ja.word.redundant",
            a,
            b,
            "意味が重なっています（「約」と「くらい」、「各」と「ごとに」）。どちらかで十分です。",
        );
    }
    for (_, b) in t.find(&NTH) {
        out.fix(
            "ja.word.redundant",
            b - 1,
            b,
            "",
            "「第…目」は意味が重なっています。「目」を取ります。",
        );
    }
}

/// ja.style.sentence-length: over the profile's limit (100, 公用文 60).
pub(crate) fn sentence_length(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.is("fiction") || ctx.block.is_heading() {
        return;
    }
    let limit = if ctx.profile.is("koyobun") { 60 } else { 100 };
    let mut start = 0;
    for i in 0..=t.len() {
        if i == t.len() || matches!(t.chars[i], '。' | '！' | '？' | '．') {
            let len = t.chars[start..i]
                .iter()
                .filter(|c| !c.is_whitespace())
                .count();
            if len > limit && !t.in_quotes(start, i) {
                out.flag(
                    "ja.style.sentence-length",
                    start,
                    i,
                    format!(
                        "一文が長すぎます（{len}文字）。{limit}文字以内を目安に分けてください。"
                    ),
                );
            }
            start = i + 1;
        }
    }
}

pub(crate) static DOUBLE_HONORIFIC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[おご御][\p{Han}\p{Hiragana}]{1,6}?になられ").unwrap());

/// ja.keigo.patterns: double honorifics (お〜になられる) and させていただく
/// three or more times in a passage.
pub(crate) fn keigo(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&DOUBLE_HONORIFIC) {
        out.flag(
            "ja.keigo.patterns",
            a,
            b,
            "二重敬語です。「お〜になる」で十分です。",
        );
    }
    let uses = find_str(t, "させていただ");
    if uses.len() >= 3 {
        for &(a, b) in &uses[2..] {
            out.flag(
                "ja.keigo.patterns",
                a,
                b,
                "「させていただく」が多用されています。",
            );
        }
    }
}

/// ja.word.okurigana and ja.word.kodomo: two spellings of one word in a
/// document (取り扱い/取扱い, 子ども/子供) - the minority flagged.
pub(crate) fn variants(t: &Text, ctx: &Ctx, out: &mut Out) {
    let v = &ctx.stats.variants;
    for (family, forms) in JA_VARIANTS {
        let counts: Vec<usize> = forms
            .iter()
            .map(|f| v.get(f).copied().unwrap_or(0))
            .collect();
        let (best, &top) = counts
            .iter()
            .enumerate()
            .max_by_key(|x| (*x.1, std::cmp::Reverse(x.0)))
            .unwrap();
        if counts.iter().filter(|&&c| c > 0).count() < 2
            || counts.iter().filter(|&&c| c == top).count() > 1
        {
            continue;
        }
        let rule = if *family == "子ども" {
            "ja.word.kodomo"
        } else {
            "ja.word.okurigana"
        };
        for (k, form) in forms.iter().enumerate() {
            if k == best {
                continue;
            }
            for (a, b) in find_str(t, form) {
                out.fix(
                    rule,
                    a,
                    b,
                    forms[best],
                    format!("表記が混在しています（本文の多くは「{}」）。", forms[best]),
                );
            }
        }
    }
}
