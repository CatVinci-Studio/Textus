//! Research on the shared tool layer: the files attached, the plugins' and
//! MCP servers' tools, and the attachments a paper keeps.

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

impl research::Model for Reader {
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
    let dossier = research::research(&Reader, &paper(), &web, &budget, &|_| {}, &kit)
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
            .any(|p| p.starts_with("Nothing is cited") || p.contains("links to")),
        "{problems:?}"
    );
}

fn plugin_echo(_: &ToolContext, arguments: &str) -> String {
    format!("echoed {arguments}")
}

/// Calls the plugin's tool it is offered, then keeps a note from it.
struct PluginUser;

impl research::Model for PluginUser {
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
    let dossier = research::research(&PluginUser, &paper(), &web, &budget, &send, &kit)
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
    let notes = notes.into_inner().unwrap();
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
