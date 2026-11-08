//! Research on the shared tool layer: the files attached, the plugins' and
//! MCP servers' tools, and the attachments a paper keeps.

use super::delegate::DELEGATE_TOOL;
use super::research::{self, ADD_NOTE_TOOL};
use super::*;
use crate::ai::tools::{Access, Run, Tool, ToolContext, ToolRegistry, EVERY_MODE};
use aicompat::agent::{AgentTurn, StepResult, ToolSpec};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;

/// The shared tools and their context, over `root` and a paper folder.
pub(super) fn kit<'t>(
    root: Option<&'t Path>,
    paper_folder: Option<&'t Path>,
    installed: Vec<Tool<'t>>,
) -> (ToolRegistry<'t>, ToolContext<'t>) {
    let tools = research::shared_tools(root, paper_folder.is_some(), false, installed);
    (tools, research::context(root, paper_folder, false))
}

fn paper() -> Paper {
    Paper {
        id: "abc123".into(),
        topic: "Tides".into(),
        genre: Genre::Report,
        language: "en".into(),
        target_chars: 4000,
        budget: ResearchBudget::for_paper(),
        stage: PaperStage::Researching,
        sub_helpers: false,
    }
}

fn call(id: &str, name: &str, args: Value) -> AgentTurn {
    AgentTurn::ToolCall {
        call_id: id.into(),
        name: name.into(),
        arguments: args.to_string(),
        reasoning: None,
    }
}

fn last_result(turns: &[AgentTurn]) -> &str {
    match turns.last() {
        Some(AgentTurn::ToolResult { output, .. }) => output,
        _ => panic!("no result"),
    }
}

/// Plans from the attached file, reads it with read_file, and cites it by
/// its path.
struct Reader;

impl crate::ai::agent::Model for Reader {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<StepResult, String>> {
        let step = if tools.is_empty() {
            let AgentTurn::User { text, .. } = &turns[0] else {
                panic!("no topic");
            };
            assert!(text.contains("Tides were logged hourly."), "{text}");
            StepResult::Done(
                r#"["What do the tide logs show?", "How often were the tides logged?"]"#.into(),
            )
        } else if turns.len() == 1 {
            assert!(
                instructions.contains("attached/my notes.md"),
                "{instructions}"
            );
            StepResult::ToolCalls(vec![call(
                "r",
                crate::ai::tools::READ_FILE_TOOL_NAME,
                json!({"path": "attached/my notes.md"}),
            )])
        } else if turns.len() == 3 {
            let output = last_result(turns);
            assert!(output.contains("Tides were logged hourly."), "{output}");
            StepResult::ToolCalls(vec![call(
                "n",
                ADD_NOTE_TOOL,
                json!({"claim": "Tides were logged hourly.", "evidence": "The logs.", "sources": ["attached/my notes.md"]}),
            )])
        } else {
            StepResult::Done("Covered.".into())
        };
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn a_researcher_reads_an_attached_file_with_read_file_and_cites_its_path() {
    let folder = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(folder.path().join("attached")).unwrap();
    std::fs::write(
        folder.path().join("attached/my notes.md"),
        "Tides were logged hourly.\n",
    )
    .unwrap();
    let budget = Arc::new(SharedBudget::new(ResearchBudget::for_paper()));
    let web = crate::ai::web::WebPlan::new(true, None, None, &[])
        .with_budget(budget.clone())
        .keeping_seen_text();
    let (tools, ctx) = kit(None, Some(folder.path()), Vec::new());
    let kit = research::Kit {
        tools: &tools,
        ctx: &ctx,
    };
    let dossier = research::research(
        &Reader,
        &paper(),
        &web,
        &budget,
        &|_| {},
        &kit,
        research::Progress::none(),
    )
    .await
    .unwrap();
    assert_eq!(dossier.notes.len(), 2);
    assert_eq!(dossier.sources.len(), 1);
    // The note was checked against the file it cites.
    assert_eq!(dossier.notes[0].grounding, Grounding::Read);
    assert_eq!(
        dossier.notes[0].excerpt.as_deref(),
        Some("Tides were logged hourly.")
    );
    let address = &dossier.sources[0].url;
    assert_eq!(address, "attached/my%20notes.md");
    assert_eq!(finish::entry(&dossier.sources[0]), "`my notes.md`");
    // A section citing it is linked to its source like a web page.
    let mut section = OutlineSection {
        title: "Logs".into(),
        target_words: 8,
        ..Default::default()
    };
    section.key_points = vec!["logs".into()];
    let cited = format!("The tides were logged every hour, the notes say [1]({address}).");
    let problems = draft::problems(&cited, &section, &[(1, address.clone())], "en");
    assert!(
        !problems
            .iter()
            .any(|p| p.text.starts_with("Nothing is cited") || p.text.contains("links to")),
        "{problems:?}"
    );
}

fn plugin_echo(_: &ToolContext, arguments: &str) -> String {
    format!("echoed {arguments}")
}

/// Calls the plugin's tool it is offered, then keeps a note from it.
struct PluginUser;

impl crate::ai::agent::Model for PluginUser {
    fn step<'a>(
        &'a self,
        _: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<StepResult, String>> {
        let step = if tools.is_empty() {
            StepResult::Done(r#"["What do the gauges read?", "Where are they?"]"#.into())
        } else if turns.len() == 1 {
            assert!(tools.iter().any(|t| t.name == "plugin_echo"), "{tools:?}");
            StepResult::ToolCalls(vec![call("p", "plugin_echo", json!({"q": "gauges"}))])
        } else if turns.len() == 3 {
            let output = last_result(turns);
            assert!(output.contains("echoed"), "{output}");
            StepResult::ToolCalls(vec![call(
                "n",
                ADD_NOTE_TOOL,
                json!({"claim": "The gauges read high.", "evidence": "The plugin said so.", "sources": ["https://gauges.example/today"]}),
            )])
        } else {
            StepResult::Done("Covered.".into())
        };
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn the_tools_plugins_and_mcp_servers_offer_reach_the_researchers() {
    let budget = Arc::new(SharedBudget::new(ResearchBudget::for_paper()));
    let web = crate::ai::web::WebPlan::new(true, None, None, &[]).with_budget(budget.clone());
    let installed = vec![Tool {
        spec: ToolSpec {
            name: "plugin_echo".into(),
            description: "Echoes.".into(),
            parameters: json!({"type": "object", "properties": {}}),
        },
        access: Access::Proposes,
        modes: EVERY_MODE,
        run: Run::Text(plugin_echo),
    }];
    let (tools, ctx) = kit(None, None, installed);
    let kit = research::Kit {
        tools: &tools,
        ctx: &ctx,
    };
    let events = std::sync::Mutex::new(Vec::new());
    let send = |e: PaperEvent| events.lock().unwrap().push(e);
    let dossier = research::research(
        &PluginUser,
        &paper(),
        &web,
        &budget,
        &send,
        &kit,
        research::Progress::none(),
    )
    .await
    .unwrap();
    assert_eq!(dossier.notes.len(), 2);
    let ran = events
        .into_inner()
        .unwrap()
        .into_iter()
        .filter(|e| matches!(e, PaperEvent::Activity { tool, .. } if tool == "plugin_echo"))
        .count();
    assert_eq!(ran, 2);
}

#[test]
fn attachments_are_kept_in_the_paper_s_folder_when_the_scratch_folder_is_gone() {
    let root = tempfile::tempdir().unwrap();
    let scratch = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(scratch.path().join("attached")).unwrap();
    std::fs::write(scratch.path().join("attached/a.md"), "A").unwrap();
    let kept = store::keep_attachments(root.path(), "abc123", Some(scratch.path()))
        .unwrap()
        .unwrap();
    drop(scratch);
    // Going on: no conversation, the paper's own copy.
    let again = store::keep_attachments(root.path(), "abc123", None)
        .unwrap()
        .unwrap();
    assert_eq!(kept, again);
    // Only the attachments: the paper's own files stay out of the tools' sight.
    assert!(!again.join("paper.json").exists() && kept.ends_with("files"));
    assert_eq!(
        std::fs::read_to_string(again.join("attached/a.md")).unwrap(),
        "A"
    );
    assert_eq!(
        store::keep_attachments(root.path(), "def456", None).unwrap(),
        None
    );
}

#[test]
fn an_older_paper_s_materials_become_attached_files() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path().join("papers/abc123");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("materials.json"),
        json!([{"name": "notes/my notes.md", "content": "Hourly."}]).to_string(),
    )
    .unwrap();
    store::keep_attachments(root.path(), "abc123", None).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.join("files/attached/my notes.md")).unwrap(),
        "Hourly."
    );
    assert!(!dir.join("materials.json").exists());
}

/// Plans two questions; answers the first from a.example and fails the
/// second unless `second` - a run stopped after one question, then going on.
struct Halfway {
    second: bool,
}

impl research::Model for Halfway {
    fn step<'a>(
        &'a self,
        _instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<StepResult, String>> {
        let step = (|| {
            if tools.is_empty() {
                assert!(!self.second, "going on planned the research again");
                return Ok(StepResult::Done(
                    r#"["Why do tides rise?", "Where are tides highest?"]"#.into(),
                ));
            }
            let AgentTurn::User { text, .. } = &turns[0] else {
                panic!("no question");
            };
            let first = text.contains("Why do tides rise?");
            assert!(
                !(first && self.second),
                "going on asked a finished question again"
            );
            if !first && !self.second {
                return Err("stopped".to_string());
            }
            Ok(if turns.len() == 1 {
                let (claim, url) = if first {
                    ("The moon pulls the sea.", "https://a.example/")
                } else {
                    ("Fundy's tides are highest.", "https://b.example/")
                };
                StepResult::ToolCalls(vec![call(
                    "n",
                    ADD_NOTE_TOOL,
                    json!({"claim": claim, "evidence": "Measured.", "sources": [url]}),
                )])
            } else {
                StepResult::Done("Covered.".into())
            })
        })();
        Box::pin(async move { step })
    }
}

/// A question's researcher hands three parts over in one step - the third
/// refused - then keeps a note of its own; each part's helper keeps one.
struct Delegator;

impl research::Model for Delegator {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<StepResult, String>> {
        let offers_delegate = tools.iter().any(|t| t.name == DELEGATE_TOOL);
        let step = if tools.is_empty() {
            StepResult::Done(r#"["What do the gauges read?", "Where are the gauges?"]"#.into())
        } else if instructions.contains("they handed you one part") {
            assert!(!offers_delegate, "a part's helper hands nothing on");
            let AgentTurn::User { text, .. } = &turns[0] else {
                panic!("no part");
            };
            if turns.len() == 1 {
                assert!(text.starts_with("Your question: Gauge "), "{text}");
                let part = text
                    .lines()
                    .next()
                    .unwrap()
                    .trim_start_matches("Your question: ");
                StepResult::ToolCalls(vec![call(
                    "n",
                    ADD_NOTE_TOOL,
                    json!({"claim": format!("{part} is answered."), "evidence": "A reading.", "sources": ["https://gauges.example/a"]}),
                )])
            } else {
                StepResult::Done("Covered.".into())
            }
        } else if turns.len() == 1 {
            assert!(offers_delegate, "{tools:?}");
            StepResult::ToolCalls(
                ["Gauge A?", "Gauge B?", "Gauge C?"]
                    .iter()
                    .enumerate()
                    .map(|(i, q)| call(&format!("d{i}"), DELEGATE_TOOL, json!({"question": q})))
                    .collect(),
            )
        } else if !turns
            .iter()
            .any(|t| matches!(t, AgentTurn::ToolCall { name, .. } if name == ADD_NOTE_TOOL))
        {
            let results: Vec<&str> = turns
                .iter()
                .filter_map(|t| match t {
                    AgentTurn::ToolResult { output, .. } => Some(output.as_str()),
                    _ => None,
                })
                .collect();
            assert_eq!(results.len(), 3, "{results:?}");
            assert!(
                results[0].contains("kept 1 note")
                    && results[0].contains("Gauge A? is answered. [1]"),
                "{results:?}"
            );
            assert!(results[1].contains("Gauge B? is answered."), "{results:?}");
            assert!(
                results[2].contains("handed over 2 parts already"),
                "{results:?}"
            );
            StepResult::ToolCalls(vec![call(
                "own",
                ADD_NOTE_TOOL,
                json!({"claim": "The gauges read high.", "evidence": "Both parts.", "sources": ["1"]}),
            )])
        } else {
            StepResult::Done("Covered.".into())
        };
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn research_stopped_halfway_goes_on_from_the_questions_it_finished() {
    let root = tempfile::tempdir().unwrap();
    let id = paper().id;
    let run = |second: bool| {
        let (root, id) = (root.path().to_path_buf(), id.clone());
        async move {
            let budget = Arc::new(SharedBudget::new(ResearchBudget::for_paper()));
            let web =
                crate::ai::web::WebPlan::new(true, None, None, &[]).with_budget(budget.clone());
            // A fresh book: something else numbered first, as another run's
            // pages would be.
            web.add_source("https://other.example/", "Other");
            let (tools, ctx) = kit(None, None, Vec::new());
            let kit = research::Kit {
                tools: &tools,
                ctx: &ctx,
            };
            let keep = |p: &research::ResearchProgress| {
                store::save_research(&root, &id, p).unwrap();
            };
            let progress = research::Progress {
                kept: store::load_research(&root, &id),
                keep: &keep,
            };
            research::research(
                &Halfway { second },
                &paper(),
                &web,
                &budget,
                &|_| {},
                &kit,
                progress,
            )
            .await
        }
    };

    // The first run: one question answered, the other failed.
    let first = run(false).await.unwrap();
    assert_eq!(first.notes.len(), 1);
    let kept = store::load_research(root.path(), &id);
    assert_eq!(kept.questions.len(), 2);
    assert!(kept.answered[0].is_some() && kept.answered[1].is_none());
    assert_eq!(kept.sources.len(), 1);
    assert_eq!(kept.sources[0].url, "https://a.example/");

    // Going on asks only the open question, and the kept note's source
    // keeps pointing at its page under the new book's numbers.
    let dossier = run(true).await.unwrap();
    let claims: Vec<&str> = dossier.notes.iter().map(|n| n.claim.as_str()).collect();
    assert_eq!(
        claims,
        ["The moon pulls the sea.", "Fundy's tides are highest."]
    );
    assert_eq!(dossier.notes[0].id, "n1");
    let url = |n: u32| {
        dossier
            .sources
            .iter()
            .find(|s| s.n == n)
            .map(|s| s.url.clone())
    };
    assert_eq!(
        url(dossier.notes[0].sources[0]).as_deref(),
        Some("https://a.example/")
    );
    assert_eq!(
        url(dossier.notes[1].sources[0]).as_deref(),
        Some("https://b.example/")
    );

    store::clear_research(root.path(), &id).unwrap();
    assert!(store::load_research(root.path(), &id).questions.is_empty());
}

#[test]
fn research_with_no_questions_leaves_no_file() {
    let root = tempfile::tempdir().unwrap();
    let kept = research::ResearchProgress {
        questions: vec!["Why?".into()],
        ..Default::default()
    };
    store::save_research(root.path(), "p1", &kept).unwrap();
    let before = walk(root.path());
    store::save_research(root.path(), "p1", &Default::default()).unwrap();
    assert!(before.iter().any(|p| p.ends_with("research.json")));
    assert!(!walk(root.path())
        .iter()
        .any(|p| p.ends_with("research.json")));
}

fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(walk(&path));
        } else {
            out.push(path);
        }
    }
    out
}

#[tokio::test]
async fn a_researcher_hands_parts_of_its_question_to_helpers_of_its_own() {
    let budget = Arc::new(SharedBudget::new(ResearchBudget::for_paper()));
    let web = crate::ai::web::WebPlan::new(true, None, None, &[]).with_budget(budget.clone());
    let (tools, ctx) = kit(None, None, Vec::new());
    let kit = research::Kit {
        tools: &tools,
        ctx: &ctx,
    };
    let events = std::sync::Mutex::new(Vec::new());
    let send = |e: PaperEvent| events.lock().unwrap().push(e);
    let delegating = Paper {
        sub_helpers: true,
        ..paper()
    };
    let dossier = research::research(
        &Delegator,
        &delegating,
        &web,
        &budget,
        &send,
        &kit,
        research::Progress::none(),
    )
    .await
    .unwrap();
    // Per question: the two parts' notes, then the researcher's own.
    assert_eq!(dossier.notes.len(), 6);
    assert_eq!(dossier.notes[0].question, "Gauge A?");
    assert_eq!(dossier.notes[2].question, "What do the gauges read?");
    let events = events.into_inner().unwrap();
    let handed = events
        .iter()
        .filter(|e| matches!(e, PaperEvent::Activity { tool, .. } if tool == DELEGATE_TOOL))
        .count();
    assert_eq!(handed, 4);
    // The parts' notes count for their question on the card.
    assert!(events.iter().any(|e| matches!(
        e,
        PaperEvent::QuestionDone {
            question: 0,
            notes: 3,
            failed: false
        }
    )));
}

#[test]
fn a_part_handed_over_is_a_narrower_question() {
    use super::delegate::read;
    let parent = "What do the gauges read?";
    assert!(read(r#"{"question": " "}"#, parent).is_err());
    assert!(read(r#"{"question": "what do the gauges read?"}"#, parent).is_err());
    let handed = read(
        r#"{"question": "Gauge A?", "context": "B is known."}"#,
        parent,
    )
    .unwrap();
    assert_eq!(handed.context.as_deref(), Some("B is known."));
    assert!(super::delegate::brief(&handed).contains("don't look for it again: B is known."));
}

#[test]
fn a_share_is_used_up_only_when_every_kind_is() {
    let share = research::Share::of(
        BudgetCounts {
            searches: 4,
            fetches: 4,
            paper_lookups: 2,
            images: 0,
            model_steps: 0,
        },
        2,
    );
    assert!(!share.used_up(&[2, 2, 0]));
    assert!(share.used_up(&[2, 2, 1]));
}

/// Plans two questions; each researcher, asserted never offered
/// delegate_task, keeps one note.
struct NoHanding;

impl research::Model for NoHanding {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<StepResult, String>> {
        let step = if tools.is_empty() {
            StepResult::Done(r#"["Why do tides rise?", "Where are tides highest?"]"#.into())
        } else {
            assert!(tools.iter().all(|t| t.name != DELEGATE_TOOL));
            assert!(!instructions.contains(DELEGATE_TOOL), "{instructions}");
            if turns.len() == 1 {
                StepResult::ToolCalls(vec![call(
                    "n",
                    ADD_NOTE_TOOL,
                    json!({"claim": "The moon pulls the sea.", "evidence": "Measured.", "sources": ["https://a.example/"]}),
                )])
            } else {
                StepResult::Done("Covered.".into())
            }
        };
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn without_the_users_choice_a_researcher_hands_nothing_over() {
    let budget = Arc::new(SharedBudget::new(ResearchBudget::for_paper()));
    let web = crate::ai::web::WebPlan::new(true, None, None, &[]).with_budget(budget.clone());
    let (tools, ctx) = kit(None, None, Vec::new());
    let kit = research::Kit {
        tools: &tools,
        ctx: &ctx,
    };
    let dossier = research::research(
        &NoHanding,
        &paper(),
        &web,
        &budget,
        &|_| {},
        &kit,
        research::Progress::none(),
    )
    .await
    .unwrap();
    assert_eq!(dossier.notes.len(), 2);
}

/// add_note keeps a note only as its sources said it: a quote they don't
/// have is refused, a figure they don't give sent back once, and a note
/// kept carries the passage it rests on.
#[test]
fn a_note_is_checked_against_what_its_sources_said() {
    use crate::ai::web::Reach;
    let web = crate::ai::web::WebPlan::new(true, None, None, &[]).keeping_seen_text();
    let page = web.add_source("https://sea.example/tides", "Tides");
    web.saw(page, "Tides\nThe gauge logged 1,240 tides in 2023. Spring tides were \u{201c}a metre higher\u{201d}.", Reach::Read);
    let snippet = web.add_source("https://sky.example/moon", "Moon");
    web.saw(snippet, "Moon\nThe moon pulls the sea.", Reach::Snippet);
    let unseen = web.add_source("https://plugin.example/gauge", "");
    let (_, ctx) = kit(None, None, Vec::new());
    let notes = std::sync::Mutex::new(Vec::new());
    let taker = super::notes::NoteTaker {
        question: "q",
        index: 0,
        web: &web,
        ctx: &ctx,
        notes: &notes,
        send: &|_| {},
        sent_back: Default::default(),
    };
    let add = |args: Value| {
        taker
            .keep(&aicompat::agent::ToolCall {
                call_id: "n".into(),
                name: ADD_NOTE_TOOL.into(),
                arguments: args.to_string(),
            })
            .text
    };
    let quoted = add(
        json!({"claim": "Spring tides run high.", "evidence": "The gauge.", "quote": "two metres higher", "sources": ["1"]}),
    );
    assert!(
        quoted.starts_with("Not kept: the quote isn't in what [1] says"),
        "{quoted}"
    );
    let made_up = json!({"claim": "The gauge logged 1,240 tides.", "evidence": "Since 2019.", "sources": ["1"]});
    let sent_back = add(made_up.clone());
    assert!(
        sent_back.starts_with("Not kept: 2019 isn't in what [1] says"),
        "{sent_back}"
    );
    assert_eq!(add(made_up), "Kept.");
    assert_eq!(
        add(
            json!({"claim": "Spring tides run high.", "evidence": "1240 tides in 2023.", "quote": "A metre higher", "sources": ["1"]})
        ),
        "Kept."
    );
    assert_eq!(
        add(json!({"claim": "The moon pulls the sea.", "evidence": "Gravity.", "sources": ["2"]})),
        "Kept."
    );
    assert_eq!(
        add(json!({"claim": "Gauges read 7.5 m.", "evidence": "The plugin.", "sources": ["3"]})),
        "Kept."
    );
    // An address nothing showed: kept, marked as never read.
    assert_eq!(
        add(
            json!({"claim": "Gauges read 9 m.", "evidence": "A page.", "sources": ["https://made-up.example/gauge"]})
        ),
        "Kept."
    );
    let notes = notes.into_inner().unwrap();
    assert_eq!(notes[4].grounding, Grounding::Unread);
    assert_eq!(notes[0].unmatched, vec!["2019"]);
    assert_eq!(notes[0].grounding, Grounding::Read);
    assert!(notes[1].unmatched.is_empty());
    assert_eq!(
        notes[1].excerpt.as_deref(),
        Some("The gauge logged 1,240 tides in 2023. Spring tides were \u{201c}a metre higher\u{201d}.")
    );
    assert_eq!(notes[2].grounding, Grounding::Snippet);
    assert_eq!(notes[3].grounding, Grounding::Unchecked);
    assert_eq!(notes[3].excerpt, None);
    assert_eq!(unseen, 3);
}
