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
    let dossier = research::research(&Scripted, &paper(), &web, &budget, &send, None)
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
    // The questions are shown before the helpers start on them.
    assert_eq!(
        events[1],
        PaperEvent::Questions {
            questions: vec![
                "How do green roofs cool a street?".into(),
                "What do city measurements show?".into(),
            ]
        }
    );
    assert_eq!(
        events[2],
        PaperEvent::Phase {
            phase: PaperPhase::Researching
        }
    );
    let budgets = events
        .iter()
        .filter(|e| matches!(e, PaperEvent::Budget { .. }))
        .count();
    assert_eq!(budgets, 2);
    // Each kept note is told as it is kept; the refused ones aren't.
    let mut kept: Vec<(u32, String)> = events
        .iter()
        .filter_map(|e| match e {
            PaperEvent::Activity {
                question,
                kind: ActivityKind::Note,
                detail,
            } => Some((*question, detail.clone())),
            _ => None,
        })
        .collect();
    kept.sort();
    assert_eq!(kept.len(), 2);
    assert_eq!(kept[0].0, 0);
    assert!(kept[0].1.contains("green roofs"), "{}", kept[0].1);
    let mut done: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, PaperEvent::QuestionDone { .. }))
        .collect();
    done.sort_by_key(|e| match e {
        PaperEvent::QuestionDone { question, .. } => *question,
        _ => 0,
    });
    assert_eq!(
        done,
        [
            &PaperEvent::QuestionDone {
                question: 0,
                notes: 1,
                failed: false
            },
            &PaperEvent::QuestionDone {
                question: 1,
                notes: 1,
                failed: false
            },
        ]
    );
}

#[test]
fn a_helper_s_tool_calls_are_told_in_one_line() {
    let call = |name: &str, args: serde_json::Value| aicompat::agent::ToolCall {
        call_id: "c".into(),
        name: name.into(),
        arguments: args.to_string(),
    };
    assert_eq!(
        research::activity(&call(
            "web_search",
            json!({"queries": ["green roofs", "heat island"]})
        )),
        Some((ActivityKind::Search, "green roofs · heat island".into()))
    );
    assert_eq!(
        research::activity(&call("web_fetch", json!({"url": "https://who.int/heat"}))),
        Some((ActivityKind::Read, "https://who.int/heat".into()))
    );
    assert_eq!(
        research::activity(&call("search_papers", json!({"query": "urban greening"}))),
        Some((ActivityKind::Papers, "urban greening".into()))
    );
    assert_eq!(research::activity(&call("add_note", json!({}))), None);
    let long = "城".repeat(300);
    let clipped = research::clip(&long);
    assert_eq!(clipped.chars().count(), 120);
    assert!(clipped.ends_with('…'));
}

#[test]
fn the_planner_s_stream_is_sent_as_its_tail_a_few_times_a_second() {
    let events = std::sync::Mutex::new(Vec::new());
    let send = |e: PaperEvent| events.lock().unwrap().push(e);
    let tail = research::ThinkingTail::new(&send);
    tail.push("First   the\nbackground. ");
    // Straight after: held back, but gathered.
    tail.push(&"x".repeat(2000));
    let events = events.into_inner().unwrap();
    assert_eq!(
        events,
        [PaperEvent::Thinking {
            text: "First the background.".into()
        }]
    );
    assert_eq!(research::tail("abcdef", 3), "def");
    assert_eq!(research::tail("绿化城市", 2), "城市");
    assert_eq!(research::tail("ab", 5), "ab");
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
    let err = research::research(&Empty, &paper(), &web, &budget, &|_| {}, None)
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
        outline::problems(
            &outline_of(4, 2000),
            &d,
            8000,
            &outline::Shape::new(3200, 6)
        ),
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
    let found = outline::problems(&bad, &d, 8000, &outline::Shape::new(3200, 1)).join("\n");
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

    let found =
        outline::problems(&outline_of(2, 100), &d, 8000, &outline::Shape::new(3200, 6)).join("\n");
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
                submit(&outline_of(9, 900))
            }
            _ => StepResult::Done("Outlined.".into()),
        };
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn the_outline_is_sent_back_until_it_holds() {
    let model = Outliner(Default::default());
    let made = outline::make_outline(&model, &paper(), &dossier(), &|_| {})
        .await
        .unwrap();
    assert_eq!(made.sections.len(), 9);
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

fn drafting_dossier() -> Dossier {
    Dossier {
        sources: vec![aicompat::agent::Source {
            n: 3,
            url: "https://example.org/study".into(),
            title: "Study".into(),
        }],
        ..dossier()
    }
}

/// A section of `n` words citing source 3, with `extra` after it.
fn section_text(n: usize, extra: &str) -> String {
    format!(
        "{} roofs cool [3](https://example.org/study).\n\n{extra}",
        "Green ".repeat(n)
    )
}

#[test]
fn a_section_is_checked_for_length_citations_and_figures() {
    let mut section = outline().sections.remove(0);
    section.target_words = 100;
    section.figures = vec![
        FigurePlan {
            kind: FigureKind::Mermaid,
            spec: "flow".into(),
        },
        FigurePlan {
            kind: FigureKind::Chart,
            spec: "temps".into(),
        },
    ];
    let sources = vec![(3, "https://example.org/study".to_string())];
    let chart =
        "```chart\n{\"type\": \"bar\", \"labels\": [\"a\"], \"series\": [{\"data\": [12]}]}\n```";
    let good = section_text(
        97,
        &format!("```mermaid\nflowchart LR\n  A --> B\n```\n\n{chart}"),
    );
    assert_eq!(
        draft::problems(&good, &section, &sources, "en"),
        Vec::<String>::new()
    );

    let bad = format!(
        "{} cool [3](https://wrong.example/) and [4](https://x.example/) and [3] alone.\n\n```chart\n{{\"type\": \"radar\", \"series\": []}}\n```",
        "Green ".repeat(20)
    );
    let found = draft::problems(&bad, &section, &sources, "en").join("\n");
    assert!(
        found.contains("Far too short: 25 against about 100"),
        "{found}"
    );
    assert!(
        found.contains(
            "[3] links to https://wrong.example/ but source 3 is https://example.org/study"
        ),
        "{found}"
    );
    assert!(
        found.contains("[4] isn't one of this section's sources"),
        "{found}"
    );
    assert!(found.contains("written as [n] alone"), "{found}");
    assert!(found.contains("Chart 1: \"type\" \"radar\""), "{found}");
    assert!(
        found.contains("1 planned diagram(s), 0 ```mermaid"),
        "{found}"
    );
    assert!(found.contains("Nothing is cited"), "{found}");
}

#[test]
fn chinese_sections_count_characters_and_skip_figures() {
    assert_eq!(draft::length("屋顶 绿化\n降温", "zh-CN"), 6);
    assert_eq!(draft::length("Green roofs cool", "en"), 3);
}

/// Writes every section, the second only on its second try.
struct Writer(std::sync::atomic::AtomicUsize);

impl research::Model for Writer {
    fn step<'a>(
        &'a self,
        _instructions: &'a str,
        turns: &'a [aicompat::agent::AgentTurn],
        _tools: &'a [aicompat::agent::ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<aicompat::agent::StepResult, String>> {
        use aicompat::agent::{AgentTurn, StepResult};
        let AgentTurn::User { text, .. } = &turns[0] else {
            panic!()
        };
        assert!(text.contains("[3](https://example.org/study)"), "{text}");
        let second = text.contains("\"Second\"");
        let step = match turns.last() {
            Some(AgentTurn::User { .. }) => {
                let words = if second { 10 } else { 97 };
                let body = section_text(words, "```chart\n{\"series\": [{\"data\": [1]}]}\n```");
                StepResult::ToolCalls(vec![AgentTurn::ToolCall {
                    call_id: format!("first-{second}"),
                    name: draft::SUBMIT_SECTION_TOOL.into(),
                    arguments: json!({ "markdown": body }).to_string(),
                    reasoning: None,
                }])
            }
            Some(AgentTurn::ToolResult { output, .. }) if output.contains("Not kept") => {
                self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let body = section_text(97, "```chart\n{\"series\": [{\"data\": [1]}]}\n```");
                StepResult::ToolCalls(vec![AgentTurn::ToolCall {
                    call_id: "again".into(),
                    name: draft::SUBMIT_SECTION_TOOL.into(),
                    arguments: json!({ "markdown": body }).to_string(),
                    reasoning: None,
                }])
            }
            _ => StepResult::Done("Written.".into()),
        };
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn sections_are_handed_on_in_order_under_their_headings() {
    let mut plan = outline_of(3, 100);
    plan.sections[1].title = "Second".into();
    let english = Paper {
        language: "en".into(),
        ..paper()
    };
    let writer = Writer(Default::default());
    let started = std::sync::Mutex::new(Vec::new());
    let mut handed = Vec::new();
    draft::draft(
        &writer,
        &english,
        &plan,
        &drafting_dossier(),
        &|i| started.lock().unwrap().push(i),
        &mut |i, md: &str| {
            handed.push((i, md.lines().next().unwrap().to_string()));
            Ok(())
        },
        &|_| {},
    )
    .await
    .unwrap();
    assert_eq!(
        handed,
        [
            (0, "## Mechanism".to_string()),
            (1, "## Second".to_string()),
            (2, "## Mechanism".to_string())
        ]
    );
    assert_eq!(writer.0.load(std::sync::atomic::Ordering::SeqCst), 1);
    let mut started = started.into_inner().unwrap();
    started.sort();
    assert_eq!(started, [0, 1, 2]);
}

#[test]
fn a_section_draft_is_kept_beside_its_paper() {
    let root = tempfile::tempdir().unwrap();
    save_section(root.path(), "abc123", 1, "## Two\n\nText.").unwrap();
    assert_eq!(
        load_section(root.path(), "abc123", 1).unwrap().as_deref(),
        Some("## Two\n\nText.")
    );
    assert_eq!(load_section(root.path(), "abc123", 0).unwrap(), None);
    assert!(save_section(root.path(), "../x", 0, "").is_err());
}

#[test]
fn a_review_report_is_read_in_order_and_capped_per_section() {
    let issue = |n: u32, p: &str| json!({"section": n, "problem": p, "fix": "fix it"});
    let args = json!({"issues": [
        issue(2, "a"), issue(2, "b"), issue(1, "c"), issue(2, "d"), issue(2, "e"), issue(1, " ")
    ]})
    .to_string();
    let issues = review::read_issues(&args, 2).unwrap();
    let got: Vec<(usize, &str)> = issues
        .iter()
        .map(|i| (i.section, i.problem.as_str()))
        .collect();
    assert_eq!(got, [(1, "a"), (1, "b"), (0, "c"), (1, "d")]);
    assert!(
        review::read_issues(&json!({"issues": [issue(3, "x")]}).to_string(), 2)
            .unwrap_err()
            .contains("no section 3")
    );
    assert_eq!(review::read_issues(r#"{"issues": []}"#, 2).unwrap(), vec![]);
    assert!(review::read_issues("{}", 2).is_err());
}

/// Reviews by faulting sections 1 and 2; revises section 1 well and
/// section 2 never in a form that holds.
struct Reviser;

impl research::Model for Reviser {
    fn step<'a>(
        &'a self,
        _instructions: &'a str,
        turns: &'a [aicompat::agent::AgentTurn],
        tools: &'a [aicompat::agent::ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<aicompat::agent::StepResult, String>> {
        use aicompat::agent::{AgentTurn, StepResult};
        let AgentTurn::User { text, .. } = &turns[0] else {
            panic!()
        };
        let call = |name: &str, args: serde_json::Value| {
            StepResult::ToolCalls(vec![AgentTurn::ToolCall {
                call_id: format!("c{}", turns.len()),
                name: name.into(),
                arguments: args.to_string(),
                reasoning: None,
            }])
        };
        let done = matches!(turns.last(), Some(AgentTurn::ToolResult { output, .. }) if output.starts_with("Kept") || output.starts_with("Reported"));
        let step = if done || turns.len() > 6 {
            StepResult::Done("Done.".into())
        } else if tools[0].name == review::REPORT_ISSUES_TOOL {
            assert!(text.contains("<section number=\"2\">"), "{text}");
            call(
                review::REPORT_ISSUES_TOOL,
                json!({"issues": [
                    {"section": 1, "problem": "Repeats section 2", "fix": "Cut the overlap"},
                    {"section": 2, "problem": "Figure never mentioned", "fix": "Refer to it"}
                ]}),
            )
        } else {
            assert!(
                text.contains("A reviewer who read the whole paper"),
                "{text}"
            );
            // Section 2's revision cites nothing: a hard problem, never kept.
            let markdown = if text.contains("Cut the overlap") {
                section_text(97, "```chart\n{\"series\": [{\"data\": [1]}]}\n```")
            } else {
                "Roofs cool.".to_string()
            };
            call(draft::SUBMIT_SECTION_TOOL, json!({ "markdown": markdown }))
        };
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn faulted_sections_are_revised_once_and_a_failed_revision_keeps_the_draft() {
    let plan = outline_of(2, 100);
    let english = Paper {
        language: "en".into(),
        ..paper()
    };
    let mut sections = vec![
        "## Mechanism\n\nFirst draft.".to_string(),
        "## Mechanism\n\nSecond draft.".to_string(),
    ];
    let issues = review::review(&Reviser, &english, &plan, &sections)
        .await
        .unwrap();
    assert_eq!(issues.len(), 2);
    let revising = std::sync::Mutex::new(Vec::new());
    let changed = review::revise(
        &Reviser,
        &english,
        &plan,
        &drafting_dossier(),
        &mut sections,
        &issues,
        &|i| revising.lock().unwrap().push(i),
        &|_| {},
    )
    .await;
    assert_eq!(changed, [0]);
    assert!(
        sections[0].starts_with("## Mechanism\n\nGreen Green"),
        "{}",
        sections[0]
    );
    assert_eq!(sections[1], "## Mechanism\n\nSecond draft.");
    let mut revising = revising.into_inner().unwrap();
    revising.sort();
    assert_eq!(revising, [0, 1]);
}

#[test]
fn a_chart_s_categories_labels_and_source_are_checked() {
    let mut section = outline().sections.remove(0);
    section.target_words = 100;
    section.figures = vec![FigurePlan {
        kind: FigureKind::Chart,
        spec: "votes".into(),
    }];
    let found = |chart: &str| {
        draft::problems(
            &section_text(97, &format!("```chart\n{chart}\n```")),
            &section,
            &[(3, "https://example.org/study".to_string())],
            "en",
        )
        .join("\n")
    };
    assert!(
        found(r#"{"x": ["Mayor", "President"], "series": [{"data": [57, 50]}]}"#)
            .contains("the categories go in \"labels\"")
    );
    assert!(found(r#"{"labels": ["a"], "series": [{"data": [1, 2]}]}"#)
        .contains("1 \"labels\" for 2 data points"));
    assert!(
        found(r#"{"labels": ["a"], "series": [{"data": [1]}], "source": "n28、n9"}"#)
            .contains("by their numbers")
    );
    assert_eq!(
        found(r#"{"labels": ["a"], "series": [{"data": [1]}], "source": "Election commission"}"#),
        ""
    );
}

#[test]
fn figures_are_numbered_through_the_paper_and_captioned_by_what_they_show() {
    let mut sections = vec![
        "## One\n\nText.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```rust\nfn main() {}\n```".to_string(),
        "## Two\n\n```chart\n{\"title\": \"Temperatures\", \"caption\": \"Roof surfaces at noon\", \"series\": [{\"data\": [1]}]}\n```\n\n![A green roof in Basel](textus-picture:16:9 a roof)\n\n<!-- textus-figure web: satellite heat map -->".to_string(),
    ];
    assert_eq!(finish::number_figures(&mut sections, "zh-CN"), 4);
    assert!(
        sections[0].contains("```\n\n*图 1*\n\n```rust"),
        "{}",
        sections[0]
    );
    assert!(!sections[0].contains("图 2"), "a code block is no figure");
    assert!(
        sections[1].contains("```\n\n*图 2　Roof surfaces at noon*"),
        "{}",
        sections[1]
    );
    // Said once, under the chart, not drawn in it as well.
    assert!(!sections[1].contains("\"caption\""), "{}", sections[1]);
    assert!(
        sections[1].contains("\"title\":\"Temperatures\""),
        "{}",
        sections[1]
    );
    assert!(
        sections[1].contains("(textus-picture:16:9 a roof)\n\n*图 3　A green roof in Basel*"),
        "{}",
        sections[1]
    );
    assert!(
        sections[1].ends_with("-->\n\n*图 4　satellite heat map*"),
        "{}",
        sections[1]
    );

    let mut english = vec!["```chart\n{\"title\": \"Temps\", \"series\": []}\n```".to_string()];
    finish::number_figures(&mut english, "en");
    assert!(english[0].ends_with("*Figure 1. Temps*"), "{}", english[0]);
}

#[test]
fn the_references_list_only_what_the_text_cites_in_number_order() {
    let mut d = drafting_dossier();
    d.sources.push(aicompat::agent::Source {
        n: 1,
        url: "https://a.example/".into(),
        title: String::new(),
    });
    d.sources.push(aicompat::agent::Source {
        n: 9,
        url: "https://unused.example/".into(),
        title: "Unused".into(),
    });
    let sections = vec![
        "Cool [3](https://example.org/study).".to_string(),
        "Again [3](https://example.org/study) and [1](https://a.example/).".to_string(),
    ];
    assert_eq!(
        finish::references(&sections, &d, "zh").unwrap(),
        "## 参考文献\n\n\\[1\\] <https://a.example/>\n\n\\[3\\] Study. <https://example.org/study>"
    );
    assert!(finish::references(&sections, &d, "zh-Hant")
        .unwrap()
        .starts_with("## 參考文獻"));
    assert!(finish::references(&sections, &d, "en-US")
        .unwrap()
        .starts_with("## References"));
    assert_eq!(
        finish::references(&["No citations.".to_string()], &d, "en"),
        None
    );
}

/// Answers the opening step with `reply`.
struct Opener(&'static str);

impl research::Model for Opener {
    fn step<'a>(
        &'a self,
        _instructions: &'a str,
        _turns: &'a [aicompat::agent::AgentTurn],
        _tools: &'a [aicompat::agent::ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<aicompat::agent::StepResult, String>> {
        let reply = self.0.to_string();
        Box::pin(async move { Ok(aicompat::agent::StepResult::Done(reply)) })
    }
}

#[tokio::test]
async fn the_opening_is_a_title_and_an_abstract_or_the_topic_alone() {
    let made = finish::opening(
        &Opener("Here: {\"title\": \"屋顶绿化如何为城市降温\", \"abstract\": \"本文综述……\"}"),
        &paper(),
        &outline(),
        &[],
    )
    .await;
    assert_eq!(made, "# 屋顶绿化如何为城市降温\n\n**摘要**：本文综述……");
    let english = Paper {
        language: "en".into(),
        topic: "Green roofs".into(),
        ..paper()
    };
    let made = finish::opening(
        &Opener("{\"title\": \"Cooler roofs\", \"abstract\": \"We review…\"}"),
        &english,
        &outline(),
        &[],
    )
    .await;
    assert_eq!(made, "# Cooler roofs\n\n**Abstract:** We review…");
    let fallback = finish::opening(&Opener("Sorry."), &english, &outline(), &[]).await;
    assert_eq!(fallback, "# Green roofs");
}

#[tokio::test]
async fn picture_lines_are_begun_up_to_the_limit_and_the_rest_left_out() {
    let run = crate::ai::images::ImageRun::offline(2);
    let text = "Intro.\n\n![Roof](textus-picture:16:9 a green roof)\n\nMid.\n\n![Map](textus-picture:4:3 a heat map)\n\n![Third](textus-picture:1:1 one too many)\n\nEnd.";
    let (placed, unmade) = crate::ai::images::place_pictures(&run, text);
    assert_eq!(placed.matches("](textus-generated:").count(), 2, "{placed}");
    assert!(placed.contains("![Roof](textus-generated:"), "{placed}");
    assert!(!placed.contains("textus-picture:"), "{placed}");
    assert!(!placed.contains("\n\n\n"), "{placed}");
    assert_eq!(unmade.len(), 1);
    assert!(placed.ends_with("End."));
    assert_eq!(finish::without_pictures(text), "Intro.\n\nMid.\n\nEnd.");
}

#[test]
fn a_citation_in_a_chart_stays_valid_json() {
    let section = "See [3](https://a.example/x).\n\n```chart\n{\"type\": \"bar\", \"x\": [\"a\"], \"series\": [{\"name\": \"n\", \"data\": [1]}], \"source\": \"Survey [3](https://a.example/x)\"}\n```\n\nAfter [3](https://a.example/x).";
    let plain = finish::plain_citations(section);
    assert!(plain.starts_with("See [\\[3\\]](#ref-3)."), "{plain}");
    assert!(plain.ends_with("After [\\[3\\]](#ref-3)."), "{plain}");
    let body = plain
        .split("```chart\n")
        .nth(1)
        .unwrap()
        .split("\n```")
        .next()
        .unwrap();
    let spec: serde_json::Value = serde_json::from_str(body).expect(body);
    assert_eq!(spec["source"], "Survey [3]");
}

#[test]
fn the_paper_is_assembled_with_its_own_citation_numbers() {
    let section = "Cooler [3](https://example.org/study), as [12](https://b.example/x?y=1) found.";
    assert_eq!(
        finish::plain_citations(section),
        "Cooler [\\[3\\]](#ref-3), as [\\[12\\]](#ref-12) found."
    );
    assert_eq!(
        finish::assemble(
            "# Title",
            &["## One\n\nA.\n".into(), "## Two\n\nB.".into()],
            Some("## References\n\nR.")
        ),
        "# Title\n\n## One\n\nA.\n\n## Two\n\nB.\n\n## References\n\nR."
    );
    assert_eq!(finish::assemble("# Title", &[], None), "# Title");
}

#[test]
fn a_paper_card_s_turns_are_not_sent_to_the_model() {
    use aicompat::agent::AgentTurn;
    let card = AgentTurn::ToolCall {
        call_id: "paper-1".into(),
        name: crate::ai::agent::PAPER_TURN.into(),
        arguments: "{}".into(),
        reasoning: None,
    };
    let result = AgentTurn::ToolResult {
        call_id: "paper-1".into(),
        output: "{}".into(),
        images: Vec::new(),
    };
    let kept = crate::ai::agent::without_memory_turns(vec![
        AgentTurn::User {
            text: "Write a paper".into(),
            images: Vec::new(),
        },
        card,
        result,
        AgentTurn::assistant("Written."),
    ]);
    assert_eq!(kept.len(), 2);
}

#[test]
fn a_reference_file_s_address_has_no_spaces_and_reads_back() {
    let address = research::reference_address("references/Tides 2024/潮汐.md");
    assert!(!address.contains(' '), "{address}");
    assert!(address.starts_with("references/Tides%202024/"), "{address}");
    assert_eq!(
        research::reference_path(&address).as_deref(),
        Some("references/Tides 2024/潮汐.md")
    );
    assert_eq!(research::reference_path("https://a.example/"), None);
}

/// Searches the library, reads around the hit, keeps a note citing the
/// file, and tries to read outside the library.
struct Librarian;

impl research::Model for Librarian {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [aicompat::agent::AgentTurn],
        tools: &'a [aicompat::agent::ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<aicompat::agent::StepResult, String>> {
        use aicompat::agent::{AgentTurn, StepResult};
        let call = |id: &str, name: &str, args: serde_json::Value| AgentTurn::ToolCall {
            call_id: id.into(),
            name: name.into(),
            arguments: args.to_string(),
            reasoning: None,
        };
        let step = if tools.is_empty() {
            StepResult::Done(
                r#"["How do tidal barrages store energy?", "Second question about it?"]"#.into(),
            )
        } else if turns.len() == 1 {
            assert!(instructions.contains("reference library"), "{instructions}");
            StepResult::ToolCalls(vec![
                call(
                    "s",
                    research::SEARCH_REFERENCES_TOOL,
                    json!({"query": "tidal barrages"}),
                ),
                call(
                    "r",
                    research::READ_REFERENCE_TOOL,
                    json!({"path": "references/../secret.md"}),
                ),
            ])
        } else if !turns.iter().any(
            |t| matches!(t, AgentTurn::ToolCall { name, .. } if name == research::ADD_NOTE_TOOL),
        ) {
            let results: Vec<&str> = turns
                .iter()
                .filter_map(|t| match t {
                    AgentTurn::ToolResult { output, .. } => Some(output.as_str()),
                    _ => None,
                })
                .collect();
            assert!(
                results[0].contains("references/Tides 2024/a.md:1-1"),
                "{}",
                results[0]
            );
            assert!(results[0].contains("<external-content"), "{}", results[0]);
            assert!(
                results[1].contains("isn't a file in references/"),
                "{}",
                results[1]
            );
            StepResult::ToolCalls(vec![call(
                "n",
                research::ADD_NOTE_TOOL,
                json!({"claim": "Barrages store energy at high tide.", "evidence": "As the notes say.", "sources": ["references/Tides 2024/a.md"]}),
            )])
        } else {
            StepResult::Done("Covered.".into())
        };
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn helpers_search_the_user_s_library_and_cite_its_files() {
    let root = tempfile::tempdir().unwrap();
    let file = root.path().join("references/Tides 2024/a.md");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, "Tidal barrages store energy at high tide.\n").unwrap();
    std::fs::write(root.path().join("secret.md"), "Not for the paper.").unwrap();
    let budget = Arc::new(SharedBudget::new(ResearchBudget::for_paper()));
    let web = WebPlan::new(true, None, None, &[]).with_budget(budget.clone());
    let dossier = research::research(
        &Librarian,
        &paper(),
        &web,
        &budget,
        &|_| {},
        Some(root.path()),
    )
    .await
    .unwrap();
    assert_eq!(dossier.notes.len(), 2);
    assert_eq!(dossier.notes[0].sources, vec![1]);
    assert_eq!(dossier.notes[1].sources, vec![1]);
    assert_eq!(dossier.sources.len(), 1);
    assert_eq!(dossier.sources[0].url, "references/Tides%202024/a.md");
    assert_eq!(dossier.sources[0].title, "a.md");

    // Written and listed like any source.
    let mut section = outline().sections.remove(0);
    section.target_words = 10;
    section.figures.clear();
    let cited = format!(
        "Barrages store energy at high tide, by the notes [1]({}).",
        dossier.sources[0].url
    );
    let sources = vec![(1, dossier.sources[0].url.clone())];
    assert_eq!(
        draft::problems(&cited, &section, &sources, "en"),
        Vec::<String>::new()
    );
    let listed = finish::references(std::slice::from_ref(&cited), &dossier, "en").unwrap();
    assert!(
        listed.ends_with("\\[1\\] a.md. `references/Tides 2024/a.md`"),
        "{listed}"
    );
    assert_eq!(
        finish::plain_citations(&cited),
        "Barrages store energy at high tide, by the notes [\\[1\\]](#ref-1)."
    );
}

#[test]
fn a_web_picture_mark_gives_its_caption_and_search_words() {
    assert_eq!(
        web_figures::read_mark("<!-- textus-figure web: 苏黎世的屋顶绿化 | green roof Zurich -->"),
        Some((
            "苏黎世的屋顶绿化".to_string(),
            "green roof Zurich".to_string()
        ))
    );
    assert_eq!(
        web_figures::read_mark("  <!-- textus-figure web: Basel rooftops -->"),
        Some(("Basel rooftops".to_string(), "Basel rooftops".to_string()))
    );
    assert_eq!(web_figures::read_mark("<!-- textus-figure web:  -->"), None);
    assert_eq!(web_figures::read_mark("Plain text."), None);
}

#[tokio::test]
async fn web_picture_marks_become_kept_pictures_with_credits_or_generated_ones() {
    let section = "Intro.\n\n<!-- textus-figure web: A roof in Basel | green roof Basel -->\n\nMid.\n\n<!-- textus-figure web: Nothing | no such picture -->\n\nEnd.";
    let find = |words: String| async move {
        if words == "green roof Basel" {
            Ok((
                aicompat::images::GeneratedImage { bytes: vec![1, 2, 3], mime: "image/jpeg", ext: "jpg", width: 4, height: 3 },
                "Ann · CC BY 4.0 · [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:R.jpg)".to_string(),
            ))
        } else {
            Err("nothing".to_string())
        }
    };
    let resolved = web_figures::resolve(section, find).await;
    let lines: Vec<&str> = resolved.split("\n\n").collect();
    assert_eq!(lines[0], "Intro.");
    let id = lines[1]
        .strip_prefix("![A roof in Basel](textus-generated:")
        .and_then(|rest| rest.strip_suffix(')'))
        .unwrap_or_else(|| panic!("{resolved}"));
    assert_eq!(
        lines[2],
        "*Ann · CC BY 4.0 · [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:R.jpg)*"
    );
    // Commons has nothing: a picture for the image model to make instead.
    assert_eq!(
        &lines[3..],
        [
            "Mid.",
            "![Nothing](textus-picture:16:9 Nothing (no such picture))",
            "End."
        ]
    );
    assert_eq!(
        crate::ai::images::ready_bytes(id),
        Some((vec![1, 2, 3], "jpg"))
    );

    // Numbered like any picture, the credit after its caption.
    let mut sections = vec![resolved];
    finish::number_figures(&mut sections, "en");
    assert!(
        sections[0].contains(")\n\n*Figure 1. A roof in Basel*\n\n*Ann · CC BY 4.0"),
        "{}",
        sections[0]
    );
}

#[test]
fn an_outline_s_shape_follows_the_paper_s_length() {
    let short = outline::Shape::new(5000, 2);
    assert_eq!((short.min_sections, short.max_sections), (4, 6));
    assert_eq!((short.max_figures, short.max_web), (7, 2));
    let long = outline::Shape::new(10000, 0);
    assert_eq!((long.min_sections, long.max_sections), (10, 12));
    assert_eq!(outline::Shape::new(1000, 0).max_sections, 3);

    // Twelve sections and seven web pictures for 5,000 characters, as the
    // first real run planned, is sent back.
    let mut crowded = outline_of(12, 400);
    for s in crowded.sections.iter_mut().take(7) {
        s.figures = vec![FigurePlan {
            kind: FigureKind::Web,
            spec: "roof".into(),
        }];
    }
    let found = outline::problems(&crowded, &dossier(), 5000, &short).join("\n");
    assert!(
        found.contains("12 sections: a paper this long has 4-6"),
        "{found}"
    );
    assert!(found.contains("12 figures: at most 7"), "{found}");
    assert!(found.contains("7 web pictures: at most 2"), "{found}");
}

#[test]
fn each_question_gets_an_even_share_of_the_research() {
    let share = research::Share::of(
        BudgetCounts {
            searches: 40,
            fetches: 60,
            paper_lookups: 30,
            images: 0,
        },
        7,
    );
    let mut spent = [0usize; 3];
    for _ in 0..5 {
        assert_eq!(
            share.spend(crate::ai::web::SEARCH_PAPERS_TOOL, &mut spent),
            None
        );
    }
    let refused = share
        .spend(crate::ai::web::SEARCH_PAPERS_TOOL, &mut spent)
        .unwrap();
    assert!(refused.contains("share of paper searches (5)"), "{refused}");
    assert_eq!(
        share.spend(crate::ai::web::WEB_FETCH_TOOL, &mut spent),
        None
    );
    assert_eq!(share.spend(research::ADD_NOTE_TOOL, &mut spent), None);
    assert_eq!(spent, [0, 1, 5]);
}

#[test]
fn only_length_and_missing_figures_are_soft() {
    assert!(draft::is_soft(
        "It is 900 long; the section is to be about 400."
    ));
    assert!(draft::is_soft("1 planned chart(s), 0 ```chart block(s)."));
    assert!(!draft::is_soft("[4] isn't one of this section's sources."));
    assert!(!draft::is_soft("Chart 1: its JSON doesn't parse (x)."));
    assert!(!draft::is_soft(
        "Nothing is cited: mark each fact from the notes with its source, [n](address)."
    ));
}

/// Always hands over a section three times too long, citing its source.
struct Verbose(usize);

impl research::Model for Verbose {
    fn step<'a>(
        &'a self,
        _instructions: &'a str,
        turns: &'a [aicompat::agent::AgentTurn],
        _tools: &'a [aicompat::agent::ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<aicompat::agent::StepResult, String>> {
        use aicompat::agent::{AgentTurn, StepResult};
        let step = StepResult::ToolCalls(vec![AgentTurn::ToolCall {
            call_id: format!("c{}", turns.len()),
            name: draft::SUBMIT_SECTION_TOOL.into(),
            arguments: json!({"markdown": section_text(self.0, "```chart\n{\"series\": [{\"data\": [1]}]}\n```")}).to_string(),
            reasoning: None,
        }]);
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn a_section_whose_only_problem_is_its_length_is_kept_after_the_tries() {
    let plan = outline_of(1, 100);
    let english = Paper {
        language: "en".into(),
        ..paper()
    };
    let written = draft::write_section(
        &Verbose(127),
        &english,
        &plan,
        0,
        &drafting_dossier(),
        None,
        &|_| {},
    )
    .await
    .unwrap();
    assert!(
        written.starts_with("## Mechanism\n\nGreen Green"),
        "{written}"
    );
}

/// Writes the section as its reply, never calling submit_section.
struct Replier;

impl research::Model for Replier {
    fn step<'a>(
        &'a self,
        _instructions: &'a str,
        _turns: &'a [aicompat::agent::AgentTurn],
        _tools: &'a [aicompat::agent::ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<aicompat::agent::StepResult, String>> {
        let reply = format!(
            "## Mechanism\n\n{}",
            section_text(97, "```chart\n{\"series\": [{\"data\": [1]}]}\n```")
        );
        Box::pin(async move { Ok(aicompat::agent::StepResult::Done(reply)) })
    }
}

#[tokio::test]
async fn a_section_written_as_the_reply_is_checked_and_kept() {
    let plan = outline_of(1, 100);
    let english = Paper {
        language: "en".into(),
        ..paper()
    };
    let written = draft::write_section(
        &Replier,
        &english,
        &plan,
        0,
        &drafting_dossier(),
        None,
        &|_| {},
    )
    .await
    .unwrap();
    // Its own heading is dropped; the outline's goes on.
    assert!(
        written.starts_with("## Mechanism\n\nGreen Green"),
        "{written}"
    );
    assert_eq!(written.matches("## Mechanism").count(), 1);
}

#[test]
fn a_section_s_length_holds_is_soft_or_is_sent_back() {
    let mut section = outline().sections.remove(0);
    section.target_words = 100;
    section.figures.clear();
    let sources = vec![(3, "https://example.org/study".to_string())];
    let found = |words: usize| {
        draft::problems(&section_text(words, ""), &section, &sources, "en").join(" ")
    };
    assert_eq!(found(107), "");
    assert!(
        found(127).starts_with("It is 130 long; the section is to be about 100 (at most 120)"),
        "{}",
        found(127)
    );
    assert!(draft::is_soft(&found(127)));
    assert!(
        found(147).starts_with("Far too long: 150 against about 100 - cut it to at most 120"),
        "{}",
        found(147)
    );
    assert!(!draft::is_soft(&found(147)));
    assert!(found(57).starts_with("It is 60 long"), "{}", found(57));
    assert!(found(37).starts_with("Far too short"), "{}", found(37));
    assert_eq!(draft::most(900), 1080);
}

#[tokio::test]
async fn a_section_far_too_long_is_never_kept() {
    let plan = outline_of(1, 100);
    let english = Paper {
        language: "en".into(),
        ..paper()
    };
    let err = draft::write_section(
        &Verbose(300),
        &english,
        &plan,
        0,
        &drafting_dossier(),
        None,
        &|_| {},
    )
    .await
    .unwrap_err();
    assert!(err.contains("wasn't written in a form that holds"), "{err}");
}

#[test]
fn an_untitled_source_is_listed_by_its_address_once() {
    let mut d = drafting_dossier();
    d.sources = vec![
        aicompat::agent::Source {
            n: 3,
            url: "https://doi.org/10.1/x".into(),
            title: String::new(),
        },
        aicompat::agent::Source {
            n: 4,
            url: "https://b.example/".into(),
            title: "https://b.example/".into(),
        },
    ];
    let listed = finish::references(
        &["A [3](https://doi.org/10.1/x) and [4](https://b.example/).".to_string()],
        &d,
        "en",
    )
    .unwrap();
    assert_eq!(
        listed,
        "## References\n\n\\[3\\] <https://doi.org/10.1/x>\n\n\\[4\\] <https://b.example/>"
    );
}

#[test]
fn an_address_with_parentheses_is_cited_whole() {
    let doi = "https://doi.org/10.1061/40927(243)238";
    let safe = research::link_safe(doi);
    assert_eq!(safe, "https://doi.org/10.1061/40927%28243%29238");
    assert_eq!(
        research::link_safe("https://a.example/%E4%B8%AD"),
        "https://a.example/%E4%B8%AD"
    );
    assert_eq!(
        research::link_safe("references/Tides%202024/a.md"),
        "references/Tides%202024/a.md"
    );
    let mut section = outline().sections.remove(0);
    section.target_words = 10;
    section.figures.clear();
    let cited = format!("Green roofs cool the roof surface by day, as measured [66]({safe}).");
    // Either way of writing it is the same source.
    assert_eq!(
        draft::problems(&cited, &section, &[(66, safe.clone())], "en"),
        Vec::<String>::new()
    );
    assert_eq!(
        draft::problems(&cited, &section, &[(66, doi.to_string())], "en"),
        Vec::<String>::new()
    );
}

#[test]
fn search_pages_and_search_apis_are_not_sources() {
    for page in [
        "https://html.duckduckgo.com/html/?q=green+roof",
        "https://lite.duckduckgo.com/lite/?q=green+roof",
        "https://www.google.com/search?q=green+roof",
        "https://www.bing.com/search?q=green+roof",
        "https://www.baidu.com/s?wd=屋顶绿化",
        "https://api.crossref.org/works?query.bibliographic=green+roof",
        "https://api.openalex.org/works?search=green+roof",
        "https://export.arxiv.org/api/query?search_query=all:roof",
        "https://commons.wikimedia.org/w/api.php?action=query",
    ] {
        assert!(research::is_search_page(page), "{page}");
    }
    for source in [
        "https://www.epa.gov/heatislands/using-green-roofs-reduce-heat-islands",
        "https://doi.org/10.3390/su9081451",
        "https://en.wikipedia.org/wiki/Green_roof",
        "https://www.google.com/about/",
        "https://arxiv.org/abs/2607.15677v1",
    ] {
        assert!(!research::is_search_page(source), "{source}");
    }
}

/// Keeps one note citing a search page by address, one by its number.
struct SearchCiter;

impl research::Model for SearchCiter {
    fn step<'a>(
        &'a self,
        _instructions: &'a str,
        turns: &'a [aicompat::agent::AgentTurn],
        tools: &'a [aicompat::agent::ToolSpec],
    ) -> futures_util::future::BoxFuture<'a, Result<aicompat::agent::StepResult, String>> {
        use aicompat::agent::{AgentTurn, StepResult};
        let note = |id: &str, source: &str| AgentTurn::ToolCall {
            call_id: format!("{id}{}", turns.len()),
            name: research::ADD_NOTE_TOOL.into(),
            arguments: json!({"claim": "c", "evidence": "e", "sources": [source]}).to_string(),
            reasoning: None,
        };
        let step = if tools.is_empty() {
            StepResult::Done(r#"["First question here?", "Second question here?"]"#.into())
        } else if turns.len() == 1 {
            StepResult::ToolCalls(vec![
                note("a", "https://lite.duckduckgo.com/lite/?q=green+roof"),
                note("b", "https://www.epa.gov/heatislands/"),
            ])
        } else if turns.len() == 5 {
            let refused = turns.iter().any(|t| matches!(t, AgentTurn::ToolResult { output, .. } if output.contains("is a search page")));
            assert!(refused, "the search page was taken as a source");
            StepResult::ToolCalls(vec![note("c", "1")])
        } else {
            StepResult::Done("Covered.".into())
        };
        Box::pin(async move { Ok(step) })
    }
}

#[tokio::test]
async fn a_note_can_t_rest_on_a_search_page_by_address_or_number() {
    let budget = SharedBudget::new(ResearchBudget::for_paper());
    let web = WebPlan::new(true, None, None, &[]);
    // Number 1 is the search page, as a helper's earlier read left it.
    assert_eq!(
        web.source_number("https://lite.duckduckgo.com/lite/?q=green+roof"),
        Some(1)
    );
    let dossier = research::research(&SearchCiter, &paper(), &web, &budget, &|_| {}, None)
        .await
        .unwrap();
    assert!(
        dossier.notes.iter().all(|n| n.sources == vec![2]),
        "{:?}",
        dossier.notes
    );
    assert!(dossier
        .sources
        .iter()
        .all(|s| !research::is_search_page(&s.url)));
}

#[test]
fn a_figure_named_by_number_is_sent_back_and_a_slash_doesn_t_matter() {
    let mut section = outline().sections.remove(0);
    section.target_words = 10;
    section.figures.clear();
    let sources = vec![(3, "https://example.org/study".to_string())];
    let numbered =
        "Roofs cool by day, as 图1 shows, and so on here [3](https://example.org/study/).";
    let found = draft::problems(numbered, &section, &sources, "en").join(" ");
    assert!(
        found.contains("\"图1\" names a figure by a number"),
        "{found}"
    );
    assert!(!draft::is_soft(&found));
    let fine =
        "Roofs cool by day, as the chart below shows and more [3](https://example.org/study/).";
    assert_eq!(
        draft::problems(fine, &section, &sources, "en"),
        Vec::<String>::new()
    );
}

#[test]
fn the_outline_is_told_as_its_arguments_stream() {
    use research::Streamed;
    let events = std::sync::Mutex::new(Vec::new());
    let send = |e: PaperEvent| events.lock().unwrap().push(e);
    let watch = outline::OutlineWatch::new(&send);
    watch.push(Streamed::ToolStart);
    // Fragments cut anywhere: inside a key, inside a value, inside an escape.
    for part in [
        r#"{"the"#,
        r##"sis": "Green \"cools\"""##,
        r#", "sec"#,
        r#"tions": [{"tit"#,
        r#"le": "一、背"#,
        r#"景", "targetWords": 700, "figures": [{"kind": "chart", "spec": "title"}]}"#,
    ] {
        watch.push(Streamed::ToolArgs(part));
    }
    let first = events.lock().unwrap().clone();
    assert_eq!(
        first,
        [PaperEvent::OutlineDraft {
            attempt: 1,
            thesis: Some("Green \"cools\"".into()),
            titles: vec![]
        }]
    );
    // Held back while too soon after the last; the next try starts over.
    watch.push(Streamed::ToolStart);
    watch.push(Streamed::ToolArgs(
        r#"{"sections": [{"title": "A"}, {"title": 3}]}"#,
    ));
    std::thread::sleep(std::time::Duration::from_millis(260));
    watch.push(Streamed::ToolArgs(r#"[{"title": "B"}"#));
    let events = events.into_inner().unwrap();
    assert_eq!(
        events.last(),
        Some(&PaperEvent::OutlineDraft {
            attempt: 2,
            thesis: None,
            titles: vec!["A".into(), "B".into()]
        })
    );
}

#[test]
fn a_section_is_shown_as_its_writer_streams_it() {
    use research::Streamed;
    assert_eq!(
        draft::partial_string_value(
            r#"{"markdown": "Line one\nsays \"hi\" \u00e9"#,
            "\"markdown\""
        ),
        "Line one\nsays \"hi\" é"
    );
    // An escape cut in half waits for the rest.
    assert_eq!(
        draft::partial_string_value(r#"{"markdown": "ab\u00"#, "\"markdown\""),
        "ab"
    );
    assert_eq!(
        draft::partial_string_value(r#"{"markdown": "ab\"#, "\"markdown\""),
        "ab"
    );
    assert_eq!(draft::partial_string_value(r#"{"mark"#, "\"markdown\""), "");

    let events = std::sync::Mutex::new(Vec::new());
    let send = |e: PaperEvent| events.lock().unwrap().push(e);
    let watch = draft::SectionWatch::new(2, &send);
    watch.push(Streamed::Thinking("not shown"));
    watch.push(Streamed::ToolStart);
    watch.push(Streamed::ToolArgs(r#"{"markdown": "Green roofs"#));
    // Too soon after the last: held back.
    watch.push(Streamed::ToolArgs(" cool"));
    assert_eq!(
        events.lock().unwrap().clone(),
        [PaperEvent::SectionText {
            index: 2,
            text: "Green roofs".into()
        }]
    );
    // A long section comes whole, for the document to show.
    let long = "长".repeat(5000);
    let events = std::sync::Mutex::new(Vec::new());
    let send = |e: PaperEvent| events.lock().unwrap().push(e);
    let watch = draft::SectionWatch::new(0, &send);
    watch.push(Streamed::Text(&long));
    assert_eq!(
        events.lock().unwrap().clone(),
        [PaperEvent::SectionText {
            index: 0,
            text: long.clone()
        }]
    );
}

#[test]
fn citations_are_numbered_in_the_order_the_paper_first_cites_them() {
    let mut d = drafting_dossier();
    for (n, url) in [
        (93, "https://a.example/"),
        (248, "https://b.example/"),
        (500, "https://unused.example/"),
    ] {
        d.sources.push(aicompat::agent::Source {
            n,
            url: url.into(),
            title: format!("Source {n}"),
        });
    }
    let mut sections = vec![
        "Old [93](https://a.example/)[248](https://b.example/).".to_string(),
        "Again [248](https://b.example/), [3](https://example.org/study) and [93](https://a.example/).\n\n```chart\n{\"source\": \"[248](https://b.example/)\"}\n```".to_string(),
    ];
    let numbered = finish::number_citations(&mut sections, &d);
    assert_eq!(
        sections[0],
        "Old [1](https://a.example/)[2](https://b.example/)."
    );
    assert!(sections[1].starts_with("Again [2](https://b.example/), [3](https://example.org/study) and [1](https://a.example/)."), "{}", sections[1]);
    assert!(
        sections[1].contains("\"[2](https://b.example/)\""),
        "{}",
        sections[1]
    );
    let numbers: Vec<(u32, &str)> = numbered
        .sources
        .iter()
        .map(|s| (s.n, s.url.as_str()))
        .collect();
    assert_eq!(
        numbers,
        vec![
            (1, "https://a.example/"),
            (2, "https://b.example/"),
            (3, "https://example.org/study")
        ]
    );
    let listed = finish::references(&sections, &numbered, "en").unwrap();
    assert!(
        listed.starts_with(
            "## References\n\n\\[1\\] Source 93. <https://a.example/>\n\n\\[2\\] Source 248."
        ),
        "{listed}"
    );
    assert!(!listed.contains("unused"), "{listed}");
    assert_eq!(
        finish::plain_citations(&sections[0]),
        "Old [\\[1\\]](#ref-1)[\\[2\\]](#ref-2)."
    );
}
