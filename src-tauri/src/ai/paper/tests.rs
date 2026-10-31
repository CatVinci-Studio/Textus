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
