use super::super::testing::*;
use super::super::{Block, Lang};

const H: Lang = Lang::ZhHans;

#[test]
fn half_width_punctuation_in_chinese() {
    assert_eq!(
        fixed(
            "zh.punct.halfwidth",
            H,
            None,
            "今天下午开会,大家讨论了三个问题.第一个是预算:钱不够!"
        ),
        "今天下午开会，大家讨论了三个问题。第一个是预算：钱不够！"
    );
    // The space after the comma goes with it.
    assert_eq!(
        fixed("zh.punct.halfwidth", H, None, "开会, 大家来了"),
        "开会，大家来了"
    );
    assert_eq!(
        fixed("zh.punct.halfwidth", H, None, "这是测试(内部版本)的结果"),
        "这是测试（内部版本）的结果"
    );
    for ok in [
        "版本 3.14 和 8:00 开会",
        "备份 MySQL 8.0, 保留 30 天。Done, ok.",
        "1. 第一项",
        "打开文件.txt 看看",
        "使用 Node.js 和 (API) 接口",
        "见 https://a.cn/x,y 页面",
    ] {
        assert!(hits("zh.punct.halfwidth", H, None, ok).is_empty(), "{ok}");
    }
}

#[test]
fn no_space_beside_full_width_marks() {
    assert_eq!(
        fixed("zh.space.fullwidth-adjacent", H, None, "你好 ，世界。 再见"),
        "你好，世界。再见"
    );
    assert_eq!(
        fixed("zh.space.fullwidth-adjacent", H, None, "他说 “好” 然后走了"),
        "他说“好”然后走了"
    );
    // Curly quotes in English text are not full-width marks.
    assert!(hits(
        "zh.space.fullwidth-adjacent",
        H,
        None,
        "He said “Hello” to me."
    )
    .is_empty());
}

#[test]
fn ellipses() {
    assert_eq!(
        fixed(
            "zh.punct.ellipsis",
            H,
            None,
            "他想了想...然后走了。。。还有…以及⋯⋯和………"
        ),
        "他想了想……然后走了……还有……以及……和……"
    );
    // Two pairs (omitted paragraphs) and English segments stay.
    assert!(hits("zh.punct.ellipsis", H, None, "前文…………后文").is_empty());
    assert!(hits("zh.punct.ellipsis", H, None, "他说 wait... ok 吧").is_empty());
    // Menu labels keep their single ellipsis.
    assert!(hits(
        "zh.punct.ellipsis",
        H,
        None,
        "右键 > 询问 AI…）打开，或选择导入技能… 即可"
    )
    .is_empty());
    assert_eq!(
        fixed(
            "zh.punct.ellipsis-deng",
            H,
            None,
            "苹果、香蕉……等水果，桃子...等等"
        ),
        "苹果、香蕉等水果，桃子等等"
    );
}

#[test]
fn dashes_but_not_ranges() {
    assert_eq!(
        fixed("zh.punct.dash", H, None, "我们必须承认--这件事很难"),
        "我们必须承认——这件事很难"
    );
    assert_eq!(
        fixed("zh.punct.dash", H, None, "他停了一下──然后说"),
        "他停了一下——然后说"
    );
    assert_eq!(
        fixed("zh.punct.dash", H, None, "我们必须要承认—这件事情真的很难"),
        "我们必须要承认——这件事情真的很难"
    );
    for ok in ["北京—上海特快", "1031—1095年", "2023--2024 赛季"] {
        assert!(hits("zh.punct.dash", H, None, ok).is_empty(), "{ok}");
    }
    // Taiwan writes ──: not a mainland rule there.
    assert!(hits("zh.punct.dash", Lang::ZhHant, None, "他停了一下──然後說").is_empty());
}

#[test]
fn stacked_marks_by_profile() {
    assert!(hits(
        "zh.punct.stacked",
        H,
        Some("zh-Hans-CN/fiction"),
        "什么？！你说什么！！！"
    )
    .is_empty());
    assert_eq!(
        hits(
            "zh.punct.stacked",
            H,
            Some("zh-Hans-CN/fiction"),
            "天哪！！！！"
        ),
        one("！！！！", "！！！")
    );
    assert_eq!(
        hits("zh.punct.stacked", H, Some("zh-Hans-CN/tech"), "成功了！！"),
        one("！！", "！")
    );
    assert_eq!(
        hits(
            "zh.punct.stacked",
            H,
            Some("zh-Hans-CN/tech"),
            "真的吗？？！"
        ),
        one("？？！", "？！")
    );
    // ？！ is always fine.
    assert!(hits("zh.punct.stacked", H, Some("zh-Hans-CN/tech"), "真的？！").is_empty());
}

#[test]
fn heading_punctuation() {
    assert_eq!(
        hits_in(
            "zh.heading.end-punct",
            H,
            None,
            "第一章 开始。",
            Block::Heading(2)
        ),
        one("。", "")
    );
    assert!(hits_in(
        "zh.heading.end-punct",
        H,
        None,
        "为什么？",
        Block::Heading(2)
    )
    .is_empty());
    assert!(hits_in(
        "zh.heading.end-punct",
        H,
        None,
        "他走了。",
        Block::Paragraph
    )
    .is_empty());
}

#[test]
fn straight_quotes_around_chinese() {
    assert_eq!(
        fixed("zh.quote.straight", H, None, "他说\"你好\"就走了"),
        "他说“你好”就走了"
    );
    assert_eq!(
        fixed(
            "zh.quote.straight",
            H,
            Some("zh-Hans-CN"),
            "他说\"你好\"就走了"
        ),
        "他说“你好”就走了"
    );
    let corner = super::super::testing::findings(H, None, "x", Block::Unknown);
    assert!(corner.is_empty());
    for ok in [
        "他说 \"hello world\" 吧",
        "只有一个\"引号",
        "代码 `\"a\"` 里",
    ] {
        assert!(hits("zh.quote.straight", H, None, ok).is_empty(), "{ok}");
    }
}

#[test]
fn cjk_latin_spacing_follows_the_majority_or_the_setting() {
    // Automatic: two spaced, one tight -> the tight one is flagged.
    assert_eq!(
        hits("zh.space.cjk-latin", H, None, "我用 React 写了一个Vue 组件"),
        one("个V", "个 V")
    );
    // A tie or a single example: nothing.
    assert!(hits("zh.space.cjk-latin", H, None, "我用React和 Vue").is_empty());
    assert!(hits("zh.space.cjk-latin", H, None, "我用React写的").is_empty());
    // The tech profile wants spaces.
    assert_eq!(
        fixed(
            "zh.space.cjk-latin",
            H,
            Some("zh-Hans-CN/tech"),
            "我用React写的"
        ),
        "我用 React 写的"
    );
    // Never before % or punctuation.
    assert!(hits(
        "zh.space.cjk-latin",
        H,
        Some("zh-Hans-CN/tech"),
        "增长了50%。"
    )
    .iter()
    .all(|(o, _)| !o.contains('%')));
}

#[test]
fn widths_decimals_and_numbers() {
    assert_eq!(
        fixed("zh.width.alnum", H, None, "第Ａ１号文件"),
        "第A1号文件"
    );
    assert!(hits(
        "zh.width.alnum",
        Lang::ZhHant,
        Some("zh-Hant-TW/gongwen"),
        "１、說明"
    )
    .is_empty());
    assert_eq!(
        fixed("zh.num.decimal", H, None, "比例是0。46，或者是.46"),
        "比例是0.46，或者是0.46"
    );
    assert_eq!(
        fixed("zh.num.approx", H, None, "过了3、4个月"),
        "过了三四个月"
    );
    assert_eq!(
        fixed("zh.num.approx", H, None, "来了几1000人"),
        "来了几千人"
    );
    for ok in ["第3、4个", "1、2、3个", "3、5个", "二、三产业"] {
        assert!(hits("zh.num.approx", H, None, ok).is_empty(), "{ok}");
    }
    assert!(hits("zh.num.approx", Lang::ZhHant, None, "約3、4天").is_empty());
    assert_eq!(
        fixed("zh.title.dunhao", H, None, "读了《红楼梦》、《水浒传》"),
        "读了《红楼梦》《水浒传》"
    );
    assert_eq!(
        hits("zh.num.mixed-date", H, None, "二〇二六年10月").len(),
        1
    );
    assert_eq!(hits("zh.num.short-year", H, None, "98年5月出生").len(), 1);
    assert!(hits("zh.num.short-year", H, None, "90年代，活了90年").is_empty());
    assert_eq!(fixed("zh.num.mixed-unit", H, None, "有4千人"), "有4000人");
    assert_eq!(hits("zh.num.mixed-unit", H, None, "共1百零8将").len(), 1);
    for ok in ["跑了5千米", "重3千克", "10万人", "3亿元"] {
        assert!(hits("zh.num.mixed-unit", H, None, ok).is_empty(), "{ok}");
    }
    assert_eq!(
        fixed("zh.date.dunhao", H, None, "于2008-8发布"),
        "于2008-08发布"
    );
    assert!(hits("zh.date.dunhao", H, None, "于2008-08-08发布").is_empty());
}

#[test]
fn never_flag_identifiers_and_established_terms() {
    for ok in [
        "2026年的3G网络和MP3",
        "G8峰会讨论维生素B12",
        "电话 010-12345678",
        "型号 A3-200 的价格",
        "第1990号",
    ] {
        let all = findings(H, None, ok, Block::Unknown);
        assert!(
            all.iter().all(|f| !f.rule.starts_with("zh.num")),
            "{ok}: {all:?}"
        );
    }
    assert_eq!(
        fixed("zh.num.ascii-range", H, None, "需要3-5天"),
        "需要3～5天"
    );
    assert_eq!(fixed("zh.num.unit-space", H, None, "增长 50 %"), "增长 50%");
}

#[test]
fn words_script_and_ideographs() {
    assert_eq!(
        fixed("zh.word.typo", H, None, "我们要再接再励"),
        "我们要再接再厉"
    );
    assert!(hits("zh.word.typo", H, None, "“再接再励”是常见错误").is_empty());
    assert_eq!(
        fixed("zh.word.typo", Lang::ZhHant, None, "我們要再接再勵"),
        "我們要再接再厲"
    );
    assert_eq!(
        fixed("zh.word.variant", H, None, "这是惟一的成份"),
        "这是唯一的成分"
    );
    // 蹚水 and 标识 are standard.
    assert!(hits("zh.word.variant", H, None, "蹚水过河的标识").is_empty());
    assert_eq!(
        hits(
            "zh.script.mixed",
            H,
            None,
            "我们这个问题很重要，我們明天再讨论这个问题。"
        ),
        one("們", "们")
    );
    // Mostly Traditional text isn't "Simplified with strays".
    assert!(hits("zh.script.mixed", H, None, "這個問題").is_empty());
    assert_eq!(fixed("zh.compat-ideograph", H, None, "\u{F99A}續"), "連續");
    assert!(hits("zh.compat-ideograph", H, None, "\u{FA11}").is_empty());
}

#[test]
fn middot_and_long_clauses() {
    assert_eq!(
        fixed("zh.punct.middot", H, None, "让・雅克•卢梭"),
        "让·雅克·卢梭"
    );
    let long = "这是一个非常非常长的没有任何标点符号的句子它一直写下去写下去写下去写下去一直到超过了四十个字为止";
    assert_eq!(hits("zh.style.clause-length", H, None, long).len(), 1);
    assert!(hits(
        "zh.style.clause-length",
        H,
        Some("zh-Hans-CN/fiction"),
        long
    )
    .is_empty());
}

#[test]
fn gongwen_and_newmedia_profiles_only() {
    let g = Some("zh-Hans-CN/gongwen");
    assert_eq!(
        fixed("zh.gongwen.docnum", H, g, "国办发[2012]第09号"),
        "国办发〔2012〕9号"
    );
    assert!(hits("zh.gongwen.docnum", H, g, "国办发〔2012〕9号").is_empty());
    assert!(hits("zh.gongwen.docnum", H, None, "国办发[2012]第09号").is_empty());
    assert_eq!(
        fixed("zh.gongwen.date", H, g, "2026年10月09日"),
        "2026年10月9日"
    );
    assert_eq!(
        hits_in(
            "zh.gongwen.title",
            H,
            g,
            "关于经费的请示报告",
            Block::Heading(1)
        )
        .len(),
        1
    );
    let n = Some("zh-Hans-CN/newmedia");
    assert_eq!(
        hits("zh.ad.absolute", H, n, "全网最低，销量第一的最佳选择").len(),
        3
    );
    assert!(hits("zh.ad.absolute", H, n, "这是第一次见面").is_empty());
    assert!(hits("zh.ad.absolute", H, None, "最佳选择").is_empty());
    assert_eq!(
        hits("zh.ad.unsourced", H, n, "数据显示，90%的用户喜欢").len(),
        2
    );
    assert!(hits("zh.ad.unsourced", H, n, "据《年报》数据显示").is_empty());
}
