use super::*;
use crate::ai::doc_blocks::Document;

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
    let mut tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false);
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
    let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false);
    let ctx = ctx("The cat sat on the mat.");
    let settled =
        |name: &str, args: &str| execute(&tools, &ctx, name, &named(ctx.document, args)).settled;
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
    let mut tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false);
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

static NO_CONVENTIONS: std::sync::LazyLock<crate::ai::rules::Conventions> =
    std::sync::LazyLock::new(crate::ai::rules::Conventions::default);
#[test]
fn use_skill_expands_skills_and_loads_packs() {
    let ws = crate::ai::workspace::load_layers(None, None, None, &["describe".to_string()]);
    let doc = "雨はまだ降っていた。美咲は改札の前で、何度も時計を見た。";
    let ctx = ToolContext {
        undecided: &[],
        document: md(doc),
        skills: &ws.skills,
        ui_language: "en",
        root: None,
        sees_images: false,
        conventions: &NO_CONVENTIONS,
        library: &[],
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

/// A document as the editor would send it, in its paragraphs - kept for
/// the test's life.
fn md(text: &str) -> &'static Document {
    Box::leak(Box::new(Document::from_markdown(text)))
}

/// A call as the model sends it, naming the block its `anchor` is in (the
/// one block that holds it), resolved as agent::settle does before the
/// tool sees it. Words in no block - text proposed and not decided yet -
/// stay a quote.
fn named(document: &Document, args: &str) -> String {
    let mut v: serde_json::Value = serde_json::from_str(args).unwrap();
    if let Some(anchor) = v.get("anchor").and_then(|a| a.as_str()) {
        let holding: Vec<&crate::ai::doc_blocks::Block> = document
            .blocks
            .iter()
            .filter(|b| document.block_text(b).contains(anchor))
            .collect();
        if v.get("block").is_none() && holding.len() == 1 {
            v["block"] = json!(holding[0].id);
        }
    }
    crate::ai::doc_blocks::resolve_edit_arguments(document, &v.to_string())
}

/// propose_edit, for a call as the model sends it (`named`).
fn edit(ctx: &ToolContext, args: &str) -> String {
    propose_edit(ctx, &named(ctx.document, args))
}

fn ctx(document: &str) -> ToolContext<'static> {
    ToolContext {
        undecided: &[],
        document: md(document),
        skills: &[],
        ui_language: "en",
        root: None,
        sees_images: false,
        conventions: &NO_CONVENTIONS,
        library: &[],
        proposed: Default::default(),
        checks: Default::default(),
    }
}

#[test]
fn check_tools_stop_answering_once_their_budget_is_spent() {
    let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false);
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
fn a_long_draft_of_new_text_is_proposed_not_checked() {
    let tools = ToolRegistry::builtin(false, false, AgentMode::Write, false);
    let paragraph = "港口不是海的终点，是陆地和浪涛握手的地方。".repeat(12);
    let context = ctx(&paragraph);
    let run = |name: &str, text: &str, metric: &str| {
        execute(
            &tools,
            &context,
            name,
            &json!({ "text": text, "metric": metric }).to_string(),
        )
        .text
    };
    let draft = format!("{paragraph}\n\n{paragraph}");
    for name in [MEASURE_TEXT_TOOL_NAME, CHECK_CONVENTIONS_TOOL_NAME] {
        let out = run(name, &draft, "cjk_chars");
        assert!(out.contains("doesn't take a draft"), "{name}: {out}");
    }
    // Text in the document, a short draft, and a platform's limit are
    // measured.
    assert!(!run(MEASURE_TEXT_TOOL_NAME, &paragraph, "cjk_chars").starts_with("Not run"));
    assert!(!run(MEASURE_TEXT_TOOL_NAME, "一句话。", "cjk_chars").starts_with("Not run"));
    assert!(!run(MEASURE_TEXT_TOOL_NAME, &draft, "weibo").starts_with("Not run"));
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
        let names = names(&builtin_tools(false, false, mode, false));
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
        names(&builtin_tools(false, has_root, AgentMode::Revise, false))
            .into_iter()
            .filter(|n| n.ends_with("_files") || n == READ_FILE_TOOL_NAME)
            .collect()
    };
    assert_eq!(names(true), ["find_files", "search_files", "read_file"]);
    assert!(names(false).is_empty());
}

#[test]
fn read_file_shows_an_image_to_a_model_that_sees_and_find_files_lists() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("map.png"), [0x89, b'P', b'N', b'G']).unwrap();
    std::fs::write(dir.path().join("notes.md"), "").unwrap();
    let tools = ToolRegistry::builtin(false, true, AgentMode::Review, true);
    let seeing = ToolContext {
        root: Some(dir.path()),
        sees_images: true,
        ..ctx("")
    };
    let run = |ctx: &ToolContext, name: &str, args: &str| execute(&tools, ctx, name, args);
    // No name: every file, images marked.
    assert_eq!(
        run(&seeing, FIND_FILES_TOOL_NAME, "{}").text,
        "map.png (image)\nnotes.md"
    );
    // The path as the listing shows it works too.
    let out = run(
        &seeing,
        READ_FILE_TOOL_NAME,
        r#"{"path":"map.png (image)"}"#,
    );
    assert_eq!(out.text, "Here is `map.png` (image/png).");
    assert_eq!(out.images.len(), 1);
    let blind = ToolContext {
        root: Some(dir.path()),
        ..ctx("")
    };
    assert_eq!(
        run(&blind, FIND_FILES_TOOL_NAME, r#"{"name":""}"#).text,
        "notes.md"
    );
    let out = run(&blind, READ_FILE_TOOL_NAME, r#"{"path":"map.png"}"#);
    assert!(out.text.contains("can't see images"), "{}", out.text);
    assert!(out.images.is_empty());
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
        )
        .text,
        "`a.md`, lines 2-2 of 3:\ntwo"
    );
    assert_eq!(
        read_file(&in_project, r#"{"path":"a.md"}"#).text,
        "one\ntwo\nthree\n"
    );
}

#[test]
fn find_files_finds_project_files_by_name() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("notes")).unwrap();
    std::fs::write(dir.path().join("notes/Lin Wan.md"), "").unwrap();
    std::fs::write(dir.path().join("chapter-1.md"), "").unwrap();
    let tools = ToolRegistry::builtin(false, true, AgentMode::Revise, false);
    let in_project = ToolContext {
        root: Some(dir.path()),
        ..ctx("")
    };
    let run = |args: &str| execute(&tools, &in_project, FIND_FILES_TOOL_NAME, args).text;
    assert_eq!(run(r#"{"name":"lin_wan"}"#), "notes/Lin Wan.md");
    assert!(run(r#"{"name":"zebra"}"#).starts_with("No file in the project folder"));
    assert!(find_files(&ctx(""), r#"{"name":"lin"}"#).starts_with("There is no project folder"));
    assert!(run("{}").starts_with("notes/Lin Wan.md\nchapter-1.md"));
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
        builtin_tools(true, true, mode, false)
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
fn an_edit_of_text_an_undecided_rewrite_replaces_goes_into_the_rewrite() {
    let doc = "The lighthouse stood on the rock.\n\nWaves broke below.";
    let undecided = vec![crate::ai::images::UndecidedEdit {
        replaced: "The lighthouse stood on the rock.".into(),
        text: "The old lighthouse stood alone on its rock.".into(),
    }];
    let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false);
    let context = ToolContext {
        undecided: &undecided,
        ..ctx(doc)
    };
    let run = |args: &str| {
        execute(
            &tools,
            &context,
            PROPOSE_EDIT_TOOL_NAME,
            &named(context.document, args),
        )
        .text
    };
    // Words of the rewrite, which has no block: the edit goes into it.
    let out = run(r#"{"action":"replace","anchor":"stood alone","text":"stood tall"}"#);
    assert!(out.contains("goes into that proposal"), "{out}");
    // Words of the old text, by its block: the edit is of the whole block
    // (one edit per block), a new version that takes the rewrite's place.
    let out = run(r#"{"action":"replace","anchor":"lighthouse","text":"beacon"}"#);
    assert!(
        out.contains("takes the place of your earlier rewrite"),
        "{out}"
    );
    // Text beside it is the document's, as before.
    let out =
        run(r#"{"action":"replace","anchor":"Waves broke below.","text":"Waves crashed below."}"#);
    assert!(out.starts_with("Edit proposed"), "{out}");
    assert!(!out.contains("goes into that proposal"), "{out}");
}

#[test]
fn an_edit_may_change_text_proposed_and_not_decided_yet() {
    let doc = "The cat sat on the mat.";
    let undecided = vec![crate::ai::images::UndecidedEdit {
        replaced: String::new(),
        text: "It purred all night. Then it slept.".to_string(),
    }];
    for mode in [AgentMode::Write, AgentMode::Revise] {
        let tools = ToolRegistry::builtin(false, false, mode, false);
        let context = ToolContext {
            undecided: &undecided,
            ..ctx(doc)
        };
        let run = |args: &str| {
            execute(
                &tools,
                &context,
                PROPOSE_EDIT_TOOL_NAME,
                &named(context.document, args),
            )
            .text
        };
        for args in [
            r#"{"action":"replace","anchor":"It purred all night.","text":"It purred."}"#,
            r#"{"action":"delete","anchor":"Then it slept."}"#,
            r#"{"action":"insert_after","anchor":"Then it slept.","text":"At dawn it woke."}"#,
        ] {
            let out = run(args);
            assert!(out.starts_with("Edit proposed"), "{mode:?} {args}: {out}");
            assert!(out.contains("goes into that proposal"), "{out}");
        }
        // Text in neither is still refused.
        assert!(
            !run(r#"{"action":"replace","anchor":"A dog barked.","text":"x"}"#)
                .starts_with("Edit proposed")
        );
    }
    // This request's own proposals count too.
    let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false);
    let context = ctx(doc);
    let run = |args: &str| {
        execute(
            &tools,
            &context,
            PROPOSE_EDIT_TOOL_NAME,
            &named(context.document, args),
        )
        .text
    };
    assert!(run(r#"{"action":"append","text":"A new line here."}"#).starts_with("Edit proposed"));
    assert!(
        run(r#"{"action":"replace","anchor":"A new line here.","text":"A newer line."}"#)
            .contains("goes into that proposal")
    );
}

#[test]
fn write_mode_refuses_an_edit_that_changes_existing_text() {
    let doc = "The cat sat on the mat.";
    let tools = ToolRegistry::builtin(false, false, AgentMode::Write, false);
    let ctx = ctx(doc);
    let run = |args: &str| {
        execute(
            &tools,
            &ctx,
            PROPOSE_EDIT_TOOL_NAME,
            &named(ctx.document, args),
        )
        .text
    };
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
    let revise = ToolRegistry::builtin(false, false, AgentMode::Revise, false);
    assert!(execute(
        &revise,
        &ctx,
        PROPOSE_EDIT_TOOL_NAME,
        &named(
            ctx.document,
            r#"{"action":"delete","anchor":"The cat sat on the mat."}"#
        )
    )
    .text
    .starts_with("Edit proposed"));
}

#[test]
fn propose_edit_refuses_a_clause_replaced_by_one_latin_token() {
    let doc = "会议照常。\n\n给您添麻烦了，如果周五上午不方便，请告诉我们您方便的时间。\n\n此致";
    let anchor = "给您添麻烦了，如果周五上午不方便，请告诉我们您方便的时间。";
    let args = |text: &str| {
        serde_json::json!({"action": "replace", "anchor": anchor, "text": text}).to_string()
    };
    let one = ctx(doc);
    let out = edit(&one, &args("due"));
    assert!(out.starts_with("Not proposed"), "{out}");
    // Sent again unchanged, it is what the user asked for ("replace the
    // sentence with TBD") and stands.
    let out = edit(&one, &args("due"));
    assert!(out.starts_with("Edit proposed"), "{out}");
    // A real translation and a short Chinese rewrite stand, and so does
    // a Latin name for a short Chinese one.
    for text in [
        "Sorry for the trouble - if Friday morning doesn't suit you, tell us what does.",
        "抱歉。",
    ] {
        let out = edit(&ctx(doc), &args(text));
        assert!(out.starts_with("Edit proposed"), "{text}: {out}");
    }
    let out = edit(
        &ctx("名称：乐维斯"),
        r#"{"action":"replace","anchor":"乐维斯","text":"Textus"}"#,
    );
    assert!(out.starts_with("Edit proposed"), "{out}");
}

#[test]
fn a_second_proposal_for_the_same_passage_is_refused() {
    let doc = ctx("Textus is great.\n\nTextus is fast.\n\nIt ships soon.");
    let ctx2 = ctx("Textus is great.");
    let ctx = doc;
    let first = r#"{"action":"replace","anchor":"Textus is great.","text":"Textus is good."}"#;
    assert!(edit(&ctx, first).starts_with("Edit proposed"));
    assert!(edit(&ctx, first).starts_with("Not proposed"));
    // Inside the first passage, too: the block it is in.
    let inner = json!({"action": "delete", "block": ctx.document.blocks[0].id, "anchor": "great"});
    assert!(edit(&ctx, &inner.to_string()).starts_with("Not proposed"));
    // Another passage and an insertion beside the first stand.
    for args in [
        r#"{"action":"replace","anchor":"It ships soon.","text":"It ships in May."}"#,
        r#"{"action":"insert_after","anchor":"Textus is great.","text":" Really."}"#,
    ] {
        assert!(edit(&ctx, args).starts_with("Edit proposed"), "{args}");
    }
    // A refused call (words in no block) doesn't count as proposed.
    let missing = r#"{"action":"replace","anchor":"Textus is slow.","text":"x"}"#;
    assert!(edit(&ctx2, missing).starts_with("Not proposed"));
}

#[test]
fn the_size_note_counts_like_measure_text() {
    let out = edit(
        &ctx("周末带爸妈去了千岛湖，人很多。"),
        r#"{"action":"replace","anchor":"周末带爸妈去了千岛湖，人很多。","text":"周末去了千岛湖。"}"#,
    );
    // Punctuation counts, as in measure_text's chars.
    assert!(out.contains("replaces 15 characters with 8"), "{out}");
}

#[test]
fn a_repeated_word_is_told_apart_by_its_block() {
    let doc = ctx("Textus is great.\n\nTextus is fast.");
    let fast = doc.document.blocks[1].id.clone();
    let out = propose_edit(
        &doc,
        &json!({"action": "replace", "block": fast, "anchor": "Textus", "text": "It"}).to_string(),
    );
    assert!(out.starts_with("Edit proposed"), "{out}");
    // Twice in its block, it needs more words.
    let twice = ctx("Textus is great, Textus is fast.");
    let id = twice.document.blocks[0].id.clone();
    let out = propose_edit(
        &twice,
        &json!({"action": "replace", "block": id, "anchor": "Textus", "text": "It"}).to_string(),
    );
    assert!(out.contains("exactly once"), "{out}");
    // Without a block, document text isn't edited.
    let out = propose_edit(
        &twice,
        r#"{"action":"replace","anchor":"great","text":"good"}"#,
    );
    assert_eq!(out, crate::ai::doc_blocks::NO_BLOCK);
}

#[test]
fn a_text_puts_each_picture_it_was_given_in_once() {
    let mut ledger = ProposalLedger::default();
    assert_eq!(ledger.pictures_problem("![a](textus-generated:zz)"), None);
    ledger.add_picture("k3f9qz".into());
    ledger.add_picture("p08mxa".into());
    let both = "One.\n\n![a](textus-generated:k3f9qz)\n\nTwo.\n\n![b](textus-generated:p08mxa)";
    assert_eq!(ledger.pictures_problem(both), None);
    let twice = "![a](textus-generated:k3f9qz)\n\n![b](textus-generated:k3f9qz)";
    let why = ledger.pictures_problem(twice).unwrap();
    assert!(why.contains("twice") && why.contains("p08mxa"), "{why}");
    let wrong = ledger
        .pictures_problem("![a](textus-generated:k3f9qy)")
        .unwrap();
    assert!(wrong.contains("no picture of this request"), "{wrong}");
}

#[test]
fn a_result_says_its_picture_ids_are_textus_own() {
    let mut ledger = ProposalLedger::default();
    assert_eq!(ledger.pictures_placed("One."), "");
    ledger.add_picture("k3f9qz".into());
    let note = ledger.pictures_placed("One.\n\n![a](textus-generated:k3f9qz)");
    assert!(note.contains("nothing to fix"), "{note}");
    assert_eq!(ledger.pictures_placed("One."), "");
}

#[test]
fn words_of_an_undecided_rewrite_quoted_by_its_block_go_into_the_rewrite() {
    // Haiku named the block it had rewritten and quoted its own rewrite.
    let doc = "The lighthouse stood on the rock.\n\nWaves broke below.";
    let undecided = vec![crate::ai::images::UndecidedEdit {
        replaced: "The lighthouse stood on the rock.".into(),
        text: "The old lighthouse stood alone on its rock.".into(),
    }];
    let context = ToolContext {
        undecided: &undecided,
        ..ctx(doc)
    };
    let block = context.document.blocks[0].id.clone();
    let out = propose_edit(
        &context,
        &json!({"action": "replace", "block": block, "anchor": "stood alone", "text": "stood tall"})
            .to_string(),
    );
    assert!(out.contains("goes into that proposal"), "{out}");
    // Words in neither are still refused, by the block.
    let out = propose_edit(
        &context,
        &json!({"action": "replace", "block": block, "anchor": "a dragon", "text": "x"})
            .to_string(),
    );
    assert!(out.contains("exactly once"), "{out}");
}
