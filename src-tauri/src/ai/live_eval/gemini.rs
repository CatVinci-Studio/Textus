//! A live check of Gemini's thoughts against Vertex AI itself: asked for
//! them (ThinkingFormat::Gemini), they stream as thinking and stay out of the
//! reply's text (providers::custom::gemini_thoughts), and a tool step after
//! them is accepted. One small request pair, not a quality matrix.
//!
//! Needs GOOGLE_VERTEX_API_KEY (express mode) and TEXTUS_EVAL_VERTEX_PROJECT,
//! in the environment or .env.local; without them it prints a notice and
//! passes. Run from src-tauri/:
//!   cargo test --lib live_eval::gemini -- --ignored --nocapture

use super::harness::{block_on, secret, with_retry};
use aicompat::agent::{AgentTurn, ProviderEvent, StepResult, ToolSpec};
use aicompat::capabilities::{self, ThinkingLevel};
use aicompat::providers::custom;
use serde_json::json;
use std::sync::Mutex;

const MODEL: &str = "google/gemini-3.8-flash";

#[test]
#[ignore = "live API - see module docs"]
fn live_gemini_thoughts_stream_as_thinking() {
    let (Some(key), Some(project)) = (
        secret("GOOGLE_VERTEX_API_KEY"),
        secret("TEXTUS_EVAL_VERTEX_PROJECT"),
    ) else {
        eprintln!("GOOGLE_VERTEX_API_KEY or TEXTUS_EVAL_VERTEX_PROJECT not set - skipped");
        return;
    };
    let base_url = format!(
        "https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/endpoints/openapi"
    );
    let tools = [ToolSpec {
        name: "search_document".into(),
        description: "Search the user's document for a phrase.".into(),
        parameters: json!({
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        }),
    }];
    let plan = capabilities::plan("google", MODEL, ThinkingLevel::Auto);
    eprintln!("gemini: {plan:?}");
    let step = |history: &[AgentTurn]| {
        let text = Mutex::new(String::new());
        let thought = Mutex::new(String::new());
        let sink = |e: ProviderEvent<'_>| match e {
            ProviderEvent::Text(t) => text.lock().unwrap().push_str(t),
            ProviderEvent::Thinking(t) => thought.lock().unwrap().push_str(t),
            _ => {}
        };
        let started = std::time::Instant::now();
        let (result, usage) = with_retry(|| {
            text.lock().unwrap().clear();
            thought.lock().unwrap().clear();
            block_on(custom::agent_step_streaming(
                &base_url,
                Some(&key),
                MODEL,
                "You are a concise assistant.",
                history,
                &tools,
                None,
                custom::Vendor::Generic,
                &plan,
                true,
                &sink,
            ))
            .inspect_err(|e| eprintln!("gemini: attempt failed: {e:?}"))
        })
        .unwrap_or_else(|e| panic!("Gemini step failed: {e}"));
        eprintln!(
            "gemini: step took {:.1}s, {usage:?}",
            started.elapsed().as_secs_f32()
        );
        (
            result,
            text.into_inner().unwrap(),
            thought.into_inner().unwrap(),
        )
    };

    // A question it has to think over: a step that barely thinks (a plain
    // tool call) comes with no summary at all.
    let ask = |text: &str| AgentTurn::User {
        text: text.into(),
        images: Vec::new(),
    };
    let (answer, text, thought) = step(&[ask("Is 391 prime? Answer in one sentence.")]);
    eprintln!("gemini: reply {text:?}; thought {} chars", thought.len());
    assert!(matches!(answer, StepResult::Done(_)), "expected a reply");
    assert!(!thought.is_empty(), "the thoughts came as thinking");
    assert!(
        text.contains("17") && text.len() < 300,
        "only the answer in the reply: {text}"
    );

    // And a tool step after it is accepted.
    let user = ask("Find where my document mentions \"field notes\". Use the tool, then say in one sentence what you found.");
    let (first, _, _) = step(std::slice::from_ref(&user));
    let StepResult::ToolCalls(calls) = first else {
        panic!("expected a tool call");
    };
    let call_id = match &calls[0] {
        AgentTurn::ToolCall { call_id, .. } => call_id.clone(),
        _ => panic!("expected a ToolCall turn"),
    };
    let mut history = vec![user];
    history.extend(calls);
    history.push(AgentTurn::ToolResult {
        call_id,
        output: "Line 12: \"Field notes from the March survey.\"".into(),
        images: Vec::new(),
    });
    let (second, text, _) = step(&history);
    assert!(matches!(second, StepResult::Done(_)), "expected a reply");
    assert!(
        text.to_lowercase().contains("march"),
        "the reply answers: {text}"
    );
}
