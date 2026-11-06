//! Whether a section's diagrams and charts are drawn: the checks in
//! `checks.rs` read a chart's JSON and see that a diagram is there, but only
//! the renderer knows whether Mermaid takes a diagram's syntax. So the
//! window the paper is written for draws every ```mermaid and ```chart block
//! as its document would (`src/ai/paper/figure-check.ts`), and a block it
//! can't draw is sent back to its writer with the renderer's own words.

use super::checks::{chart_holds, fences};
use super::PaperEvent;
use futures_util::future::BoxFuture;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::oneshot;

/// How long the window has to draw a section's figures. Past it the section
/// is checked as if no window could draw: by its JSON and syntax alone.
const DRAWN_WITHIN: Duration = Duration::from_secs(30);
/// The most of a renderer's error a writer is shown.
const ERROR_CHARS: usize = 400;

/// One diagram or chart block to draw. Mirrored in
/// src/platform/bindings/ai-paper.ts.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FigureBlock {
    /// "mermaid" or "chart".
    pub language: String,
    pub code: String,
}

/// Draws blocks: for each, why it can't be drawn, or None when it can. None
/// as a whole when nothing could draw them.
pub(crate) type Draw<'a> =
    &'a (dyn Fn(Vec<FigureBlock>) -> BoxFuture<'static, Option<Vec<Option<String>>>> + Sync);

type Answers = HashMap<String, oneshot::Sender<Vec<Option<String>>>>;
/// A draw's id: three writers draw at once.
static NEXT_CALL: AtomicU64 = AtomicU64::new(0);
/// The draws waiting for the window's answer, by call id.
static WAITING: Mutex<Option<Answers>> = Mutex::new(None);

fn waiting() -> std::sync::MutexGuard<'static, Option<Answers>> {
    WAITING.lock().unwrap_or_else(|e| e.into_inner())
}

/// What the window made of the blocks `drawFigures` `call_id` sent: for
/// each, in order, why it couldn't be drawn, or null.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ai_paper_figures_drawn(call_id: String, errors: Vec<Option<String>>) {
    if let Some(sender) = waiting().as_mut().and_then(|w| w.remove(&call_id)) {
        let _ = sender.send(errors);
    }
}

/// A Draw that asks the window behind `send` - the paper's channel - to draw.
pub(crate) fn by_window(
    send: impl Fn(PaperEvent) -> bool + Send + Sync + 'static,
) -> impl Fn(Vec<FigureBlock>) -> BoxFuture<'static, Option<Vec<Option<String>>>> + Sync {
    let send = std::sync::Arc::new(send);
    move |blocks: Vec<FigureBlock>| {
        let send = send.clone();
        Box::pin(async move {
            let call_id = NEXT_CALL.fetch_add(1, Ordering::Relaxed).to_string();
            let (sender, answer) = oneshot::channel();
            waiting()
                .get_or_insert_with(HashMap::new)
                .insert(call_id.clone(), sender);
            let count = blocks.len();
            let sent = send(PaperEvent::DrawFigures {
                call_id: call_id.clone(),
                blocks,
            });
            let drawn = match sent {
                true => tokio::time::timeout(DRAWN_WITHIN, answer)
                    .await
                    .ok()
                    .and_then(Result::ok),
                false => None,
            };
            if drawn.is_none() {
                waiting().as_mut().and_then(|w| w.remove(&call_id));
            }
            drawn.filter(|errors| errors.len() == count)
        })
    }
}

/// `markdown`'s diagram and chart blocks, as the window draws them: a chart
/// whose JSON `checks` already refuses is left out, since its writer hears of
/// it there.
pub(crate) fn blocks(markdown: &str) -> Vec<FigureBlock> {
    fences(markdown)
        .into_iter()
        .filter(|(lang, body)| match lang.as_str() {
            "mermaid" => !body.trim().is_empty(),
            "chart" => chart_holds(body).is_ok(),
            _ => false,
        })
        .map(|(language, code)| FigureBlock {
            language,
            code: code.trim_end().to_string(),
        })
        .collect()
}

/// What is wrong with `markdown`'s figures as `draw` draws them: one problem
/// for each block it couldn't draw. None of them without a `draw`, or when
/// it couldn't draw at all.
pub(crate) async fn undrawn(draw: Option<Draw<'_>>, markdown: &str) -> Vec<String> {
    let blocks = blocks(markdown);
    let (Some(draw), false) = (draw, blocks.is_empty()) else {
        return Vec::new();
    };
    let Some(errors) = draw(blocks.clone()).await else {
        return Vec::new();
    };
    let mut diagrams = 0;
    let mut charts = 0;
    let mut out = Vec::new();
    for (block, error) in blocks.iter().zip(errors) {
        let (n, what) = if block.language == "chart" {
            charts += 1;
            (charts, "Chart")
        } else {
            diagrams += 1;
            (diagrams, "Diagram")
        };
        if let Some(error) = error {
            out.push(problem(what, n, &error));
        }
    }
    out
}

/// A block that doesn't draw, as its writer is told: which one, and the
/// renderer's words, cut short.
fn problem(what: &str, n: usize, error: &str) -> String {
    let mut error: String = error.trim().chars().take(ERROR_CHARS).collect();
    if error.is_empty() {
        error = "the renderer drew nothing".into();
    }
    let fix = if what == "Chart" {
        "fix its JSON"
    } else {
        "fix its Mermaid syntax - quote a label with brackets, parentheses or punctuation as A[\"label (x)\"], or make it simpler"
    };
    format!("{what} {n} doesn't draw ({error}): {fix}.")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECTION: &str = "Text.\n\n```mermaid\nflowchart TB\n  A --> B\n```\n\n```mermaid\n\n```\n\n```chart\n{\"series\": [{\"data\": [1]}]}\n```\n\n```chart\n{\"series\": []}\n```\n\n```rust\nfn main() {}\n```";

    fn refusing(
        error: Option<&'static str>,
    ) -> impl Fn(Vec<FigureBlock>) -> BoxFuture<'static, Option<Vec<Option<String>>>> + Sync {
        move |blocks: Vec<FigureBlock>| {
            let errors = blocks.iter().map(|_| error.map(String::from)).collect();
            Box::pin(async move { Some(errors) })
        }
    }

    #[test]
    fn only_diagrams_and_charts_the_checks_pass_are_drawn() {
        let blocks = blocks(SECTION);
        assert_eq!(
            blocks,
            [
                FigureBlock {
                    language: "mermaid".into(),
                    code: "flowchart TB\n  A --> B".into(),
                },
                FigureBlock {
                    language: "chart".into(),
                    code: "{\"series\": [{\"data\": [1]}]}".into(),
                },
            ]
        );
    }

    #[tokio::test]
    async fn each_block_that_doesn_t_draw_is_a_hard_problem_in_the_renderer_s_words() {
        let draw = refusing(Some("Parse error: expecting 'SQE', got planned 'PS'"));
        let found = undrawn(Some(&draw), SECTION).await;
        assert_eq!(found.len(), 2);
        assert!(
            found[0].starts_with("Diagram 1 doesn't draw (Parse error"),
            "{}",
            found[0]
        );
        assert!(
            found[1].starts_with("Chart 1 doesn't draw ("),
            "{}",
            found[1]
        );
        assert!(found.iter().all(|p| !super::super::checks::is_soft(p)));
    }

    #[tokio::test]
    async fn figures_that_draw_or_can_t_be_drawn_at_all_add_nothing() {
        assert!(undrawn(Some(&refusing(None)), SECTION).await.is_empty());
        let nobody = |_: Vec<FigureBlock>| -> BoxFuture<'static, Option<Vec<Option<String>>>> {
            Box::pin(async { None })
        };
        assert!(undrawn(Some(&nobody), SECTION).await.is_empty());
        assert!(undrawn(None, SECTION).await.is_empty());
    }

    #[tokio::test]
    async fn a_window_that_answers_draws_and_one_gone_draws_nothing() {
        let block = || {
            vec![FigureBlock {
                language: "mermaid".into(),
                code: "flowchart TB".into(),
            }]
        };
        let answering = by_window(|event| {
            if let PaperEvent::DrawFigures { call_id, .. } = event {
                ai_paper_figures_drawn(call_id, vec![Some("bad".into())]);
            }
            true
        });
        assert_eq!(answering(block()).await, Some(vec![Some("bad".into())]));
        let gone = by_window(|_| false);
        assert_eq!(gone(block()).await, None);
        assert!(waiting().as_ref().is_none_or(HashMap::is_empty));
    }
}
