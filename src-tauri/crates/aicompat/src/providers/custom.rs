use crate::agent::{
    mark_cited_spans, tool_images_note, AgentTurn, CitedSpan, EventSink, ImageAttachment,
    ProviderEvent, StepCitations, StepResult, StepUsage, ToolSpec,
};
use crate::capabilities::Thinking;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

mod completion;
pub use completion::*;
mod messages;
pub use messages::*;
mod search;
pub(crate) use search::*;
mod stream;
pub(crate) use stream::*;

fn chat_completions_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim_end_matches('/'))
}

fn models_url(base_url: &str) -> String {
    format!("{}/models", base_url.trim_end_matches('/'))
}

/// Which server is behind the generic dialect, where one's defaults differ
/// from OpenAI's enough to matter.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum Vendor {
    #[default]
    Generic,
    /// Volcengine Ark (Doubao). Its Seed models think by default, which
    /// turns a completion or grammar check into a wait of many seconds, so
    /// writing calls ask for `reasoning_effort: "minimal"` - "no thinking"
    /// on Seed, and mapped to the lowest effort, not rejected, on the Ark
    /// models that can't stop thinking (GLM 5.3 Flash), which
    /// `thinking: {"type": "disabled"}` would be. And Ark caps the answer
    /// at 4096 tokens unless `max_tokens` says otherwise - short enough to
    /// cut a long edit's tool arguments off mid-JSON. On Seed the cap
    /// leaves the reasoning out.
    Ark,
    /// DeepSeek. Both its models think by default, at effort `high`: the
    /// live eval saw a grammar check spend 260-400 reasoning tokens and
    /// half again the time on one paragraph. Writing calls switch it off
    /// with `thinking: {"type": "disabled"}`, which both models take.
    DeepSeek,
    /// MiniMax. Unasked, its models write their thinking into the answer
    /// itself between `<think>` tags; `reasoning_split: true` moves it to
    /// `reasoning_content`, where the other thinking models put theirs.
    /// M3.1 Flash can't stop thinking (`thinking: disabled` is a 400) and
    /// at its default effort once thought for four minutes before a story,
    /// so writing calls ask both models for `reasoning_effort: "low"`.
    MiniMax,
}

/// Ark's answer cap for agent steps - the budget the Anthropic dialect
/// gives an edit.
const ARK_AGENT_MAX_TOKENS: u32 = 16384;

/// The streaming twin of [`agent_step`]: same request plus `stream: true`,
/// consumed incrementally so fragments surface through `on_event`. Kept
/// separate rather than replacing agent_step because `stream` support
/// varies across OpenAI-compatible servers even more than `tools` does -
/// the caller falls back to the non-streaming step when this errors.
#[allow(clippy::too_many_arguments)]
pub async fn agent_step_streaming(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: Option<NativeWebSearch>,
    vendor: Vendor,
    thinking: &Thinking,
    stream_usage: bool,
    on_event: EventSink<'_>,
) -> Result<(StepResult, Option<StepUsage>), String> {
    let mut body = agent_request_body(
        model,
        instructions,
        history,
        tools,
        web_search,
        vendor,
        thinking,
    );
    body["stream"] = json!(true);
    // The usage (with what was read from the server's prompt cache) comes
    // in a last chunk only when asked for, where the server takes the ask
    // (capabilities::ProviderCaps::stream_usage).
    if stream_usage {
        body["stream_options"] = json!({"include_usage": true});
    }

    let client = crate::http::streaming_client();
    let mut req = client.post(chat_completions_url(base_url)).json(&body);
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;

    let mut acc = ChatStreamAccumulator {
        ids: CallIds::from_history(history),
        ..Default::default()
    };
    crate::http::read_sse(res, "Custom endpoint", |data| acc.apply(data, on_event)).await?;
    if let Some(error) = acc.error {
        return Err(error);
    }
    let usage = acc.usage;
    Ok((acc.into_step_result(on_event), usage))
}

/// Runs one round-trip against a Chat Completions-compatible endpoint with
/// tool definitions - the generic-dialect twin of `openai_codex::agent_step`.
#[allow(clippy::too_many_arguments)]
pub async fn agent_step(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: Option<NativeWebSearch>,
    vendor: Vendor,
    thinking: &Thinking,
    on_event: EventSink<'_>,
) -> Result<(StepResult, Option<StepUsage>), String> {
    let body = agent_request_body(
        model,
        instructions,
        history,
        tools,
        web_search,
        vendor,
        thinking,
    );

    let client = crate::http::client();
    let mut req = client.post(chat_completions_url(base_url)).json(&body);
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Custom endpoint request failed ({status}): {text}"));
    }

    let parsed: Value = res.json().await.map_err(|e| e.to_string())?;
    let message = parsed
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
        .cloned()
        .unwrap_or(Value::Null);
    let mut report = SearchReport::default();
    report.take(&message, &parsed);
    let usage = parsed.get("usage").and_then(StepUsage::from_openai);
    let mut step = parse_agent_response(&message, &report, on_event);
    if let StepResult::ToolCalls(calls) = &mut step {
        let mut ids = CallIds::from_history(history);
        let mut index = 0;
        for call in calls.iter_mut() {
            if let AgentTurn::ToolCall { call_id, .. } = call {
                *call_id = ids.claim(call_id, index);
                index += 1;
            }
        }
    }
    Ok((step, usage))
}

#[cfg(test)]
mod call_id_tests;

#[cfg(test)]
mod tests;
