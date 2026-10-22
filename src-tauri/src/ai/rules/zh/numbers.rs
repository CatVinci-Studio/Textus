//! Numbers in Chinese text: decimals, approximate counts, dates, units
//! and ranges.

use super::*;

pub(crate) static DECIMAL_MARU: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d。\d").unwrap());

pub(crate) static DECIMAL_BARE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.\d+").unwrap());

/// zh.num.decimal: 0。46 and .46 -> 0.46.
pub(crate) fn decimal(t: &Text, ctx: &Ctx, out: &mut Out) {
    let msg = m(
        ctx,
        "小数点用“.”，整数部分的 0 不能省略。",
        "小數點用「.」，整數部分的 0 不能省略。",
    );
    for (a, _) in t.find(&DECIMAL_MARU) {
        out.fix("zh.num.decimal", a + 1, a + 2, ".", msg.clone());
    }
    for (a, b) in t.find(&DECIMAL_BARE) {
        let before_ok = t
            .before(a)
            .is_none_or(|c| is_cjk(c) || c == ' ' || matches!(c, '（' | '，' | '：'));
        let after_ok = t
            .at(b)
            .is_none_or(|c| !(c == '.' || c.is_ascii_alphanumeric()));
        if before_ok && after_ok && t.before(a).is_some_and(is_cjk) {
            out.fix(
                "zh.num.decimal",
                a,
                b,
                format!("0{}", t.slice(a, b)),
                msg.clone(),
            );
        }
    }
}

pub(crate) const MEASURE: &str =
    "个天日月年人次岁小时分钟周名位本件元块斤里米倍成层家项条辆台张页章节句只头匹";

pub(crate) static APPROX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"([1-9])、([1-9])").unwrap());

pub(crate) static JI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"几(\d+)").unwrap());

/// zh.num.approx (mainland): 3、4个 -> 三四个, 几1000 -> 几千. Only adjacent
/// numbers before a measure word, never after 第 or in a list.
pub(crate) fn approx(t: &Text, _ctx: &Ctx, out: &mut Out) {
    const DIGITS: [&str; 10] = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
    for caps in t.captures(&APPROX) {
        let (Some((a, b)), Some((x, _)), Some((y, _))) = (caps[0], caps[1], caps[2]) else {
            continue;
        };
        let (p, q) = (
            t.chars[x].to_digit(10).unwrap(),
            t.chars[y].to_digit(10).unwrap(),
        );
        let measure = t.at(b).is_some_and(|c| MEASURE.contains(c));
        let listed = t
            .before(a)
            .is_some_and(|c| c == '第' || c == '、' || c.is_ascii_digit())
            || t.at(b) == Some('、');
        if q == p + 1 && measure && !listed {
            out.fix(
                "zh.num.approx",
                a,
                b,
                format!("{}{}", DIGITS[p as usize], DIGITS[q as usize]),
                "相邻数字表示概数时用汉字，不加顿号：“三四个”。",
            );
        }
    }
    for caps in t.captures(&JI) {
        let (Some((a, b)), Some((x, y))) = (caps[0], caps[1]) else {
            continue;
        };
        let unit = match t.slice(x, y).as_str() {
            "10" => Some("十"),
            "100" => Some("百"),
            "1000" => Some("千"),
            "10000" => Some("万"),
            _ => None,
        };
        let msg = "“几”后用汉字数字：“几千”。";
        match unit {
            Some(u) => out.fix("zh.num.approx", a, b, format!("几{u}"), msg),
            None => out.flag("zh.num.approx", a, b, msg),
        }
    }
}

pub(crate) static MIXED_DATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[〇○零一二三四五六七八九]{4}年\d{1,2}月|\d{4}年[一二三四五六七八九十]{1,3}月")
        .unwrap()
});

/// zh.num.mixed-date: 二〇二六年10月 - one date in two numeral systems.
pub(crate) fn mixed_date(t: &Text, ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&MIXED_DATE) {
        out.flag(
            "zh.num.mixed-date",
            a,
            b,
            m(
                ctx,
                "同一个日期不要混用汉字数字和阿拉伯数字。",
                "同一個日期不要混用中文數字和阿拉伯數字。",
            ),
        );
    }
}

pub(crate) static SHORT_YEAR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d{2,4}年\d{1,2}月").unwrap());

/// zh.num.short-year: 98年5月 - a year shortened to two digits (90年代 is
/// usage, and 活了90年 is a duration: only year-month dates are taken).
pub(crate) fn short_year(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.lang == Lang::ZhHant {
        return; // 民國 years are two- and three-digit.
    }
    for (a, b) in t.find(&SHORT_YEAR) {
        let digits = t.chars[a..b]
            .iter()
            .take_while(|c| c.is_ascii_digit())
            .count();
        if digits == 2 && !t.before(a).is_some_and(|c| c.is_ascii_digit()) {
            out.flag("zh.num.short-year", a, a + 3, "年份应写全，如“1998年”。");
        }
    }
}

pub(crate) static MIXED_UNIT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(\d+)([百千])([零〇]?\d+)?|[一二三四五六七八九十百千]+[零〇]?\d+").unwrap()
});

/// zh.num.mixed-unit (mainland): 4千, 1百零8, 一百08 - Arabic digits mix
/// only with 万 and 亿. 千米, 千克, 千瓦, 百分 are units, not numbers.
pub(crate) fn mixed_unit(t: &Text, ctx: &Ctx, out: &mut Out) {
    if ctx.profile.is("gongwen") && ctx.lang == Lang::ZhHant {
        return;
    }
    let msg = m(
        ctx,
        "阿拉伯数字只与“万”“亿”连用：写“4000”，不写“4千”。",
        "阿拉伯數字只與「萬」「億」連用：寫「4000」，不寫「4千」。",
    );
    for caps in t.captures(&MIXED_UNIT) {
        let Some((a, b)) = caps[0] else { continue };
        let next = t.at(b);
        if next.is_some_and(|c| "米克瓦卡兆赫分字".contains(c))
            || t.before(a)
                .is_some_and(|c| c.is_ascii_digit() || is_han(c) && "第周".contains(c))
        {
            continue;
        }
        match (caps[1], caps[2], caps[3]) {
            (Some((x, y)), Some((u, _)), None) => {
                let digits = t.slice(x, y);
                let zeros = if t.chars[u] == '千' { "000" } else { "00" };
                if digits.len() <= 3 {
                    out.fix(
                        "zh.num.mixed-unit",
                        a,
                        b,
                        format!("{digits}{zeros}"),
                        msg.clone(),
                    );
                }
            }
            _ => out.flag("zh.num.mixed-unit", a, b, msg.clone()),
        }
    }
}

pub(crate) static HYPHEN_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?-u:\b)(\d{4})-(\d)(?-u:\b)").unwrap());

/// zh.date.dunhao: an incomplete hyphen date (2008-8).
pub(crate) fn date_dunhao(t: &Text, ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&HYPHEN_DATE) {
        let (Some((a, b)), Some((y1, y2)), Some((d, _))) = (caps[0], caps[1], caps[2]) else {
            continue;
        };
        if t.at(b) == Some('-') || t.at(b).is_some_and(|c| c.is_ascii_digit()) {
            continue;
        }
        out.fix(
            "zh.date.dunhao",
            a,
            b,
            format!("{}-0{}", t.slice(y1, y2), t.chars[d]),
            m(
                ctx,
                "用连接号的日期，月、日写两位，如“2008-08”。",
                "用連接號的日期，月、日寫兩位，如「2008-08」。",
            ),
        );
    }
}

pub(crate) static UNIT_SPACE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\d[ \u{00A0}]+[%°℃‰′″]").unwrap());

/// zh.num.unit-space: no space between a number and % ° ′ ″.
pub(crate) fn unit_space(t: &Text, ctx: &Ctx, out: &mut Out) {
    for (a, b) in t.find(&UNIT_SPACE) {
        out.fix(
            "zh.num.unit-space",
            a,
            b,
            format!("{}{}", t.chars[a], t.chars[b - 1]),
            m(
                ctx,
                "数字与 %、° 等符号之间不加空格。",
                "數字與 %、° 等符號之間不加空格。",
            ),
        );
    }
}

pub(crate) static ASCII_RANGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?-u:\b)(\d{1,4})-(\d{1,4})(?-u:\b)").unwrap());

/// zh.num.ascii-range: 3-5天 -> 3～5天. Not full dates, codes, phone or
/// model numbers: only a short range before a Chinese measure word.
pub(crate) fn ascii_range(t: &Text, ctx: &Ctx, out: &mut Out) {
    for caps in t.captures(&ASCII_RANGE) {
        let (Some((a, b)), Some((x1, x2)), Some((y1, y2))) = (caps[0], caps[1], caps[2]) else {
            continue;
        };
        let before_ok = t
            .before(a)
            .is_none_or(|c| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '/')));
        let after_ok = t
            .at(b)
            .is_some_and(|c| is_han(c) && (MEASURE.contains(c) || "℃度分秒期岁届".contains(c)));
        let date_like = x2 - x1 == 4 && y2 - y1 == 2;
        if before_ok && after_ok && !date_like && t.at(b) != Some('-') {
            out.fix(
                "zh.num.ascii-range",
                a,
                b,
                format!("{}～{}", t.slice(x1, x2), t.slice(y1, y2)),
                m(
                    ctx,
                    "表示数值范围用“～”或“—”，不用“-”。",
                    "表示數值範圍用「～」，不用「-」。",
                ),
            );
        }
    }
}
