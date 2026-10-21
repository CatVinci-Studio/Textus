use super::*;

/// One call through the registry, as the agent loop makes it.
fn execute(tools: &ToolRegistry, ctx: &ToolContext, name: &str, arguments: &str) -> ToolOutput {
    tauri::async_runtime::block_on(tools.execute(
        ctx,
        ToolCall {
            call_id: String::new(),
            name: name.into(),
            arguments: arguments.into(),
        },
    ))
}

fn names(tools: &[Tool]) -> Vec<String> {
    tools.iter().map(|t| t.spec.name.to_string()).collect()
}

/// A tool that arrives at run time, as a plugin's or an MCP server's
/// will: an owned name and schema, and an async run.
fn runtime_tool<'a>(name: &str, access: Access, modes: &'static [AgentMode]) -> Tool<'a> {
    Tool {
        spec: ToolSpec {
            name: name.to_string().into(),
            description: format!("{name}, from a plugin").into(),
            parameters: json!({"type": "object", "properties": {}}),
        },
        access,
        modes,
        run: Run::Async(Box::new(|call: ToolCall| {
            Box::pin(async move { format!("{} ran with {}", call.name, call.arguments).into() })
        })),
    }
}

#[test]
fn a_runtime_tool_is_offered_and_run_through_the_registry() {
    let mut tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
    tools.add(runtime_tool("zotero_search", Access::ReadOnly, EVERY_MODE));
    assert!(tools.specs().iter().any(|s| s.name == "zotero_search"));
    let out = execute(&tools, &ctx("Doc."), "zotero_search", r#"{"q":"x"}"#);
    assert_eq!(out.text, r#"zotero_search ran with {"q":"x"}"#);
    assert_eq!(
        execute(&tools, &ctx("Doc."), "no_such_tool", "{}").text,
        "Unknown tool: no_such_tool"
    );
}

/// Only a valid proposal or comment ends the exchange early (the loop's
/// ToolOutput::settled): a refused one needs the model again.
#[test]
fn valid_proposals_and_comments_are_settled_and_refusals_are_not() {
    let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
    let ctx = ctx("The cat sat on the mat.");
    let settled = |name: &str, args: &str| execute(&tools, &ctx, name, args).settled;
    assert!(settled(
        PROPOSE_EDIT_TOOL_NAME,
        r#"{"action":"append","text":"The dog ran."}"#
    ));
    assert!(!settled(
        PROPOSE_EDIT_TOOL_NAME,
        r#"{"action":"replace","anchor":"not in the document","text":"x"}"#
    ));
    assert!(settled(
        ADD_COMMENT_TOOL_NAME,
        r#"{"anchor":"The cat sat","comment":"Name the cat."}"#
    ));
    assert!(!settled(READ_DOCUMENT_TOOL_NAME, "{}"));
}

#[test]
fn a_tool_is_offered_only_in_the_modes_it_names() {
    for (mode, offered) in [
        (AgentMode::Review, false),
        (AgentMode::Revise, true),
        (AgentMode::Write, true),
    ] {
        let mut tools = ToolRegistry::new(mode);
        tools.add(runtime_tool("make_figure", Access::Proposes, EDITING_MODES));
        assert_eq!(tools.specs().len() == 1, offered, "{mode}");
    }
}

#[test]
fn reads_run_together_and_proposals_in_order() {
    let mut tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
    tools.add(runtime_tool(
        "make_figure",
        Access::ProposesInItsCall,
        EDITING_MODES,
    ));
    assert_eq!(
        tools.how_to_run(READ_DOCUMENT_TOOL_NAME),
        ToolRun::Concurrent
    );
    assert_eq!(tools.how_to_run(PROPOSE_EDIT_TOOL_NAME), ToolRun::InOrder);
    assert_eq!(tools.how_to_run(ADD_COMMENT_TOOL_NAME), ToolRun::InOrder);
    assert_eq!(tools.how_to_run("make_figure"), ToolRun::Amending);
    assert_eq!(tools.how_to_run("no_such_tool"), ToolRun::InOrder);
}

#[test]
fn anchors_match_through_typography_and_folded_whitespace() {
    let doc = "He said “hello” — twice.\n\nThen left；quietly.";
    assert_eq!(anchor_match_count(doc, "He said \"hello\" - twice."), 1);
    assert_eq!(anchor_match_count(doc, "Then left;quietly."), 1);
    assert_eq!(anchor_match_count(doc, "twice.\nThen left"), 1);
    assert_eq!(anchor_match_count(doc, "not here"), 0);
}

#[test]
fn a_section_runs_to_the_next_heading_at_its_level() {
    let doc = "# Intro\na\n## Intro details\nb\n# Methods\nc\n```sh\n# not a heading\n```";
    let lines: Vec<&str> = doc.lines().collect();
    // Exact title beats a heading that merely contains it.
    assert_eq!(section_range(&lines, "Intro"), Some((0, 4)));
    assert_eq!(section_range(&lines, "## intro DETAILS"), Some((2, 4)));
    // A `#` comment in a fence doesn't end the last section.
    assert_eq!(section_range(&lines, "methods"), Some((4, 9)));
    assert_eq!(section_range(&lines, "Results"), None);
    assert_eq!(section_range(&lines, "  "), None);
}

#[test]
fn a_repeated_anchor_needs_a_longer_unique_context() {
    let doc = "the cat sat. the dog sat.";
    let args = |context: &str| serde_json::json!({ "context": context });
    assert!(check_anchor(doc, &args(""), "the cat").is_ok());
    assert!(check_anchor(doc, &args(""), "sat.").is_err());
    assert!(check_anchor(doc, &args("dog sat."), "sat.").is_ok());
    // The context must be longer than the anchor and occur once.
    assert!(check_anchor(doc, &args("sat."), "sat.").is_err());
    assert!(check_anchor(doc, &args("missing sat."), "sat.").is_err());
}

static NO_CONVENTIONS: std::sync::LazyLock<crate::ai::rules::Conventions> =
    std::sync::LazyLock::new(crate::ai::rules::Conventions::default);
#[test]
fn use_skill_expands_skills_and_loads_packs() {
    let ws = crate::ai::workspace::load_layers(None, None, None, &["describe".to_string()]);
    let doc = "雨はまだ降っていた。美咲は改札の前で、何度も時計を見た。";
    let ctx = ToolContext {
        document: doc,
        skills: &ws.skills,
        ui_language: "en",
        root: None,
        sees_images: false,
        conventions: &NO_CONVENTIONS,
        library: &[],
        memory: None,
        proposed: Default::default(),
        checks: Default::default(),
    };
    let call = |name: &str| use_skill(&ctx, &json!({ "name": name }).to_string());
    let dialogue = call("dialogue");
    assert!(dialogue.starts_with("Instructions for skill `dialogue`"));
    assert!(dialogue.contains("### contract") && dialogue.contains("### standards-ja#dialogue"));
    assert!(call("tighten").contains("only when the user types /tighten"));
    assert!(
        call("describe").starts_with("No skill named `describe`"),
        "turned off"
    );
    let fr = call("standards-fr#dialogue");
    assert!(fr.starts_with("Reference `standards-fr#dialogue`") && fr.contains("guillemets"));
    let missing = call("nope");
    assert!(missing.contains("Reference packs: craft, standards-en"));
    assert!(
        !missing.contains("tighten"),
        "a /name-only skill isn't offered"
    );
}

fn ctx(document: &str) -> ToolContext<'_> {
    ToolContext {
        document,
        skills: &[],
        ui_language: "en",
        root: None,
        sees_images: false,
        conventions: &NO_CONVENTIONS,
        library: &[],
        memory: None,
        proposed: Default::default(),
        checks: Default::default(),
    }
}

#[test]
fn check_tools_stop_answering_once_their_budget_is_spent() {
    let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
    let context = ctx("草稿");
    let run = |name: &str, args: &str| execute(&tools, &context, name, args).text;
    let measure = |metric: &str| {
        run(
            MEASURE_TEXT_TOOL_NAME,
            &json!({ "text": "草稿", "metric": metric }).to_string(),
        )
    };
    for metric in ["", "chars", "cjk_chars"] {
        assert!(!measure(metric).starts_with("Not run"));
    }
    let refused = measure("words");
    assert!(
        refused.starts_with("Not run: measure_text was already called 3 times"),
        "{refused}"
    );
    // A platform's limit is measured as often as it takes.
    for _ in 0..10 {
        assert!(measure("x_weighted").starts_with("x_weighted: 4 of 280"));
    }
    // Each check has its own budget, and other tools have none.
    for _ in 0..4 {
        assert!(!run(CHECK_CONVENTIONS_TOOL_NAME, "{}").starts_with("Not run"));
    }
    assert!(run(CHECK_CONVENTIONS_TOOL_NAME, "{}").starts_with("Not run"));
    for _ in 0..5 {
        let out = run(SEARCH_TOOL_NAME, r#"{"query":"草"}"#);
        assert!(!out.starts_with("Not run"), "{out}");
    }
}

#[test]
fn check_conventions_reports_by_rule_with_lines() {
    let doc = "# 周报\n\n本周完成了三项工作，进展顺利。\n\n下周继续推进,争取月底上线...\n";
    let out = check_conventions(&ctx(doc), "{}");
    assert!(
        out.starts_with("Writing conventions: zh-Hans-CN (Automatic"),
        "{out}"
    );
    assert!(
        out.contains("zh.punct.halfwidth (1): 中文句子里应使用全角标点。"),
        "{out}"
    );
    assert!(out.contains("L5 fix: \",\" -> \"，\""), "{out}");
    assert!(out.contains("zh.punct.ellipsis (1)"), "{out}");
    // A range or heading limits what is reported.
    let out = check_conventions(&ctx(doc), r#"{"start_line":1,"end_line":3}"#);
    assert!(
        out.contains("No convention issues found in lines 1-3."),
        "{out}"
    );
    let out = check_conventions(&ctx(doc), r#"{"heading":"没有"}"#);
    assert!(out.starts_with("No heading matching"), "{out}");
    // A draft is judged against the document.
    let out = check_conventions(&ctx(doc), r#"{"text":"我们还要测试,然后发布。"}"#);
    assert!(
        out.contains("in the text you gave") && out.contains("L1 fix"),
        "{out}"
    );
    // French no-break spaces are spelled out.
    let out = check_conventions(
        &ctx("Vraiment ? Nous avons fini le travail dans la maison avec les enfants."),
        "{}",
    );
    assert!(out.contains("[narrow no-break space]?"), "{out}");
    assert!(out.contains("write it as \\u00a0 or \\u202f"), "{out}");
}

#[test]
fn measure_text_counts_exactly() {
    let out = measure_text(
        &ctx(""),
        r#"{"text":"你好 https://textus.app","metric":"x_weighted"}"#,
    );
    assert_eq!(out, "x_weighted: 28 of 280 weighted characters - within the limit (252 to spare). URLs count 23 each; CJK characters and emoji count 2.");
    let out = measure_text(&ctx(""), r#"{"text":"hi"}"#);
    assert!(
        out.contains("chars: 2 characters.") && out.contains("bluesky: 2 of 300"),
        "{out}"
    );
    assert!(
        measure_text(&ctx(""), r#"{"text":"hi","metric":"tiktok"}"#).starts_with("Unknown metric")
    );
    assert!(measure_text(&ctx(""), "{}").starts_with("No `text`"));
}

#[test]
fn the_rules_tools_are_in_every_mode() {
    for mode in [AgentMode::Review, AgentMode::Revise, AgentMode::Write] {
        let names = names(&builtin_tools(false, false, mode, false, false));
        assert!(
            names.iter().any(|n| n == "check_conventions")
                && names.iter().any(|n| n == "measure_text"),
            "{names:?}"
        );
    }
}

#[test]
fn the_project_file_tools_are_offered_only_with_a_project_folder() {
    let names = |has_root: bool| -> Vec<String> {
        names(&builtin_tools(
            false,
            has_root,
            AgentMode::Revise,
            false,
            false,
        ))
        .into_iter()
        .filter(|n| n.ends_with("_files") || n == READ_FILE_TOOL_NAME)
        .collect()
    };
    assert_eq!(
        names(true),
        ["find_files", "search_files", "list_files", "read_file"]
    );
    assert!(names(false).is_empty());
}

#[test]
fn view_image_is_offered_only_to_a_model_that_can_see() {
    let offered = |has_root: bool, sees_images: bool| {
        builtin_tools(false, has_root, AgentMode::Review, false, sees_images)
            .iter()
            .any(|t| t.spec.name == VIEW_IMAGE_TOOL_NAME)
    };
    assert!(offered(true, true));
    assert!(!offered(true, false));
    assert!(!offered(false, true));
}

#[test]
fn view_image_shows_the_image_and_the_listing_marks_it() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("map.png"), [0x89, b'P', b'N', b'G']).unwrap();
    std::fs::write(dir.path().join("notes.md"), "").unwrap();
    let tools = ToolRegistry::builtin(false, true, AgentMode::Review, false, true);
    let seeing = ToolContext {
        root: Some(dir.path()),
        sees_images: true,
        ..ctx("")
    };
    assert_eq!(list_files(&seeing, "{}"), "map.png (image)\nnotes.md");
    // The path as the listing shows it works too.
    let out = execute(
        &tools,
        &seeing,
        VIEW_IMAGE_TOOL_NAME,
        r#"{"path":"map.png (image)"}"#,
    );
    assert_eq!(out.text, "Here is `map.png` (image/png).");
    assert_eq!(out.images.len(), 1);
    let out = execute(
        &tools,
        &seeing,
        VIEW_IMAGE_TOOL_NAME,
        r#"{"path":"notes.md"}"#,
    );
    assert!(out.text.starts_with("`notes.md` isn't an image"));
    assert!(out.images.is_empty());
    let blind = ToolContext {
        root: Some(dir.path()),
        ..ctx("")
    };
    assert_eq!(list_files(&blind, "{}"), "notes.md");
}

#[test]
fn read_file_takes_a_line_range() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.md"), "one\ntwo\nthree\n").unwrap();
    let in_project = ToolContext {
        root: Some(dir.path()),
        ..ctx("")
    };
    assert_eq!(
        read_file(
            &in_project,
            r#"{"path":"a.md","start_line":2,"end_line":2}"#
        ),
        "`a.md`, lines 2-2 of 3:\ntwo"
    );
    assert_eq!(
        read_file(&in_project, r#"{"path":"a.md"}"#),
        "one\ntwo\nthree\n"
    );
}

#[test]
fn find_files_finds_project_files_by_name() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("notes")).unwrap();
    std::fs::write(dir.path().join("notes/Lin Wan.md"), "").unwrap();
    std::fs::write(dir.path().join("chapter-1.md"), "").unwrap();
    let tools = ToolRegistry::builtin(false, true, AgentMode::Revise, false, false);
    let in_project = ToolContext {
        root: Some(dir.path()),
        ..ctx("")
    };
    let run = |args: &str| execute(&tools, &in_project, FIND_FILES_TOOL_NAME, args).text;
    assert_eq!(run(r#"{"name":"lin_wan"}"#), "notes/Lin Wan.md");
    assert!(run(r#"{"name":"zebra"}"#).starts_with("No file in the project folder"));
    assert!(find_files(&ctx(""), r#"{"name":"lin"}"#).starts_with("There is no project folder"));
    assert!(list_files(&in_project, "{}").starts_with("notes/Lin Wan.md\nchapter-1.md"));
}

#[test]
fn remember_is_offered_in_every_mode_only_while_the_setting_is_on() {
    let has = |mode: AgentMode, remember: bool| {
        builtin_tools(true, true, mode, remember, false)
            .iter()
            .any(|t| t.spec.name == REMEMBER_TOOL_NAME)
    };
    // It writes memory, not the document: Write and Review have it too.
    for mode in [AgentMode::Write, AgentMode::Review, AgentMode::Revise] {
        assert!(has(mode, true) && !has(mode, false), "{mode}");
    }
    assert_eq!(
        remember(&ctx(""), r#"{"kind":"style","text":"x"}"#),
        "Remembering is turned off."
    );
}

#[test]
fn read_document_reads_a_section_with_its_subsections() {
    let doc = "# Title\nintro\n## Methods\nm1\n### Sampling\ns1\n```\n# not a heading\n```\n## Results\nr1";
    let out = read_document(&ctx(doc), r#"{"heading":"methods"}"#);
    assert!(out.starts_with("Lines 3-9 of 11:"), "{out}");
    assert!(out.contains("### Sampling") && out.contains("# not a heading"));
    assert!(!out.contains("## Results"));
}

#[test]
fn read_document_reads_an_inclusive_line_range() {
    let out = read_document(&ctx("a\nb\nc\nd"), r#"{"start_line":2,"end_line":3}"#);
    assert_eq!(out, "Lines 2-3 of 4:\nb\nc\n");
}

#[test]
fn review_mode_does_not_receive_the_edit_tool() {
    let edit_tool = |mode| {
        builtin_tools(true, true, mode, false, false)
            .into_iter()
            .find(|tool| tool.spec.name == PROPOSE_EDIT_TOOL_NAME)
    };
    assert!(edit_tool(AgentMode::Review).is_none());
    // Write and Revise share the tool as the model sees it (the cached
    // prefix); Write's run refuses what changes existing text (below).
    let spec = |mode| format!("{:?}", edit_tool(mode).unwrap().spec);
    assert_eq!(spec(AgentMode::Write), spec(AgentMode::Revise));
}

#[test]
fn write_mode_refuses_an_edit_that_changes_existing_text() {
    let doc = "The cat sat on the mat.";
    let tools = ToolRegistry::builtin(false, false, AgentMode::Write, false, false);
    let ctx = ctx(doc);
    let run = |args: &str| execute(&tools, &ctx, PROPOSE_EDIT_TOOL_NAME, args).text;
    for args in [
        r#"{"action":"replace","anchor":"The cat sat on the mat.","text":"A dog."}"#,
        r#"{"action":"replace_selection","text":"A dog."}"#,
        r#"{"action":"delete","anchor":"The cat sat on the mat."}"#,
        r#"{"action":"rewrite","text":"A dog."}"#,
    ] {
        let out = run(args);
        assert!(
            out.starts_with("Not proposed: Write mode only adds text"),
            "{out}"
        );
        assert!(out.contains("Revise mode"), "{out}");
    }
    for args in [
        r#"{"action":"insert_after","anchor":"The cat sat on the mat.","text":"It purred."}"#,
        r#"{"action":"append","text":"It purred."}"#,
    ] {
        assert!(run(args).starts_with("Edit proposed"), "{args}");
    }
    // Revise keeps every action.
    let revise = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
    assert!(execute(
        &revise,
        &ctx,
        PROPOSE_EDIT_TOOL_NAME,
        r#"{"action":"delete","anchor":"The cat sat on the mat."}"#
    )
    .text
    .starts_with("Edit proposed"));
}

#[test]
fn propose_edit_refuses_a_clause_replaced_by_one_latin_token() {
    let doc = "会议照常。给您添麻烦了，如果周五上午不方便，请告诉我们您方便的时间。此致";
    let anchor = "给您添麻烦了，如果周五上午不方便，请告诉我们您方便的时间。";
    let args = |text: &str| {
        serde_json::json!({"action": "replace", "anchor": anchor, "text": text}).to_string()
    };
    let one = ctx(doc);
    let out = propose_edit(&one, &args("due"));
    assert!(out.starts_with("Not proposed"), "{out}");
    // Sent again unchanged, it is what the user asked for ("replace the
    // sentence with TBD") and stands.
    let out = propose_edit(&one, &args("due"));
    assert!(out.starts_with("Edit proposed"), "{out}");
    // A real translation and a short Chinese rewrite stand, and so does
    // a Latin name for a short Chinese one.
    for text in [
        "Sorry for the trouble - if Friday morning doesn't suit you, tell us what does.",
        "抱歉。",
    ] {
        let out = propose_edit(&ctx(doc), &args(text));
        assert!(out.starts_with("Edit proposed"), "{text}: {out}");
    }
    let out = propose_edit(
        &ctx("名称：乐维斯"),
        r#"{"action":"replace","anchor":"乐维斯","text":"Textus"}"#,
    );
    assert!(out.starts_with("Edit proposed"), "{out}");
}

#[test]
fn a_second_proposal_for_the_same_passage_is_refused() {
    let doc = ctx("Textus is great. Textus is fast. It ships soon.");
    let ctx2 = ctx("Textus is great.");
    let ctx = doc;
    let first = r#"{"action":"replace","anchor":"Textus is great.","text":"Textus is good."}"#;
    assert!(propose_edit(&ctx, first).starts_with("Edit proposed"));
    assert!(propose_edit(&ctx, first).starts_with("Not proposed"));
    // Inside the first passage, too.
    let inner = r#"{"action":"delete","anchor":"great"}"#;
    assert!(propose_edit(&ctx, inner).starts_with("Not proposed"));
    // Another passage, an insertion beside the first, and the same
    // word picked out elsewhere by its context all stand.
    for args in [
        r#"{"action":"replace","anchor":"It ships soon.","text":"It ships in May."}"#,
        r#"{"action":"insert_after","anchor":"Textus is great.","text":" Really."}"#,
        r#"{"action":"replace","anchor":"Textus","context":"Textus is fast","text":"It"}"#,
    ] {
        assert!(
            propose_edit(&ctx, args).starts_with("Edit proposed"),
            "{args}"
        );
    }
    // Two fixes of a repeated word, pinned by overlapping contexts, are
    // two passages; the same occurrence pinned twice is one.
    let typos = super::tests::ctx("I think its fine and its late, its true.");
    for args in [
        r#"{"action":"replace","anchor":"its","context":"think its fine and its","text":"it's"}"#,
        r#"{"action":"replace","anchor":"its","context":"and its late, its true","text":"it's"}"#,
    ] {
        assert!(
            propose_edit(&typos, args).starts_with("Edit proposed"),
            "{args}"
        );
    }
    let again = r#"{"action":"replace","anchor":"its","context":"its late","text":"it is"}"#;
    assert!(propose_edit(&typos, again).starts_with("Not proposed"));
    // A refused call (no match) doesn't count as proposed.
    let missing = r#"{"action":"replace","anchor":"Textus is slow.","text":"x"}"#;
    assert!(propose_edit(&ctx2, missing).starts_with("No exact match"));
}

#[test]
fn the_size_note_counts_like_measure_text() {
    let out = propose_edit(
        &ctx("周末带爸妈去了千岛湖，人很多。"),
        r#"{"action":"replace","anchor":"周末带爸妈去了千岛湖，人很多。","text":"周末去了千岛湖。"}"#,
    );
    // Punctuation counts, as in measure_text's chars.
    assert!(out.contains("replaces 15 characters with 8"), "{out}");
}

#[test]
fn propose_edit_rejects_repeated_anchor_without_context() {
    let out = propose_edit(
        &ctx("Textus is great. Textus is fast."),
        r#"{"action":"replace","anchor":"Textus","text":"It"}"#,
    );
    assert!(out.contains("appears 2 times"), "{out}");
    assert!(out.contains("`context`"), "{out}");
}

#[test]
fn propose_edit_accepts_repeated_anchor_with_unique_context() {
    let out = propose_edit(
        &ctx("Textus is great. Textus is fast."),
        r#"{"action":"replace","anchor":"Textus","text":"It","context":"Textus is fast"}"#,
    );
    assert!(out.starts_with("Edit proposed"), "{out}");
}

#[test]
fn propose_edit_rejects_context_that_repeats_or_misses_the_anchor() {
    let doc = "Textus is great. Textus is great.";
    let repeated = propose_edit(
        &ctx(doc),
        r#"{"action":"replace","anchor":"Textus","text":"It","context":"Textus is great"}"#,
    );
    assert!(repeated.contains("`context`"), "{repeated}");
    let anchor_free = propose_edit(
        &ctx("Textus is great. Textus is fast."),
        r#"{"action":"replace","anchor":"Textus","text":"It","context":"is fast"}"#,
    );
    assert!(anchor_free.contains("`context`"), "{anchor_free}");
}
