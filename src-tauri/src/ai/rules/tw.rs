//! Traditional Chinese rules: script purity for any Traditional text, and the
//! Taiwan and Hong Kong conventions by region. The region-neutral Chinese
//! rules run from zh.rs.

use super::stats::minority;
use super::text::*;
use super::zhdata;
use super::{Ctx, Out};
use regex::Regex;
use std::sync::LazyLock;

pub(crate) fn run(t: &Text, ctx: &Ctx, out: &mut Out) {
    script_simplified(t, ctx, out);
    let region = ctx.profile.region.as_deref().unwrap_or("TW");
    if region == "TW" || region == "HK" {
        quote_corner(t, ctx, out);
        hk_mix(t, ctx, out, region);
        dash(t, ctx, out);
    }
    if region == "TW" {
        middot(t, ctx, out);
        mainland_words(t, ctx, out);
        if ctx.profile.is("gongwen") {
            gongwen(t, ctx, out);
        }
    }
}

/// tw.script.simplified: a stray Simplified character in clearly Traditional
/// text, never inside a quotation. One with several Traditional forms (发:
/// 發/髮) gets no single suggestion.
fn script_simplified(t: &Text, _ctx: &Ctx, out: &mut Out) {
    let (mut hans, mut hant) = (0, 0);
    for p in zhdata::script_pairs() {
        hans += t
            .chars
            .iter()
            .filter(|&&c| c == p.0 && p.2 != zhdata::Pair::TradOnly)
            .count();
        hant += t
            .chars
            .iter()
            .filter(|&&c| c == p.1 && p.2 != zhdata::Pair::SimpOnly)
            .count();
    }
    if hant < 2 * hans.max(1) {
        return;
    }
    for i in 0..t.len() {
        let c = t.chars[i];
        let Some(forms) = zhdata::to_traditional(c) else {
            continue;
        };
        if t.in_quotes(i, i + 1) {
            continue;
        }
        if forms.len() == 1 {
            out.fix(
                "tw.script.simplified",
                i,
                i + 1,
                forms[0].to_string(),
                format!("繁體文本中混入了簡體字「{c}」，應為「{}」。", forms[0]),
            );
        } else {
            let options: Vec<String> = forms.iter().map(|f| format!("「{f}」")).collect();
            out.flag(
                "tw.script.simplified",
                i,
                i + 1,
                format!(
                    "繁體文本中混入了簡體字「{c}」，應為{}之一。",
                    options.join("、")
                ),
            );
        }
    }
}

/// tw.quote.corner: “” -> 「」 and ‘’ -> 『』 around Chinese text (and
/// straight quotes too). Some Taiwanese publishers use “”: quotes=curly.
fn quote_corner(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.opt("quotes") == Some("curly") {
        return;
    }
    let msg = "臺灣的引號用「」，引號內再用『』。";
    for (open, close, to_open, to_close) in [('“', '”', "「", "」"), ('‘', '’', "『", "』")]
    {
        let mut i = 0;
        while i < t.len() {
            if t.chars[i] != open {
                i += 1;
                continue;
            }
            let Some(j) = (i + 1..t.len()).find(|&j| t.chars[j] == close) else {
                break;
            };
            if t.chars[i + 1..j].iter().any(|&c| is_cjk(c)) {
                out.fix("tw.quote.corner", i, i + 1, to_open, msg);
                out.fix("tw.quote.corner", j, j + 1, to_close, msg);
            }
            i = j + 1;
        }
    }
    let marks: Vec<usize> = (0..t.len())
        .filter(|&i| t.chars[i] == '"' && !t.protected[i])
        .collect();
    if marks.len().is_multiple_of(2) {
        for pair in marks.chunks(2) {
            if t.chars[pair[0] + 1..pair[1]].iter().any(|&c| is_cjk(c)) {
                out.fix("tw.quote.corner", pair[0], pair[0] + 1, "「", msg);
                out.fix("tw.quote.corner", pair[1], pair[1] + 1, "」", msg);
            }
        }
    }
}

/// tw.script.hk-mix: Taiwanese and Hong Kong forms (裡/裏, 著/着, 線/綫,
/// 衛/衞) mixed. A chosen profile flags the other region's forms; Automatic
/// only flags them when the text also has the region's own.
fn hk_mix(t: &Text, ctx: &Ctx, out: &mut Out, region: &str) {
    let hk = region == "HK";
    let (own, other): (Vec<char>, Vec<char>) = zhdata::TW_HK
        .iter()
        .map(|&(tw, h)| if hk { (h, tw) } else { (tw, h) })
        .unzip();
    let has_own = t.chars.iter().any(|c| own.contains(c));
    if !(ctx.profile.explicit || has_own) {
        return;
    }
    for i in 0..t.len() {
        if let Some(k) = other.iter().position(|&c| c == t.chars[i]) {
            let msg = if hk {
                format!("香港用字作「{}」。", own[k])
            } else {
                format!("臺灣用字作「{}」。", own[k])
            };
            out.fix("tw.script.hk-mix", i, i + 1, own[k].to_string(), msg);
        }
    }
}

/// tw.punct.dash: —— and ── mixed in one document (Taiwan uses ──).
fn dash(t: &Text, ctx: &Ctx, out: &mut Out) {
    let s = ctx.stats;
    let (from, to) = if minority(s.zh_em_dash, s.zh_box_dash) {
        ("——", "──")
    } else if minority(s.zh_box_dash, s.zh_em_dash) {
        ("──", "——")
    } else {
        return;
    };
    for (a, b) in find_str(t, from) {
        out.fix(
            "tw.punct.dash",
            a,
            b,
            to,
            format!("破折號寫法不一致：本文多用「{to}」。"),
        );
    }
}

/// tw.punct.middot (a chosen zh-Hant-TW profile): · -> ． between the
/// parts of a name and in 《書．篇》.
fn middot(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !ctx.profile.explicit {
        return;
    }
    for i in 1..t.len().saturating_sub(1) {
        if t.chars[i] == '·' && is_han(t.chars[i - 1]) && is_han(t.chars[i + 1]) {
            out.fix(
                "tw.punct.middot",
                i,
                i + 1,
                "．",
                "教育部標點符號手冊的間隔號是「．」。",
            );
        }
    }
}

/// tw.word.mainland: mainland vocabulary (軟件 -> 軟體) - suggestions.
fn mainland_words(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (cn, tw) in zhdata::TW_MAINLAND {
        for (a, b) in find_str(t, cn) {
            if !t.in_quotes(a, b) {
                out.fix("tw.word.mainland", a, b, *tw, format!("臺灣慣用「{tw}」。"));
            }
        }
    }
}

static WESTERN_YEAR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(19[2-9]\d|20\d\d)年").unwrap());
static MARKER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:(\d)、|[(（](\d)[)）]|（([１-９])）)").unwrap());

/// The Taiwanese 公文 profile: legal characters, 民國 years, item markers,
/// 臺.
fn gongwen(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (other, legal) in zhdata::TW_LEGAL {
        for (a, b) in find_str(t, other) {
            out.fix(
                "tw.gongwen.legal-chars",
                a,
                b,
                *legal,
                format!("法律統一用字作「{legal}」。"),
            );
        }
    }
    for caps in t.captures(&WESTERN_YEAR) {
        let (Some((a, b)), Some((y1, y2))) = (caps[0], caps[1]) else {
            continue;
        };
        if t.before(a).is_some_and(|c| c.is_ascii_digit()) {
            continue;
        }
        let year: u32 = t.slice(y1, y2).parse().unwrap_or(0);
        out.fix(
            "tw.gongwen.year",
            a,
            b,
            format!("{}年", year - 1911),
            "公文年份以國曆（民國紀年）為準。",
        );
    }
    for caps in t.captures(&MARKER) {
        let fw = |d: char| char::from_u32(d as u32 + 0xFEE0).unwrap_or(d);
        let msg = "公文項目符號依序為「一、」「(一)」「１、」「(１)」：全形數字、半形括號。";
        if let (Some((a, b)), Some((d, _))) = (caps[0], caps[1]) {
            out.fix(
                "tw.gongwen.markers",
                a,
                b,
                format!("{}、", fw(t.chars[d])),
                msg,
            );
        } else if let (Some((a, b)), Some((d, _))) = (caps[0], caps[2]) {
            out.fix(
                "tw.gongwen.markers",
                a,
                b,
                format!("({})", fw(t.chars[d])),
                msg,
            );
        } else if let (Some((a, b)), Some((d, _))) = (caps[0], caps[3]) {
            out.fix("tw.gongwen.markers", a, b, format!("({})", t.chars[d]), msg);
        }
    }
    const NAMES: [&str; 6] = ["台積電", "台塑", "台達電", "電台", "台幣", "台灣大哥大"];
    for (a, b) in find_str(t, "台") {
        let in_name = NAMES
            .iter()
            .any(|name| find_str(t, name).iter().any(|&(x, y)| x <= a && b <= y));
        if !in_name {
            out.fix(
                "tw.gongwen.tai",
                a,
                b,
                "臺",
                "教育部標準字作「臺」（公文建議）。",
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::testing::*;
    use super::super::Lang;

    const T: Lang = Lang::ZhHant;

    #[test]
    fn simplified_characters_in_traditional_text() {
        assert_eq!(
            hits(
                "tw.script.simplified",
                T,
                None,
                "這個問題很重要，我們明天再讨論。"
            ),
            one("讨", "討")
        );
        assert_eq!(
            hits(
                "tw.script.simplified",
                T,
                None,
                "這個問題很重要，我們明天再發言，头发很長。"
            )[1]
            .1,
            None
        );
        // Characters both scripts share (里, 后, 台) are not "simplified".
        assert!(hits(
            "tw.script.simplified",
            T,
            None,
            "這個問題在公里和皇后之間。"
        )
        .is_empty());
    }

    #[test]
    fn corner_quotes_in_taiwan_but_not_with_curly_or_on_the_mainland() {
        assert_eq!(
            fixed("tw.quote.corner", T, None, "他說：“我們‘明天’見。”"),
            "他說：「我們『明天』見。」"
        );
        assert_eq!(
            fixed("tw.quote.corner", T, None, "他說\"好的\"就走了"),
            "他說「好的」就走了"
        );
        assert!(hits("tw.quote.corner", T, Some("zh-Hant-CN"), "他說：“我們見。”").is_empty());
        assert!(hits("tw.quote.corner", T, None, "He said “hi” 然後").is_empty());
    }

    #[test]
    fn taiwan_and_hong_kong_forms() {
        assert_eq!(
            hits("tw.script.hk-mix", T, None, "這裡有人，那裏沒有。"),
            one("裏", "裡")
        );
        // Automatic, with no Taiwanese form beside it: left alone.
        assert!(hits("tw.script.hk-mix", T, None, "那裏沒有人。").is_empty());
        assert_eq!(
            hits("tw.script.hk-mix", T, Some("zh-Hant-HK"), "這裡沒有人。"),
            one("裡", "裏")
        );
    }

    #[test]
    fn mainland_words_and_middot() {
        assert_eq!(
            fixed("tw.word.mainland", T, None, "這個軟件的信息"),
            "這個軟體的資訊"
        );
        assert!(hits("tw.word.mainland", T, Some("zh-Hant-HK"), "這個軟件").is_empty());
        // 質量 (mass) and 程序 (procedure) alone are fine.
        assert!(hits("tw.word.mainland", T, None, "物體的質量與法律程序").is_empty());
        assert_eq!(
            fixed("tw.punct.middot", T, Some("zh-Hant-TW"), "馬克·吐溫"),
            "馬克．吐溫"
        );
        assert!(hits("tw.punct.middot", T, None, "馬克·吐溫").is_empty());
    }

    #[test]
    fn taiwanese_gongwen() {
        let g = Some("zh-Hant-TW/gongwen");
        assert_eq!(
            fixed("tw.gongwen.legal-chars", T, g, "請盡量公佈"),
            "請儘量公布"
        );
        assert_eq!(
            fixed("tw.gongwen.year", T, g, "2026年10月14日"),
            "115年10月14日"
        );
        assert_eq!(fixed("tw.gongwen.markers", T, g, "1、說明"), "１、說明");
        assert_eq!(fixed("tw.gongwen.markers", T, g, "(2)辦法"), "(２)辦法");
        assert_eq!(
            fixed("tw.gongwen.tai", T, g, "台北市的台積電"),
            "臺北市的台積電"
        );
        assert!(hits("tw.gongwen.year", T, None, "2026年").is_empty());
        // Never flagged: 頓號 between titled items, 約三、四天.
        let all = findings(
            T,
            g,
            "閱讀《水滸傳》、《三國演義》約三、四天。",
            super::super::Block::Unknown,
        );
        assert!(all.is_empty(), "{all:?}");
    }
}
