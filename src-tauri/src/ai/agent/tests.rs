use super::*;
use crate::ai::ui_language::{entries, UI_LANGUAGES};

#[test]
fn a_length_the_user_asks_for_is_noticed() {
    for asked in [
        "写一篇 1200 字左右的文章",
        "写三千字",
        "Write about 500 words on tides",
        "2,000 characters, please",
        "800字以内",
    ] {
        assert!(asks_for_a_length(asked), "{asked}");
    }
    for other in ["写一篇文章，配两张图", "Fix the 3 typos", "第2段"] {
        assert!(!asks_for_a_length(other), "{other}");
    }
}

/// The whole tool path a writing request takes, with a scripted model:
/// read the section it was asked about, propose an edit quoting it,
/// get told when a quote doesn't match, retry with the right one.
#[test]
fn scripted_agent_reads_then_proposes_through_the_real_tools() {
    use aicompat::agent::StepResult;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    let document = "# Notes\n\n## Methods\n\nWe sampled ten sites.\n\n## Results\n\nAll good.";
    let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
    let conventions = crate::ai::rules::Conventions::default();
    let ctx = ToolContext {
        document,
        undecided: &[],
        skills: &[],
        ui_language: "en",
        root: None,
        sees_images: false,
        conventions: &conventions,
        library: &[],
        memory: None,
        proposed: Default::default(),
        checks: Default::default(),
    };
    let call = |id: &str, name: &str, args: &str| AgentTurn::ToolCall {
        call_id: id.into(),
        name: name.into(),
        arguments: args.into(),
        reasoning: None,
    };
    let script = RefCell::new(VecDeque::from(vec![
        StepResult::ToolCalls(vec![call("r", "read_document", r#"{"heading":"Methods"}"#)]),
        StepResult::ToolCalls(vec![call(
            "bad",
            "propose_edit",
            r#"{"action":"replace","anchor":"We sampled 10 sites.","text":"x"}"#,
        )]),
        StepResult::ToolCalls(vec![call(
            "ok",
            "propose_edit",
            r#"{"action":"replace","anchor":"We sampled ten sites.","text":"We sampled ten coastal sites."}"#,
        )]),
        StepResult::Done("Named the site type.".into()),
    ]));
    let turns = tauri::async_runtime::block_on(run_agent_loop(
        vec![],
        AgentTurn::User {
            text: "Say which sites".into(),
            images: Vec::new(),
        },
        MAX_STEPS,
        |_| {
            let next = script.borrow_mut().pop_front().unwrap();
            async move { Ok(next) }
        },
        |call| tools.execute(&ctx, call),
        |name| tools.how_to_run(name),
        |_| {},
    ))
    .unwrap();

    let result = |id: &str| {
        turns
            .iter()
            .find_map(|t| match t {
                AgentTurn::ToolResult {
                    call_id, output, ..
                } if call_id == id => Some(output.clone()),
                _ => None,
            })
            .unwrap()
    };
    assert!(result("r").contains("We sampled ten sites."));
    assert!(!result("r").contains("All good."));
    assert!(
        result("bad").starts_with("No exact match"),
        "{}",
        result("bad")
    );
    assert!(
        result("ok").starts_with("Edit proposed"),
        "{}",
        result("ok")
    );
}

#[test]
fn history_keeps_no_tool_images_and_says_so() {
    let shown = AgentTurn::ToolResult {
        call_id: "v".into(),
        output: "Here is `map.png` (image/png).".into(),
        images: vec![ImageAttachment {
            name: "map.png".into(),
            mime: "image/png".into(),
            data_base64: "AAAA".into(),
        }],
    };
    let AgentTurn::ToolResult { output, images, .. } = for_history(shown) else {
        panic!("still a tool result");
    };
    assert!(images.is_empty());
    assert!(
        output.ends_with("call read_file again to look at it.]"),
        "{output}"
    );
    let plain = AgentTurn::ToolResult {
        call_id: "r".into(),
        output: "text".into(),
        images: Vec::new(),
    };
    assert!(matches!(for_history(plain), AgentTurn::ToolResult { output, .. } if output == "text"));
}

#[test]
fn compact_history_stubs_old_reads_but_keeps_edit_results() {
    let big = "x".repeat(5_000);
    let history = vec![
        AgentTurn::User {
            text: "q".into(),
            images: Vec::new(),
        },
        AgentTurn::ToolCall {
            call_id: "r".into(),
            name: "read_file".into(),
            arguments: "{}".into(),
            reasoning: None,
        },
        AgentTurn::ToolResult {
            call_id: "r".into(),
            output: big.clone(),
            images: Vec::new(),
        },
        AgentTurn::ToolCall {
            call_id: "e".into(),
            name: "propose_edit".into(),
            arguments: "{}".into(),
            reasoning: None,
        },
        AgentTurn::ToolResult {
            call_id: "e".into(),
            output: big.clone(),
            images: Vec::new(),
        },
    ];
    let out = compact_history(history);
    let AgentTurn::ToolResult { output, .. } = &out[2] else {
        panic!()
    };
    assert!(output.len() < 1_000 && output.contains("omitted"));
    let AgentTurn::ToolResult { output, .. } = &out[4] else {
        panic!()
    };
    assert_eq!(output, &big);
}

#[test]
fn compact_history_drops_whole_oldest_exchanges_over_budget() {
    let long = "y".repeat(HISTORY_BUDGET);
    let history = vec![
        AgentTurn::User {
            text: long.clone(),
            images: Vec::new(),
        },
        AgentTurn::assistant("a1"),
        AgentTurn::User {
            text: "recent".into(),
            images: Vec::new(),
        },
        AgentTurn::assistant("a2"),
    ];
    let out = compact_history(history);
    assert_eq!(out.len(), 2);
    assert!(matches!(&out[0], AgentTurn::User { text, .. } if text == "recent"));
}

/// One exchange of `chars` characters: a question, a file read, a reply.
fn exchange(n: usize, chars: usize) -> Vec<AgentTurn> {
    vec![
        AgentTurn::User {
            text: format!("question {n}"),
            images: Vec::new(),
        },
        AgentTurn::ToolCall {
            call_id: format!("r{n}"),
            name: "read_file".into(),
            arguments: "{}".into(),
            reasoning: None,
        },
        AgentTurn::ToolResult {
            call_id: format!("r{n}"),
            output: "z".repeat(2_000),
            images: Vec::new(),
        },
        AgentTurn::assistant("a".repeat(chars)),
    ]
}

fn debug(turns: &[AgentTurn]) -> String {
    format!("{turns:?}")
}

/// What the prompt cache needs: a turn, once replayed, reads the same on
/// every later send - the old read cut to the same stub each time.
#[test]
fn compacted_history_is_the_same_on_every_send() {
    let mut history = exchange(0, 100);
    let first = compact_history(history.clone());
    assert!(debug(&first).contains("omitted"));
    for n in 1..5 {
        history.extend(exchange(n, 100));
        let later = compact_history(history.clone());
        assert_eq!(debug(&later[..first.len()]), debug(&first));
    }
}

/// Over budget, the history's first message moves once per block of
/// growth, not on every send - and between moves each send's history
/// starts with the previous one's, so the cached prefix survives.
#[test]
fn over_budget_the_oldest_exchanges_go_in_blocks() {
    let mut history = Vec::new();
    let mut previous: Option<Vec<AgentTurn>> = None;
    let (mut sends, mut moves) = (0, 0);
    for n in 0..60 {
        history.extend(exchange(n, 9_000));
        let out = compact_history(history.clone());
        let kept: usize = out.iter().map(turn_chars).sum();
        assert!(kept <= HISTORY_BUDGET, "{kept} chars kept");
        if let Some(prev) = previous.filter(|_| n > 20) {
            sends += 1;
            if out.len() < prev.len() || debug(&out[..prev.len()]) != debug(&prev) {
                moves += 1;
                // A move drops a whole block and still keeps most of
                // the budget.
                assert!(kept >= HISTORY_BUDGET - HISTORY_DROP_STEP - 10_000);
            }
        }
        previous = Some(out);
    }
    // Each exchange is ~9.4k characters; a block is 50k.
    assert!(moves * 4 < sends, "{moves} moves in {sends} sends");
    assert!(moves > 0);
}

/// An attached file inlined into a message can make one exchange bigger
/// than a block. Rounding the cut up to the next block end would then
/// drop it with everything before it, though the budget only needs the
/// oldest two exchanges gone - so it isn't rounded that far.
#[test]
fn over_budget_a_long_attachment_is_not_dropped_early() {
    let mut history = Vec::new();
    for n in 0..3 {
        history.extend(exchange(n, 10_000));
    }
    history.extend([
        AgentTurn::User {
            text: format!("<attached-file>{}</attached-file>", "p".repeat(130_000)),
            images: Vec::new(),
        },
        AgentTurn::assistant("summary"),
    ]);
    history.extend(exchange(5, 5_000));
    let out = compact_history(history);
    let kept: usize = out.iter().map(turn_chars).sum();
    assert!(kept <= HISTORY_BUDGET, "{kept} chars kept");
    assert!(matches!(&out[0], AgentTurn::User { text, .. } if text == "question 2"));
    assert!(debug(&out).contains("attached-file"));
}

/// A step's reasoning is replayed within its exchange only: the turn
/// the frontend keeps, and sends back next time, has none.
#[test]
fn history_keeps_no_reasoning() {
    let call = AgentTurn::ToolCall {
        call_id: "c".into(),
        name: "read_document".into(),
        arguments: "{}".into(),
        reasoning: Some(serde_json::json!("thought")),
    };
    assert!(matches!(
        for_history(call),
        AgentTurn::ToolCall {
            reasoning: None,
            ..
        }
    ));
}

#[test]
fn the_message_header_names_the_language_the_user_typed() {
    let cases = [
        ("What was the most common complaint?", Some("English")),
        ("把这段翻译成英文", Some("Simplified Chinese")),
        ("把這段翻譯成英文", Some("Traditional Chinese")),
        ("この段落を短くしてください", Some("Japanese")),
        // A selection, the cursor's surroundings and an expanded skill
        // are not what the user typed.
        (
            "<selected-text>\n图书馆每周日下午四点就闭馆了，很多读者抱怨。\n</selected-text>\n\nMake this more formal.",
            Some("English"),
        ),
        (
            "<skill name=\"tighten\" typed=\"/tighten\">\nTighten the passage. Keep every fact.\n</skill>\n\n帮我精简这一段",
            Some("Simplified Chinese"),
        ),
        ("ok", None),
    ];
    for (message, expected) in cases {
        assert_eq!(message_language(message), expected, "{message}");
    }
    let text = request_user_text("doc", "What was the most common complaint?");
    assert!(
        text.ends_with("---the user's message (written in English: reply in English, unless the user instructions set a reply language)---\nWhat was the most common complaint?"),
        "{text}"
    );
    assert!(request_user_text("doc", "ok").ends_with("---the user's message---\nok"));
}

#[test]
fn short_document_is_embedded_verbatim() {
    let doc = "# Title\n\nJust a short document.";
    let section = document_section(doc, true, None);
    // Whole, each block marked with its id (doc_blocks.rs).
    let blocks = doc_blocks::split(doc);
    assert_eq!(
        section,
        format!(
            "---document---\n[#{}] # Title\n\n[#{}] Just a short document.",
            blocks[0].id, blocks[1].id
        )
    );
}

#[test]
fn long_document_is_truncated_with_outline_and_excerpts() {
    let middle = "x".repeat(FULL_DOCUMENT_LIMIT + 1000);
    let doc = format!("# Start\n\nfirst-marker {middle} last-marker\n\n## End");
    let section = document_section(&doc, true, None);
    assert!(section.contains("truncated"));
    assert!(section.contains("# Start"));
    assert!(section.contains("## End"));
    assert!(section.contains("search_document"));
    assert!(section.contains("first-marker"));
    assert!(section.contains("last-marker"));
    // The bulk of the middle shouldn't appear - only outline + excerpts.
    assert!(section.len() < doc.len() / 2);
}

#[test]
fn the_document_tools_are_for_a_document_shown_in_part() {
    // agent::run_agent takes search_document and read_document out when
    // the whole document is in the message.
    assert!(context::shown_whole("# Title\n\nOne paragraph.", true));
    assert!(!context::shown_whole(
        &"x".repeat(FULL_DOCUMENT_LIMIT + 1),
        true
    ));
}

#[test]
fn truncation_note_omits_tool_mention_without_tools() {
    let doc = "x".repeat(FULL_DOCUMENT_LIMIT + 1);
    let section = document_section(&doc, false, None);
    assert!(!section.contains("search_document"));
}

#[test]
fn excerpts_are_char_boundary_safe_for_cjk() {
    // Every char here is multi-byte - a byte-index slice at a fixed
    // offset would panic mid-character.
    let doc = "中".repeat(FULL_DOCUMENT_LIMIT + 500);
    let section = document_section(&doc, true, None);
    assert!(section.contains('中'));
}

/// A Chinese document is about a token a character: past a third of the
/// limit it is outlined, with the section being edited, where the
/// model can read on - and sent whole where it can't.
#[test]
fn a_long_cjk_document_is_outlined_by_its_token_weight() {
    let mut doc = String::from("# 报告\n\n");
    for i in 0..20 {
        doc.push_str(&format!("## 第{i}节\n\n{}\n\n", "调研数据。".repeat(150)));
    }
    doc.push_str("## 目标\n\n用户正在改的段落。");
    let chars = doc.chars().count();
    assert!(chars > FULL_DOCUMENT_LIMIT / 3 && chars < FULL_DOCUMENT_LIMIT);
    let with_tools = document_section(&doc, true, Some("目标"));
    assert!(with_tools.contains("truncated"));
    assert!(with_tools.contains("用户正在改的段落。"));
    assert!(with_tools.chars().count() < chars / 2);
    assert_eq!(
        document_section(&doc, false, None),
        format!(
            "---document---\n{}",
            doc_blocks::annotate(&doc, &doc_blocks::split(&doc), 0, doc.len())
        )
    );
    // The same length of English is still sent whole.
    let english = "x".repeat(chars);
    assert!(!document_section(&english, true, None).contains("truncated"));
}

#[test]
fn a_long_document_still_carries_the_section_being_worked_on() {
    let mut doc = String::from("# Report\n\n");
    for i in 0..60 {
        doc.push_str(&format!(
            "## Part {i}\n\n{}\n\n",
            "filler text. ".repeat(80)
        ));
    }
    doc.push_str("## Target\n\nThe paragraph the user is editing.\n\n## After\n\nmore");
    let section = document_section(&doc, true, Some("Target"));
    assert!(section.contains("truncated"));
    assert!(section.contains("The paragraph the user is editing."));
    // The section ends where the next heading of its level starts.
    let blocks = doc_blocks::split(&doc);
    let (line, focus) = focus_section(&doc, &blocks, "Target").unwrap();
    // Its blocks marked with their ids, as the whole document is.
    assert!(focus.starts_with("[#"), "{focus}");
    let focus = doc_blocks::annotate(&focus, &[], 0, focus.len());
    let focus = focus
        .split_once("] ")
        .map_or(focus.as_str(), |(_, rest)| rest);
    assert!(focus.starts_with("## Target"));
    assert!(!focus.contains("## After"));
    assert_eq!(doc.lines().nth(line - 1), Some("## Target"));
    assert!(!document_section(&doc, true, None).contains("the section the user is working in"));
}

#[test]
fn style_and_mentioned_library_entries_reach_the_prompt() {
    let workspace = AgentWorkspace {
        style: Some("Short sentences. No adverbs.".into()),
        library: vec![
            crate::ai::project::parse_library_entry(
                "a",
                "a",
                "---\nname: 林晚\naliases: [晚晚]\n---\n中学语文老师。",
            ),
            crate::ai::project::parse_library_entry("b", "b", "---\nname: 港城\n---\n海边城市。"),
        ],
        ..AgentWorkspace::default()
    };
    let prompt = request_context(&workspace, "晚晚推开门。", true, "改写这句", None);
    assert!(prompt.contains("Short sentences. No adverbs."));
    assert!(
        prompt.contains("中学语文老师"),
        "mentioned via alias in the document"
    );
    assert!(!prompt.contains("海边城市"), "not mentioned anywhere");
}

#[test]
fn a_built_in_skill_is_indexed_by_when_to_use_it() {
    assert_eq!(
        index_line(
            "Fixes typos. Use when asked to proofread (校对, relire) or check (by hand) errors."
        ),
        "Use when asked to proofread or check (by hand) errors."
    );
    assert_eq!(index_line("No trigger clause."), "No trigger clause.");
}

/// Without use_skill the guide stays in the prompt; with it, the prompt
/// points at it and use_skill loads it.
#[test]
fn the_app_guide_is_loaded_on_demand_where_skills_can_be() {
    let plain = AgentWorkspace::default();
    assert!(workspace_section(&plain, "en").contains("What the app calls the things"));
    let with_skills = crate::ai::workspace::load_layers(None, None, None, &[]);
    assert!(with_skills.has_usable_skills());
    let section = workspace_section(&with_skills, "en");
    assert!(!section.contains("What the app calls the things"));
    assert!(section.contains("use_skill app-guide"));
    assert!(app_guide().contains("Learn my style"));
}

#[test]
fn the_skill_index_offers_model_skills_and_prefers_the_users() {
    use crate::ai::workspace::{AgentSkill, SkillSource};
    let mut ws = crate::ai::workspace::load_layers(None, None, None, &["describe".to_string()]);
    ws.skills.push(AgentSkill {
        name: "house-headline".into(),
        description: "Titles in the house style".into(),
        prompt: "x".into(),
        source: SkillSource::Project,
        ..AgentSkill::default()
    });
    ws.skills.push(AgentSkill {
        name: "my-tone".into(),
        description: "d".repeat(700),
        prompt: "x".into(),
        source: SkillSource::Global,
        ..AgentSkill::default()
    });
    let index = skill_index(&ws, "en");
    let lines: Vec<&str> = index.lines().collect();
    assert!(lines[0].starts_with("- house-headline (project): "));
    assert!(lines[1].starts_with("- my-tone (yours): ") && lines[1].ends_with('…'));
    assert!(lines[1].chars().count() < 540, "a long description is cut");
    // A built-in says when to use it, without the request words in
    // eight languages; the user's own keep their description.
    assert_eq!(
        lines[2],
        "- continue-story: Use when asked to continue the story, write the next part or chapter, or what happens next. Not for non-fiction drafts or for questions about inline completion."
    );
    // In another UI a built-in carries that UI's name for it.
    let zh = skill_index(&ws, "zh");
    assert!(
        zh.contains("- continuity [/检查前后一致 in their UI]: "),
        "{zh}"
    );
    assert!(zh.contains("- house-headline (project): "));
    // /name-only skills and turned-off ones aren't offered.
    for absent in ["tighten", "expand", "change-tone", "summarize", "describe"] {
        assert!(!index.contains(&format!("- {absent}:")), "{absent}");
    }
    // Built-ins by menu category: write before revise before check
    // before format.
    let at = |name: &str| index.find(&format!("- {name}:")).unwrap();
    assert!(
        at("dialogue") < at("de-ai")
            && at("de-ai") < at("proofread")
            && at("proofread") < at("email")
    );
    // The system prompt carries it, the preference rule and the packs,
    // the same whatever the document.
    let a = build_instructions(&ws, "# One", true, AgentMode::Revise, "hi", "en");
    let b = build_instructions(
        &ws,
        "# Two\n\nOther text.",
        true,
        AgentMode::Revise,
        "other",
        "en",
    );
    assert_eq!(a, b);
    assert!(a.contains("When a skill marked (project) or (yours) and an unmarked built-in skill both match a request, use the marked one."));
    assert!(a.contains("standards-zh-hant") && !a.contains("contract,"));
    // Nothing to offer, no index.
    let mut none = ws.clone();
    none.skills.iter_mut().for_each(|s| s.enabled = false);
    assert!(
        !build_instructions(&none, "", true, AgentMode::Revise, "", "en")
            .contains("---available skills---")
    );
}

#[test]
fn the_academic_skill_is_indexed_in_one_line() {
    let ws = crate::ai::workspace::load_layers(None, None, None, &[]);
    let zh = skill_index(&ws, "zh");
    let line = zh
        .lines()
        .find(|l| l.starts_with("- academic-polish [/学术润色 in their UI]: "))
        .unwrap_or_else(|| panic!("{zh}"));
    // Sent with every request: one line, under the 500 cap uncut, and
    // it names grant proposals so they route here.
    assert!(
        !line.ends_with('…') && line.contains("grant proposal"),
        "{line}"
    );
    assert!(!zh.contains("research-writing"));
}

#[test]
fn the_workspace_section_says_which_folder_and_why() {
    use crate::ai::workspace::{load_from, RootSource};
    let doc_folder = load_from(None, Some("/tmp/novel/chapter-1.md"), None);
    assert_eq!(doc_folder.root_source, RootSource::DocumentFolder);
    let text = workspace_section(&doc_folder, "en");
    assert!(text.contains("/tmp/novel") && text.contains("own folder"));
    let tmp = std::env::temp_dir();
    let chosen = load_from(None, Some("/tmp/novel/chapter-1.md"), tmp.to_str());
    assert_eq!(chosen.root_source, RootSource::Chosen);
    assert!(workspace_section(&chosen, "en").contains("chosen by the user"));
    // An unsaved draft: no files, the reason, and the way out.
    let unsaved = load_from(None, None, None);
    assert_eq!(unsaved.root_source, RootSource::None);
    let text = workspace_section(&unsaved, "en");
    assert!(text.contains("isn't saved") && text.contains("Settings > Textus AI"));
    assert!(!text.contains("list_files"));
    // No project, no project bar: only the Settings row is offered.
    assert!(!text.contains("click the folder name"));
    assert!(workspace_section(&doc_folder, "en").contains("click the folder name"));
    assert!(workspace_section(&chosen, "en").contains("Use the document's folder"));
    let too_broad = AgentWorkspace {
        root_source: RootSource::TooBroad,
        ..AgentWorkspace::default()
    };
    let text = workspace_section(&too_broad, "en");
    assert!(text.contains("too broad") && !text.contains("click the folder name"));
    // The app's names, for every case: the English ones, and those of
    // the user's UI language - only that one.
    assert!(text.contains("Learn my style") && !text.contains("English |"));
    let chinese = workspace_section(&too_broad, "zh");
    assert!(chinese.contains("English | 中文\nproject folder | 项目文件夹\n"));
    assert!(chinese.contains("not \"style profile (文风档案)\", not \"资料库 (library)\""));
    assert!(!chinese.contains("日本語"));
    // A language whose names aren't translated yet gets the English
    // ones alone, and one the backend doesn't know of the same.
    assert_eq!(workspace_section(&too_broad, "xx"), text);
    // The tool-less fallback doesn't hear about file tools.
    let prompt = build_instructions(&unsaved, "draft", false, AgentMode::Revise, "", "en");
    assert!(!prompt.contains("---project---"));
    let review = request_preamble(&doc_folder, AgentMode::Review, "en");
    assert!(review.contains("Review mode:") && review.contains("Revise mode you"));
    let review = request_preamble(&doc_folder, AgentMode::Review, "ja");
    assert!(
        review.contains("Review mode (レビュー in their Japanese UI)")
            && review.contains("Revise mode (推敲)")
            && review.contains("Write mode (執筆)")
    );
}

#[test]
fn the_prompt_names_things_exactly_as_the_ui_does() {
    // Every UI label the agent is told about must be the one the user
    // sees, in each language, or the agent sends people to menu items
    // that don't exist. Read from the frontend's files, so a language
    // still to be translated - no help guide of its own yet - is simply
    // not there.
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let read = |path: &str| std::fs::read_to_string(repo.join(path)).unwrap_or_default();
    let names_ts = read("src/i18n/names.ts");
    assert!(
        names_ts.contains(&format!("export const AI_NAME = \"{AI_NAME}\";")),
        "AI_NAME differs from src/i18n/names.ts"
    );
    assert!(
        names_ts.contains(&format!(
            "export const APP_NAME = \"{}\";",
            crate::app_identity::APP_NAME
        )),
        "APP_NAME differs from src/i18n/names.ts"
    );
    // The same languages as the UI offers, in the same order.
    let langs_ts = read("src/i18n/langs.ts");
    let list = langs_ts
        .split("export const LANGS = [")
        .nth(1)
        .and_then(|rest| rest.split("] as const").next())
        .expect("LANGS in src/i18n/langs.ts");
    let codes: Vec<&str> = list.split('"').skip(1).step_by(2).collect();
    assert_eq!(
        codes,
        UI_LANGUAGES.iter().map(|l| l.code).collect::<Vec<_>>()
    );

    // A chosen project folder: the case that names every label.
    let chosen = AgentWorkspace {
        root: Some("/tmp/novel".into()),
        root_source: crate::ai::workspace::RootSource::Chosen,
        ..AgentWorkspace::default()
    };
    let english: Vec<&str> = entries(UI_LANGUAGES[0].names).collect();
    for language in UI_LANGUAGES {
        let code = language.code;
        let strings = read(&format!("src/i18n/locales/{code}.ts"));
        let guide = read(&format!("src/help/agent-guide.{code}.md"));
        // A name is the UI's, or, for the few that are no label -
        // "project menu" - the help guide's. "Style (the chip)": the
        // label is what precedes the note.
        let known = |name: &str| {
            let name = name.split(" (").next().unwrap();
            strings.contains(name) || guide.to_lowercase().contains(&name.to_lowercase())
        };
        if code == "en" {
            for name in &english {
                assert!(known(name), "neither the UI nor the guide says {name}");
            }
            continue;
        }
        let lines: Vec<&str> = entries(language.names).collect();
        if lines.is_empty() {
            continue;
        }
        let pairs: Vec<(&str, &str)> = lines
            .iter()
            .map(|line| {
                line.split_once(" = ")
                    .unwrap_or_else(|| panic!("ui-names/{code}.txt: no \" = \" in {line}"))
            })
            .collect();
        assert_eq!(
            pairs.iter().map(|(en, _)| *en).collect::<Vec<_>>(),
            english,
            "ui-names/{code}.txt names every line of en.txt, in its order"
        );
        let prompt = build_instructions(&chosen, "draft", true, AgentMode::Review, "", code);
        assert!(prompt.contains(&format!("\nEnglish | {}\n", language.native)));
        for (en, name) in &pairs {
            assert!(
                prompt.contains(&format!("{en} | {name}")),
                "the prompt lacks {name}"
            );
            assert!(
                known(name),
                "{code}: neither the UI nor the guide says {name}"
            );
        }
    }

    // The labels the English description quotes, and those too short
    // to look up on their own, are exactly the strings' entries.
    let prompt = build_instructions(&chosen, "draft", true, AgentMode::Review, "", "en");
    let en_ts = read("src/i18n/locales/en.ts");
    for label in [
        "Choose project folder…",
        "Use the document's folder",
        "Learn my style from samples…",
        "Create style profile",
        "Open style profile",
        "New library entry…",
        "Edit project writing instructions",
        "Writing Instructions (agent.md)",
        "Edit agent.md",
        "Import Skill…",
    ] {
        assert!(prompt.contains(label), "the prompt lacks {label}");
        assert!(
            en_ts.contains(&format!("\"{label}\"")),
            "the UI has no {label}"
        );
    }
    let (zh_ts, ja_ts) = (
        read("src/i18n/locales/zh.ts"),
        read("src/i18n/locales/ja.ts"),
    );
    for (strings, entry) in [
        (&en_ts, "projectStyleChip: \"Style\""),
        (&zh_ts, "projectStyleChip: \"文风\""),
        (&ja_ts, "projectStyleChip: \"文体\""),
        (&en_ts, "agentWorkspaceRootLabel: \"Project Folder\""),
        (&zh_ts, "agentWorkspaceRootLabel: \"项目文件夹\""),
        (
            &ja_ts,
            "agentWorkspaceRootLabel: \"プロジェクトフォルダー\"",
        ),
        (&zh_ts, "agentSkillsLabel: \"技能\""),
        (&ja_ts, "agentSkillsLabel: \"スキル\""),
        (&zh_ts, "settingsTitle: \"设置\""),
        (&ja_ts, "settingsTitle: \"設定\""),
        (&zh_ts, "tutorialContinuationTitle: \"续写\""),
        (&ja_ts, "completionToneLabel: \"補完のトーン\""),
        (&zh_ts, "proposalAccept: \"采纳\""),
        (&ja_ts, "proposalAccept: \"適用\""),
        (&zh_ts, "proposalReject: \"拒绝\""),
        (&ja_ts, "proposalReject: \"却下\""),
    ] {
        assert!(strings.contains(entry), "the UI has no {entry}");
    }
    assert!(prompt.contains(&format!("Settings > {AI_NAME} > Project Folder")));
    // The backend's own pointer to Settings names the same page.
    assert!(crate::ai::route::NOT_CONFIGURED.contains(&format!("Settings > {AI_NAME}.")));
}

#[test]
fn interaction_mode_is_explicit_in_every_message() {
    let workspace = AgentWorkspace::default();
    let message = |mode| request_message(&workspace, mode, "en", "---document---\ndraft", "Go.");
    let review = message(AgentMode::Review);
    assert!(review.contains("interaction mode: review"));
    assert!(
        build_instructions(&workspace, "draft", true, AgentMode::Review, "", "en")
            .contains("No document edit tool is available")
    );

    assert!(message(AgentMode::Revise).contains("interaction mode: revise"));

    // Write adds after a selection rather than replacing it, and sends
    // a request to change what is there to Revise.
    let write = message(AgentMode::Write);
    assert!(write.contains("interaction mode: write"));
    assert!(write.contains("right after the selection") && write.contains("never in place of it"));
    assert!(write.contains("say it needs Revise mode"));
    // The mode comes before the document and the user's words.
    assert!(write.find("interaction mode").unwrap() < write.find("---document---").unwrap());
    // Tool-less, it stays in the system prompt with everything else.
    assert!(
        build_instructions(&workspace, "draft", false, AgentMode::Write, "", "en")
            .contains("interaction mode: write")
    );
}

/// Switching between Write and Revise, or saving a memory, must not
/// change the system prompt or the tool list: either rewrote the whole
/// cached prefix and the history after it (docs/design/ai-tokens.md).
#[test]
fn the_cached_prefix_survives_a_mode_switch_and_a_new_memory() {
    use crate::ai::memory::{Memories, Memory, MemoryKind, Scope};
    let mut ws = AgentWorkspace {
        remember: true,
        ..AgentWorkspace::default()
    };
    let prefix = |ws: &AgentWorkspace, mode| {
        let tools = ToolRegistry::builtin(false, false, mode, true, false);
        let specs: Vec<String> = tools
            .specs()
            .iter()
            .map(|s| format!("{}{}{}", s.name, s.description, s.parameters))
            .collect();
        (build_instructions(ws, "draft", true, mode, "", "en"), specs)
    };
    let revise = prefix(&ws, AgentMode::Revise);
    assert_eq!(prefix(&ws, AgentMode::Write), revise);
    ws.memories = Memories {
        items: vec![Memory {
            id: "personal/memory/x".into(),
            scope: Scope::Personal,
            kind: MemoryKind::Preference,
            text: "Reply briefly.".into(),
            file: String::new(),
            remembered: Default::default(),
            included: true,
        }],
        ..Default::default()
    };
    assert_eq!(prefix(&ws, AgentMode::Revise), revise);
    assert!(request_message(&ws, AgentMode::Revise, "en", "", "Go.").contains("Reply briefly."));
}

#[test]
fn project_writing_instructions_follow_and_override_the_global_ones() {
    let global = "Always reply in English.";
    let project = "Reply in Chinese.";
    let both = AgentWorkspace {
        instructions: vec![global.into()],
        project_instructions: Some(project.into()),
        ..AgentWorkspace::default()
    };
    let prompt = build_instructions(&both, "draft", true, AgentMode::Revise, "", "en");
    let global_at = prompt.find(global).unwrap();
    let project_at = prompt.find(project).unwrap();
    assert!(global_at < project_at, "global first, project after");
    assert!(prompt.contains(
        "---user instructions for this project (where they conflict with the ones above, follow these)---\nReply in Chinese."
    ));

    // One layer alone keeps the plain header, whichever layer it is.
    for alone in [
        AgentWorkspace {
            instructions: vec![global.into()],
            ..AgentWorkspace::default()
        },
        AgentWorkspace {
            project_instructions: Some(global.into()),
            ..AgentWorkspace::default()
        },
    ] {
        let prompt = build_instructions(&alone, "draft", true, AgentMode::Revise, "", "en");
        assert!(prompt.contains("---user instructions---\nAlways reply in English."));
        assert!(!prompt.contains("---user instructions for this project"));
    }
}

#[test]
fn remembered_memories_follow_the_users_instructions() {
    use crate::ai::memory::{Memories, Memory, MemoryKind, Scope};
    let memory = |scope, text: &str| Memory {
        id: String::new(),
        scope,
        kind: MemoryKind::Preference,
        text: text.into(),
        file: String::new(),
        remembered: Default::default(),
        included: true,
    };
    let ws = AgentWorkspace {
        instructions: vec!["Global rule.".into()],
        memories: Memories {
            items: vec![
                memory(Scope::Personal, "Reply briefly."),
                memory(Scope::Project, "Spell it colour."),
            ],
            ..Default::default()
        },
        remember: true,
        ..AgentWorkspace::default()
    };
    let prompt = build_instructions(&ws, "draft", true, AgentMode::Review, "", "en");
    assert!(prompt.contains("---remembering---"), "every mode");
    // What is remembered comes with the message, after the user's own
    // instructions (in the system prompt).
    let message = request_message(&ws, AgentMode::Review, "en", "", "Go.");
    let personal = message.find("Reply briefly.").unwrap();
    let project = message.find("Spell it colour.").unwrap();
    assert!(prompt.contains("Global rule.") && personal < project);
    // Without tools there is no remember tool to talk about.
    let flat = build_instructions(&ws, "draft", false, AgentMode::Review, "", "en");
    assert!(flat.contains("Reply briefly.") && !flat.contains("---remembering---"));
}

#[test]
fn a_selected_picture_in_the_documents_folder_is_seen() {
    let dir = std::env::temp_dir().join(format!("textus-selpic-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    // A 1x1 PNG.
    let png = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    )
    .unwrap();
    std::fs::write(dir.join("assets/boats.png"), png).unwrap();
    let doc = dir.join("harbour.md");
    let doc = doc.to_str();
    let ask = |selection: &str| {
        selected_picture(
            &format!("<selected-text>\n{selection}\n</selected-text>\n\nWhat is in it?"),
            doc,
        )
    };
    let seen = ask("![Boats](assets/boats.png)").expect("the picture");
    assert_eq!(seen.mime, "image/png");
    assert!(ask("![Boats](<assets/boats.png> \"Boats\")").is_some());
    // More than the picture, a picture on the web, or outside the folder.
    assert!(ask("Look: ![Boats](assets/boats.png)").is_none());
    assert!(ask("![Boats](https://example.com/boats.png)").is_none());
    assert!(ask("![Boats](../boats.png)").is_none());
    assert!(selected_picture("What is in it?", doc).is_none());
    let _ = std::fs::remove_dir_all(&dir);
}

/// Runs a scripted Revise request: each step the provider's text and its
/// calls (comments, edits), through the real tools. Returns the turns and
/// how many steps ran.
fn scripted_revise(document: &str, script: Vec<Vec<AgentTurn>>) -> (Vec<AgentTurn>, usize) {
    use aicompat::agent::StepResult;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
    let conventions = crate::ai::rules::Conventions::default();
    let ctx = ToolContext {
        document,
        undecided: &[],
        skills: &[],
        ui_language: "en",
        root: None,
        sees_images: false,
        conventions: &conventions,
        library: &[],
        memory: None,
        proposed: Default::default(),
        checks: Default::default(),
    };
    let script = RefCell::new(VecDeque::from(script));
    let steps = std::cell::Cell::new(0);
    let turns = tauri::async_runtime::block_on(run_agent_loop(
        vec![],
        AgentTurn::User {
            text: "Translate it into English".into(),
            images: Vec::new(),
        },
        MAX_STEPS,
        |_| {
            steps.set(steps.get() + 1);
            let step = StepResult::ToolCalls(script.borrow_mut().pop_front().unwrap());
            let result = settle_step(step, document, &conventions, None).0;
            async move { Ok(result) }
        },
        |call| tools.execute(&ctx, call),
        |name| tools.how_to_run(name),
        |_| {},
    ))
    .unwrap();
    (turns, steps.get())
}

fn call(id: &str, name: &str, arguments: serde_json::Value) -> AgentTurn {
    AgentTurn::ToolCall {
        call_id: id.into(),
        name: name.into(),
        arguments: arguments.to_string(),
        reasoning: None,
    }
}

fn comment(id: &str, anchor: &str) -> AgentTurn {
    call(
        id,
        tools::ADD_COMMENT_TOOL_NAME,
        serde_json::json!({"anchor": anchor, "comment": "The title is a pun; this keeps one half."}),
    )
}

fn translation(id: &str, document: &str) -> AgentTurn {
    let ids: Vec<String> = doc_blocks::split(document)
        .into_iter()
        .map(|b| b.id)
        .collect();
    call(
        id,
        tools::PROPOSE_EDIT_TOOL_NAME,
        serde_json::json!({"action": "replace", "block": ids[0], "last_block": ids[1],
            "text": "# Borrowed Rain\n\nA rainy night."}),
    )
}

fn proposed_edits(turns: &[AgentTurn]) -> usize {
    turns
        .iter()
        .filter(|t| matches!(t, AgentTurn::ToolResult { output, .. } if output.starts_with("Edit proposed")))
        .count()
}

#[test]
fn a_comment_and_a_sentence_before_any_edit_is_asked_on() {
    // DeepSeek, 1.2.0-rc.6: "Translated it all" with a comment, and no
    // edit - the edits it meant to send next were never asked for.
    let document = "# 借雨\n\n雨夜。";
    let (turns, steps) = scripted_revise(
        document,
        vec![
            vec![
                comment("c0", "借雨"),
                AgentTurn::assistant("Translated it all; one note on the title."),
            ],
            vec![translation("e1", document), AgentTurn::assistant("Done.")],
        ],
    );
    assert_eq!(steps, 2);
    assert_eq!(proposed_edits(&turns), 1);
}

#[test]
fn edits_comments_and_a_sentence_in_one_step_end_the_request() {
    // The comment comes first: the step's edits still run before it.
    let document = "# 借雨\n\n雨夜。";
    let (turns, steps) = scripted_revise(
        document,
        vec![vec![
            comment("c0", "借雨"),
            translation("e0", document),
            AgentTurn::assistant("Translated it; one note on the title."),
        ]],
    );
    assert_eq!(steps, 1);
    assert_eq!(proposed_edits(&turns), 1);
}
