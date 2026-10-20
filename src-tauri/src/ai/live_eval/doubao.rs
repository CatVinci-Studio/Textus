//! Live checks of the Doubao provider against Volcengine Ark itself: that
//! the request shapes in aicompat's custom.rs (Vendor::Ark) are ones Ark
//! accepts and answers the way the app reads them - a writing call with
//! thinking turned down, a tool call through the streamed step, and an image
//! read by the vision path. Not a quality matrix: one request each.
//!
//! Needs VOLCENGINE_ARK_API_KEY (an Ark API key, with the catalog's Doubao
//! models enabled for the account in the Ark console); without it each test
//! prints a notice and passes. Run from src-tauri/:
//!   VOLCENGINE_ARK_API_KEY=... cargo test --lib live_eval::doubao -- --ignored --nocapture

use super::harness::{block_on, with_retry};
use crate::ai::catalog;
use crate::ai::route::chat_vendor;
use aicompat::agent::{AgentTurn, ImageAttachment, ProviderEvent, StepResult, ToolSpec};
use aicompat::providers::custom;
use serde_json::json;
use std::sync::Mutex;

const KEY_VAR: &str = "VOLCENGINE_ARK_API_KEY";

/// A 16x16 solid red PNG.
const RED_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO4ICBAEmIY1TCqYfhqAABYoPABnlzdOQAAAABJRU5ErkJggg==";

struct Ark {
    key: String,
    base_url: &'static str,
    writing_model: &'static str,
    agent_model: &'static str,
}

fn ark() -> Option<Ark> {
    let key = std::env::var(KEY_VAR).ok().filter(|k| !k.trim().is_empty());
    let Some(key) = key else {
        eprintln!("live_eval: no {KEY_VAR} - skipping Doubao");
        return None;
    };
    let entry = catalog::find("doubao").expect("doubao is in the catalog");
    Some(Ark {
        key: key.trim().to_string(),
        base_url: entry.base_url.expect("doubao has a base_url"),
        writing_model: entry.default_model.expect("doubao has a writing default"),
        agent_model: entry
            .agent_default_model
            .expect("doubao has an agent default"),
    })
}

/// One streamed agent step, returning its result and the reply text that
/// was streamed (reasoning must not be part of it).
fn streamed_step(ark: &Ark, history: &[AgentTurn], tools: &[ToolSpec]) -> (StepResult, String) {
    let streamed = Mutex::new(String::new());
    let sink = |e: ProviderEvent<'_>| {
        if let ProviderEvent::Text(t) = e {
            streamed.lock().unwrap().push_str(t);
        }
    };
    let result = with_retry(|| {
        streamed.lock().unwrap().clear();
        block_on(custom::agent_step_streaming(
            ark.base_url,
            Some(&ark.key),
            ark.agent_model,
            "You are a concise assistant.",
            history,
            tools,
            None,
            chat_vendor(ark.base_url),
            &sink,
        ))
    })
    .unwrap_or_else(|e| panic!("Ark agent step failed: {e}"));
    (result, streamed.into_inner().unwrap())
}

#[test]
#[ignore = "live API - see module docs"]
fn live_doubao_writing_call_answers_without_thinking() {
    let Some(ark) = ark() else { return };
    let started = std::time::Instant::now();
    let reply = with_retry(|| {
        block_on(custom::call_completion(
            ark.base_url,
            Some(&ark.key),
            ark.writing_model,
            "Reply with the corrected sentence only.".to_string(),
            "She go to school every days.".to_string(),
            chat_vendor(ark.base_url),
        ))
    })
    .unwrap_or_else(|e| panic!("Ark writing call failed: {e}"));
    eprintln!("doubao writing: {:?} in {:?}", reply, started.elapsed());
    assert!(reply.to_lowercase().contains("goes"), "{reply}");
}

#[test]
#[ignore = "live API - see module docs"]
fn live_doubao_calls_a_tool_through_the_streamed_step() {
    let Some(ark) = ark() else { return };
    let tools = [ToolSpec {
        name: "search_document",
        description: "Search the user's document for a phrase.",
        parameters: json!({
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        }),
    }];
    let history = [AgentTurn::User {
        text: "Find where my document mentions \"field notes\". Use the tool.".to_string(),
        images: Vec::new(),
    }];
    let (result, _) = streamed_step(&ark, &history, &tools);
    let StepResult::ToolCalls(calls) = result else {
        panic!("expected a tool call");
    };
    let AgentTurn::ToolCall {
        name, arguments, ..
    } = &calls[0]
    else {
        panic!("expected a ToolCall turn");
    };
    assert_eq!(name, "search_document");
    let args: serde_json::Value = serde_json::from_str(arguments).unwrap();
    assert!(args["query"].as_str().is_some(), "{arguments}");
}

#[test]
#[ignore = "live API - see module docs"]
fn live_doubao_sees_an_attached_image() {
    let Some(ark) = ark() else { return };
    let history = [AgentTurn::User {
        text: "What colour is this image? One word.".to_string(),
        images: vec![ImageAttachment {
            name: "red.png".to_string(),
            mime: "image/png".to_string(),
            data_base64: RED_PNG.to_string(),
        }],
    }];
    let (result, streamed) = streamed_step(&ark, &history, &[]);
    let StepResult::Done(reply) = result else {
        panic!("expected a reply");
    };
    eprintln!("doubao vision: {reply:?}");
    assert_eq!(streamed, reply, "only the reply is streamed, not reasoning");
    assert!(reply.to_lowercase().contains("red"), "{reply}");
}
