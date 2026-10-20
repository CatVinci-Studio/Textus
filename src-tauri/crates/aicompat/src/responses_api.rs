use crate::agent::{
    mark_cited_spans, tool_images_note, AgentTurn, CitedSpan, EventSink, ProviderEvent,
    StepCitations, StepResult, ToolSpec,
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
    let mut output = Vec::new();
    // A remote failure arrives as an event, not a transport error - noted
    // here and surfaced after the read loop (read_sse's callback can't
    // return early).
    let mut failure: Option<String> = None;
    // arguments-delta events carry the ITEM id, not the call_id the rest of
    // the pipeline keys on - the mapping arrives on output_item.added.
    let mut call_ids: HashMap<String, String> = HashMap::new();

    crate::http::read_sse(res, provider_label, |data| {
        if failure.is_some() {
            return;
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            return;
        };

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
    Ok(output)
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
                    arguments: arguments.to_string(),
                    reasoning: None,
                });
            }
            Some("message") => {
                if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                    for part in content {
                        if part.get("text").and_then(|t| t.as_str()).is_some() {
                            text_parts.push(cited_part_text(part, &mut citations, on_event));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if !tool_calls.is_empty() {
        StepResult::ToolCalls(tool_calls)
    } else {
        StepResult::Done(text_parts.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::ImageAttachment;

    #[test]
    fn agent_request_body_round_trips_every_turn_kind() {
        let history = vec![
            AgentTurn::User {
                text: "hi".to_string(),
                images: Vec::new(),
            },
            AgentTurn::assistant("hello".to_string()),
            AgentTurn::ToolCall {
                call_id: "c1".to_string(),
                name: "search_document".to_string(),
                arguments: "{}".to_string(),
                reasoning: None,
            },
            AgentTurn::ToolResult {
                call_id: "c1".to_string(),
                output: "no matches".to_string(),
                images: Vec::new(),
            },
        ];
        let tools = [ToolSpec {
            name: "search_document",
            description: "search",
            parameters: json!({"type": "object"}),
        }];

        let body = agent_request_body(
            "gpt-5-mini",
            "be helpful",
            &history,
            &tools,
            false,
            &Thinking::default(),
            true,
        );

        assert_eq!(body["model"], "gpt-5-mini");
        assert_eq!(body["stream"], true);
        assert_eq!(body["input"].as_array().unwrap().len(), 4);
        assert_eq!(body["input"][2]["type"], "function_call");
        assert_eq!(body["input"][2]["call_id"], "c1");
        assert_eq!(body["input"][3]["type"], "function_call_output");
        assert_eq!(body["tools"].as_array().unwrap().len(), 1);
        assert_eq!(body["tools"][0]["name"], "search_document");
        // gpt-5* models get the verbosity hint, older ones don't.
        assert_eq!(body["text"]["verbosity"], "low");
    }

    /// OpenAI caches prompt prefixes on its own; every step and exchange
    /// keeps it only if the earlier input items never change. One item per
    /// turn, rendered from that turn alone, guarantees it.
    #[test]
    fn a_new_step_only_appends_input_items() {
        let mut turns = vec![AgentTurn::User {
            text: "doc + q".to_string(),
            images: Vec::new(),
        }];
        let before = agent_request_body(
            "gpt-6-luna",
            "rules",
            &turns,
            &[],
            false,
            &Thinking::default(),
            true,
        );
        turns.extend([
            AgentTurn::ToolCall {
                call_id: "c1".to_string(),
                name: "read_document".to_string(),
                arguments: "{}".to_string(),
                reasoning: None,
            },
            AgentTurn::ToolResult {
                call_id: "c1".to_string(),
                output: "text".to_string(),
                images: Vec::new(),
            },
        ]);
        let after = agent_request_body(
            "gpt-6-luna",
            "rules",
            &turns,
            &[],
            false,
            &Thinking::default(),
            true,
        );
        let (before, after) = (
            before["input"].as_array().unwrap(),
            after["input"].as_array().unwrap(),
        );
        assert_eq!(after[..before.len()], before[..]);
        assert_eq!(after.len(), before.len() + 2);
    }

    /// The image part's exact shape is the whole contract with the provider,
    /// and getting it wrong fails at request time with an opaque 400 - worth
    /// pinning here rather than discovering it from a user's bug report.
    #[test]
    fn user_turn_images_become_input_image_parts_before_the_text() {
        let turn = AgentTurn::User {
            text: "what is this?".to_string(),
            images: vec![ImageAttachment {
                name: "chart.png".to_string(),
                mime: "image/png".to_string(),
                data_base64: "AAAA".into(),
            }],
        };
        let item = turn_to_input_item(&turn);
        assert_eq!(item["content"][0]["type"], "input_image");
        assert_eq!(
            item["content"][0]["image_url"],
            "data:image/png;base64,AAAA"
        );
        // The question follows the picture it is about.
        assert_eq!(item["content"][1]["type"], "input_text");
        assert_eq!(item["content"][1]["text"], "what is this?");
    }

    /// A tool's images follow its output as a user message: the one place
    /// the Codex backend and the Responses-compatible servers take them.
    #[test]
    fn tool_result_images_follow_the_output_as_a_user_message() {
        let history = vec![
            AgentTurn::ToolCall {
                call_id: "v".to_string(),
                name: "view_image".to_string(),
                arguments: "{}".to_string(),
                reasoning: None,
            },
            AgentTurn::ToolResult {
                call_id: "v".to_string(),
                output: "Here is map.png.".to_string(),
                images: vec![ImageAttachment {
                    name: "map.png".to_string(),
                    mime: "image/png".to_string(),
                    data_base64: "AAAA".into(),
                }],
            },
        ];
        let body = agent_request_body(
            "gpt-5-mini",
            "rules",
            &history,
            &[],
            false,
            &Thinking::default(),
            true,
        );
        let input = body["input"].as_array().unwrap();
        assert_eq!(input.len(), 3);
        assert_eq!(input[1]["type"], "function_call_output");
        assert_eq!(input[1]["output"], "Here is map.png.");
        assert_eq!(input[2]["role"], "user");
        assert_eq!(input[2]["content"][0]["type"], "input_image");
        assert_eq!(
            input[2]["content"][0]["image_url"],
            "data:image/png;base64,AAAA"
        );
        assert!(input[2]["content"][1]["text"]
            .as_str()
            .unwrap()
            .contains("not sent by the user: map.png"));
    }

    #[test]
    fn agent_request_body_appends_web_search_tool_and_skips_verbosity_on_old_models() {
        let body = agent_request_body(
            "gpt-4o-mini",
            "be helpful",
            &[],
            &[],
            true,
            &Thinking::default(),
            false,
        );
        assert_eq!(body["tools"].as_array().unwrap().len(), 1);
        assert_eq!(body["tools"][0]["type"], "web_search");
        assert!(body.get("text").is_none());
    }

    #[test]
    fn agent_request_body_carries_the_thinking_plan() {
        let deep = crate::capabilities::plan(
            "openai",
            "gpt-6.1-sol",
            crate::capabilities::ThinkingLevel::Deep,
        );
        let body = agent_request_body("gpt-6.1-sol", "rules", &[], &[], false, &deep, true);
        assert_eq!(body["reasoning"]["effort"], "high");
        assert_eq!(body["reasoning"]["summary"], "auto");
        // Auto is the request as it always was.
        let auto = agent_request_body(
            "gpt-6.1-sol",
            "rules",
            &[],
            &[],
            false,
            &Thinking::default(),
            true,
        );
        assert!(auto.get("reasoning").is_none());
    }

    #[test]
    fn quick_requests_ask_gpt6_for_its_lowest_reasoning_effort() {
        let luna =
            serde_json::to_value(ResponsesRequest::new("gpt-6-luna", "i".into(), "u".into()))
                .unwrap();
        assert_eq!(luna["reasoning"]["effort"], "none");
        let sol =
            serde_json::to_value(ResponsesRequest::new("gpt-6.1-sol", "i".into(), "u".into()))
                .unwrap();
        assert_eq!(sol["reasoning"]["effort"], "low");
        assert!(sol.get("text").is_none());
        let old =
            serde_json::to_value(ResponsesRequest::new("gpt-4o-mini", "i".into(), "u".into()))
                .unwrap();
        assert!(old.get("reasoning").is_none());
    }

    #[test]
    fn parse_agent_output_prefers_tool_calls_over_text() {
        let output = vec![
            json!({"type": "function_call", "call_id": "c1", "name": "propose_edit", "arguments": "{\"action\":\"append\"}"}),
            json!({"type": "message", "content": [{"text": "ignored while a tool call is pending"}]}),
        ];
        match parse_agent_output(&output, &|_| {}) {
            StepResult::ToolCalls(calls) => {
                assert_eq!(calls.len(), 1);
                let AgentTurn::ToolCall { call_id, name, .. } = &calls[0] else {
                    panic!("expected a ToolCall turn");
                };
                assert_eq!(call_id, "c1");
                assert_eq!(name, "propose_edit");
            }
            StepResult::Done(_) => panic!("expected tool calls"),
        }
    }

    /// Runs `output` through parse_agent_output and shows its markers as
    /// [k], with the pages it reported.
    fn cited(output: &[Value]) -> (String, Vec<(String, String)>) {
        let pages = std::sync::Mutex::new(Vec::new());
        let sink = |e: ProviderEvent<'_>| {
            if let ProviderEvent::Citation { url, title } = e {
                pages
                    .lock()
                    .unwrap()
                    .push((url.to_string(), title.to_string()));
            }
        };
        let StepResult::Done(text) = parse_agent_output(output, &sink) else {
            panic!("expected a final answer");
        };
        let text = crate::agent::replace_citation_markers(&text, |k| Some(format!("[{k}]")));
        (text, pages.into_inner().unwrap())
    }

    #[test]
    fn openai_inline_citation_links_become_numbered_markers() {
        let text = "Spring tides peak at full moon ([noaa.gov](https://noaa.gov/tides)). Neap tides are weakest ([例子](https://例.example/x)).";
        let span = |needle: &str| {
            let byte = text.find(needle).unwrap();
            let start = text[..byte].chars().count();
            (start, start + needle.chars().count())
        };
        let (a0, a1) = span("[noaa.gov](https://noaa.gov/tides)");
        let (b0, b1) = span("([例子](https://例.example/x))");
        let output = vec![json!({"type": "message", "content": [{
            "type": "output_text",
            "text": text,
            "annotations": [
                {"type": "url_citation", "url": "https://noaa.gov/tides", "title": "Tides", "start_index": a0, "end_index": a1},
                {"type": "url_citation", "url": "https://例.example/x", "title": "例子", "start_index": b0, "end_index": b1},
            ],
        }]})];
        let (text, pages) = cited(&output);
        assert_eq!(
            text,
            "Spring tides peak at full moon [1]. Neap tides are weakest [2]."
        );
        assert_eq!(pages[0], ("https://noaa.gov/tides".into(), "Tides".into()));
    }

    /// xAI writes "[[1]](url)" and puts the number, not the page's title,
    /// in `title`; Qwen names its pages only in the web_search_call.
    #[test]
    fn xai_numbers_are_not_titles_and_qwen_sources_are_reported() {
        let text = "It rose 3% [[1]](https://x.example/a).";
        let start = text.find("[[").unwrap();
        let output = vec![
            json!({"type": "web_search_call", "action": {"type": "search", "sources": [{"url": "https://q.example/"}]}}),
            json!({"type": "message", "content": [{
                "type": "output_text",
                "text": text,
                "annotations": [{"type": "url_citation", "url": "https://x.example/a", "title": "1", "start_index": start, "end_index": text.len() - 1}],
            }]}),
        ];
        let (text, pages) = cited(&output);
        assert_eq!(text, "It rose 3% [2].");
        assert_eq!(
            pages,
            vec![
                ("https://q.example/".to_string(), String::new()),
                ("https://x.example/a".to_string(), String::new())
            ]
        );
    }

    #[test]
    fn parse_agent_output_joins_message_text_when_no_tool_calls() {
        let output = vec![
            json!({"type": "message", "content": [{"text": "part one"}, {"text": "part two"}]}),
        ];
        match parse_agent_output(&output, &|_| {}) {
            StepResult::Done(text) => assert_eq!(text, "part one\npart two"),
            StepResult::ToolCalls(_) => panic!("expected a final answer"),
        }
    }
}
