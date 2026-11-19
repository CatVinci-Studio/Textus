use super::*;

fn doc(text: &str) -> Document {
    Document::from_markdown(text)
}

#[test]
fn a_document_is_in_chapters_at_its_highest_repeated_heading() {
    let d = doc("# The Book\n\nIntro.\n\n## One\n\nA.\n\n### Aside\n\nB.\n\n## Two\n\nC.");
    let found = chapters(&d);
    assert_eq!(found.len(), 2);
    // The title and intro go with the first chapter.
    assert_eq!(found[0].first, 0);
    assert_eq!(found[0].title, "One");
    assert_eq!(found[1].title, "Two");
    assert_eq!(found[1].last, d.blocks.len() - 1);
    assert_eq!(found[0].last + 1, found[1].first);
    // One heading, or none: no chapters.
    assert!(chapters(&doc("# Only\n\nText.")).is_empty());
    assert!(chapters(&doc("Text.\n\nMore.")).is_empty());
}

#[test]
fn too_many_chapters_are_joined_in_pairs() {
    let text: String = (1..=40)
        .map(|n| format!("## C{n}\n\nText {n}.\n\n"))
        .collect();
    let found = chapters(&doc(&text));
    assert!(found.len() <= MAX_CHAPTERS);
    assert_eq!(found[0].title, "C1");
    assert_eq!(found.last().unwrap().last, doc(&text).blocks.len() - 1);
}

#[test]
fn only_a_long_document_in_chapters_is_offered_it() {
    let short = doc("## One\n\nA.\n\n## Two\n\nB.");
    assert!(!offers_chapters(&short));
    let long: String = (1..=3)
        .map(|n| format!("## Chapter {n}\n\n{}\n\n", "Words here. ".repeat(300)))
        .collect();
    assert!(offers_chapters(&doc(&long)));
    assert!(!offers_chapters(&doc(&"Words here. ".repeat(1000))));
}

#[test]
fn a_call_needs_an_instruction_and_keeps_a_clean_glossary() {
    assert!(read_call(r#"{"instruction": "  "}"#).is_err());
    let (instruction, glossary) = read_call(
        r#"{"instruction": "Translate into English.", "glossary": [{"term": "林远", "write": "Lin Yuan"}, {"term": "", "write": "x"}]}"#,
    )
    .unwrap();
    assert_eq!(instruction, "Translate into English.");
    assert_eq!(glossary, vec![("林远".to_string(), "Lin Yuan".to_string())]);
}

/// A chapter's helper steps through `Model`, as the chat and
/// Research do: here a scripted one, each chapter seeing only its own. A
/// server numbers every helper's calls from call_0; their ids stay apart,
/// also from a second edit_chapters call's.
#[tokio::test]
async fn each_chapter_s_helper_steps_the_model_it_is_given() {
    use aicompat::agent::StepResult;
    use futures_util::future::BoxFuture;

    struct Seen(Mutex<Vec<String>>);
    impl Model for Seen {
        fn step<'a>(
            &'a self,
            _instructions: &'a str,
            turns: &'a [AgentTurn],
            _tools: &'a [ToolSpec],
        ) -> BoxFuture<'a, Result<StepResult, String>> {
            Box::pin(async move {
                if turns.len() > 1 {
                    return Ok(StepResult::Done("Done.".into()));
                }
                if let Some(AgentTurn::User { text, .. }) = turns.first() {
                    self.0.lock().unwrap().push(text.clone());
                }
                Ok(StepResult::ToolCalls(vec![AgentTurn::ToolCall {
                    call_id: "call_0".into(),
                    name: crate::ai::tools::PROPOSE_EDIT_TOOL_NAME.into(),
                    arguments: r#"{"action": "append", "text": "More."}"#.into(),
                    reasoning: None,
                }]))
            })
        }
    }
    struct Quiet;
    impl EventSink for Quiet {
        fn send(&self, _: StreamEvent) {}
    }

    let text: String = (1..=2)
        .map(|n| format!("## Chapter {n}\n\nBody {n}.\n\n"))
        .collect();
    let document = doc(&text);
    let model = Seen(Default::default());
    let workspace = AgentWorkspace::default();
    let conventions = Conventions::default();
    let tools = ToolRegistry::builtin(false, false, AgentMode::Write, false)
        .only(crate::ai::tools::PROPOSE_EDIT_TOOL_NAME);
    let tool_ctx = ToolContext::for_document(&document);
    let helpers = HelperTurns::default();
    let run = ChapterRun {
        agent: &model,
        workspace: &workspace,
        document: &document,
        mode: AgentMode::Write,
        ui_language: "en",
        conventions: &conventions,
        tools: &tools,
        tool_ctx: &tool_ctx,
        channel: &Quiet,
        helpers: &helpers,
    };
    let call = |id: &str| ToolCall {
        call_id: id.into(),
        name: "edit_chapters".into(),
        arguments: r#"{"instruction": "Tighten it."}"#.into(),
    };
    let ToolOutput { text: said, .. } = run.run(call("c1")).await;
    assert!(said.contains("\"Chapter 1\": 1 edits proposed"), "{said}");
    assert!(said.contains("\"Chapter 2\": 1 edits proposed"), "{said}");
    run.run(call("c2")).await;
    let ids: Vec<String> = helpers
        .lock()
        .unwrap()
        .iter()
        .flat_map(|(_, turns)| turns.iter())
        .filter_map(|t| match t {
            AgentTurn::ToolCall { call_id, .. } => Some(call_id.clone()),
            _ => None,
        })
        .collect();
    let unique: std::collections::HashSet<_> = ids.iter().collect();
    assert_eq!((ids.len(), unique.len()), (4, 4), "{ids:?}");
    let seen = model.0.lock().unwrap();
    assert_eq!(seen.len(), 4);
    assert!(seen
        .iter()
        .any(|m| m.contains("Body 1.") && !m.contains("Body 2.")));
    assert!(seen
        .iter()
        .any(|m| m.contains("Body 2.") && !m.contains("Body 1.")));
}

#[test]
fn helper_turns_go_after_their_call_s_result() {
    let call = |id: &str| AgentTurn::ToolCall {
        call_id: id.into(),
        name: "x".into(),
        arguments: "{}".into(),
        reasoning: None,
    };
    let result = |id: &str| AgentTurn::ToolResult {
        call_id: id.into(),
        output: "ok".into(),
        images: Vec::new(),
    };
    let helpers: HelperTurns = Mutex::new(vec![("c1".into(), vec![call("h1"), result("h1")])]);
    let turns = with_helper_turns(
        vec![call("c1"), result("c1"), AgentTurn::assistant("Done.")],
        &helpers,
    );
    let ids: Vec<String> = turns
        .iter()
        .map(|t| match t {
            AgentTurn::ToolCall { call_id, .. } => format!("call {call_id}"),
            AgentTurn::ToolResult { call_id, .. } => format!("result {call_id}"),
            _ => "reply".into(),
        })
        .collect();
    assert_eq!(
        ids,
        ["call c1", "result c1", "call h1", "result h1", "reply"]
    );
}
