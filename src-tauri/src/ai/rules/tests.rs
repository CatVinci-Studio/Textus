use super::*;

#[test]
fn levels_pick_rules_by_priority_and_category() {
    let r = |id| registry::info(id);
    assert!(allowed(r("zh.word.typo"), Level::Typos, false));
    assert!(!allowed(r("zh.punct.halfwidth"), Level::Typos, false));
    assert!(allowed(r("zh.punct.halfwidth"), Level::Standard, false));
    assert!(!allowed(r("en.word.wordy"), Level::Standard, false));
    assert!(allowed(r("en.word.wordy"), Level::Strict, false));
    assert!(allowed(r("en.punct.dash-style"), Level::Standard, true));
    assert!(!allowed(r("en.punct.dash-style"), Level::Standard, false));
    assert!(allowed(r("tw.gongwen.year"), Level::Standard, false));
}

#[test]
fn shared_messages_follow_the_apps_language() {
    let conv = Conventions::default();
    let text = "This sentence has  two spaces in the middle of it, written in English.";
    let message = |ui| {
        check_for(text, &conv, Level::Standard, &[], ui)
            .into_iter()
            .find(|f| f.rule.starts_with("shared."))
            .map(|f| f.message)
            .expect("a double space")
    };
    let english = message(None);
    let chinese = message(Some("zh"));
    assert_ne!(english, chinese, "the app's language, not the text's");
    assert_eq!(
        chinese,
        messages::get("shared.double-space", Lang::ZhHans, &[])
    );
}

#[test]
fn the_grammar_check_gets_paragraph_rules_only() {
    let conv = Conventions::default();
    let found = check(
        "今天下午开会,大家讨论了三个问题.",
        &conv,
        Level::Standard,
        &[],
    );
    let pairs: Vec<(&str, &str)> = found
        .iter()
        .map(|f| (f.original.as_str(), f.suggestion.as_deref().unwrap()))
        .collect();
    assert_eq!(pairs, [(",", "，"), (".", "。")]);
    assert_eq!(found[0].message, "中文句子里应使用全角标点。");
    // Typos level: spelling rules only.
    assert!(check("今天下午开会,大家讨论了三个问题.", &conv, Level::Typos, &[]).is_empty());
    let typo = check("我们要再接再励,继续努力。", &conv, Level::Typos, &[]);
    assert_eq!(typo.len(), 1);
    assert_eq!(typo[0].suggestion.as_deref(), Some("再接再厉"));
    // Too short to tell the language: nothing language-specific.
    assert!(check("ok , fine", &conv, Level::Standard, &[]).is_empty());
}

#[test]
fn apply_skips_overlaps_and_is_idempotent() {
    let conv = Conventions::default();
    let text = "我们用React写了一个工具,很快...真的。";
    let found = check(text, &conv, Level::Standard, &[]);
    let once = apply(text, &found);
    assert_eq!(once, "我们用React写了一个工具，很快……真的。");
    assert!(check(&once, &conv, Level::Standard, &[])
        .iter()
        .all(|f| f.fix != Fix::Safe));
}

#[test]
fn a_paragraph_checks_well_under_budget() {
    let conv = Conventions::default();
    let para = "我们用 React 和 Tauri 重写了编辑器,启动时间从 3 秒降到了 800ms。The rewrite took two months, and the the team shipped it. ".repeat(20);
    let start = std::time::Instant::now();
    for _ in 0..10 {
        check(&para, &conv, Level::Strict, &[]);
    }
    // ~2,000 chars x 10 runs; generous for debug builds and CI.
    assert!(start.elapsed().as_millis() < 3_000, "{:?}", start.elapsed());
}
