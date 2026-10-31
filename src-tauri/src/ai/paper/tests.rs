use super::*;
use crate::ai::web::{WebPlan, WEB_FETCH_TOOL};
use serde_json::json;
use std::sync::Arc;

fn paper() -> Paper {
    Paper {
        id: "abc123".into(),
        topic: "城市热岛效应".into(),
        language: "zh".into(),
        target_chars: 8000,
        budget: ResearchBudget::for_paper(),
    }
}

fn outline() -> Outline {
    Outline {
        thesis: "Green roofs cool cities measurably.".into(),
        sections: vec![OutlineSection {
            title: "Mechanism".into(),
            key_points: vec!["Albedo".into(), "Evapotranspiration".into()],
            evidence: vec!["n1".into()],
            target_words: 1200,
            figures: vec![FigurePlan {
                kind: FigureKind::Chart,
                spec: "Surface temperature by roof type, from n1".into(),
            }],
        }],
    }
}

fn dossier() -> Dossier {
    Dossier {
        notes: vec![Note {
            id: "n1".into(),
            question: "How much do green roofs cool?".into(),
            claim: "Green roofs lower surface temperature by up to 30 °C.".into(),
            evidence: "Measured on 12 roofs over two summers.".into(),
            quote: Some("up to 30 °C cooler".into()),
            sources: vec![3, 7],
            leads: vec![Lead {
                kind: LeadKind::Data,
                description: "Table 2: temperatures per roof".into(),
                url: Some("https://example.org/study".into()),
            }],
        }],
        sources: Vec::new(),
    }
}

#[test]
fn the_shapes_serialize_in_camel_case_for_the_frontend() {
    let value = serde_json::to_value(outline()).unwrap();
    let section = &value["sections"][0];
    assert_eq!(
        section["keyPoints"],
        json!(["Albedo", "Evapotranspiration"])
    );
    assert_eq!(section["targetWords"], json!(1200));
    assert_eq!(section["figures"][0]["kind"], json!("chart"));
    let paper = serde_json::to_value(paper()).unwrap();
    assert_eq!(paper["targetChars"], json!(8000));
    assert_eq!(paper["budget"]["limits"]["paperLookups"], json!(30));
    let event = serde_json::to_value(PaperEvent::Section {
        index: 2,
        status: SectionStatus::Drafted,
    })
    .unwrap();
    assert_eq!(
        event,
        json!({"type": "section", "index": 2, "status": "drafted"})
    );
    let phase = serde_json::to_value(PaperEvent::Phase {
        phase: PaperPhase::AwaitingOutline,
    })
    .unwrap();
    assert_eq!(phase, json!({"type": "phase", "phase": "awaitingOutline"}));
}

#[test]
fn a_note_without_a_quote_still_reads() {
    let note: Note = serde_json::from_value(json!({
        "id": "n2", "question": "q", "claim": "c", "evidence": "e",
        "sources": [], "leads": []
    }))
    .unwrap();
    assert_eq!(note.quote, None);
}

#[test]
fn a_saved_paper_loads_back_whole() {
    let root = tempfile::tempdir().unwrap();
    let files = PaperFiles {
        paper: paper(),
        dossier: dossier(),
        outline: Some(outline()),
    };
    save(root.path(), &files).unwrap();
    let dir = root.path().join(".textus/papers/abc123");
    for name in ["paper.json", "dossier.json", "outline.json"] {
        assert!(dir.join(name).is_file(), "{name}");
    }
    assert_eq!(load(root.path(), "abc123").unwrap(), files);
}

#[test]
fn a_paper_not_yet_researched_or_outlined_loads_empty() {
    let root = tempfile::tempdir().unwrap();
    let files = PaperFiles {
        paper: paper(),
        dossier: Dossier::default(),
        outline: None,
    };
    save(root.path(), &files).unwrap();
    assert!(!root
        .path()
        .join(".textus/papers/abc123/outline.json")
        .exists());
    assert_eq!(load(root.path(), "abc123").unwrap(), files);
}

#[test]
fn a_missing_or_unsafe_paper_id_is_an_error() {
    let root = tempfile::tempdir().unwrap();
    assert!(load(root.path(), "nothere").is_err());
    for id in ["../x", "", "A1", "a/b"] {
        assert!(load(root.path(), id).is_err(), "{id}");
    }
    let mut bad = paper();
    bad.id = "../../escape".into();
    let files = PaperFiles {
        paper: bad,
        dossier: Dossier::default(),
        outline: None,
    };
    assert!(save(root.path(), &files).is_err());
    assert!(!root.path().join(".textus").exists());
}

#[test]
fn new_ids_are_valid_and_differ() {
    let a = new_id();
    std::thread::sleep(std::time::Duration::from_millis(1));
    let b = new_id();
    assert_ne!(a, b);
    assert!(store::paper_dir(std::path::Path::new("/p"), &a).is_ok());
}

#[test]
fn the_budget_refuses_once_a_kind_is_spent_and_leaves_the_others() {
    let mut budget = ResearchBudget::new(BudgetCounts {
        searches: 2,
        fetches: 1,
        paper_lookups: 0,
        images: 1,
    });
    assert!(budget.take(BudgetKind::Search));
    assert!(budget.take(BudgetKind::Search));
    assert!(!budget.take(BudgetKind::Search));
    assert!(!budget.take(BudgetKind::PaperLookup));
    assert_eq!(
        budget.remaining(),
        BudgetCounts {
            searches: 0,
            fetches: 1,
            paper_lookups: 0,
            images: 1,
        }
    );
    assert_eq!(budget.used.searches, 2);
}

#[tokio::test]
async fn web_plans_sharing_a_budget_spend_it_together() {
    let shared = Arc::new(SharedBudget::new(ResearchBudget::new(BudgetCounts {
        fetches: 3,
        ..BudgetCounts::default()
    })));
    let helpers: Vec<WebPlan> = (0..2)
        .map(|_| WebPlan::new(true, None, None, &[]).with_budget(shared.clone()))
        .collect();
    // This computer is refused at once, and the read still counts.
    let fetch = r#"{"url":"http://127.0.0.1:8080/"}"#;
    for web in [&helpers[0], &helpers[1], &helpers[0]] {
        let out = web.execute(WEB_FETCH_TOOL, fetch, "").await;
        assert!(out.contains("private network"), "{out}");
    }
    let out = helpers[1].execute(WEB_FETCH_TOOL, fetch, "").await;
    assert!(out.contains("That's the 3 pages"), "{out}");
    assert_eq!(shared.snapshot().remaining().fetches, 0);
}

#[test]
fn questions_come_from_a_json_array_or_a_list() {
    assert_eq!(
        research::parse_questions("Here:\n[\"What is it?\", \"What is it?\", \"Who uses it?\"]"),
        ["What is it?", "Who uses it?"]
    );
    assert_eq!(
        research::parse_questions(
            "1. How do green roofs cool?\n- What do the measurements show?\nok"
        ),
        ["How do green roofs cool?", "What do the measurements show?"]
    );
}

/// A model that plans two questions, and as each question's helper keeps
/// one good note, tries two bad ones, then stops.
struct Scripted;

impl research::Model for Scripted {
    fn step<'a>(
        &'a self,
        _instructions: &'a str,
        turns: &'a [aicompat::agent::AgentTurn],
        tools: &'a [aicompat::agent::ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<aicompat::agent::StepResult, String>> {
        use aicompat::agent::{AgentTurn, StepResult};
        let step = if tools.is_empty() {
            StepResult::Done(
                r#"["How do green roofs cool a street?", "What do city measurements show?"]"#
                    .into(),
            )
        } else if turns.len() == 1 {
            let AgentTurn::User { text, .. } = &turns[0] else {
                panic!()
            };
            let call = |id: &str, args: serde_json::Value| AgentTurn::ToolCall {
                call_id: format!("{id}-{}", text.len()),
                name: research::ADD_NOTE_TOOL.into(),
                arguments: args.to_string(),
                reasoning: None,
            };
            StepResult::ToolCalls(vec![
                call(
                    "good",
                    json!({"claim": text, "evidence": "2 °C cooler at noon.", "sources": ["https://example.org/study"], "leads": [{"kind": "data", "description": "hourly table"}]}),
                ),
                call(
                    "unknown",
                    json!({"claim": "x", "evidence": "y", "sources": ["7"]}),
                ),
                call(
                    "bare",
                    json!({"claim": "x", "evidence": "y", "sources": []}),
                ),
            ])
        } else {
            StepResult::Done("Covered.".into())
        };
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn research_plans_questions_and_keeps_each_helper_s_sourced_notes() {
    let budget = Arc::new(SharedBudget::new(ResearchBudget::for_paper()));
    let web = WebPlan::new(true, None, None, &[]).with_budget(budget.clone());
    let events = std::sync::Mutex::new(Vec::new());
    let send = |e: PaperEvent| events.lock().unwrap().push(e);
    let dossier = research::research(&Scripted, &paper(), &web, &budget, &send)
        .await
        .unwrap();

    // One note per question kept; the unknown number and the unsourced one
    // were refused.
    assert_eq!(dossier.notes.len(), 2);
    assert_eq!(dossier.notes[0].id, "n1");
    assert_eq!(dossier.notes[1].id, "n2");
    assert_eq!(
        dossier.notes[0].question,
        "How do green roofs cool a street?"
    );
    assert!(dossier.notes[0]
        .claim
        .contains("How do green roofs cool a street?"));
    assert_eq!(dossier.notes[0].leads[0].kind, LeadKind::Data);
    // Both helpers cited the same page: one number for the whole paper.
    assert_eq!(dossier.notes[0].sources, vec![1]);
    assert_eq!(dossier.notes[1].sources, vec![1]);
    assert_eq!(dossier.sources.len(), 1);
    assert_eq!(dossier.sources[0].url, "https://example.org/study");

    let events = events.into_inner().unwrap();
    assert_eq!(
        events[0],
        PaperEvent::Phase {
            phase: PaperPhase::Planning
        }
    );
    assert_eq!(
        events[1],
        PaperEvent::Phase {
            phase: PaperPhase::Researching
        }
    );
    let budgets = events
        .iter()
        .filter(|e| matches!(e, PaperEvent::Budget { .. }))
        .count();
    assert_eq!(budgets, 2);
}

#[tokio::test]
async fn a_note_s_sources_must_be_known_numbers_or_addresses() {
    let web = WebPlan::new(true, None, None, &[]);
    assert_eq!(web.source_number("https://a.example/"), Some(1));
    assert_eq!(web.source_number("[1]"), Some(1));
    assert_eq!(web.source_number(" 1 "), Some(1));
    assert_eq!(web.source_number("2"), None);
    assert_eq!(web.source_number("a.example"), None);
}

/// Plans two questions; its helpers keep nothing.
struct Empty;

impl research::Model for Empty {
    fn step<'a>(
        &'a self,
        _instructions: &'a str,
        _turns: &'a [aicompat::agent::AgentTurn],
        tools: &'a [aicompat::agent::ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<aicompat::agent::StepResult, String>> {
        let reply = if tools.is_empty() {
            r#"["First question here?", "Second question here?"]"#
        } else {
            "Nothing found."
        };
        Box::pin(async move { Ok(aicompat::agent::StepResult::Done(reply.into())) })
    }
}

#[tokio::test]
async fn research_that_keeps_nothing_fails_with_a_reason() {
    let budget = SharedBudget::new(ResearchBudget::for_paper());
    let web = WebPlan::new(true, None, None, &[]);
    let err = research::research(&Empty, &paper(), &web, &budget, &|_| {})
        .await
        .unwrap_err();
    assert!(err.contains("found nothing to write from"), "{err}");
}

/// `outline()` with `n` copies of its section, each `words` long.
fn outline_of(n: usize, words: u32) -> Outline {
    let mut o = outline();
    let section = OutlineSection {
        target_words: words,
        ..o.sections[0].clone()
    };
    o.sections = vec![section; n];
    o
}

#[test]
fn an_outline_is_checked_for_everything_at_once() {
    let d = dossier();
    assert_eq!(
        outline::problems(&outline_of(4, 2000), &d, 8000, 6),
        Vec::<String>::new()
    );

    let mut bad = outline_of(4, 2000);
    bad.thesis = " ".into();
    bad.sections[1].evidence = vec!["n9".into()];
    bad.sections[2].key_points = vec![" ".into()];
    for s in &mut bad.sections {
        s.figures.clear();
    }
    bad.sections[0].figures = vec![
        FigurePlan {
            kind: FigureKind::Generated,
            spec: "a".into(),
        },
        FigurePlan {
            kind: FigureKind::Generated,
            spec: "b".into(),
        },
    ];
    let found = outline::problems(&bad, &d, 8000, 1).join("\n");
    assert!(found.contains("`thesis` is empty"), "{found}");
    assert!(
        found.contains("notes that don't exist: [\"n9\"]"),
        "{found}"
    );
    assert!(
        found.contains("Section 3 (\"Mechanism\") has no key points"),
        "{found}"
    );
    assert!(
        found.contains("2 generated pictures, but only 1"),
        "{found}"
    );
    // Two figures for four sections is enough; lengths add to 8000.
    assert!(!found.contains("figures for"), "{found}");

    let found = outline::problems(&outline_of(2, 100), &d, 8000, 6).join("\n");
    assert!(found.contains("2 sections"), "{found}");
    assert!(found.contains("add up to 200"), "{found}");
}

#[test]
fn english_lengths_are_in_words_and_chinese_in_characters() {
    assert_eq!(outline::target_units(&paper()), 8000);
    let english = Paper {
        language: "en-GB".into(),
        ..paper()
    };
    assert_eq!(outline::target_units(&english), 1333);
}

/// Sends a wrong outline, then the right one.
struct Outliner(std::sync::atomic::AtomicUsize);

impl research::Model for Outliner {
    fn step<'a>(
        &'a self,
        _instructions: &'a str,
        turns: &'a [aicompat::agent::AgentTurn],
        _tools: &'a [aicompat::agent::ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<aicompat::agent::StepResult, String>> {
        use aicompat::agent::{AgentTurn, StepResult};
        let n = self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let AgentTurn::User { text, .. } = &turns[0] else {
            panic!()
        };
        assert!(
            text.contains("n1 - Green roofs lower surface temperature"),
            "{text}"
        );
        let submit = |o: &Outline| {
            StepResult::ToolCalls(vec![AgentTurn::ToolCall {
                call_id: format!("c{n}"),
                name: outline::SUBMIT_OUTLINE_TOOL.into(),
                arguments: serde_json::to_string(o).unwrap(),
                reasoning: None,
            }])
        };
        let step = match n {
            0 => submit(&outline_of(1, 8000)),
            1 => {
                let AgentTurn::ToolResult { output, .. } = turns.last().unwrap() else {
                    panic!()
                };
                assert!(output.contains("Not kept"), "{output}");
                submit(&outline_of(4, 2000))
            }
            _ => StepResult::Done("Outlined.".into()),
        };
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn the_outline_is_sent_back_until_it_holds() {
    let model = Outliner(Default::default());
    let made = outline::make_outline(&model, &paper(), &dossier())
        .await
        .unwrap();
    assert_eq!(made.sections.len(), 4);
}

#[test]
fn an_edited_outline_drops_what_it_can_t_use_and_needs_titles() {
    let d = dossier();
    let mut edited = outline_of(2, 500);
    edited.sections[0].evidence = vec!["n1".into(), "n42".into()];
    edited.sections[0].key_points = vec!["Albedo".into(), "  ".into()];
    edited.sections[1].figures[0].spec = " ".into();
    let kept = outline::as_edited(edited, &d).unwrap();
    assert_eq!(kept.sections[0].evidence, ["n1"]);
    assert_eq!(kept.sections[0].key_points, ["Albedo"]);
    assert!(kept.sections[1].figures.is_empty());

    let mut untitled = outline_of(1, 500);
    untitled.sections[0].title = " ".into();
    assert!(outline::as_edited(untitled, &d).is_err());
    assert!(outline::as_edited(Outline::default(), &d).is_err());
}

#[tokio::test]
async fn paper_searches_draw_on_the_papers_lookups() {
    // None left: refused before any request goes out.
    let shared = Arc::new(SharedBudget::new(ResearchBudget::new(
        BudgetCounts::default(),
    )));
    let web = WebPlan::new(true, None, None, &[]).with_budget(shared.clone());
    let out = web
        .execute(
            crate::ai::web::SEARCH_PAPERS_TOOL,
            r#"{"query":"tides"}"#,
            "",
        )
        .await;
    assert!(out.contains("That's the 0 paper searches"), "{out}");
    assert_eq!(shared.snapshot().used.paper_lookups, 0);
}
