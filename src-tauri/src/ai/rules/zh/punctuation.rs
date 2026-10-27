//! Chinese punctuation marks: ellipses, dashes, stacked marks, quotes,
//! the end of a heading, the enumeration comma and the middle dot.

use super::*;

pub(crate) static DOTS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\.{3,}|。{3,}|…+|⋯+|·{3,}").unwrap());

/// zh.punct.ellipsis: ... 。。。 a lone … ⋯⋯ and runs longer than two
/// pairs -> …… (two pairs, the twelve dots for omitted paragraphs, stay).
pub(crate) fn ellipsis(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(
        ctx,
        "中文省略号用“……”（两个“…”）。",
        "中文刪節號用「……」（兩個「…」）。",
    );
    for (a, b) in t.find(&DOTS) {
        let run = t.slice(a, b);
        if run == "……" || run == "…………" {
            continue;
        }
        // A lone … after a menu command ("导入技能…") is the UI's label: only one
        // with CJK letters on both sides is taken for an ellipsis.
        if run == "…" && !(t.before(a).is_some_and(is_cjk) && t.at(b).is_some_and(is_cjk)) {
            continue;
        }
        let near_cjk = t.before(a).is_some_and(cjk_before)
            || t.at(b).is_some_and(opens_cjk)
            || t.at(b).is_some_and(is_fullwidth_punct);
        let chinese_run = run.starts_with('。') || run.starts_with('⋯') || run.starts_with('…');
        if !near_cjk
            && !(chinese_run
                && (t.before(a).is_some_and(is_cjk_text) || t.at(b).is_some_and(is_cjk_text)))
        {
            continue;
        }
        // "……等" is zh.punct.ellipsis-deng's.
        if t.at(b) == Some('等') || find_str(t, "什么的").iter().any(|&(x, _)| x == b) {
            continue;
        }
        out.fix("zh.punct.ellipsis", a, b, "……", msg.clone());
    }
}

/// zh.punct.ellipsis-deng: an ellipsis and 等/等等/什么的 say the same thing.
pub(crate) fn ellipsis_deng(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(
        ctx,
        "省略号和“等”“等等”“什么的”不同时使用。",
        "刪節號和「等」「等等」不同時使用。",
    );
    for (a, b) in t.find(&DOTS) {
        if !t.before(a).is_some_and(cjk_before) {
            continue;
        }
        for word in ["等等", "等", "什么的", "什麼的"] {
            if t.chars[b..].starts_with(&word.chars().collect::<Vec<_>>()) {
                let w = word.chars().count();
                out.fix("zh.punct.ellipsis-deng", a, b + w, word, msg.clone());
                break;
            }
        }
    }
}

pub(crate) static DASH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"-{2,}|－{2,}|─{2}|―{2}|—").unwrap());

/// The length of the run of CJK letters ending at `i` (exclusive) or
/// starting at `i`.
pub(crate) fn cjk_run_left(t: &Text, i: usize) -> usize {
    t.chars[..i]
        .iter()
        .rev()
        .take_while(|&&c| is_cjk(c))
        .count()
}

pub(crate) fn cjk_run_right(t: &Text, i: usize) -> usize {
    t.chars[i..].iter().take_while(|&&c| is_cjk(c)).count()
}

/// zh.punct.dash (mainland): -- －－ ── ―― and a single — between Chinese
/// clauses -> ——. A single — between numbers, dates or places is the range
/// connector (北京—上海), so only one between long clauses is taken.
pub(crate) fn dash(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(ctx, "中文破折号用“——”（两个“—”）。", "中文破折號用「——」。");
    for (a, b) in t.find(&DASH) {
        let run = t.slice(a, b);
        let (l, r) = (t.before(a), t.at(b));
        let cjk_side = l.is_some_and(cjk_before) || r.is_some_and(opens_cjk);
        if !cjk_side {
            continue;
        }
        if run == "—" {
            if t.at(b) == Some('—') || t.before(a) == Some('—') {
                continue;
            }
            if l.is_some_and(is_cjk)
                && r.is_some_and(is_cjk)
                && cjk_run_left(t, a) >= 5
                && cjk_run_right(t, b) >= 5
            {
                out.fix("zh.punct.dash", a, b, "——", msg.clone());
            }
            continue;
        }
        if run.starts_with('-')
            && l.is_some_and(|c| c.is_ascii_digit())
            && r.is_some_and(|c| c.is_ascii_digit())
        {
            continue;
        }
        out.fix("zh.punct.dash", a, b, "——", msg.clone());
    }
}

/// zh.punct.stacked: more than `stacked-marks` ？ or ！ in a row (three in
/// fiction, one elsewhere); one of each, ？！, is always fine.
pub(crate) fn stacked(t: &Text, ctx: &Ctx, out: &mut Out) {
    let max: usize = match ctx.profile.opt("stacked-marks") {
        Some("3") => 3,
        Some("1") => 1,
        _ if ctx.profile.is("fiction") => 3,
        // Automatic: the GB limit; the tech and official profiles allow one.
        _ if ctx.profile.explicit && !ctx.profile.is("fiction") => 1,
        _ => 3,
    };
    let msg = m(
        ctx,
        "问号、叹号不宜连用过多。",
        "問號、驚嘆號不宜連用過多。",
    );
    let n = t.len();
    let mut i = 0;
    while i < n {
        if !matches!(t.chars[i], '！' | '？') {
            i += 1;
            continue;
        }
        let a = i;
        while i < n && matches!(t.chars[i], '！' | '？') {
            i += 1;
        }
        let run: Vec<char> = t.chars[a..i].to_vec();
        let mixed_pair = run.len() == 2 && run[0] != run[1];
        if run.len() <= max || mixed_pair {
            continue;
        }
        let fixed: String = if max == 1 {
            if run.contains(&'？') && run.contains(&'！') {
                "？！".into()
            } else {
                run[0].to_string()
            }
        } else {
            run[..max].iter().collect()
        };
        out.fix("zh.punct.stacked", a, i, fixed, msg.clone());
    }
}

/// zh.heading.end-punct: a heading ending in 。，、；：.
pub(crate) fn heading_end(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !ctx.block.is_heading() {
        return;
    }
    let trimmed = t.s.trim_end().chars().count();
    if trimmed > 0 && matches!(t.chars[trimmed - 1], '。' | '，' | '、' | '；' | '：') {
        out.fix(
            "zh.heading.end-punct",
            trimmed - 1,
            trimmed,
            "",
            m(
                ctx,
                "标题末尾不用句号、逗号等点号。",
                "標題末尾不用句號、逗號等標點。",
            ),
        );
    }
}

/// zh.quote.straight (mainland): straight quotes around Chinese -> “” ‘’
/// (or 「」『』 with quotes=corner). Code, English quotations and unmatched
/// quotes are left alone.
pub(crate) fn quote_straight(t: &Text, ctx: &Ctx, out: &mut Out) {
    let corner = ctx.profile.opt("quotes") == Some("corner");
    let msg = if corner {
        m(
            ctx,
            "中文引号用「」，内层用『』。",
            "中文引號用「」，內層用『』。",
        )
    } else {
        m(ctx, "中文引号用“”，内层用‘’。", "中文引號用“”，內層用‘’。")
    };
    for (q, open, close) in [
        (
            '"',
            if corner { "「" } else { "“" },
            if corner { "」" } else { "”" },
        ),
        (
            '\'',
            if corner { "『" } else { "‘" },
            if corner { "』" } else { "’" },
        ),
    ] {
        let marks: Vec<usize> = (0..t.len())
            .filter(|&i| t.chars[i] == q && !t.protected[i])
            // An apostrophe between letters isn't a quote.
            .filter(|&i| {
                q != '\''
                    || !(t.before(i).is_some_and(|c| c.is_alphanumeric())
                        && t.at(i + 1).is_some_and(|c| c.is_alphanumeric())
                        && !t.before(i).is_some_and(is_cjk))
            })
            .collect();
        if !marks.len().is_multiple_of(2) {
            continue;
        }
        for pair in marks.chunks(2) {
            let (a, b) = (pair[0], pair[1]);
            let inner = &t.chars[a + 1..b];
            let cjk = inner.iter().filter(|&&c| is_cjk(c)).count();
            let latin = inner.iter().filter(|&&c| is_latin_letter(c)).count();
            let outside =
                t.before(a).is_some_and(is_cjk_text) || t.at(b + 1).is_some_and(is_cjk_text);
            if cjk > 0 && cjk * 3 >= latin && (outside || cjk >= latin) {
                out.fix("zh.quote.straight", a, a + 1, open, msg.clone());
                out.fix("zh.quote.straight", b, b + 1, close, msg.clone());
            }
        }
    }
}

/// zh.title.dunhao (mainland): 《A》、《B》 -> 《A》《B》.
pub(crate) fn title_dunhao(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (a, _) in find_str(t, "》、《") {
        out.fix(
            "zh.title.dunhao",
            a,
            a + 3,
            "》《",
            "并列的书名号之间一般不用顿号。",
        );
    }
}

/// zh.punct.middot (mainland): • ・ ‧ between the parts of a name -> ·.
pub(crate) fn middot(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for i in 1..t.len().saturating_sub(1) {
        if matches!(t.chars[i], '•' | '・' | '‧')
            && is_han(t.chars[i - 1])
            && is_han(t.chars[i + 1])
        {
            out.fix(
                "zh.punct.middot",
                i,
                i + 1,
                "·",
                "外国人名等各部分之间用间隔号“·”。",
            );
        }
    }
}
