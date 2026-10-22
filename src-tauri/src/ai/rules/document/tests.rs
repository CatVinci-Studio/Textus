
use super::*;

fn rules(report: &DocReport) -> Vec<(&'static str, usize, String)> {
    report
        .findings
        .iter()
        .map(|f| (f.rule, f.line.unwrap(), f.original.clone()))
        .collect()
}

#[test]
fn code_math_front_matter_and_links_are_skipped() {
    let doc = "---\ntitle: a,b\n---\n\n# 标题\n\n今天开会,大家来了。见 `a,b` 和 $x,y$ 以及 [链接](https://a.cn/x,y)。\n\n```\n代码,不查\n```\n\n<div>html,不查</div>\n";
    let report = check_document(doc, &Conventions::default(), Level::Standard, &[]);
    assert_eq!(report.lang, Some(Lang::ZhHans));
    assert_eq!(rules(&report), [("zh.punct.halfwidth", 7, ",".to_string())]);
    // The offset is into the source.
    let f = &report.findings[0];
    assert_eq!(doc.chars().nth(f.start), Some(','));
    assert_eq!(f.suggestion.as_deref(), Some("，"));
}

#[test]
fn the_majority_is_the_whole_documents() {
    // Each paragraph alone has no majority; the document has one.
    let doc = "我用 React 写。\n\n他用 Vue 写。\n\n她用 Go 写。\n\n你用Rust写。\n";
    let report = check_document(doc, &Conventions::default(), Level::Standard, &[]);
    let spacing: Vec<_> = report
        .findings
        .iter()
        .filter(|f| f.rule == "zh.space.cjk-latin")
        .collect();
    assert_eq!(spacing.len(), 2, "{:?}", report.findings);
    assert!(spacing.iter().all(|f| f.line == Some(7)));
}

#[test]
fn blocks_know_their_kind_and_language() {
    let doc = "# Getting started.\n\n- 3 eggs\n- a hour\n\n> He said “the the end”.\n\nThe colour of the centre and the favourite flavor.\n\n这是中文段落,没有问题。\n";
    let report = check_document(doc, &Conventions::default(), Level::Standard, &[]);
    let r = rules(&report);
    assert!(
        r.contains(&("en.heading.end-punct", 1, ".".to_string())),
        "{r:?}"
    );
    assert!(
        r.contains(&("en.word.article", 4, "a".to_string())),
        "{r:?}"
    );
    assert!(
        r.contains(&("en.spelling.variety", 8, "flavor".to_string())),
        "{r:?}"
    );
    assert!(
        r.contains(&("zh.punct.halfwidth", 10, ",".to_string())),
        "{r:?}"
    );
    // A list item starting with a number is fine.
    assert!(!r.iter().any(|x| x.0 == "en.num.sentence-start"));
}

#[test]
fn document_level_rules() {
    let doc = "# One\n\n### Three\n\n#### Four\n\n![](a.png) and ![Image of a cat](b.png)\n\nSee [click here](https://x.y).\n";
    let report = check_document(doc, &Conventions::default(), Level::Standard, &[]);
    let r = rules(&report);
    // P2 structure rules only at strict.
    assert!(r.is_empty(), "{r:?}");
    let strict = check_document(doc, &Conventions::default(), Level::Strict, &[]);
    let r: Vec<&str> = strict.findings.iter().map(|f| f.rule).collect();
    assert_eq!(
        r.iter()
            .filter(|x| **x == "shared.heading-structure")
            .count(),
        2,
        "{r:?}"
    );
    assert_eq!(
        r.iter().filter(|x| **x == "shared.image-alt").count(),
        2,
        "{r:?}"
    );
    assert!(r.contains(&"en.link.text"));
}

#[test]
fn a_suggestion_across_markup_becomes_a_flag() {
    let doc = "我们买了苹果、香蕉……**等**水果，讨论了价格。\n";
    let report = check_document(doc, &Conventions::default(), Level::Standard, &[]);
    let f: Vec<_> = report
        .findings
        .iter()
        .filter(|f| f.rule == "zh.punct.ellipsis-deng")
        .collect();
    assert_eq!(f.len(), 1, "{:?}", report.findings);
    assert_eq!(f[0].original, "……**等");
    assert_eq!((f[0].suggestion.as_deref(), f[0].fix), (None, Fix::None));
}

#[test]
fn short_blocks_take_the_documents_language() {
    assert_eq!(
        block_language("続き書き(補完)", Some(Lang::Ja)),
        Some(Lang::Ja)
    );
    assert_eq!(block_language("Une phrase", Some(Lang::En)), Some(Lang::En));
    assert_eq!(
        block_language("这是一段中文，讨论了三个问题。", Some(Lang::En)),
        Some(Lang::ZhHans)
    );
    assert_eq!(
        block_language("這是", Some(Lang::ZhHans)),
        Some(Lang::ZhHans)
    );
    // A long block says what it is.
    let fr = "Les entretiens ont duré deux mois et nous avons rencontré des habitants dans trois quartiers.";
    assert_eq!(block_language(fr, Some(Lang::En)), Some(Lang::Fr));
    // A Japanese heading of kanji in a Japanese document is checked as
    // Japanese: no Chinese parenthesis rule.
    let doc = "# 概要\n\nこの文書では三つの機能を紹介します。\n\n### 1. 続き書き(補完)\n";
    let report = check_document(doc, &Conventions::default(), Level::Standard, &[]);
    assert!(
        report.findings.iter().all(|f| !f.rule.starts_with("zh.")),
        "{:?}",
        report.findings
    );
}

#[test]
fn spaces_beside_emphasis_markers_are_not_flagged() {
    let doc = "这是一段说明文字。**项目文件夹就是工作的文件夹。** 默认是文档所在的文件夹。\n\n日本語の文書では **太字** や記号を使います。\n";
    let report = check_document(doc, &Conventions::default(), Level::Standard, &[]);
    assert!(report.findings.is_empty(), "{:?}", report.findings);
}

#[test]
fn gongwen_report_must_not_ask_for_approval() {
    let doc = "# 关于经费使用情况的报告\n\n今年经费已用完。请批准追加预算。\n";
    let conv = Conventions {
        setting: Some(serde_json::json!({ "zh-Hans": "zh-Hans-CN/gongwen" })),
        ..Default::default()
    };
    let report = check_document(doc, &conv, Level::Standard, &[]);
    assert!(report
        .findings
        .iter()
        .any(|f| f.rule == "zh.gongwen.report-request" && f.original == "请批准"));
}

#[test]
fn a_long_document_checks_within_budget() {
    let para = "我们用 React 和 Tauri 重写了编辑器，启动时间从 3 秒降到了 800ms。The rewrite took two months and the team shipped it.\n\n";
    let doc = para.repeat(300); // ~ 30,000 chars
    let start = std::time::Instant::now();
    let report = check_document(&doc, &Conventions::default(), Level::Strict, &[]);
    assert!(start.elapsed().as_millis() < 5_000, "{:?}", start.elapsed());
    let _ = report;
}
