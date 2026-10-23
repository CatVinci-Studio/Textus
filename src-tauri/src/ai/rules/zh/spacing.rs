//! Width and spacing in Chinese text: half-width punctuation among
//! Chinese characters, spaces next to full-width marks, between Chinese
//! and Latin, full-width letters and digits.

use super::*;

/// CJK text or a closing CJK mark: what a Chinese sentence's punctuation
/// follows.
pub(crate) fn cjk_before(c: char) -> bool {
    is_cjk(c) || matches!(c, '”' | '’' | '」' | '』' | '）' | '》' | '】' | '〕')
}

/// The next non-space character from `i`, and where it is.
pub(crate) fn next_non_space(t: &Text, i: usize) -> (Option<char>, usize) {
    let mut j = i;
    while j < t.len() && t.chars[j] == ' ' {
        j += 1;
    }
    (t.at(j), j)
}

pub(crate) fn opens_cjk(c: char) -> bool {
    is_cjk(c) || matches!(c, '“' | '‘' | '「' | '『' | '（' | '《' | '【' | '〔')
}

/// zh.punct.halfwidth: , . ; : ? ! ( ) typed with an English input
/// method inside a Chinese sentence -> ，。；：？！（）. Not decimals (3.14),
/// times (8:00), list markers ("1."), file names, or English segments.
pub(crate) fn halfwidth(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(
        ctx,
        "中文句子里应使用全角标点。",
        "中文句子裡應使用全形標點。",
    );
    let n = t.len();
    for i in 0..n {
        let c = t.chars[i];
        let full = match c {
            ',' => '，',
            '.' => '。',
            ';' => '；',
            ':' => '：',
            '?' => '？',
            '!' => '！',
            _ => continue,
        };
        let Some(prev) = t.before(i) else { continue };
        if !cjk_before(prev) {
            continue;
        }
        let next = t.at(i + 1);
        if c == '.' && matches!(next, Some('.')) {
            continue; // an ellipsis: zh.punct.ellipsis
        }
        let (after, j) = next_non_space(t, i + 1);
        let ends = after.is_none();
        let ok = match after {
            None => true,
            Some(q) => {
                opens_cjk(q)
                    || (matches!(c, '!' | '?') && matches!(q, '!' | '?' | '！' | '？' | '”' | '」'))
            }
        };
        if !(ok || ends) {
            continue;
        }
        // Keep spaces after it only when they lead nowhere (end of text).
        let end = if ends { i + 1 } else { j.max(i + 1) };
        let end = if end > i + 1 && !t.chars[i + 1..end].iter().all(|&ch| ch == ' ') {
            i + 1
        } else {
            end
        };
        out.fix("zh.punct.halfwidth", i, end, full.to_string(), msg.clone());
    }
    // Parentheses around Chinese text.
    let mut stack: Vec<usize> = Vec::new();
    for i in 0..n {
        match t.chars[i] {
            '(' => stack.push(i),
            ')' => {
                if let Some(a) = stack.pop() {
                    let inner_cjk = t.chars[a + 1..i].iter().any(|&ch| is_cjk(ch));
                    let outer_cjk =
                        t.before(a).is_some_and(is_cjk) || t.at(i + 1).is_some_and(is_cjk);
                    if inner_cjk && outer_cjk && !t.guarded(a, i + 1) {
                        out.fix("zh.punct.halfwidth", a, a + 1, "（", msg.clone());
                        out.fix("zh.punct.halfwidth", i, i + 1, "）", msg.clone());
                    }
                }
            }
            _ => {}
        }
    }
}

/// Full-width marks that take no space beside them; the curly quotes,
/// dashes and ellipsis only when Chinese text is on the other side.
pub(crate) fn fullwidth_adjacent(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(ctx, "全角标点前后不加空格。", "全形標點前後不加空格。");
    let n = t.len();
    let mut i = 0;
    while i < n {
        if t.chars[i] != ' ' && t.chars[i] != '\u{3000}' {
            i += 1;
            continue;
        }
        let a = i;
        while i < n && (t.chars[i] == ' ' || t.chars[i] == '\u{3000}') {
            i += 1;
        }
        let b = i;
        if a == 0 || b >= n {
            continue;
        }
        let (l, r) = (t.chars[a - 1], t.chars[b]);
        let left_mark = is_fullwidth_punct(l)
            || (matches!(l, '”' | '’' | '…' | '—') && is_cjk_text(r))
            || (matches!(l, '“' | '‘') && is_cjk_text(r));
        let right_mark = is_fullwidth_punct(r)
            || (matches!(r, '“' | '‘' | '…' | '—') && is_cjk_text(l))
            || (matches!(r, '”' | '’') && is_cjk_text(l));
        // An ideographic space after ？！ is a Japanese convention, and a
        // leading one is an indent: neither is this rule's.
        if left_mark || right_mark {
            out.fix(
                "zh.space.fullwidth-adjacent",
                a - 1,
                b + 1,
                format!("{l}{r}"),
                msg.clone(),
            );
        }
    }
}

/// zh.space.cjk-latin: spaces between Chinese and Latin letters or digits
/// by the profile's `cjk-latin-space`: `on` adds them, `off` and `layout`
/// remove typed ones, Automatic flags only the minority form when the
/// text's majority is clear. Never next to punctuation, %, or °.
pub(crate) fn cjk_latin(t: &Text, ctx: &Ctx, out: &mut Out) {
    let mode = match ctx.profile.opt("cjk-latin-space") {
        Some(v) => v,
        None if ctx.profile.is("tech") => "on",
        None => "auto",
    };
    let s = ctx.stats;
    let (add, remove) = match mode {
        "on" => (true, false),
        "off" | "layout" => (false, true),
        _ => (
            minority(s.cjk_latin_tight, s.cjk_latin_spaced),
            minority(s.cjk_latin_spaced, s.cjk_latin_tight),
        ),
    };
    let auto = mode == "auto";
    let n = t.len();
    for i in 0..n.saturating_sub(1) {
        let (c, d) = (t.chars[i], t.chars[i + 1]);
        if add && ((is_cjk(c) && is_latin_or_digit(d)) || (is_latin_or_digit(c) && is_cjk(d))) {
            let msg = if auto {
                m(
                    ctx,
                    "中文与英文、数字之间加空格（与本文多数写法一致）。",
                    "中文與英文、數字之間加空格（與本文多數寫法一致）。",
                )
            } else {
                m(
                    ctx,
                    "按所选规范，中文与英文、数字之间加空格。",
                    "按所選規範，中文與英文、數字之間加空格。",
                )
            };
            out.fix("zh.space.cjk-latin", i, i + 2, format!("{c} {d}"), msg);
        }
        if remove && c == ' ' && i > 0 {
            let p = t.chars[i - 1];
            if (is_cjk(p) && is_latin_or_digit(d)) || (is_latin_or_digit(p) && is_cjk(d)) {
                let msg = if auto {
                    m(
                        ctx,
                        "中文与英文、数字之间不加空格（与本文多数写法一致）。",
                        "中文與英文、數字之間不加空格（與本文多數寫法一致）。",
                    )
                } else {
                    m(
                        ctx,
                        "按所选规范，中文与英文、数字之间不加空格。",
                        "按所選規範，中文與英文、數字之間不加空格。",
                    )
                };
                out.fix("zh.space.cjk-latin", i - 1, i + 2, format!("{p}{d}"), msg);
            }
        }
    }
}

/// zh.width.alnum: full-width letters and digits (Ａ１) -> half-width.
/// Taiwanese 公文 numbers its items with full-width digits (１、).
pub(crate) fn width_alnum(t: &Text, ctx: &Ctx, out: &mut Out) {
    let tw_gongwen = ctx.lang == Lang::ZhHant && ctx.profile.is("gongwen");
    let fw = |c: char| {
        matches!(c, '０'..='９' | 'Ａ'..='Ｚ' | 'ａ'..='ｚ') && !(tw_gongwen && c.is_numeric())
    };
    let msg = m(
        ctx,
        "全角字母和数字应改为半角。",
        "全形字母和數字應改為半形。",
    );
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
        out.fix("zh.width.alnum", a, i, half, msg.clone());
    }
}
