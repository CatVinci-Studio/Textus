//! Chinese wording: typos, variant and compatibility characters, mixed
//! scripts, long clauses, official documents and advertising law.

use super::*;

/// zh.word.typo: the wrong-character list; not inside a quotation (which
/// may be quoting the error).
pub(crate) fn typo(t: &Text, ctx: &Ctx, out: &mut Out) {
    for (wrong, right) in zhdata::TYPOS {
        for (a, b) in find_str(t, wrong) {
            if !t.in_quotes(a, b) {
                out.fix(
                    "zh.word.typo",
                    a,
                    b,
                    *right,
                    if ctx.lang == Lang::ZhHant {
                        format!("錯別字：應為「{right}」。")
                    } else {
                        format!("错别字：应为“{right}”。")
                    },
                );
            }
        }
    }
}

/// zh.word.variant: GF 1001 variant words -> the recommended form.
pub(crate) fn variant(t: &Text, _ctx: &Ctx, out: &mut Out) {
    for (var, rec) in zhdata::VARIANTS {
        for (a, b) in find_str(t, var) {
            if !t.in_quotes(a, b) {
                out.fix(
                    "zh.word.variant",
                    a,
                    b,
                    *rec,
                    format!("异形词：推荐写作“{rec}”。"),
                );
            }
        }
    }
}

/// zh.script.mixed: a Traditional character in Simplified text - only a
/// stray one (the text is clearly Simplified), never inside a quotation.
pub(crate) fn script_mixed(t: &Text, _ctx: &Ctx, out: &mut Out) {
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
    if hans < 2 * hant.max(1) {
        return;
    }
    for i in 0..t.len() {
        if let Some(s) = zhdata::to_simplified(t.chars[i]) {
            if !t.in_quotes(i, i + 1) {
                out.fix(
                    "zh.script.mixed",
                    i,
                    i + 1,
                    s.to_string(),
                    format!("简体文本中混入了繁体字“{}”，应为“{s}”。", t.chars[i]),
                );
            }
        }
    }
}

/// zh.compat-ideograph: CJK compatibility ideographs (pasted from PDFs)
/// -> the unified ones, except the twelve that are unified themselves.
pub(crate) fn compat_ideograph(t: &Text, ctx: &Ctx, out: &mut Out) {
    const UNIFIED: [u32; 12] = [
        0xFA0E, 0xFA0F, 0xFA11, 0xFA13, 0xFA14, 0xFA1F, 0xFA21, 0xFA23, 0xFA24, 0xFA27, 0xFA28,
        0xFA29,
    ];
    for i in 0..t.len() {
        let c = t.chars[i];
        if matches!(c, '\u{F900}'..='\u{FAFF}' | '\u{2F800}'..='\u{2FA1F}')
            && !UNIFIED.contains(&(c as u32))
        {
            let unified: String = c.to_string().nfc().collect();
            if unified != c.to_string() {
                out.fix(
                    "zh.compat-ideograph",
                    i,
                    i + 1,
                    unified,
                    m(
                        ctx,
                        "兼容汉字（常见于从 PDF 复制的文字）：应改为统一汉字。",
                        "相容漢字（常見於從 PDF 複製的文字）：應改為統一漢字。",
                    ),
                );
            }
        }
    }
}

/// zh.style.clause-length: a clause of more than 40 characters with no
/// punctuation (not in fiction, not in quotations).
pub(crate) fn clause_length(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.is("fiction") || ctx.block.is_heading() {
        return;
    }
    let mut start = 0;
    for i in 0..=t.len() {
        let end = i == t.len()
            || matches!(
                t.chars[i],
                '，' | '。'
                    | '；'
                    | '：'
                    | '！'
                    | '？'
                    | '、'
                    | ','
                    | '.'
                    | ';'
                    | ':'
                    | '!'
                    | '?'
                    | '…'
                    | '—'
                    | '\n'
                    | '“'
                    | '”'
                    | '「'
                    | '」'
                    | '（'
                    | '）'
            );
        if end {
            let len = t.chars[start..i].iter().filter(|&&c| is_cjk(c)).count();
            if len > 40 && !t.in_quotes(start, i) {
                out.flag(
                    "zh.style.clause-length",
                    start,
                    i,
                    m(
                        ctx,
                        &format!("这一分句很长（{len} 字没有标点），可以考虑拆开。"),
                        &format!("這一分句很長（{len} 字沒有標點），可以考慮拆開。"),
                    ),
                );
            }
            start = i + 1;
        }
    }
}

pub(crate) static DOCNUM: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"([〔\[\(（【［])(\d{4})([〕\]\)）】］])(第?)(0*)(\d+)号").unwrap()
});

pub(crate) static GONGWEN_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d{4}年(0?\d{1,2})月(0?\d{1,2})日").unwrap());

/// The 公文 profile (GB/T 9704, 条例): document numbers, dates, titles.
pub(crate) fn gongwen(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !ctx.profile.is("gongwen") {
        return;
    }
    for caps in t.captures(&DOCNUM) {
        let (
            Some((a, b)),
            Some((o, _)),
            Some((y1, y2)),
            Some((c, _)),
            Some((d1, d2)),
            Some((z1, z2)),
            Some((n1, n2)),
        ) = (
            caps[0], caps[1], caps[2], caps[3], caps[4], caps[5], caps[6],
        )
        else {
            continue;
        };
        if t.chars[o] != '〔' || t.chars[c] != '〕' || d2 > d1 || z2 > z1 {
            out.fix(
                "zh.gongwen.docnum",
                a,
                b,
                format!("〔{}〕{}号", t.slice(y1, y2), t.slice(n1, n2)),
                "发文字号写作“代字〔年份〕序号号”：六角括号，序号不加“第”、不编虚位。",
            );
        }
    }
    for caps in t.captures(&GONGWEN_DATE) {
        for g in [caps[1], caps[2]].into_iter().flatten() {
            let (x, y) = g;
            if y - x == 2 && t.chars[x] == '0' {
                out.fix(
                    "zh.gongwen.date",
                    x,
                    y,
                    t.chars[x + 1].to_string(),
                    "成文日期的月、日不编虚位：“2026年10月9日”。",
                );
            }
        }
    }
    if ctx.block.is_heading() {
        for word in ["请示报告", "报告请示"] {
            for (a, b) in find_str(t, word) {
                out.flag(
                    "zh.gongwen.title",
                    a,
                    b,
                    "公文标题不要并用“请示”和“报告”：请示用于请求批准，报告不得夹带请示事项。",
                );
            }
        }
        for i in 0..t.len() {
            if matches!(
                t.chars[i],
                '，' | '。' | '；' | '：' | '！' | '？' | '“' | '”' | '（' | '）'
            ) {
                out.flag(
                    "zh.gongwen.title",
                    i,
                    i + 1,
                    "公文标题中除书名号外，一般不用标点符号。",
                );
            }
        }
    }
}

pub(crate) const AD_ABSOLUTE: &[&str] = &[
    "国家级",
    "最高级",
    "最佳",
    "最好",
    "顶级",
    "首选",
    "史上最",
    "全网最",
    "最低价",
    "第一品牌",
];

pub(crate) static AD_FIRST: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:销量|全国|全球|行业|世界|全网|排名)第一").unwrap());

pub(crate) static AD_HEALTH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"治疗|治愈|疗效|根治").unwrap());

pub(crate) static AD_DATA: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"数据显示|调查显示|研究表明|研究显示|\d+(?:\.\d+)?%的(?:用户|消费者|人|网友)")
        .unwrap()
});

/// The newmedia profile: 广告法 absolute terms (warnings, with the
/// exemptions in the message), treatment claims and unsourced data.
pub(crate) fn ad(t: &Text, ctx: &Ctx, out: &mut Out) {
    if !ctx.profile.is("newmedia") {
        return;
    }
    let msg = "广告法禁用绝对化用语；商标、官方奖项或有时间地点限定的真实数据可除外。";
    for word in AD_ABSOLUTE {
        for (a, b) in find_str(t, word) {
            out.flag("zh.ad.absolute", a, b, msg);
        }
    }
    for (a, b) in t.find(&AD_FIRST) {
        out.flag("zh.ad.absolute", a, b, msg);
    }
    for (a, b) in t.find(&AD_HEALTH) {
        out.flag("zh.ad.health", a, b, "非医疗广告不得涉及疾病治疗功能。");
    }
    let sourced = ["来源", "出处", "《", "引自", "据悉", "根据", "据统计"]
        .iter()
        .any(|w| t.s.contains(w));
    if !sourced {
        for (a, b) in t.find(&AD_DATA) {
            out.flag("zh.ad.unsourced", a, b, "引用数据、调查结果请注明出处。");
        }
    }
}
