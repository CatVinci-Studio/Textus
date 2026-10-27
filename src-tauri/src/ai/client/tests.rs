use super::*;

#[test]
fn grammar_explanations_are_in_the_apps_language() {
    let zh = grammar_instructions(None, Some("zh"));
    assert!(zh.contains("one short sentence in Chinese (the language of the writer's app"));
    assert!(!zh.contains("{ISSUE_LANGUAGE}"));
    // No UI language (the live eval) or an unknown one: the paragraph's.
    assert!(
        grammar_instructions(None, None).contains("one short sentence in the paragraph's language")
    );
    assert!(grammar_instructions(None, Some("xx")).contains("the paragraph's language"));
}

fn hints_with(prose: &str, ui: Option<&str>) -> CompletionHints {
    CompletionHints {
        block: Some("paragraph".into()),
        prose: Some(prose.into()),
        ui_language: ui.map(str::to_string),
        ..Default::default()
    }
}

#[test]
fn a_diagram_with_no_prose_around_it_completes_in_the_apps_language() {
    let before = "graph TD\n  A[Start] --> B{Is it?}\n  B -->|Yes| C[OK]";
    let hints = hints_with("", Some("zh"));
    assert_eq!(
        completion_language(before, "", &hints),
        Some(("Chinese", false))
    );
    let (instructions, _) = completion_prompt(before, "", &hints, None);
    assert!(instructions.contains("so write in Chinese, the language of the writer's app"));
    // Without the frontend's prose (whose labels above are English
    // words), bare diagram keywords still don't read as a language.
    let bare = CompletionHints {
        ui_language: Some("zh".into()),
        ..Default::default()
    };
    assert_eq!(
        completion_language("graph TD\n  A --> B\n  B --> C", "", &bare),
        Some(("Chinese", false))
    );
}

#[test]
fn the_prose_decides_the_language_over_the_app_and_the_code() {
    let code = "SELECT id, name FROM users WHERE active = true ORDER BY name";
    let zh = hints_with("这项研究在三个街区进行，我们和居民做了访谈。", Some("en"));
    assert_eq!(completion_language(code, "", &zh), Some(("Chinese", true)));
    let en = hints_with(
        "The survey ran in three districts, and we talked to the people who live there.",
        Some("zh"),
    );
    assert_eq!(completion_language(code, "", &en), Some(("English", true)));
    // Too short for the detector, but its script says enough.
    let ru = hints_with("Привет", Some("zh"));
    assert_eq!(completion_language("", "", &ru), Some(("Russian", true)));
    // A few ideographs: the Chinese the app is in, not a guess between
    // Simplified and Traditional.
    let hant = hints_with("圖表", Some("zh-Hant"));
    assert_eq!(
        completion_language("", "", &hant),
        Some(("Traditional Chinese", false))
    );
}

#[test]
fn code_and_bare_requests_get_no_language_line() {
    let code = CompletionHints {
        block: Some(CODE_BLOCK_HINT.into()),
        ui_language: Some("zh".into()),
        ..Default::default()
    };
    assert_eq!(completion_language("fn main() {", "", &code), None);
    assert_eq!(
        completion_language("", "", &CompletionHints::default()),
        None
    );
    let (instructions, _) = completion_prompt("", "", &CompletionHints::default(), None);
    assert!(!instructions.contains("Language:"));
}

#[test]
fn the_completion_prompt_has_no_example_words_in_cyrillic() {
    // A Russian example word in the prompt is what a context with no
    // prose of its own fell back on.
    assert!(!COMPLETION_INSTRUCTIONS
        .chars()
        .any(|c| ('\u{0400}'..='\u{04ff}').contains(&c)));
}

#[test]
fn a_chinese_clause_at_the_cursor_is_written_out_and_taken_off() {
    assert_eq!(
        clause_at_cursor("告诉自己今天先跑十分"),
        Some("告诉自己今天先跑十分")
    );
    // At most the last ten characters of a long clause.
    assert_eq!(
        clause_at_cursor("她每天六点准时出现在操场上的跑道边"),
        Some("出现在操场上的跑道边")
    );
    assert_eq!(clause_at_cursor("好的，"), None);
    assert_eq!(clause_at_cursor("Rust 重写"), Some("重写"));
    assert_eq!(clause_at_cursor("the end"), None);
    let user = completion_user_text("我每天先跑十分", "", &CompletionHints::default());
    assert!(
        user.contains("<text-before-cursor></text-before-cursor>"),
        "{user}"
    );
    assert!(
        user.contains("<clause-at-cursor>我每天先跑十分</clause-at-cursor>"),
        "{user}"
    );
    // Written out again, it is taken off; a whole word comes back whole.
    assert_eq!(
        fit_to_cursor("我每天先跑十分", "我每天先跑十分钟就好。"),
        "钟就好。"
    );
    assert_eq!(
        fit_to_cursor("没", "没想到会坚持这么久。"),
        "想到会坚持这么久。"
    );
}

#[test]
fn an_as_you_type_suggestion_stops_at_its_first_clause() {
    let short = CompletionHints {
        length: Some("short".into()),
        ..Default::default()
    };
    assert_eq!(
        finish_suggestion(
            "我每天先跑十分",
            "",
            "我每天先跑十分钟就好。后来越跑越远。",
            &short
        ),
        "钟就好。"
    );
    assert_eq!(
        finish_suggestion(
            "The tide went",
            "",
            "went out at dawn. Boats lay still.",
            &short
        ),
        " out at dawn."
    );
    assert_eq!(
        finish_suggestion(
            "我这边可能",
            "",
            "我这边可能需要延期一周，主要是问卷回收比预期慢。",
            &short
        ),
        "需要延期一周，"
    );
    assert_eq!(first_clause("跑得不快"), "跑得不快");
    assert_eq!(
        first_clause(" and it only drips when the flat above uses water, mostly in the evening"),
        " and it only drips when the flat above uses water,"
    );
    assert_eq!(
        first_clause(" one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen"),
        " one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen"
    );
    // "3.5" and a closing quote don't end a sentence early.
    assert_eq!(
        first_sentence("version 3.5 is out.” Then"),
        "version 3.5 is out.”"
    );
    // An explicit continuation keeps all its sentences.
    let long = CompletionHints {
        length: Some("long".into()),
        ..Default::default()
    };
    assert_eq!(
        finish_suggestion("The tide went", "", "went out. Boats lay still.", &long),
        " out. Boats lay still."
    );
}

#[test]
fn nothing_doubles_up_at_the_join() {
    // A clause mark the text already ends with.
    assert_eq!(
        fit_to_cursor("只收回了 120 份，", "，离计划还差不少。"),
        "离计划还差不少。"
    );
    assert_eq!(
        fit_to_cursor("If all goes well,", ", we finish."),
        " we finish."
    );
    // An ellipsis the reply opened with.
    assert_eq!(
        fit_to_cursor("请他们在班会上再提醒", "……学生填写。"),
        "学生填写。"
    );
    // A different mark, or one in the middle, stays.
    assert_eq!(fit_to_cursor("她笑着说，", "“记不清了。”"), "“记不清了。”");
}

#[test]
fn completion_user_text_puts_hints_before_the_cursor_split() {
    let hints = CompletionHints {
        title: Some("Field notes".into()),
        section: vec!["Methods".into(), "Sampling".into()],
        block: Some("list item".into()),
        length: Some("short".into()),
        ..Default::default()
    };
    let text = completion_user_text("We took, ", "", &hints);
    assert_eq!(
        text,
        "<document-title>Field notes</document-title>\n\
         <section>Methods > Sampling</section>\n\
         <block>list item</block>\n\
         <text-before-cursor>We took, </text-before-cursor>\n\
         <text-after-cursor></text-after-cursor>"
    );
    // No hints: just the split.
    assert_eq!(
        completion_user_text("it is ", "b", &CompletionHints::default()),
        "<text-before-cursor>it is </text-before-cursor>\n<text-after-cursor>b</text-after-cursor>"
    );
    // The word the cursor is in or right after gets a tag of its own.
    assert_eq!(
        completion_user_text("a copy of the docu", "", &CompletionHints::default()),
        "<text-before-cursor>a copy of the </text-before-cursor>\n<word-at-cursor>docu</word-at-cursor>\n<text-after-cursor></text-after-cursor>"
    );
}

#[test]
fn the_word_at_the_cursor_is_the_whole_written_word() {
    assert_eq!(word_at_cursor("a full copy of the docu"), Some("docu"));
    assert_eq!(word_at_cursor("it quickly"), Some("quickly"));
    assert_eq!(word_at_cursor("Lessons"), Some("Lessons"));
    assert_eq!(word_at_cursor("I don't"), Some("don't"));
    assert_eq!(word_at_cursor("a well-known"), Some("well-known"));
    assert_eq!(word_at_cursor("version 3.5"), Some("3.5"));
    assert_eq!(word_at_cursor("closed 2,300"), Some("2,300"));
    assert_eq!(word_at_cursor("직장인들이"), Some("직장인들이"));
    // A short word before an apostrophe: an elision or a contraction.
    assert_eq!(word_at_cursor("réserver l'"), Some("l'"));
    assert_eq!(word_at_cursor("I don'"), Some("don'"));
    // Joiners only inside a word.
    assert_eq!(word_at_cursor("see e.g."), None);
    assert_eq!(word_at_cursor("(\"hello"), Some("hello"));
    // Nothing to complete: a space, punctuation, a closing quote or
    // plural possessive, or a script written without spaces.
    assert_eq!(word_at_cursor("thank you for "), None);
    assert_eq!(word_at_cursor("Berufstätige,"), None);
    assert_eq!(word_at_cursor("the students'"), None);
    assert_eq!(word_at_cursor("规划者在制定方案时"), None);
    assert_eq!(word_at_cursor(""), None);
}

#[test]
fn completions_join_the_text_before_the_cursor() {
    // The word at the cursor written out in full is cut off again: the
    // rest of a cut-off word, or a space and the next word.
    assert_eq!(
        fit_to_cursor("a full copy of the docu", "document grew"),
        "ment grew"
    );
    assert_eq!(
        fit_to_cursor("on long files it quickly", "quickly grew"),
        " grew"
    );
    assert_eq!(fit_to_cursor("직장인들이", "직장인들이 들른다"), " 들른다");
    assert_eq!(fit_to_cursor("준비물\n\n상비", "상비약"), "약");
    assert_eq!(fit_to_cursor("réserver l'", "l'hôtel"), "hôtel");
    // A longer echo goes too: two words of a heading, a list item.
    assert_eq!(
        fit_to_cursor("Lessons from", "Lessons from a year of Tauri"),
        " a year of Tauri"
    );
    assert_eq!(
        fit_to_cursor("« Tu pars ? »\n\n« Seulement si", "Seulement si tu viens"),
        " tu viens"
    );
    // ...and in scripts written without spaces, from two characters.
    assert_eq!(fit_to_cursor("护照\n\n常用", "常用药品"), "药品");
    assert_eq!(fit_to_cursor("结果", "结果排队的人很多"), "排队的人很多");
    assert_eq!(fit_to_cursor("但内存占用", "占用反而上升了"), "反而上升了");
    assert_eq!(
        fit_to_cursor("「雨が止むまで、", "止むまで、ここで待つ"),
        "ここで待つ"
    );
    assert_eq!(fit_to_cursor("一滴，两滴", "，三滴"), "，三滴");
    // The word left out, and letters follow: a word the text already
    // uses whole gets its space; otherwise nobody can tell a next word
    // from the rest of a cut-off one, and nothing is shown.
    assert_eq!(
        fit_to_cursor("it creaked, and it was narrow, and", "the shelves"),
        " the shelves"
    );
    assert_eq!(fit_to_cursor("on long files it quickly", "grew"), "");
    assert_eq!(fit_to_cursor("a full copy of the docu", "ument"), "");
    assert_eq!(fit_to_cursor("Deshalb kommen viele Berufst", "ätige"), "");
    // Anything else: a space before a new start, none before what
    // attaches to the word, none after an elision.
    assert_eq!(fit_to_cursor("set the", "`max_retries`"), " `max_retries`");
    assert_eq!(fit_to_cursor("if a", "< b"), " < b");
    assert_eq!(
        fit_to_cursor("Berufstätige", ", die abends"),
        ", die abends"
    );
    assert_eq!(fit_to_cursor("réserver l'", "hôtel"), "hôtel");
    // After punctuation, a new word gets its space.
    assert_eq!(fit_to_cursor("the students'", "books"), " books");
    assert_eq!(
        fit_to_cursor("doubled in six months.", "Le problème"),
        " Le problème"
    );
    // A word with an apostrophe, hyphen or dot is written out whole -
    // and the letters after an apostrophe never eat the start of the
    // next word.
    assert_eq!(fit_to_cursor("I don't", "don't think so"), " think so");
    assert_eq!(fit_to_cursor("I don'", "don't know"), "t know");
    assert_eq!(fit_to_cursor("I don'", "t know"), "t know");
    assert_eq!(fit_to_cursor("C'est", "C'est la vie"), " la vie");
    assert_eq!(fit_to_cursor("a well-known", "well-known fact"), " fact");
    assert_eq!(fit_to_cursor("a well-known", "known fact"), " fact");
    assert_eq!(fit_to_cursor("version 3.5", "3.5 adds"), " adds");
    // The repeat and nothing more: nothing to add.
    assert_eq!(fit_to_cursor("it quickly", "quickly"), "");
    // Unspaced scripts and spaces already typed: nothing added.
    assert_eq!(fit_to_cursor("规划者在制定方案时", "应当"), "应当");
    assert_eq!(fit_to_cursor("我们用", "React 重写"), "React 重写");
    assert_eq!(fit_to_cursor("ฉันชอบ", "กินข้าว"), "กินข้าว");
    assert_eq!(fit_to_cursor("thank you for ", "your note"), "your note");
    // Code indentation at the start of a line is kept.
    assert_eq!(
        fit_to_cursor("for s in xs:\n", "    total += s"),
        "    total += s"
    );
    assert_eq!(
        finish_completion("def f():", "", "\n    return 1", true),
        "\n    return 1"
    );
    // Each candidate is fitted, and each later one starts on the line
    // after its separator, so its joining space survives the split.
    assert_eq!(
        finish_completion(
            "it quickly",
            "",
            "quickly grew\n<<<>>>\nquickly slowed",
            false
        ),
        " grew\n<<<>>>\n slowed"
    );
    assert_eq!(
        finish_completion(
            "it quickly",
            "",
            "quickly grew\n\n<<<>>>\n\nquickly slowed\n<<<>>>\n",
            false
        ),
        " grew\n\n<<<>>>\n slowed\n<<<>>>\n"
    );
}

#[test]
fn replies_that_are_not_text_to_insert_are_cleaned_or_dropped() {
    // A leaked tag goes; one the document itself uses stays.
    assert_eq!(
        finish_completion("준비물\n\n상비", "", "상비약</reasoning_effort>", false),
        "약"
    );
    assert_eq!(
        finish_completion("Use <br> for breaks and", "", "and <br> again", false),
        " <br> again"
    );
    assert_eq!(finish_completion("if a", "", " < b", false), " < b");
    // Several lines outside code: the model's reasoning, or a second
    // block - dropped whole. Inside code they are the code.
    assert_eq!(
        finish_completion(
            "a Markdown editor that",
            "",
            "that\"s where it stops? No - the text ends with \"that\".\n\nthat keeps notes",
            false
        ),
        ""
    );
    assert_eq!(
        finish_completion("指标\n\n崩溃", "", "率\n\nWait - the rules say...", false),
        ""
    );
    // ...unless it ended by giving its first line again: that's the
    // answer.
    assert_eq!(
        finish_completion(
            "指标\n\n崩溃",
            "",
            "率\n\n</reasoning_effort>\n\nWait, I must not include tags. Output the cell content only.\n\n率",
            false
        ),
        "率"
    );
    // A figure the text doesn't have is dropped; one it has, or the
    // next in its count, stays.
    assert_eq!(
        finish_completion("启动服务并检查", "", "，确认健康检查接口返回 200", false),
        ""
    );
    assert_eq!(
        finish_completion(
            "We closed 2,300 tickets, up from",
            "",
            "up from 1,980 last quarter.",
            false
        ),
        ""
    );
    assert_eq!(
        finish_completion(
            "We closed 2,300 tickets and",
            "",
            "and 2300 is a record.",
            false
        ),
        " 2300 is a record."
    );
    assert_eq!(
        finish_completion("Step 2: install. Step", "", "Step 3: run it.", false),
        " 3: run it."
    );
    // Chinese wrapped whole in ASCII quotes: the quotes are the
    // model's. Quotes that are part of the text stay.
    assert_eq!(
        finish_completion(
            "規劃者在制定方案時",
            "",
            "'就需要先傾聽居民的意見。'",
            false
        ),
        "就需要先傾聽居民的意見。"
    );
    assert_eq!(
        finish_completion("He said", "", "\"I'm done.\"", false),
        " \"I'm done.\""
    );
    assert_eq!(
        finish_completion("for s in xs:\n", "", "    total += s\n    n += 1", true),
        "    total += s\n    n += 1"
    );
    // A leading line break outside code is dropped, the text kept.
    assert_eq!(
        finish_completion("Notes\n\n", "", "\nThe pilot ran", false),
        "The pilot ran"
    );
    // So are trailing ones - also those a removed tag leaves behind -
    // which would put a line break into a table cell.
    assert_eq!(
        finish_completion("指标\n\n崩溃", "", "率\n\n<br>", false),
        "率"
    );
    assert_eq!(finish_completion("指标\n\n崩溃", "", "率\n", false), "率");
    assert_eq!(
        finish_completion("def f():", "", "\n    return 1\n", true),
        "\n    return 1\n"
    );
    // Backticks a plain-text context doesn't use would be inserted
    // literally.
    assert_eq!(
        finish_completion(
            "To change it, set the",
            "",
            "the `max_retries` option",
            false
        ),
        " max_retries option"
    );
    assert_eq!(
        finish_completion("Call `upload` with", "", "with `path`", false),
        " `path`"
    );
    // An alternative that breaks the rules is dropped, the others kept.
    assert_eq!(
        finish_completion(
            "it quickly",
            "",
            "quickly grew\n<<<>>>\nquickly slowed\nand stopped\n<<<>>>\nquickly shrank",
            false
        ),
        " grew\n<<<>>>\n\n<<<>>>\n shrank"
    );
}

fn fix(original: &str, suggestion: &str) -> GrammarIssue {
    GrammarIssue {
        rule: None,
        start: 0,
        end: 0,
        issue: "test".to_string(),
        suggestion: suggestion.to_string(),
        original: Some(original.to_string()),
        context: None,
    }
}

/// (span, suggestion) of each verified issue.
fn spans(paragraph: &str, issues: Vec<GrammarIssue>) -> Vec<(String, String)> {
    let out = validate_issues(issues, paragraph);
    for i in &out {
        let span: String = paragraph
            .chars()
            .skip(i.start)
            .take(i.end - i.start)
            .collect();
        assert_eq!(i.original.as_deref(), Some(span.as_str()));
    }
    out.into_iter()
        .map(|i| (i.original.unwrap(), i.suggestion))
        .collect()
}

fn one(paragraph: &str, original: &str, suggestion: &str) -> Vec<(String, String)> {
    spans(paragraph, vec![fix(original, suggestion)])
}

fn pair(a: &str, b: &str) -> Vec<(String, String)> {
    vec![(a.to_string(), b.to_string())]
}

#[test]
fn a_quoted_fix_narrows_to_the_words_it_changes() {
    let p = "She has a honest opinion about the exam.";
    assert_eq!(
        one(p, "a honest opinion", "an honest opinion"),
        pair("a", "an")
    );
    assert_eq!(
        one("I go to the market and buy apples.", "go to", "went to"),
        pair("go", "went")
    );
    // A deletion takes its space with it.
    assert_eq!(
        one(
            "check that the the value is shown",
            "that the the value",
            "that the value"
        ),
        pair("the ", "")
    );
    // An insertion takes the next word (or, at the end, the last one).
    assert_eq!(
        one("We saw film about it.", "saw film", "saw a film"),
        pair("film", "a film")
    );
    assert_eq!(
        one("It ended", "It ended", "It ended."),
        pair("ended", "ended.")
    );
    // A changed ending grows back to the whole word.
    assert_eq!(
        one("Les enfants sont allé au parc.", "sont allé", "sont allés"),
        pair("allé", "allés")
    );
    assert_eq!(
        one(
            "aunque hacia demasiado calor",
            "hacia demasiado",
            "hacía demasiado"
        ),
        pair("hacia", "hacía")
    );
    // Moved words: the span covers everything between the first and
    // last change.
    assert_eq!(
        one(
            "obwohl der Kellner hat uns lange warten lassen.",
            "hat uns lange warten lassen",
            "uns lange hat warten lassen"
        ),
        pair("hat uns lange", "uns lange hat")
    );
    // Without spaces, characters: 的 -> 地, and an insertion takes the
    // character before it.
    assert_eq!(
        one("他高兴的跳了起来", "高兴的跳", "高兴地跳"),
        pair("的", "地")
    );
    assert_eq!(
        one("我去了商店", "去了商店", "去了一家商店"),
        pair("了", "了一家")
    );
    assert_eq!(
        one("今天下午开会,大家讨论了", "开会,大家", "开会，大家"),
        pair(",", "，")
    );
    // A change of spacing or punctuation alone between letters shows
    // the words around it.
    assert_eq!(
        one(
            "The company changed it's logo.",
            "changed it's logo",
            "changed its logo"
        ),
        pair("it's", "its")
    );
    assert_eq!(
        one("영수증을 두번 출력해서", "두번 출력해서", "두 번 출력해서"),
        pair("두번", "두 번")
    );
    assert_eq!(
        one("조금 당황 했다.", "당황 했다", "당황했다"),
        pair("당황 했다", "당황했다")
    );
    assert_eq!(
        one("However the plan held.", "However the", "However, the"),
        pair("However", "However,")
    );
    // ...but never runs on into a script written without spaces.
    assert_eq!(
        one("我们用React,很方便", "React,很方便", "React，很方便"),
        pair("React,", "React，")
    );
}

#[test]
fn the_quote_picks_the_right_copy_of_repeated_text() {
    // 的 occurs three times; the quote with its neighbours occurs once,
    // and the fix lands on the 的 of 跑的, not of 最快的.
    let p = "他认真的看着我，跑的最快的那个人是他弟弟。";
    let out = validate_issues(vec![fix("跑的最快", "跑得最快")], p);
    assert_eq!(out.len(), 1);
    assert_eq!((out[0].start, out[0].end), (9, 10));
    // A bare repeated quote is ambiguous - dropped - unless a context
    // or matching offsets say which copy is meant.
    assert!(validate_issues(vec![fix("的", "地")], p).is_empty());
    let mut with_context = fix("ab", "AB");
    with_context.context = Some("cd ab ef".to_string());
    assert_eq!(
        validate_issues(vec![with_context], "ab cd ab ef")[0].start,
        6
    );
    let mut with_offsets = fix("ab", "AB");
    (with_offsets.start, with_offsets.end) = (6, 8);
    assert_eq!(
        validate_issues(vec![with_offsets], "ab cd ab ef")[0].start,
        6
    );
    // Typography folded only when there is no exact match.
    assert_eq!(
        one("He said “hallo” twice.", "said \"hallo\"", "said \"hello\""),
        pair("hallo", "hello")
    );
    // Not in the paragraph at all.
    assert!(validate_issues(vec![fix("zz", "z")], "abcdef").is_empty());
}

#[test]
fn fixes_that_change_nothing_or_write_text_twice_are_dropped() {
    // A no-op card: an underline on correct text whose Apply does nothing.
    assert!(validate_issues(vec![fix("再三考虑", "再三考虑")], "我们还需要再三考虑。").is_empty());
    // Applied, it would read "uns uns".
    assert!(validate_issues(
        vec![fix("hat", "uns")],
        "obwohl der Kellner hat uns lange warten lassen."
    )
    .is_empty());
    // A rewrite reaching past its quote: "the team" twice.
    let p =
        "In my opinion, the end result of the project was the fact that the team became closer.";
    assert!(validate_issues(
        vec![fix(
            "the end result of the project was the fact that",
            "the project resulted in the team becoming closer"
        )],
        p
    )
    .is_empty());
    // An ordinary fix that repeats a short pair stays ("to the").
    assert_eq!(
        one("I went to shop and to the bank.", "to shop", "to the shop"),
        pair("shop", "the shop")
    );
}

#[test]
fn overlapping_fixes_keep_the_first() {
    let p = "Each of the participants have their own reasons.";
    let out = spans(
        p,
        vec![
            fix("participants have their", "participants has their"),
            fix("have their own", "has its own"),
        ],
    );
    assert_eq!(out, pair("have", "has"));
}

#[test]
fn the_reply_is_the_last_issue_array_in_it() {
    let p = "昨日は映画を見ました。面白かったでしだ。";
    // Notes before the array, and a corrected second array after a first one.
    let raw = "Checking the paragraph:\n[{\"original\": \"かったでした\", \"suggestion\": \"かったでした\", \"issue\": \"x\"}]\nWait - that quote is wrong. Corrected:\n[{\"original\": \"かったでしだ\", \"suggestion\": \"かったでした\", \"issue\": \"誤字\"}]";
    let out = parse_grammar_reply(raw, p).unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].original.as_deref(), Some("だ"));
    assert_eq!(out[0].suggestion, "た");
    assert!(parse_grammar_reply("[]", p).unwrap().is_empty());
    // Something that isn't the issue array: an error, so the command
    // retries once.
    assert!(parse_grammar_reply("[10, 12]", p).is_err());
    assert!(parse_grammar_reply("no issues", p).is_err());
}

#[test]
fn the_rules_engine_adds_what_the_model_missed() {
    use crate::ai::rules::Conventions;
    let conv = Conventions::default();
    let finish = |model: &str, p: &str, level: &str| {
        finish_grammar(model, p, Some(level), &conv, &[], None).unwrap()
    };
    let p = "今天下午开会,大家讨论了三个问题.第一个是明年的预算。";
    let model = "{\"corrected\": \"\", \"issues\": [{\"original\": \"问题.第一个\", \"suggestion\": \"问题。第一个\", \"issue\": \"句号\"}]}";
    let out = finish(model, p, "standard");
    let fixes: Vec<(&str, &str)> = out
        .iter()
        .map(|i| (i.original.as_deref().unwrap(), i.suggestion.as_str()))
        .collect();
    // The model's fix for the full stop, and the comma it missed - once.
    assert_eq!(fixes, [(",", "，"), (".", "。")]);
    assert_eq!(out[1].issue, "句号");
    assert_eq!(out[0].rule.as_deref(), Some("zh.punct.halfwidth"));
    assert_eq!(out[1].rule, None);
    // Japanese gets 、; numbers and Latin text are left alone.
    let ja = finish("[]", "今日は雨,明日は晴れ.", "standard");
    assert_eq!(ja[0].suggestion, "、");
    assert_eq!(ja[1].suggestion, "。");
    assert!(finish("[]", "备份 MySQL 8.0, 保留 30 天。Done, ok.", "standard").is_empty());
    // "typos": punctuation is not a typo, a wrong character is.
    assert!(finish("[]", p, "typos").is_empty());
    let typo = finish("[]", "我们要再接再励。", "typos");
    assert_eq!(typo[0].suggestion, "再接再厉");
    // A finding without a fix (es.punct.inverted) never reaches the
    // editor, which would apply its empty suggestion.
    assert!(finish(
        "[]",
        "Vienes mañana conmigo al cine esta noche?",
        "standard"
    )
    .is_empty());
    // The rule id is serialized; the model's issues carry none.
    let json = serde_json::to_string(&out).unwrap();
    assert!(json.contains("\"rule\":\"zh.punct.halfwidth\""));
    assert_eq!(json.matches("\"rule\"").count(), 1);
}

#[test]
fn the_older_offset_shape_still_works() {
    let mut legacy = fix("", "CD");
    legacy.original = None;
    (legacy.start, legacy.end) = (2, 4);
    let out = validate_issues(vec![legacy.clone()], "abcdef");
    assert_eq!(out[0].original.as_deref(), Some("cd"));
    (legacy.start, legacy.end) = (4, 2);
    assert!(validate_issues(vec![legacy.clone()], "abcdef").is_empty());
    (legacy.start, legacy.end) = (0, 99);
    assert!(validate_issues(vec![legacy], "abcdef").is_empty());
}
