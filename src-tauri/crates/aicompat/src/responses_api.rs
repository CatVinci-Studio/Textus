use crate::agent::{
    mark_cited_spans, tool_images_note, AgentTurn, CitedSpan, EventSink, ProviderEvent,
    StepCitations, StepResult, StepUsage, ToolSpec,
};
use crate::capabilities::Thinking;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

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

// --- Agentic tool-calling support, shared by every Responses API dialect
// (Codex OAuth and the public API-key path) - see `crate::agent` for the
// provider-agnostic loop this feeds. A new Responses-API-shaped provider
// only needs its own auth/URL plumbing and can reuse everything below.

fn turn_to_input_item(turn: &AgentTurn) -> Value {
    match turn {
        AgentTurn::User { text, images } => {
            // Images come first: a request like "what does this chart show?"
            // reads as a question about the picture above it, and putting the
            // text last is what both OpenAI and Anthropic recommend.
            let mut content: Vec<Value> = images
                .iter()
                .map(|image| json!({"type": "input_image", "image_url": image.data_url()}))
                .collect();
            content.push(json!({"type": "input_text", "text": text}));
            json!({
                "type": "message",
                "role": "user",
                "content": content,
            })
        }
        AgentTurn::Assistant { text, .. } => json!({
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": text}],
        }),
        AgentTurn::ToolCall {
            call_id,
            name,
            arguments,
            ..
        } => json!({
            "type": "function_call",
            "call_id": call_id,
            "name": name,
            "arguments": arguments,
        }),
        AgentTurn::ToolResult {
            call_id, output, ..
        } => json!({
            "type": "function_call_output",
            "call_id": call_id,
            "output": output,
        }),
    }
}

/// One turn's `input` items: its own, and after a tool result that showed
/// images, a user message carrying them. The public API takes images inside
/// a `function_call_output`, but the Codex backend and the
/// Responses-compatible servers (xAI, Qwen) aren't known to, while every
/// one of them reads an `input_image` in a user message.
fn turn_to_input_items(turn: &AgentTurn) -> Vec<Value> {
    let mut items = vec![turn_to_input_item(turn)];
    if let AgentTurn::ToolResult { images, .. } = turn {
        if !images.is_empty() {
            let mut content: Vec<Value> = images
                .iter()
                .map(|image| json!({"type": "input_image", "image_url": image.data_url()}))
                .collect();
            content.push(json!({"type": "input_text", "text": tool_images_note(images)}));
            items.push(json!({"type": "message", "role": "user", "content": content}));
        }
    }
    items
}

fn tool_to_schema(tool: &ToolSpec) -> Value {
    json!({
        "type": "function",
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.parameters,
    })
}

/// Builds a Responses API request body for one agent step: the full turn
/// history (mapped to `input` items) plus tool definitions. `streaming`
/// picks `stream: true`/`false` - the Codex backend only serves SSE, the
/// public API accepts either and non-streaming is simpler for callers that
/// don't need it. Reasoning items are not sent back: with `store: false`
/// the API needs only the calls and their outputs, as it always had.
pub fn agent_request_body(
    model: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    thinking: &Thinking,
    streaming: bool,
) -> Value {
    let input: Vec<Value> = history.iter().flat_map(turn_to_input_items).collect();
    let mut tool_schemas: Vec<Value> = tools.iter().map(tool_to_schema).collect();
    // OpenAI's server-side web search: unlike function tools it runs inside
    // the response (search calls surface as ignored `web_search_call` output
    // items), so no loop changes are needed - just offering it is enough.
    if web_search {
        tool_schemas.push(json!({"type": "web_search"}));
    }

    let mut body = json!({
        "model": model,
        "store": false,
        "stream": streaming,
        "instructions": instructions,
        "input": input,
        "tools": tool_schemas,
        "tool_choice": "auto",
        "parallel_tool_calls": true,
    });
    if supports_verbosity(model) {
        body["text"] = json!({"verbosity": "low"});
    }
    thinking.apply_responses(&mut body);
    body
}

/// `text` without the citation markers OpenAI's models write in their own
/// app's format - `\u{e200}cite\u{e202}turn3view0\u{e201}`, or, its private-use
/// delimiters lost, `citeturn3view0turn8view1` - which nothing here reads:
/// they reached documents as garbage after the ChatGPT model searched the
/// web (1.2.0-rc.5). The pages themselves come as annotations and
/// `web_search_call` sources. A space left before punctuation goes too.
pub fn strip_citation_markers(text: &str) -> String {
    if !text.contains('\u{e200}') && !text.contains("citeturn") {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let delimited = rest.find('\u{e200}');
        let bare = rest.find("citeturn");
        let at = match (delimited, bare) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) | (None, Some(a)) => a,
            (None, None) => break,
        };
        out.push_str(&rest[..at]);
        let marker = &rest[at..];
        let len = if marker.starts_with('\u{e200}') {
            marker
                .find('\u{e201}')
                .map_or(marker.len(), |end| end + '\u{e201}'.len_utf8())
        } else {
            bare_marker_len(marker)
        };
        rest = &marker[len..];
        // "found it citeturn1view0." reads "found it."
        let next = rest.chars().next();
        if next.is_none_or(|c| c.is_whitespace() || ".,;:!?)，。；：！？）、".contains(c)) {
            let trimmed = out.trim_end_matches([' ', '\t']).len();
            out.truncate(trimmed);
        }
    }
    out.push_str(rest);
    // A private-use delimiter left over on its own.
    out.retain(|c| !('\u{e200}'..='\u{e2ff}').contains(&c));
    out
}

/// The length of a `citeturnNkindM(turnNkindM...)` marker at the start of
/// `text`.
fn bare_marker_len(text: &str) -> usize {
    let mut at = "cite".len();
    loop {
        let rest = &text[at..];
        let Some(after) = rest.strip_prefix("turn") else {
            break;
        };
        let digits = after.chars().take_while(char::is_ascii_digit).count();
        let kind = after[digits..]
            .chars()
            .take_while(char::is_ascii_lowercase)
            .count();
        let number = after[digits + kind..]
            .chars()
            .take_while(char::is_ascii_digit)
            .count();
        if digits == 0 || kind == 0 || number == 0 {
            break;
        }
        at += "turn".len() + digits + kind + number;
    }
    at
}

/// Tool arguments without citation markers in what they write - not in an
/// `anchor` or `context`, which quote the document: one that already has
/// such markers (written before this) must still be quotable, to clean up.
fn strip_markers_in_arguments(arguments: &str) -> String {
    if !arguments.contains("citeturn")
        && !arguments.contains('\u{e200}')
        && !arguments.contains("\\ue200")
    {
        return arguments.to_string();
    }
    fn walk(value: &mut Value) {
        match value {
            Value::String(s) => *s = strip_citation_markers(s),
            Value::Array(items) => items.iter_mut().for_each(walk),
            Value::Object(map) => map
                .iter_mut()
                .filter(|(key, _)| !matches!(key.as_str(), "anchor" | "context"))
                .for_each(|(_, v)| walk(v)),
            _ => {}
        }
    }
    match serde_json::from_str::<Value>(arguments) {
        Ok(mut value) => {
            walk(&mut value);
            value.to_string()
        }
        Err(_) => arguments.to_string(),
    }
}

/// A message part's text with its `url_citation` annotations marked
/// ([`mark_cited_spans`]). xAI's annotations carry the citation's number as
/// their `title`, not the page's: a title that is only digits is no title.
fn cited_part_text(part: &Value, citations: &mut StepCitations, on_event: EventSink<'_>) -> String {
    let text = part
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or_default();
    let spans: Vec<CitedSpan<'_>> = part
        .get("annotations")
        .and_then(|a| a.as_array())
        .into_iter()
        .flatten()
        .filter(|a| a.get("type").and_then(|t| t.as_str()) == Some("url_citation"))
        .filter_map(|a| {
            let index = |key: &str| a.get(key).and_then(|v| v.as_u64()).map(|v| v as usize);
            let title = a.get("title").and_then(|t| t.as_str()).unwrap_or_default();
            Some(CitedSpan {
                start: index("start_index")?,
                end: index("end_index")?,
                url: a.get("url").and_then(|u| u.as_str())?,
                title: if title.chars().all(|c| c.is_ascii_digit()) {
                    ""
                } else {
                    title
                },
            })
        })
        .collect();
    if spans.is_empty() {
        return text.to_string();
    }
    mark_cited_spans(text, spans, citations, on_event)
}

/// Parses a Responses API `output` item array (streamed or not - both shapes
/// match) into a [`StepResult`]: any `function_call` items become tool
/// calls the caller must execute, otherwise the `message` items' text is the
/// model's final answer. The pages a native web search cited are reported
/// through `on_event` - in the text's annotations, and the sources a
/// `web_search_call` lists (Qwen's only way of naming them).
pub fn parse_agent_output(output: &[Value], on_event: EventSink<'_>) -> StepResult {
    let mut tool_calls = Vec::new();
    let mut text_parts = Vec::new();
    let mut citations = StepCitations::default();

    for item in output {
        match item.get("type").and_then(|t| t.as_str()) {
            Some("web_search_call") => {
                for source in item
                    .pointer("/action/sources")
                    .and_then(|s| s.as_array())
                    .into_iter()
                    .flatten()
                {
                    if let Some(url) = source.get("url").and_then(|u| u.as_str()) {
                        let title = source.get("title").and_then(|t| t.as_str()).unwrap_or("");
                        citations.cite(url, title, on_event);
                    }
                }
            }
            Some("function_call") => {
                let call_id = item
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let name = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let arguments = item
                    .get("arguments")
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}");
                tool_calls.push(AgentTurn::ToolCall {
                    call_id: call_id.to_string(),
                    name: name.to_string(),
                    arguments: strip_markers_in_arguments(arguments),
                    reasoning: None,
                });
            }
            Some("message") => {
                if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                    for part in content {
                        if part.get("text").and_then(|t| t.as_str()).is_some() {
                            let text = cited_part_text(part, &mut citations, on_event);
                            text_parts.push(strip_citation_markers(&text));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if !tool_calls.is_empty() {
        StepResult::calls_with_text(tool_calls, text_parts.join("\n"))
    } else {
        StepResult::Done(text_parts.join("\n"))
    }
}

#[cfg(test)]
mod tests;
