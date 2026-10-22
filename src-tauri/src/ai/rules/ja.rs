//! Japanese rules (CATALOGUE.md §3.5), JTF style by default (ja/jtf),
//! with the 公用文 (koyobun), fiction and technical-writing profiles.
//! Never flagged: a missing space between Japanese and Latin text,
//! 「とんでもございません」 deflecting praise, a single … or ― in 公用文,
//! ！？ in fiction or headings. Spaces are never inserted.

use super::stats::{minority, JA_VARIANTS};
use super::text::*;
use super::{Block, Ctx, Out};
use regex::Regex;
use std::sync::LazyLock;
use unicode_normalization::UnicodeNormalization;

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    width_kana(t, ctx, out);
    halfwidth(t, ctx, out);
    width_alnum(t, ctx, out);
    space_typed(t, ctx, out);
    space_fullwidth(t, ctx, out);
    after_exclaim(t, ctx, out);
    tilde(t, ctx, out);
    counter(t, ctx, out);
    dots_dash(t, ctx, out);
    single_leader(t, ctx, out);
    register_mix(t, ctx, out);
    ranuki(t, ctx, out);
    no_repeat(t, ctx, out);
    double_negative(t, ctx, out);
    redundant(t, ctx, out);
    sentence_length(t, ctx, out);
    period_bracket(t, ctx, out);
    keigo(t, ctx, out);
    choon(t, ctx, out);
    variants(t, ctx, out);
    kanji_digit(t, ctx, out);
}

/// Japanese running text: kana, kanji, Japanese punctuation and brackets.
fn is_ja(c: char) -> bool {
    is_cjk(c) || is_fullwidth_punct(c) || matches!(c, 'ー' | '々' | '〆' | '…' | '―')
}

/// ja.width.kana: half-width katakana -> full-width (voiced marks joined).
fn width_kana(t: &Text, _ctx: &Ctx, out: &mut Out) {
    let n = t.len();
    let mut i = 0;
    while i < n {
        if !is_halfwidth_kana(t.chars[i]) {
            i += 1;
            continue;
        }
        let a = i;
        while i < n && is_halfwidth_kana(t.chars[i]) {
            i += 1;
        }
        let full: String = t.slice(a, i).nfkc().collect();
        out.fix("ja.width.kana", a, i, full, "半角カタカナは全角にします。");
    }
}

/// ja.punct.halfwidth: half-width , . ! ? in Japanese -> 、。！？ (or ，．
/// when the document writes those), and 、。 / ，． mixed -> the majority.
fn halfwidth(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    let comma = if minority(s.ja_touten, s.ja_comma) {
        '，'
    } else {
        '、'
    };
    let period = if minority(s.ja_kuten, s.ja_period) {
        '．'
    } else {
        '。'
    };
    let msg = "日本語の文では全角の句読点を使います。";
    for i in 0..t.len() {
        let c = t.chars[i];
        let Some(prev) = t.before(i) else { continue };
        let prev_ja = is_cjk(prev) || matches!(prev, '」' | '』' | '）' | 'ー');
        match c {
            ',' | '.' | '!' | '?' if prev_ja => {
                let next = t.at(i + 1);
                if c == '.' && next == Some('.') {
                    continue;
                }
                let mut j = i + 1;
                while j < t.len() && t.chars[j] == ' ' {
                    j += 1;
                }
                let after = t.at(j);
                let ok = after.is_none_or(|q| is_ja(q) || matches!(q, '「' | '『' | '（'));
                if !ok {
                    continue;
                }
                let full = match c {
                    ',' => comma,
                    '.' => period,
                    '!' => '！',
                    _ => '？',
                };
                let end = if after.is_some() { j } else { i + 1 };
                out.fix("ja.punct.halfwidth", i, end, full.to_string(), msg);
            }
            '、' if comma == '，' => out.fix(
                "ja.punct.halfwidth",
                i,
                i + 1,
                "，",
                "読点の書き方が混在しています（本文の多くは「，」）。",
            ),
            '，' if comma == '、' && minority(s.ja_comma, s.ja_touten) => out.fix(
                "ja.punct.halfwidth",
                i,
                i + 1,
                "、",
                "読点の書き方が混在しています（本文の多くは「、」）。",
            ),
            '。' if period == '．' => out.fix(
                "ja.punct.halfwidth",
                i,
                i + 1,
                "．",
                "句点の書き方が混在しています（本文の多くは「．」）。",
            ),
            '．' if period == '。' && minority(s.ja_period, s.ja_kuten) => out.fix(
                "ja.punct.halfwidth",
                i,
                i + 1,
                "。",
                "句点の書き方が混在しています（本文の多くは「。」）。",
            ),
            _ => {}
        }
    }
}

/// ja.width.alnum: full-width digits and letters -> half-width (公用文
/// keeps full-width initialisms such as ＱＯＬ).
fn width_alnum(t: &Text, ctx: &Ctx, out: &mut Out) {
    let koyobun = ctx.profile.is("koyobun");
    let fw =
        |c: char| matches!(c, '０'..='９') || (!koyobun && matches!(c, 'Ａ'..='Ｚ' | 'ａ'..='ｚ'));
    let n = t.len();
    let mut i = 0;
    while i < n {
        if !fw(t.chars[i]) {
            i += 1;
            continue;
        }
        let a = i;
        while i < n && fw(t.chars[i]) {
            i += 1;
        }
        let half: String = t.chars[a..i]
            .iter()
            .map(|&c| char::from_u32(c as u32 - 0xFEE0).unwrap_or(c))
            .collect();
        out.fix("ja.width.alnum", a, i, half, "全角の英数字は半角にします。");
    }
}

/// ja.space.typed: a typed space between Japanese and Latin text -> none
/// (JTF) - unless the document clearly spaces them throughout. Spaces
/// inside a Latin phrase (Visual Studio Code) aren't boundaries.
fn space_typed(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    // A chosen profile (JTF, 公用文, technical, fiction) removes the spaces;
    // Automatic only where the document's majority is unspaced - many
    // Japanese technical texts space Latin terms on purpose.
    if !ctx.profile.explicit && !minority(s.cjk_latin_spaced, s.cjk_latin_tight) {
        return;
    }
    for i in 1..t.len().saturating_sub(1) {
        if t.chars[i] != ' ' {
            continue;
        }
        let (p, q) = (t.chars[i - 1], t.chars[i + 1]);
        if (is_cjk(p) && is_latin_or_digit(q)) || (is_latin_or_digit(p) && is_cjk(q)) {
            out.fix(
                "ja.space.typed",
                i - 1,
                i + 2,
                format!("{p}{q}"),
                "和文と欧文の間にスペースは入れません。",
            );
        }
    }
}

/// ja.space.fullwidth: a space between Japanese characters or beside a
/// bracket -> none; the full-width space after ？！ stays.
fn space_fullwidth(t: &Text, _ctx: &Ctx, out: &mut Out) {
    let n = t.len();
    let mut i = 1;
    while i < n {
        if !matches!(t.chars[i], ' ' | '\u{3000}') {
            i += 1;
            continue;
        }
        let a = i;
        while i < n && matches!(t.chars[i], ' ' | '\u{3000}') {
            i += 1;
        }
        if i >= n {
            break;
        }
        let (p, q) = (t.chars[a - 1], t.chars[i]);
        let after_exclaim = matches!(p, '？' | '！') && t.chars[a..i] == ['\u{3000}'];
        // Spaces that set off a menu path ("設定 → ショートカット の") are
        // the writer's way of quoting UI labels.
        let window: String = t.chars[a.saturating_sub(12)..(i + 12).min(n)]
            .iter()
            .collect();
        if window.contains(" → ") || window.contains(" > ") || window.contains(" ＞ ") {
            continue;
        }
        let bracket =
            matches!(p, '「' | '『' | '（' | '【') || matches!(q, '」' | '』' | '）' | '】');
        if !after_exclaim && ((is_ja(p) && is_ja(q)) || (bracket && (is_ja(p) || is_ja(q)))) {
            out.fix(
                "ja.space.fullwidth",
                a - 1,
                i + 1,
                format!("{p}{q}"),
                "全角文字の間にスペースは入れません。",
            );
        }
    }
}

/// ja.punct.after-exclaim: a sentence-final ？/！ followed by more text -> a
/// full-width space after it. Not before a closing bracket, と, って or か,
/// not in fiction or headings.
fn after_exclaim(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.is("fiction") || ctx.block.is_heading() {
        return;
    }
    for i in 0..t.len().saturating_sub(1) {
        if !matches!(t.chars[i], '？' | '！') {
            continue;
        }
        let q = t.chars[i + 1];
        if is_cjk(q) && !matches!(q, 'と' | 'っ' | 'か' | 'な' | 'の') {
            out.fix(
                "ja.punct.after-exclaim",
                i,
                i + 1,
                format!("{}\u{3000}", t.chars[i]),
                "文中の「！」「？」のあとには全角スペースを入れます。",
            );
        }
    }
}

/// ja.punct.tilde: 10~20 -> 10～20.
fn tilde(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 1..t.len().saturating_sub(1) {
        if t.chars[i] == '~' && t.chars[i - 1].is_ascii_digit() && t.chars[i + 1].is_ascii_digit() {
            out.fix(
                "ja.punct.tilde",
                i,
                i + 1,
                "～",
                "範囲を示すには「～」を使います。",
            );
        }
    }
}

static COUNTER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d\s?([ヶヵケ])(月|所|国|年)").unwrap());

/// ja.num.counter: 3ヶ月 -> 3か月 (霞ケ関 has no digit before it).
fn counter(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&COUNTER) {
        let Some((a, b)) = caps[1] else { continue };
        out.fix(
            "ja.num.counter",
            a,
            b,
            "か",
            "「3か月」のように「か」と書きます（「カ」も使われます）。",
        );
    }
}

static DOTS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\.{3,}|・{3,}|。{3,}|ーー+|−−+|--+").unwrap());

/// ja.punct.dots-dash: ... ・・・ -> ……; ーー −− -- used as a dash -> ――.
/// ーー after kana is a drawn-out sound (えーー), not a dash.
fn dots_dash(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&DOTS) {
        let run = t.slice(a, b);
        let near_ja = t.before(a).is_some_and(is_ja) || t.at(b).is_some_and(is_ja);
        if !near_ja {
            continue;
        }
        if run.starts_with('ー') {
            if t.before(a).is_some_and(|c| is_kana(c) || c == 'ー') {
                continue;
            }
            out.fix(
                "ja.punct.dots-dash",
                a,
                b,
                "――",
                "ダッシュは「――」と二つ重ねます。",
            );
        } else if run.starts_with('−') || run.starts_with('-') {
            out.fix(
                "ja.punct.dots-dash",
                a,
                b,
                "――",
                "ダッシュは「――」と二つ重ねます。",
            );
        } else {
            out.fix(
                "ja.punct.dots-dash",
                a,
                b,
                "……",
                "三点リーダーは「……」と二つ重ねます。",
            );
        }
    }
}

/// ja.punct.single-leader: a single … or ― -> two (公用文 allows one).
fn single_leader(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.is("koyobun") {
        return;
    }
    for i in 0..t.len() {
        let c = t.chars[i];
        // Only inside a sentence: a lone … after a menu command ("編集…")
        // is the UI's label.
        let inside = t.before(i).is_some_and(is_cjk) && t.at(i + 1).is_some_and(is_cjk);
        if matches!(c, '…' | '―') && t.before(i) != Some(c) && t.at(i + 1) != Some(c) && inside
        {
            out.fix(
                "ja.punct.single-leader",
                i,
                i + 1,
                format!("{c}{c}"),
                "「…」「―」は二つ重ねて使います。",
            );
        }
    }
}

static DESU_END: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:です|ます|でした|ました|ません|でしょう|ましょう)[。！？]").unwrap()
});
static DEARU_END: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:である|であった|ではない|だった|のだ|なのだ)[。！？]").unwrap()
});

/// ja.style.register-mix: です・ます and である in one document's body -
/// the minority's sentence endings flagged. Not quotations, list items or
/// headings.
fn register_mix(t: &Text, ctx: &Ctx, out: &mut Out) {
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

const RANUKI_STEMS: &[&str] = &[
    "見", "来", "食べ", "寝", "着", "出", "起き", "決め", "考え", "信じ", "変え", "投げ", "降り",
    "借り", "浴び", "答え", "教え",
];

/// ja.word.ranuki: ら抜き言葉 from a closed list (見れる -> 見られる). Not
/// 見れば (a conditional), not in dialogue or fiction.
fn ranuki(t: &Text, ctx: &Ctx, out: &mut Out) {
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
fn no_repeat(t: &Text, _ctx: &Ctx, out: &mut Out) {
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

static DOUBLE_NEG: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"ないわけではない|なくはない|ないこともない|ないとは言えない|ないではない").unwrap()
});

/// ja.style.double-negative.
fn double_negative(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&DOUBLE_NEG) {
        out.flag(
            "ja.style.double-negative",
            a,
            b,
            "二重否定は意味が取りにくくなります。",
        );
    }
}

static ABOUT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"約[^。、]{1,10}?(?:くらい|ぐらい|ほど|程度)").unwrap());
static EACH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"各[^。、]{1,10}?ごとに").unwrap());
static NTH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"第\d+(?:番|回|日|位)目").unwrap());

/// ja.word.redundant: することができる, 約…くらい, 各…ごとに, 第…目.
fn redundant(t: &Text, _ctx: &Ctx, out: &mut Out) {
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
fn sentence_length(t: &Text, ctx: &Ctx, out: &mut Out) {
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

/// ja.punct.period-bracket (a chosen JTF or technical profile): 。」 -> 」.
fn period_bracket(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !(ctx.profile.explicit && (ctx.profile.is("jtf") || ctx.profile.is("tech"))) {
        return;
    }
    for (a, _) in find_str(t, "。」") {
        out.fix(
            "ja.punct.period-bracket",
            a,
            a + 2,
            "」",
            "かぎかっこの閉じの前に句点は付けません。",
        );
    }
}

static DOUBLE_HONORIFIC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[おご御][\p{Han}\p{Hiragana}]{1,6}?になられ").unwrap());

/// ja.keigo.patterns: double honorifics (お〜になられる) and させていただく
/// three or more times in a passage.
fn keigo(t: &Text, _ctx: &Ctx, out: &mut Out) {
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

/// ja.word.choon: コンピュータ and コンピューター in one document - the
/// minority form flagged.
fn choon(t: &Text, ctx: &Ctx, out: &mut Out) {
    let k = &ctx.stats.katakana;
    for (word, &count) in k {
        let Some(short) = word.strip_suffix('ー') else {
            continue;
        };
        let Some(&short_count) = k.get(short) else {
            continue;
        };
        let (minor, major) = if short_count < count {
            (short, word.as_str())
        } else if count < short_count {
            (word.as_str(), short)
        } else {
            continue;
        };
        for (a, b) in find_str(t, minor) {
            // Whole katakana words only.
            let inside = t
                .at(b)
                .is_some_and(|c| matches!(c, '\u{30A1}'..='\u{30FA}' | 'ー'))
                || t.before(a)
                    .is_some_and(|c| matches!(c, '\u{30A1}'..='\u{30FA}' | 'ー'));
            if !inside {
                out.fix(
                    "ja.word.choon",
                    a,
                    b,
                    major,
                    format!("長音の表記が混在しています（「{major}」と「{minor}」）。"),
                );
            }
        }
    }
}

/// ja.word.okurigana and ja.word.kodomo: two spellings of one word in a
/// document (取り扱い/取扱い, 子ども/子供) - the minority flagged.
fn variants(t: &Text, ctx: &Ctx, out: &mut Out) {
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

static KANJI_DIGIT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\d{1,3})([千百])").unwrap());

/// ja.num.kanji-digit: 5千 -> 5,000, 3百 -> 300 (万 and 億 are fine).
fn kanji_digit(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&KANJI_DIGIT) {
        let (Some((a, b)), Some((x, y)), Some((u, _))) = (caps[0], caps[1], caps[2]) else {
            continue;
        };
        if t.before(a).is_some_and(|c| c.is_ascii_digit() || c == ',')
            || t.at(b).is_some_and(|c| matches!(c, '葉' | '代' | '歳'))
        {
            continue;
        }
        let n: u64 = t.slice(x, y).parse().unwrap_or(0);
        let value = if t.chars[u] == '千' {
            n * 1000
        } else {
            n * 100
        };
        let mut s = value.to_string();
        if value >= 1000 {
            let k = s.len() - 3;
            s.insert(k, ',');
        }
        out.fix(
            "ja.num.kanji-digit",
            a,
            b,
            s,
            "算用数字と「千」「百」は混ぜずに書きます（「万」「億」は可）。",
        );
    }
}

#[cfg(test)]
mod tests;
