use crate::agent::{
    mark_cited_spans, tool_images_note, AgentTurn, CitedSpan, EventSink, ProviderEvent,
    StepCitations, StepResult, StepUsage, ToolSpec,
};
use crate::capabilities::Thinking;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

mod agent_turns;
pub use agent_turns::*;

/// Shared request/response shapes for OpenAI's Responses API - both the
/// Codex (chatgpt.com backend) and the plain public API key path send the
/// exact same body shape, they just differ in URL/model/auth headers.

#[derive(Serialize)]
struct TextConfig {
    verbosity: &'static str,
}

#[derive(Serialize)]
struct ReasoningConfig {
    effort: &'static str,
}

#[derive(Serialize)]
struct ContentPart {
    #[serde(rename = "type")]
    kind: &'static str,
    text: String,
}

#[derive(Serialize)]
struct InputMessage {
    role: &'static str,
    content: Vec<ContentPart>,
}

#[derive(Serialize)]
pub struct ResponsesRequest {
    model: String,
    store: bool,
    stream: bool,
    instructions: String,
    input: Vec<InputMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<TextConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<ReasoningConfig>,
}

/// `text.verbosity` is a GPT-5-only Responses API field - sending it to
/// older models (e.g. gpt-4o-mini) gets rejected with "Unknown parameter:
/// 'verbosity'". Gate it on the model name so any model can be plugged in
/// here without breaking the request.
fn supports_verbosity(model: &str) -> bool {
    model.starts_with("gpt-5")
}

/// The lowest reasoning effort a model accepts, for the short one-shot
/// requests (inline completion, grammar check) that `ResponsesRequest`
/// carries. GPT-6 reasons at `medium` unless told otherwise, which turns a
/// ghost-text suggestion into a multi-second wait. Luna can switch
/// reasoning off; Astra and Sol reject `none` and bottom out at `low`.
/// Older models get no field - GPT-4-era models reject it outright.
fn quick_reasoning_effort(model: &str) -> Option<&'static str> {
    if !model.starts_with("gpt-6") {
        return None;
    }
    Some(if model.contains("luna") {
        "none"
    } else {
        "low"
    })
}

impl ResponsesRequest {
    pub fn new(model: impl Into<String>, instructions: String, user_text: String) -> Self {
        let model = model.into();
        let text = supports_verbosity(&model).then_some(TextConfig { verbosity: "low" });
        let reasoning = quick_reasoning_effort(&model).map(|effort| ReasoningConfig { effort });
        Self {
            model,
            store: false,
            stream: false,
            instructions,
            input: vec![InputMessage {
                role: "user",
                content: vec![ContentPart {
                    kind: "input_text",
                    text: user_text,
                }],
            }],
            text,
            reasoning,
        }
    }

    /// The ChatGPT backend (chatgpt.com/backend-api/codex/responses) rejects
    /// `stream: false` outright ("Stream must be set to true") - unlike the
    /// public api.openai.com/v1/responses endpoint, it only serves SSE.
    pub fn streaming(mut self) -> Self {
        self.stream = true;
        self
    }
}

#[derive(Deserialize, Default)]
struct OutputContent {
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize, Default)]
struct OutputItem {
    #[serde(default)]
    content: Vec<OutputContent>,
}

#[derive(Deserialize, Default)]
pub struct ResponsesResult {
    #[serde(default)]
    output: Vec<OutputItem>,
}

impl ResponsesResult {
    pub fn into_text(self) -> String {
        self.output
            .into_iter()
            .flat_map(|item| item.content)
            .find_map(|c| c.text)
            .unwrap_or_default()
    }
}

pub async fn extract_response_text(
    res: reqwest::Response,
    provider_label: &str,
) -> Result<String, String> {
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!(
            "{provider_label} request failed ({status}): {text}"
        ));
    }
    let parsed: ResponsesResult = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed.into_text())
}

/// Reads a `stream: true` Responses API SSE body and collects the completed
/// output items, reporting live fragments through `on_event` as they come
/// off the wire (`http::read_sse`) - text via `response.output_text.delta`,
/// tool calls via `response.output_item.added` + arguments deltas.
///
/// The `response.completed` event's `response.output` is unreliable (often
/// empty) on this backend, so instead this accumulates each
/// `response.output_item.done` event's `item` - which carries the same
/// message/function_call shape the non-streaming `output` array used to -
/// as they arrive.
pub async fn read_streamed_output(
    res: reqwest::Response,
    provider_label: &str,
    on_event: EventSink<'_>,
) -> Result<Vec<Value>, String> {
    read_streamed_response(res, provider_label, on_event)
        .await
        .map(|(output, _)| output)
}

/// [`read_streamed_output`], and the token usage `response.completed`
/// reports.
pub async fn read_streamed_response(
    res: reqwest::Response,
    provider_label: &str,
    on_event: EventSink<'_>,
) -> Result<(Vec<Value>, Option<StepUsage>), String> {
    let mut output = Vec::new();
    let mut usage = None;
    // A remote failure arrives as an event, not a transport error - noted
    // here and surfaced after the read loop (read_sse's callback can't
    // return early).
    let mut failure: Option<String> = None;
    // arguments-delta events carry the ITEM id, not the call_id the rest of
    // the pipeline keys on - the mapping arrives on output_item.added.
    let mut call_ids: HashMap<String, String> = HashMap::new();

    // TEXTUS_SSE_TRACE=1: each event's type, item and time, on stderr - how
    // a service paces a step (live_eval::latency). A response with a long
    // call beside others came with no argument deltas at all, the calls
    // whole at its end (ChatGPT, 2026-10).
    let trace_started = std::time::Instant::now();
    let trace = std::env::var("TEXTUS_SSE_TRACE").is_ok_and(|v| v == "1");
    crate::http::read_sse(res, provider_label, |data| {
        if failure.is_some() {
            return;
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            return;
        };
        if trace {
            eprintln!(
                "[sse] {:6.2}s {} item={} type={}",
                trace_started.elapsed().as_secs_f64(),
                event.get("type").and_then(|t| t.as_str()).unwrap_or("?"),
                event
                    .get("item_id")
                    .or_else(|| event.pointer("/item/id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("-"),
                event
                    .pointer("/item/type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("-"),
            );
        }

        match event.get("type").and_then(|t| t.as_str()) {
            Some("response.output_item.added") => {
                let Some(item) = event.get("item") else {
                    return;
                };
                // A reasoning item opens: the model is thinking, whether or
                // not a summary of it follows.
                if item.get("type").and_then(|t| t.as_str()) == Some("reasoning") {
                    on_event(ProviderEvent::Thinking(""));
                    return;
                }
                if item.get("type").and_then(|t| t.as_str()) != Some("function_call") {
                    return;
                }
                let call_id = item
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let name = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                    call_ids.insert(id.to_string(), call_id.to_string());
                }
                on_event(ProviderEvent::ToolStart { call_id, name });
            }
            Some("response.reasoning_summary_text.delta") => {
                if let Some(delta) = event.get("delta").and_then(|d| d.as_str()) {
                    on_event(ProviderEvent::Thinking(delta));
                }
            }
            Some("response.output_text.delta") => {
                if let Some(delta) = event.get("delta").and_then(|d| d.as_str()) {
                    on_event(ProviderEvent::Text(delta));
                }
            }
            Some("response.function_call_arguments.delta") => {
                let Some(delta) = event.get("delta").and_then(|d| d.as_str()) else {
                    return;
                };
                let item_id = event
                    .get("item_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if let Some(call_id) = call_ids.get(item_id) {
                    on_event(ProviderEvent::ToolArgs { call_id, delta });
                }
            }
            Some("response.output_item.done") => {
                if let Some(item) = event.get("item") {
                    output.push(item.clone());
                }
            }
            Some("response.completed") => {
                usage = event
                    .pointer("/response/usage")
                    .and_then(StepUsage::from_openai);
            }
            Some("response.failed") => {
                let error = event
                    .get("response")
                    .and_then(|r| r.get("error"))
                    .cloned()
                    .unwrap_or(event.clone());
                failure = Some(format!("{provider_label} request failed: {error}"));
            }
            _ => {}
        }
    })
    .await?;

    if let Some(failure) = failure {
        return Err(failure);
    }
    Ok((output, usage))
}

/// Extracts the assistant's text from a streamed output item list (see
/// [`read_streamed_output`]).
pub fn text_from_streamed_output(output: &[Value]) -> String {
    output
        .iter()
        .filter(|item| item.get("type").and_then(|t| t.as_str()) == Some("message"))
        .filter_map(|item| item.get("content").and_then(|c| c.as_array()))
        .flatten()
        .find_map(|part| part.get("text").and_then(|t| t.as_str()))
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests;
