//! Sections written at once: each kept as it is done, whatever the order,
//! the paper handed back in the outline's; and what that saves.

use super::tests::{drafting_dossier, outline_of, paper, section_text};
use super::*;
use aicompat::agent::{AgentTurn, StepResult, ToolSpec};
use futures_util::future::BoxFuture;
use futures_util::stream::{self, StreamExt};
use serde_json::json;
use std::sync::Mutex;
use std::time::Duration;
use tokio::time::Instant;

/// Writes section "S<i>" after `delays[i]`, handing it over whole; a
/// section with no delay fails.
struct Timed {
    delays: Vec<Option<Duration>>,
    at_once: usize,
}

impl model::Model for Timed {
    fn step<'a>(
        &'a self,
        _instructions: &'a str,
        turns: &'a [AgentTurn],
        _tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        Box::pin(async move {
            let AgentTurn::User { text, .. } = &turns[0] else {
                panic!()
            };
            let i: usize = text
                .split("Your section: \"S")
                .nth(1)
                .and_then(|rest| rest.split('"').next())
                .and_then(|n| n.parse().ok())
                .expect("a section");
            if !matches!(turns.last(), Some(AgentTurn::User { .. })) {
                return Ok(StepResult::Done("Written.".into()));
            }
            let Some(delay) = self.delays[i] else {
                tokio::time::sleep(Duration::from_millis(50)).await;
                return Err("Claude request failed (400): no".into());
            };
            tokio::time::sleep(delay).await;
            let body = section_text(97, "```chart\n{\"series\": [{\"data\": [1]}]}\n```");
            Ok(StepResult::ToolCalls(vec![AgentTurn::ToolCall {
                call_id: format!("s{i}"),
                name: draft::SUBMIT_SECTION_TOOL.into(),
                arguments: json!({ "markdown": body }).to_string(),
                reasoning: None,
            }]))
        })
    }

    fn at_once(&self) -> usize {
        self.at_once
    }
}

fn english() -> Paper {
    Paper {
        language: "en".into(),
        ..paper()
    }
}

fn outline(n: usize) -> Outline {
    let mut plan = outline_of(n, 100);
    for (i, s) in plan.sections.iter_mut().enumerate() {
        s.title = format!("S{i}");
    }
    plan
}

fn ms(delays: &[u64]) -> Vec<Option<Duration>> {
    delays
        .iter()
        .map(|d| Some(Duration::from_millis(*d)))
        .collect()
}

/// Drafts `plan`, returning the sections and the order they were kept in.
async fn drafted(writer: &Timed, plan: &Outline) -> (Result<Vec<String>, String>, Vec<usize>) {
    let kept = Mutex::new(Vec::new());
    let sections = draft::draft(
        writer,
        &english(),
        plan,
        &drafting_dossier(),
        &[],
        &|_| {},
        &mut |i, _: &str| {
            kept.lock().unwrap().push(i);
            Ok(())
        },
        &|_| {},
    )
    .await;
    (sections, kept.into_inner().unwrap())
}

#[tokio::test(start_paused = true)]
async fn sections_are_kept_as_they_are_done_and_handed_back_in_order() {
    let writer = Timed {
        delays: ms(&[500, 100, 300, 100]),
        at_once: 3,
    };
    let (sections, kept) = drafted(&writer, &outline(4)).await;
    // The slow first one keeps none of the others waiting, nor unsaved.
    assert_eq!(kept, [1, 3, 2, 0]);
    let headings: Vec<String> = sections
        .unwrap()
        .iter()
        .map(|s| s.lines().next().unwrap().to_string())
        .collect();
    assert_eq!(headings, ["## S0", "## S1", "## S2", "## S3"]);
}

#[tokio::test(start_paused = true)]
async fn a_failed_section_lets_those_under_way_be_kept_and_starts_no_more() {
    let mut delays = ms(&[0, 200, 200, 200, 200]);
    delays[0] = None;
    let writer = Timed { delays, at_once: 3 };
    let (sections, kept) = drafted(&writer, &outline(5)).await;
    assert!(sections.is_err());
    // 1 and 2 were under way; 3 would have begun once 0 failed.
    assert_eq!(kept, [1, 2]);
}

#[tokio::test]
async fn helpers_at_once_never_spend_more_than_the_budget() {
    let budget = SharedBudget::new(ResearchBudget::new(BudgetCounts {
        searches: 10,
        ..Default::default()
    }));
    let taken = futures_util::future::join_all((0..100).map(|_| async {
        tokio::task::yield_now().await;
        budget.take(budget::BudgetKind::Search)
    }))
    .await;
    assert_eq!(taken.iter().filter(|t| **t).count(), 10);
    assert_eq!(budget.snapshot().used.searches, 10);
}

/// How main drafted: three at a time, each handed on only once every one
/// before it was - a slow section held the slots of those done after it.
async fn drafted_as_before(writer: &Timed, plan: &Outline) -> usize {
    let (paper, dossier) = (english(), drafting_dossier());
    let (paper, dossier) = (&paper, &dossier);
    stream::iter(0..plan.sections.len())
        .map(|i| async move {
            draft::write_section(writer, paper, plan, i, dossier, None, &|_| {}).await
        })
        .buffered(3)
        .filter(|s| std::future::ready(s.is_ok()))
        .count()
        .await
}

#[tokio::test(start_paused = true)]
async fn drafting_eight_sections_at_once_takes_less_than_three_in_turn() {
    // What a writer takes, in seconds: as a real run's sections vary.
    let delays = ms(&[
        90_000, 30_000, 40_000, 20_000, 50_000, 30_000, 20_000, 40_000,
    ]);
    let plan = outline(8);
    let before = {
        let writer = Timed {
            delays: delays.clone(),
            at_once: 3,
        };
        let start = Instant::now();
        assert_eq!(drafted_as_before(&writer, &plan).await, 8);
        start.elapsed()
    };
    let mut after = Vec::new();
    for at_once in [3, 4, 6] {
        let writer = Timed {
            delays: delays.clone(),
            at_once,
        };
        let start = Instant::now();
        assert_eq!(drafted(&writer, &plan).await.0.unwrap().len(), 8);
        after.push((at_once, start.elapsed()));
    }
    eprintln!(
        "drafting 8 sections (90/30/40/20/50/30/20/40 s each): before, 3 in turn: {before:?}"
    );
    for (at_once, took) in &after {
        eprintln!("  after, {at_once} at once: {took:?}");
    }
    assert!(after[0].1 < before, "unordered at 3 beats ordered at 3");
    assert!(
        after[2].1 * 2 <= before,
        "6 at once takes half the time or less"
    );
}
