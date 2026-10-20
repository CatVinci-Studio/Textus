use crate::agent::{
    tool_images_note, AgentTurn, EventSink, ImageAttachment, ProviderEvent, StepResult, ToolSpec,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

fn chat_completions_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim_end_matches('/'))
}

fn models_url(base_url: &str) -> String {
    format!("{}/models", base_url.trim_end_matches('/'))
}

#[derive(Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
}

#[derive(Deserialize, Default)]
struct ChatChoiceMessage {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize, Default)]
struct ChatChoice {
    #[serde(default)]
    message: ChatChoiceMessage,
}

#[derive(Deserialize, Default)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<ChatChoice>,
}

/// Custom endpoints (self-hosted, local models, third-party OpenAI-compatible
/// servers) most reliably support the older `/chat/completions` shape rather
/// than the newer Responses API, which fewer non-OpenAI servers implement.
pub async fn call_completion(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    instructions: String,
    user_text: String,
) -> Result<String, String> {
    let body = ChatRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: "system",
                content: instructions,
            },
            ChatMessage {
                role: "user",
                content: user_text,
            },
        ],
    };

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

    let parsed: ChatResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed
        .choices
        .into_iter()
        .find_map(|c| c.message.content)
        .unwrap_or_default())
}

#[derive(Deserialize)]
struct ModelListEntry {
    id: String,
    /// Unix seconds, when the endpoint says (OpenAI and most compatibles).
    #[serde(default)]
    created: Option<i64>,
}

#[derive(Deserialize, Default)]
struct ModelListResponse {
    #[serde(default)]
    data: Vec<ModelListEntry>,
}

/// Lists models from an OpenAI-compatible `/models` endpoint. Also doubles
/// as the "test connection" check - if this succeeds, the endpoint is
/// reachable and credentials work.
pub async fn list_models(base_url: &str, api_key: Option<&str>) -> Result<Vec<String>, String> {
    let client = crate::http::client();
    let mut req = client.get(models_url(base_url));
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Could not list models ({status}): {text}"));
    }

    let parsed: ModelListResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(crate::models::tidy(
        parsed
            .data
            .into_iter()
            .map(|m| (m.id, m.created.map(|c| format!("{c:020}"))))
            .collect(),
    ))
}

// --- Agentic tool-calling support (the generic openai-chat-completions
// dialect - see `aicompat::agent` for the provider-agnostic loop this
// feeds). This is the dialect self-hosted models, OpenRouter, Groq, Ollama,
// and most other OpenAI-compatible servers speak - unlike the Responses API
// and Messages API dialects, `tools` support here varies a lot server to
// server, so the caller (agent.rs) is expected to fall back to
// `call_completion` on a hard failure rather than this module guessing.

fn tool_to_schema(tool: &ToolSpec) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        },
    })
}

/// Provider-specific web search switches that are accepted by otherwise
/// OpenAI-compatible Chat Completions endpoints.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeWebSearch {
    Groq,
    OpenRouter,
    Qwen,
    Zhipu,
}

fn agent_request_body(
    model: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: Option<NativeWebSearch>,
) -> Value {
    let mut tool_schemas = tools.iter().map(tool_to_schema).collect::<Vec<_>>();
    match web_search {
        Some(NativeWebSearch::Groq) => {
            tool_schemas.push(json!({"type": "browser_search"}));
        }
        Some(NativeWebSearch::OpenRouter) => {
            tool_schemas.push(json!({"type": "openrouter:web_search"}));
        }
        Some(NativeWebSearch::Zhipu) => {
            tool_schemas.push(json!({
                "type": "web_search",
                "web_search": {"enable": true, "search_result": true},
            }));
        }
        Some(NativeWebSearch::Qwen) | None => {}
    }

    let mut body = json!({
        "model": model,
        "messages": turns_to_messages(instructions, history),
        "tools": tool_schemas,
        "tool_choice": "auto",
    });
    if web_search == Some(NativeWebSearch::Qwen) {
        body["enable_search"] = json!(true);
    }
    body
}

/// Groups the flat `AgentTurn` history into Chat Completions messages.
/// Like the Anthropic dialect, every `ToolCall` of a step must land in ONE
/// assistant message's `tool_calls` array - but each `ToolResult` becomes
/// its OWN `role: "tool"` message afterward (not grouped into one, unlike
/// Anthropic's `tool_result` content blocks), matching what
/// api.openai.com/v1/chat/completions and compatible servers expect. A call
/// after a result starts the next step's message (`run_agent_loop` records
/// each step's calls before their results), so a new step only appends to
/// the messages and the servers that cache prompt prefixes on their own
/// (DeepSeek, Qwen, Kimi, ...) keep the earlier steps cached.
/// A user message of image parts, then `text`.
fn user_message_with_images(images: &[ImageAttachment], text: &str) -> Value {
    let mut content: Vec<Value> = images
        .iter()
        .map(|image| {
            json!({
                "type": "image_url",
                "image_url": {"url": image.data_url()},
            })
        })
        .collect();
    content.push(json!({"type": "text", "text": text}));
    json!({"role": "user", "content": content})
}

fn turns_to_messages(instructions: &str, history: &[AgentTurn]) -> Vec<Value> {
    let mut messages = vec![json!({"role": "system", "content": instructions})];
    let mut i = 0;
    while i < history.len() {
        match &history[i] {
            AgentTurn::User { text, images } => {
                // Plain string `content` unless there are images: an
                // OpenAI-compatible server that predates vision accepts the
                // string form and may reject the content-part array, and the
                // overwhelming majority of turns have no images.
                if images.is_empty() {
                    messages.push(json!({"role": "user", "content": text}));
                } else {
                    messages.push(user_message_with_images(images, text));
                }
                i += 1;
            }
            AgentTurn::Assistant { text } => {
                messages.push(json!({"role": "assistant", "content": text}));
                i += 1;
            }
            AgentTurn::ToolCall { .. } | AgentTurn::ToolResult { .. } => {
                let mut tool_calls = Vec::new();
                let mut tool_results = Vec::new();
                let mut tool_images = Vec::new();
                while let Some(turn) = history.get(i) {
                    match turn {
                        // The next step's calls.
                        AgentTurn::ToolCall { .. } if !tool_results.is_empty() => break,
                        AgentTurn::ToolCall {
                            call_id,
                            name,
                            arguments,
                        } => {
                            tool_calls.push(json!({
                                "id": call_id,
                                "type": "function",
                                "function": { "name": name, "arguments": arguments },
                            }));
                            i += 1;
                        }
                        AgentTurn::ToolResult {
                            call_id,
                            output,
                            images,
                        } => {
                            tool_results.push((call_id.clone(), output.clone()));
                            tool_images.extend(images.iter().cloned());
                            i += 1;
                        }
                        _ => break,
                    }
                }
                if !tool_calls.is_empty() {
                    messages.push(json!({"role": "assistant", "content": Value::Null, "tool_calls": tool_calls}));
                }
                for (call_id, output) in tool_results {
                    messages
                        .push(json!({"role": "tool", "tool_call_id": call_id, "content": output}));
                }
                // A `tool` message's content is text only (OpenAI's own
                // API rejects image parts there, and the compatible servers
                // follow it), so the step's images follow its results as
                // one user message.
                if !tool_images.is_empty() {
                    let note = tool_images_note(&tool_images);
                    messages.push(user_message_with_images(&tool_images, &note));
                }
            }
        }
    }
    messages
}

/// Parses a Chat Completions `choices[0].message` object into a
/// [`StepResult`]: any `tool_calls` become tool calls the caller must
/// execute, otherwise `content` is the model's final answer.
fn parse_agent_response(message: &Value) -> StepResult {
    let calls: Vec<AgentTurn> = message
        .get("tool_calls")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|tc| {
            let call_id = tc.get("id")?.as_str()?.to_string();
            let func = tc.get("function")?;
            let name = func.get("name")?.as_str()?.to_string();
            let arguments = func
                .get("arguments")
                .and_then(|a| a.as_str())
                .unwrap_or("{}")
                .to_string();
            Some(AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
            })
        })
        .collect();

    if !calls.is_empty() {
        return StepResult::ToolCalls(calls);
    }
    StepResult::Done(
        message
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or_default()
            .to_string(),
    )
}

/// One tool call under construction while a Chat Completions stream is
/// being read - OpenAI-compatible servers send the id/name in the first
/// fragment and the JSON arguments in pieces after it, all addressed by
/// array index rather than id.
#[derive(Default)]
struct StreamToolCall {
    id: String,
    name: String,
    args: String,
    /// ToolStart is reported once, when both id and name have arrived.
    started: bool,
}

/// Rebuilds the non-streaming `choices[0].message` result from Chat
/// Completions SSE chunks, reporting fragments through `on_event` as they
/// arrive. Separate from the HTTP read so the chunk bookkeeping is unit
/// testable with plain JSON fixtures.
#[derive(Default)]
struct ChatStreamAccumulator {
    text: String,
    calls: Vec<StreamToolCall>,
    error: Option<String>,
}

impl ChatStreamAccumulator {
    fn apply(&mut self, data: &str, on_event: EventSink<'_>) {
        if self.error.is_some() || data.trim() == "[DONE]" {
            return;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(data) else {
            return;
        };
        // Mid-stream failures arrive as an `error` object in the data
        // payload (the HTTP status was already 200 by the time they occur).
        if let Some(error) = chunk.get("error") {
            self.error = Some(format!("Custom endpoint request failed: {error}"));
            return;
        }
        let Some(delta) = chunk
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("delta"))
        else {
            return;
        };

        if let Some(text) = delta.get("content").and_then(|c| c.as_str()) {
            if !text.is_empty() {
                self.text.push_str(text);
                on_event(ProviderEvent::Text(text));
            }
        }

        for tc in delta
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            let index = tc
                .get("index")
                .and_then(|i| i.as_u64())
                .map(|i| i as usize)
                .unwrap_or(self.calls.len().saturating_sub(1));
            while self.calls.len() <= index {
                self.calls.push(StreamToolCall::default());
            }
            let call = &mut self.calls[index];
            if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                call.id = id.to_string();
            }
            if let Some(name) = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
            {
                call.name = name.to_string();
            }
            if !call.started && !call.id.is_empty() && !call.name.is_empty() {
                call.started = true;
                on_event(ProviderEvent::ToolStart {
                    call_id: &call.id,
                    name: &call.name,
                });
            }
            if let Some(part) = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|v| v.as_str())
            {
                if !part.is_empty() {
                    call.args.push_str(part);
                    if call.started {
                        on_event(ProviderEvent::ToolArgs {
                            call_id: &call.id,
                            delta: part,
                        });
                    }
                }
            }
        }
    }

    fn into_step_result(self) -> StepResult {
        let calls: Vec<AgentTurn> = self
            .calls
            .into_iter()
            .filter(|c| !c.id.is_empty() && !c.name.is_empty())
            .map(|c| AgentTurn::ToolCall {
                call_id: c.id,
                name: c.name,
                arguments: if c.args.is_empty() {
                    "{}".to_string()
                } else {
                    c.args
                },
            })
            .collect();
        if !calls.is_empty() {
            StepResult::ToolCalls(calls)
        } else {
            StepResult::Done(self.text)
        }
    }
}

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
    on_event: EventSink<'_>,
) -> Result<StepResult, String> {
    let mut body = agent_request_body(model, instructions, history, tools, web_search);
    body["stream"] = json!(true);

    let client = crate::http::streaming_client();
    let mut req = client.post(chat_completions_url(base_url)).json(&body);
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;

    let mut acc = ChatStreamAccumulator::default();
    crate::http::read_sse(res, "Custom endpoint", |data| acc.apply(data, on_event)).await?;
    if let Some(error) = acc.error {
        return Err(error);
    }
    Ok(acc.into_step_result())
}

/// Runs one round-trip against a Chat Completions-compatible endpoint with
/// tool definitions - the generic-dialect twin of `openai_codex::agent_step`.
pub async fn agent_step(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: Option<NativeWebSearch>,
) -> Result<StepResult, String> {
    let body = agent_request_body(model, instructions, history, tools, web_search);

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
    Ok(parse_agent_response(&message))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::ImageAttachment;

    /// The chat-completions image part, plus the guarantee that a text-only
    /// turn still sends a plain string. The second half is what keeps this
    /// dialect working against OpenAI-compatible servers old enough to
    /// reject a content-part array outright.
    #[test]
    fn images_use_image_url_parts_and_text_only_turns_stay_strings() {
        let with_image = turns_to_messages(
            "be helpful",
            &[AgentTurn::User {
                text: "what is this?".to_string(),
                images: vec![ImageAttachment {
                    name: "chart.png".to_string(),
                    mime: "image/png".to_string(),
                    data_base64: "AAAA".to_string(),
                }],
            }],
        );
        assert_eq!(with_image[1]["content"][0]["type"], "image_url");
        assert_eq!(
            with_image[1]["content"][0]["image_url"]["url"],
            "data:image/png;base64,AAAA"
        );
        assert_eq!(with_image[1]["content"][1]["text"], "what is this?");

        let text_only = turns_to_messages(
            "be helpful",
            &[AgentTurn::User {
                text: "hi".to_string(),
                images: Vec::new(),
            }],
        );
        assert_eq!(text_only[1]["content"], "hi");
    }

    fn call(id: &str, query: &str) -> AgentTurn {
        AgentTurn::ToolCall {
            call_id: id.to_string(),
            name: "search_document".to_string(),
            arguments: format!("{{\"query\":\"{query}\"}}"),
        }
    }

    fn result(id: &str, output: &str) -> AgentTurn {
        AgentTurn::ToolResult {
            call_id: id.to_string(),
            output: output.to_string(),
            images: Vec::new(),
        }
    }

    #[test]
    fn turns_to_messages_starts_with_system_and_groups_tool_turns() {
        // One step that called two tools (calls first, as run_agent_loop
        // records them).
        let history = vec![
            AgentTurn::User {
                text: "do it".to_string(),
                images: Vec::new(),
            },
            call("1", "a"),
            call("2", "b"),
            result("1", "found a"),
            result("2", "found b"),
            AgentTurn::Assistant {
                text: "done".to_string(),
            },
        ];

        let messages = turns_to_messages("be helpful", &history);
        // system, user, assistant(tool_calls x2), tool, tool, assistant
        assert_eq!(messages.len(), 6);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "be helpful");
        assert_eq!(messages[1]["role"], "user");

        assert_eq!(messages[2]["role"], "assistant");
        let tool_calls = messages[2]["tool_calls"].as_array().unwrap();
        assert_eq!(tool_calls.len(), 2);
        assert_eq!(tool_calls[0]["id"], "1");
        assert_eq!(tool_calls[0]["function"]["name"], "search_document");
        assert_eq!(tool_calls[1]["id"], "2");

        assert_eq!(messages[3]["role"], "tool");
        assert_eq!(messages[3]["tool_call_id"], "1");
        assert_eq!(messages[3]["content"], "found a");
        assert_eq!(messages[4]["role"], "tool");
        assert_eq!(messages[4]["tool_call_id"], "2");

        assert_eq!(messages[5]["role"], "assistant");
        assert_eq!(messages[5]["content"], "done");
    }

    /// A `tool` message is text only, so a step's images come after its
    /// tool messages, as one user message.
    #[test]
    fn tool_result_images_follow_the_tool_messages_as_a_user_message() {
        let history = vec![
            call("1", "a"),
            call("2", "b"),
            AgentTurn::ToolResult {
                call_id: "1".to_string(),
                output: "Here is map.png.".to_string(),
                images: vec![ImageAttachment {
                    name: "map.png".to_string(),
                    mime: "image/png".to_string(),
                    data_base64: "AAAA".into(),
                }],
            },
            result("2", "found b"),
        ];
        let messages = turns_to_messages("rules", &history);
        // system, assistant(tool_calls), tool, tool, user(image)
        assert_eq!(messages.len(), 5);
        assert_eq!(messages[2]["content"], "Here is map.png.");
        assert_eq!(messages[3]["role"], "tool");
        assert_eq!(messages[4]["role"], "user");
        assert_eq!(messages[4]["content"][0]["type"], "image_url");
        assert_eq!(
            messages[4]["content"][0]["image_url"]["url"],
            "data:image/png;base64,AAAA"
        );
        assert_eq!(messages[4]["content"][1]["type"], "text");
    }

    /// Servers that cache prompt prefixes automatically (DeepSeek and most
    /// Chinese providers) only help if a new step leaves the messages before
    /// it alone: the next step's call starts a message of its own.
    #[test]
    fn a_new_step_only_appends_messages() {
        let mut turns = vec![AgentTurn::User {
            text: "doc + q".to_string(),
            images: Vec::new(),
        }];
        let mut before = turns_to_messages("rules", &turns);
        for step in [
            vec![call("r", "a"), result("r", "x")],
            vec![
                call("e1", "b"),
                call("e2", "c"),
                result("e1", "y"),
                result("e2", "z"),
            ],
        ] {
            turns.extend(step);
            let after = turns_to_messages("rules", &turns);
            assert_eq!(after[..before.len()], before[..]);
            before = after;
        }
        // system, user, then [assistant, tool] and [assistant, tool, tool].
        assert_eq!(before.len(), 7);
        assert_eq!(before[4]["tool_calls"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn parse_agent_response_prefers_tool_calls_over_content() {
        let message = json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [{
                "id": "c1",
                "type": "function",
                "function": { "name": "propose_edit", "arguments": "{\"action\":\"append\"}" },
            }],
        });
        match parse_agent_response(&message) {
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

    #[test]
    fn parse_agent_response_falls_back_to_content() {
        let message = json!({ "role": "assistant", "content": "plain answer" });
        match parse_agent_response(&message) {
            StepResult::Done(text) => assert_eq!(text, "plain answer"),
            StepResult::ToolCalls(_) => panic!("expected a final answer"),
        }
    }

    /// Feeds SSE data payloads through the accumulator, collecting the
    /// events it reports as "T:text", "S:id:name", "A:id:delta" strings.
    fn run_stream(chunks: &[&str]) -> (ChatStreamAccumulator, Vec<String>) {
        let reported = std::sync::Mutex::new(Vec::new());
        let sink = |e: ProviderEvent<'_>| {
            reported.lock().unwrap().push(match e {
                ProviderEvent::Text(t) => format!("T:{t}"),
                ProviderEvent::ToolStart { call_id, name } => format!("S:{call_id}:{name}"),
                ProviderEvent::ToolArgs { call_id, delta } => format!("A:{call_id}:{delta}"),
            });
        };
        let mut acc = ChatStreamAccumulator::default();
        for chunk in chunks {
            acc.apply(chunk, &sink);
        }
        let reported = reported.into_inner().unwrap();
        (acc, reported)
    }

    #[test]
    fn chat_stream_accumulates_text_deltas() {
        let (acc, events) = run_stream(&[
            r#"{"choices":[{"delta":{"role":"assistant"}}]}"#,
            r#"{"choices":[{"delta":{"content":"Hel"}}]}"#,
            r#"{"choices":[{"delta":{"content":"lo"}}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
            "[DONE]",
        ]);
        assert_eq!(events, vec!["T:Hel", "T:lo"]);
        match acc.into_step_result() {
            StepResult::Done(text) => assert_eq!(text, "Hello"),
            StepResult::ToolCalls(_) => panic!("expected a final answer"),
        }
    }

    #[test]
    fn chat_stream_assembles_tool_calls_from_indexed_fragments() {
        let (acc, events) = run_stream(&[
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"propose_edit","arguments":""}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"action\":"}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"append\"}"}}]}}]}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
            "[DONE]",
        ]);
        assert_eq!(
            events,
            vec!["S:c1:propose_edit", "A:c1:{\"action\":", "A:c1:\"append\"}",]
        );
        match acc.into_step_result() {
            StepResult::ToolCalls(calls) => {
                let AgentTurn::ToolCall {
                    call_id,
                    name,
                    arguments,
                } = &calls[0]
                else {
                    panic!("expected a ToolCall turn");
                };
                assert_eq!(call_id, "c1");
                assert_eq!(name, "propose_edit");
                assert_eq!(arguments, "{\"action\":\"append\"}");
            }
            StepResult::Done(_) => panic!("expected tool calls"),
        }
    }

    #[test]
    fn chat_stream_surfaces_mid_stream_errors() {
        let (acc, events) = run_stream(&[
            r#"{"choices":[{"delta":{"content":"par"}}]}"#,
            r#"{"error":{"message":"rate limited","code":429}}"#,
            r#"{"choices":[{"delta":{"content":"tial, ignored"}}]}"#,
        ]);
        assert_eq!(events, vec!["T:par"]);
        assert!(acc.error.as_deref().unwrap().contains("rate limited"));
    }

    #[test]
    fn agent_request_body_adds_each_native_search_shape() {
        let openrouter = agent_request_body(
            "openrouter/auto",
            "help",
            &[],
            &[],
            Some(NativeWebSearch::OpenRouter),
        );
        assert_eq!(openrouter["tools"][0]["type"], "openrouter:web_search");

        let groq = agent_request_body(
            "openai/gpt-oss-120b",
            "help",
            &[],
            &[],
            Some(NativeWebSearch::Groq),
        );
        assert_eq!(groq["tools"][0]["type"], "browser_search");

        let qwen = agent_request_body("qwen-plus", "help", &[], &[], Some(NativeWebSearch::Qwen));
        assert_eq!(qwen["enable_search"], true);

        let zhipu = agent_request_body("glm-5.2", "help", &[], &[], Some(NativeWebSearch::Zhipu));
        assert_eq!(zhipu["tools"][0]["type"], "web_search");
        assert_eq!(zhipu["tools"][0]["web_search"]["enable"], true);
    }
}
