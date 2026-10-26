//! Japanese notation: character width, spaces, marks after ! and ?,
//! the wave dash, counters, leaders, brackets, the long vowel mark and
//! digits with kanji.

use super::*;

/// ja.width.kana: half-width katakana -> full-width (voiced marks joined).
pub(crate) fn width_kana(t: &Text, _ctx: &Ctx, out: &mut Out) {
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
pub(crate) fn halfwidth(t: &Text, ctx: &Ctx, out: &mut Out) {
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
pub(crate) fn width_alnum(t: &Text, ctx: &Ctx, out: &mut Out) {
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

/// ja.space.typed: a typed space between Japanese and Latin text -> none,
/// unless the document clearly spaces them throughout.
pub(crate) fn space_typed(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    // A chosen profile removes the spaces; Automatic only where the document's
    // majority is unspaced, as many technical texts space Latin terms on purpose.
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
pub(crate) fn space_fullwidth(t: &Text, _ctx: &Ctx, out: &mut Out) {
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
pub(crate) fn after_exclaim(t: &Text, ctx: &Ctx, out: &mut Out) {
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
pub(crate) fn tilde(t: &Text, _ctx: &Ctx, out: &mut Out) {
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

pub(crate) static COUNTER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d\s?([ヶヵケ])(月|所|国|年)").unwrap());

/// ja.num.counter: 3ヶ月 -> 3か月 (霞ケ関 has no digit before it).
pub(crate) fn counter(t: &Text, _ctx: &Ctx, out: &mut Out) {
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

pub(crate) static DOTS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\.{3,}|・{3,}|。{3,}|ーー+|−−+|--+").unwrap());

/// ja.punct.dots-dash: ... ・・・ -> ……; ーー −− -- used as a dash -> ――.
/// ーー after kana is a drawn-out sound (えーー), not a dash.
pub(crate) fn dots_dash(t: &Text, _ctx: &Ctx, out: &mut Out) {
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
pub(crate) fn single_leader(t: &Text, ctx: &Ctx, out: &mut Out) {
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

/// ja.punct.period-bracket (a chosen JTF or technical profile): 。」 -> 」.
pub(crate) fn period_bracket(t: &Text, ctx: &Ctx, out: &mut Out) {
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

/// ja.word.choon: コンピュータ and コンピューター in one document - the
/// minority form flagged.
pub(crate) fn choon(t: &Text, ctx: &Ctx, out: &mut Out) {
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

pub(crate) static KANJI_DIGIT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d{1,3})([千百])").unwrap());

/// ja.num.kanji-digit: 5千 -> 5,000, 3百 -> 300 (万 and 億 are fine).
pub(crate) fn kanji_digit(t: &Text, _ctx: &Ctx, out: &mut Out) {
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
