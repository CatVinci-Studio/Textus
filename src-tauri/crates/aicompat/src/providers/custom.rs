use crate::agent::{
    mark_cited_spans, tool_images_note, AgentTurn, CitedSpan, EventSink, ImageAttachment,
    ProviderEvent, StepCitations, StepResult, StepUsage, ToolSpec,
};
use crate::capabilities::Thinking;
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
    /// Ark's and MiniMax's switch for their thinking models - see
    /// [`Vendor::Ark`] and [`Vendor::MiniMax`].
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<&'static str>,
    /// DeepSeek's switch - see [`Vendor::DeepSeek`].
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<Value>,
    /// MiniMax's - see [`Vendor::MiniMax`].
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_split: Option<bool>,
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

fn completion_request(
    model: &str,
    instructions: String,
    user_text: String,
    vendor: Vendor,
) -> ChatRequest {
    ChatRequest {
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
        reasoning_effort: match vendor {
            Vendor::Ark => Some("minimal"),
            Vendor::MiniMax => Some("low"),
            _ => None,
        },
        thinking: (vendor == Vendor::DeepSeek).then(|| json!({"type": "disabled"})),
        reasoning_split: (vendor == Vendor::MiniMax).then_some(true),
    }
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
    vendor: Vendor,
) -> Result<String, String> {
    let body = completion_request(model, instructions, user_text, vendor);

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
    vendor: Vendor,
    thinking: &Thinking,
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
        "messages": turns_to_messages(instructions, history, thinking.replay),
        "tools": tool_schemas,
        "tool_choice": "auto",
    });
    if web_search == Some(NativeWebSearch::Qwen) {
        body["enable_search"] = json!(true);
    }
    if vendor == Vendor::Ark {
        body["max_tokens"] = json!(ARK_AGENT_MAX_TOKENS);
    }
    if vendor == Vendor::MiniMax {
        body["reasoning_split"] = json!(true);
    }
    thinking.apply_chat_completions(&mut body);
    body
}

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

/// Groups the flat `AgentTurn` history into Chat Completions messages.
/// Like the Anthropic dialect, every `ToolCall` of a step must land in ONE
/// assistant message's `tool_calls` array - but each `ToolResult` becomes
/// its OWN `role: "tool"` message afterward (not grouped into one, unlike
/// Anthropic's `tool_result` content blocks), matching what
/// api.openai.com/v1/chat/completions and compatible servers expect. A call
/// after a result starts the next step's message (`run_agent_loop` records
/// each step's calls before their results), so a new step only appends to
/// the messages and the servers that cache prompt prefixes on their own
/// (DeepSeek, Qwen, Kimi, ...) keep the earlier steps cached. With
/// `replay_reasoning`, a step's `reasoning_content` goes back on its
/// assistant message (see `ProviderCaps::replay_reasoning`).
fn turns_to_messages(
    instructions: &str,
    history: &[AgentTurn],
    replay_reasoning: bool,
) -> Vec<Value> {
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
            AgentTurn::Assistant { text, .. } => {
                messages.push(json!({"role": "assistant", "content": text}));
                i += 1;
            }
            AgentTurn::ToolCall { .. } | AgentTurn::ToolResult { .. } => {
                let mut tool_calls = Vec::new();
                let mut tool_results = Vec::new();
                let mut tool_images = Vec::new();
                let mut reasoning = None;
                while let Some(turn) = history.get(i) {
                    match turn {
                        // The next step's calls.
                        AgentTurn::ToolCall { .. } if !tool_results.is_empty() => break,
                        AgentTurn::ToolCall {
                            call_id,
                            name,
                            arguments,
                            reasoning: step_reasoning,
                        } => {
                            if reasoning.is_none() {
                                reasoning = step_reasoning.as_ref().and_then(|r| r.as_str());
                            }
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
                    let mut message = json!({"role": "assistant", "content": Value::Null, "tool_calls": tool_calls});
                    if let Some(reasoning) = reasoning.filter(|_| replay_reasoning) {
                        message["reasoning_content"] = json!(reasoning);
                    }
                    messages.push(message);
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

/// What a native web search said about the pages it used, gathered from a
/// response or its stream chunks - each provider puts it somewhere else.
#[derive(Default)]
struct SearchReport {
    /// OpenRouter: `url_citation` annotations on the message.
    annotations: Vec<Value>,
    /// Zhipu: a top-level `web_search` list, which the text cites as
    /// `[ref_1]` (or `[来源：ref_1]`) by each result's `refer`.
    zhipu_results: Vec<Value>,
    /// Groq: the browser_search calls the model made, with their results.
    executed_tools: Vec<Value>,
}

impl SearchReport {
    /// What `message` (a message, or a stream chunk's delta) and its
    /// `response` (or chunk) carry. A stream may repeat a list in several
    /// chunks; each entry is kept once.
    fn take(&mut self, message: &Value, response: &Value) {
        fn add(into: &mut Vec<Value>, list: Option<&Value>) {
            for v in list.and_then(|v| v.as_array()).into_iter().flatten() {
                if !into.contains(v) {
                    into.push(v.clone());
                }
            }
        }
        add(&mut self.annotations, message.get("annotations"));
        add(&mut self.executed_tools, message.get("executed_tools"));
        add(&mut self.zhipu_results, response.get("web_search"));
    }

    /// `text` with the pages it cites marked, every page reported.
    fn cite(&self, text: &str, on_event: EventSink<'_>) -> String {
        let mut citations = StepCitations::default();
        let spans: Vec<CitedSpan<'_>> = self
            .annotations
            .iter()
            .filter_map(|a| {
                let c = a.get("url_citation")?;
                let index = |key: &str| c.get(key).and_then(|v| v.as_u64()).map(|v| v as usize);
                Some(CitedSpan {
                    start: index("start_index")?,
                    end: index("end_index")?,
                    url: c.get("url")?.as_str()?,
                    title: c.get("title").and_then(|t| t.as_str()).unwrap_or(""),
                })
            })
            .collect();
        let mut text = if spans.is_empty() {
            text.to_string()
        } else {
            mark_cited_spans(text, spans, &mut citations, on_event)
        };
        if !self.zhipu_results.is_empty() {
            text = cite_zhipu_refs(&text, &self.zhipu_results, &mut citations, on_event);
        }
        if !self.executed_tools.is_empty() {
            // Groq's text points into its browser's pages as 【2†L6-L10】,
            // which name no page: the marks go, the pages are still listed.
            text = strip_between(&text, '【', '】', |inner| inner.contains('†'));
            for result in self.executed_tools.iter().flat_map(|t| {
                t.pointer("/search_results/results")
                    .and_then(|r| r.as_array())
                    .cloned()
                    .unwrap_or_default()
            }) {
                if let Some(url) = result.get("url").and_then(|u| u.as_str()) {
                    let title = result.get("title").and_then(|t| t.as_str()).unwrap_or("");
                    citations.cite(url, title, on_event);
                }
            }
        }
        text
    }
}

/// `text` without the `open`...`close` runs whose inside `drop` accepts.
fn strip_between(text: &str, open: char, close: char, drop: impl Fn(&str) -> bool) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(open) {
        let after = &rest[start + open.len_utf8()..];
        match after.find(close) {
            Some(end) if drop(&after[..end]) => {
                out.push_str(&rest[..start]);
                rest = &after[end + close.len_utf8()..];
            }
            _ => {
                out.push_str(&rest[..start + open.len_utf8()]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Zhipu's `[ref_1]`, `[来源：ref_1]` or `【ref_1】` as citation markers, by
/// the `refer` of each result - or, when the text marks none, every result
/// with a link reported.
fn cite_zhipu_refs(
    text: &str,
    results: &[Value],
    citations: &mut StepCitations,
    on_event: EventSink<'_>,
) -> String {
    let page = |refer: &str| {
        results.iter().find_map(|r| {
            (r.get("refer").and_then(|v| v.as_str()) == Some(refer)).then(|| {
                (
                    r.get("link").and_then(|v| v.as_str()).unwrap_or(""),
                    r.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                )
            })
        })
    };
    let mut out = String::with_capacity(text.len());
    let mut matched = false;
    let mut rest = text;
    while let Some(start) = rest.find(['[', '【']) {
        out.push_str(&rest[..start]);
        let open = rest[start..].chars().next().unwrap();
        let close = if open == '[' { ']' } else { '】' };
        let after = &rest[start + open.len_utf8()..];
        let inner_end = after.find(close).filter(|&end| end <= 40);
        let refer = inner_end.and_then(|end| {
            let inner = &after[..end];
            let at = inner.find("ref_")?;
            let refer = &inner[at..];
            refer[4..]
                .chars()
                .all(|c| c.is_ascii_digit())
                .then_some(refer)
        });
        match (inner_end, refer.and_then(page)) {
            (Some(end), Some((url, title))) if !url.is_empty() => {
                out.push_str(&citations.cite(url, title, on_event));
                matched = true;
                rest = &after[end + close.len_utf8()..];
            }
            _ => {
                out.push(open);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    // A reply that searched but marked nothing still names its pages.
    if matched {
        return out;
    }
    for r in results {
        if let Some(url) = r
            .get("link")
            .and_then(|v| v.as_str())
            .filter(|u| !u.is_empty())
        {
            citations.cite(
                url,
                r.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                on_event,
            );
        }
    }
    out
}

/// Parses a Chat Completions `choices[0].message` object into a
/// [`StepResult`]: any `tool_calls` become tool calls the caller must
/// execute, otherwise `content` is the model's final answer, with the
/// pages a native search cited (`report`) marked and reported.
fn parse_agent_response(
    message: &Value,
    report: &SearchReport,
    on_event: EventSink<'_>,
) -> StepResult {
    let mut calls: Vec<AgentTurn> = message
        .get("tool_calls")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|tc| {
            let call_id = tc
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
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
                reasoning: None,
            })
        })
        .collect();

    let text = message
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or_default();
    if !calls.is_empty() {
        attach_reasoning(&mut calls, reasoning_of(message).unwrap_or_default());
        return StepResult::calls_with_text(calls, report.cite(text, on_event));
    }
    StepResult::Done(report.cite(text, on_event))
}

/// The reasoning an OpenAI-compatible message or delta carries: DeepSeek,
/// Kimi, Qwen and GLM call it `reasoning_content`; OpenRouter, Groq and
/// Ollama `reasoning`.
fn reasoning_of(message: &Value) -> Option<&str> {
    ["reasoning_content", "reasoning"]
        .iter()
        .find_map(|key| message.get(*key).and_then(|r| r.as_str()))
}

/// A step's reasoning rides on its first call (`AgentTurn::ToolCall`).
fn attach_reasoning(calls: &mut [AgentTurn], text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(AgentTurn::ToolCall { reasoning, .. }) = calls.first_mut() {
        *reasoning = Some(json!(text));
    }
}

/// The ids a step's tool calls go by. OpenAI-compatible servers are free in
/// what they send: local ones (Ollama, LM Studio) number calls from
/// `call_0` in every reply, and some send no id at all. The app keys a
/// proposal by its call's id - its preview, its card, its status in later
/// requests - so a reused id put a new proposal in an old one's place and
/// both went (a mock server that did, live stress test of a queue of
/// requests), and a call with none was dropped. Each call keeps the id it
/// was sent unless the conversation already has it, or it has none.
#[derive(Default)]
struct CallIds {
    taken: std::collections::HashSet<String>,
}

impl CallIds {
    fn from_history(history: &[AgentTurn]) -> Self {
        let taken = history
            .iter()
            .filter_map(|turn| match turn {
                AgentTurn::ToolCall { call_id, .. } => Some(call_id.clone()),
                _ => None,
            })
            .collect();
        CallIds { taken }
    }

    /// The id the call at `index` goes by: `sent`, or one made from it.
    fn claim(&mut self, sent: &str, index: usize) -> String {
        let base = if sent.is_empty() {
            format!("call_{index}")
        } else {
            sent.to_string()
        };
        let mut id = base.clone();
        let mut n = 2;
        while self.taken.contains(&id) {
            id = format!("{base}~{n}");
            n += 1;
        }
        self.taken.insert(id.clone());
        id
    }
}

/// One tool call under construction while a Chat Completions stream is
/// being read - OpenAI-compatible servers send the id/name in the first
/// fragment and the JSON arguments in pieces after it, all addressed by
/// array index rather than id.
#[derive(Default)]
struct StreamToolCall {
    /// The id the server sent, then (once started) the one it goes by
    /// (CallIds).
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
    reasoning: String,
    calls: Vec<StreamToolCall>,
    error: Option<String>,
    search: SearchReport,
    /// From the chunk that carries it - the last, with `include_usage`.
    usage: Option<StepUsage>,
    ids: CallIds,
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
        if let Some(usage) = chunk.get("usage").and_then(StepUsage::from_openai) {
            self.usage = Some(usage);
        }
        let Some(delta) = chunk
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("delta"))
        else {
            self.search.take(&Value::Null, &chunk);
            return;
        };
        self.search.take(delta, &chunk);

        if let Some(thought) = reasoning_of(delta) {
            if !thought.is_empty() {
                self.reasoning.push_str(thought);
                on_event(ProviderEvent::Thinking(thought));
            }
        }

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
                if !call.started {
                    call.id = id.to_string();
                }
            }
            if let Some(name) = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
            {
                call.name = name.to_string();
            }
            if !call.started && !call.name.is_empty() {
                call.started = true;
                call.id = self.ids.claim(&call.id, index);
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

    fn into_step_result(self, on_event: EventSink<'_>) -> StepResult {
        let mut calls: Vec<AgentTurn> = self
            .calls
            .into_iter()
            .filter(|c| c.started)
            .map(|c| AgentTurn::ToolCall {
                call_id: c.id,
                name: c.name,
                arguments: if c.args.is_empty() {
                    "{}".to_string()
                } else {
                    c.args
                },
                reasoning: None,
            })
            .collect();
        if !calls.is_empty() {
            attach_reasoning(&mut calls, &self.reasoning);
            StepResult::calls_with_text(calls, self.search.cite(&self.text, on_event))
        } else {
            StepResult::Done(self.search.cite(&self.text, on_event))
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
mod call_id_tests {
    use super::*;

    fn chunk(tc: Value) -> String {
        json!({"choices": [{"delta": {"tool_calls": [tc]}}]}).to_string()
    }

    #[test]
    fn a_reused_or_missing_call_id_gets_one_of_its_own() {
        let history = vec![AgentTurn::ToolCall {
            call_id: "call_0".into(),
            name: "propose_edit".into(),
            arguments: "{}".into(),
            reasoning: None,
        }];
        let seen = std::sync::Mutex::new(Vec::new());
        let sink = |e: ProviderEvent<'_>| {
            if let ProviderEvent::ToolStart { call_id, .. }
            | ProviderEvent::ToolArgs { call_id, .. } = e
            {
                seen.lock().unwrap().push(call_id.to_string());
            }
        };
        let mut acc = ChatStreamAccumulator {
            ids: CallIds::from_history(&history),
            ..Default::default()
        };
        // The id the last reply's call had, then a call with none.
        acc.apply(&chunk(json!({"index": 0, "id": "call_0", "function": {"name": "propose_edit", "arguments": ""}})), &sink);
        acc.apply(
            &chunk(json!({"index": 0, "function": {"arguments": "{}"}})),
            &sink,
        );
        acc.apply(
            &chunk(json!({"index": 1, "function": {"name": "propose_edit", "arguments": "{}"}})),
            &sink,
        );
        let StepResult::ToolCalls(calls) = acc.into_step_result(&|_| {}) else {
            panic!("calls");
        };
        let ids: Vec<String> = calls
            .iter()
            .filter_map(|c| match c {
                AgentTurn::ToolCall { call_id, .. } => Some(call_id.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(ids, ["call_0~2", "call_1"]);
        // The stream named them as the result does.
        let seen = seen.into_inner().unwrap();
        assert!(
            seen.iter().all(|id| id == "call_0~2" || id == "call_1"),
            "{seen:?}"
        );
    }
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
            false,
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
            false,
        );
        assert_eq!(text_only[1]["content"], "hi");
    }

    fn call(id: &str, query: &str) -> AgentTurn {
        AgentTurn::ToolCall {
            call_id: id.to_string(),
            name: "search_document".to_string(),
            arguments: format!("{{\"query\":\"{query}\"}}"),
            reasoning: None,
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
            AgentTurn::assistant("done".to_string()),
        ];

        let messages = turns_to_messages("be helpful", &history, false);
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
        let messages = turns_to_messages("rules", &history, false);
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
        let mut before = turns_to_messages("rules", &turns, false);
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
            let after = turns_to_messages("rules", &turns, false);
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
        match parse_agent_response(&message, &SearchReport::default(), &|_| {}) {
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
        match parse_agent_response(&message, &SearchReport::default(), &|_| {}) {
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
                ProviderEvent::Thinking(t) => format!("R:{t}"),
                ProviderEvent::Citation { url, .. } => format!("C:{url}"),
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
        match acc.into_step_result(&|_| {}) {
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
        match acc.into_step_result(&|_| {}) {
            StepResult::ToolCalls(calls) => {
                let AgentTurn::ToolCall {
                    call_id,
                    name,
                    arguments,
                    ..
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

    /// With `include_usage`, the usage comes in a last chunk with no
    /// choices; what the server read from its prompt cache is in it.
    #[test]
    fn chat_stream_reads_the_usage_chunk() {
        let (acc, _) = run_stream(&[
            r#"{"choices":[{"delta":{"content":"Hi"}}],"usage":null}"#,
            r#"{"choices":[],"usage":{"prompt_tokens":6461,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":5944}}}"#,
            "[DONE]",
        ]);
        let usage = acc.usage.expect("the usage chunk was read");
        assert_eq!(
            (
                usage.input_tokens,
                usage.cache_read_input_tokens,
                usage.output_tokens
            ),
            (517, 5944, 2)
        );
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

    /// DeepSeek-style thinking with tools: the reasoning streams as its own
    /// events, never into the reply, and rides on the step's first call.
    #[test]
    fn chat_stream_keeps_reasoning_out_of_the_reply_and_on_the_call() {
        let (acc, events) = run_stream(&[
            r#"{"choices":[{"delta":{"reasoning_content":"Need the "}}]}"#,
            r#"{"choices":[{"delta":{"reasoning_content":"section."}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"read_document","arguments":"{}"}}]}}]}"#,
            "[DONE]",
        ]);
        assert_eq!(
            events,
            vec!["R:Need the ", "R:section.", "S:c1:read_document", "A:c1:{}"]
        );
        let StepResult::ToolCalls(calls) = acc.into_step_result(&|_| {}) else {
            panic!("expected tool calls");
        };
        let AgentTurn::ToolCall { reasoning, .. } = &calls[0] else {
            panic!("expected a ToolCall turn");
        };
        assert_eq!(reasoning.as_ref().unwrap(), "Need the section.");

        // OpenRouter, Groq and Ollama name the field `reasoning`.
        let (acc, events) = run_stream(&[
            r#"{"choices":[{"delta":{"reasoning":"hm"}}]}"#,
            r#"{"choices":[{"delta":{"content":"Yes."}}]}"#,
        ]);
        assert_eq!(events, vec!["R:hm", "T:Yes."]);
        assert!(matches!(acc.into_step_result(&|_| {}), StepResult::Done(t) if t == "Yes."));
    }

    #[test]
    fn a_steps_reasoning_goes_back_only_where_the_provider_wants_it() {
        let history = vec![
            AgentTurn::User {
                text: "q".to_string(),
                images: Vec::new(),
            },
            AgentTurn::ToolCall {
                call_id: "1".to_string(),
                name: "read_document".to_string(),
                arguments: "{}".to_string(),
                reasoning: Some(json!("Need the section.")),
            },
            result("1", "text"),
        ];
        let replayed = turns_to_messages("rules", &history, true);
        assert_eq!(replayed[2]["reasoning_content"], "Need the section.");
        assert_eq!(replayed[2]["tool_calls"][0]["id"], "1");
        let kept = turns_to_messages("rules", &history, false);
        assert!(kept[2].get("reasoning_content").is_none());

        // The non-streaming answer's reasoning lands on the call the same way.
        let StepResult::ToolCalls(calls) = parse_agent_response(
            &json!({
                "reasoning_content": "Look first.",
                "tool_calls": [{"id": "c", "function": {"name": "read_document", "arguments": "{}"}}],
            }),
            &SearchReport::default(),
            &|_| {},
        ) else {
            panic!("expected tool calls");
        };
        assert!(
            matches!(&calls[0], AgentTurn::ToolCall { reasoning: Some(r), .. } if r == "Look first.")
        );
    }

    #[test]
    fn deepseek_deep_thinking_request_shape() {
        let deep = crate::capabilities::plan(
            "deepseek",
            "deepseek-v4-pro",
            crate::capabilities::ThinkingLevel::Deep,
        );
        let body = agent_request_body(
            "deepseek-v4-pro",
            "help",
            &[],
            &[],
            None,
            Vendor::Generic,
            &deep,
        );
        assert_eq!(body["thinking"]["type"], "enabled");
        assert_eq!(body["reasoning_effort"], "high");
        assert!(deep.replay);
    }

    /// The streamed chunks' text, with markers as [k], and the pages
    /// reported.
    fn cited_stream(chunks: &[&str]) -> (String, Vec<String>) {
        let pages = std::sync::Mutex::new(Vec::new());
        let sink = |e: ProviderEvent<'_>| {
            if let ProviderEvent::Citation { url, .. } = e {
                pages.lock().unwrap().push(url.to_string());
            }
        };
        let mut acc = ChatStreamAccumulator::default();
        for chunk in chunks {
            acc.apply(chunk, &sink);
        }
        let StepResult::Done(text) = acc.into_step_result(&sink) else {
            panic!("expected a final answer");
        };
        let text = crate::agent::replace_citation_markers(&text, |k| Some(format!("[{k}]")));
        (text, pages.into_inner().unwrap())
    }

    #[test]
    fn openrouter_annotations_mark_their_links_once_however_often_streamed() {
        let annotation = r#"{"type":"url_citation","url_citation":{"url":"https://a.example/","title":"A","start_index":12,"end_index":43}}"#;
        let (text, pages) = cited_stream(&[
            r#"{"choices":[{"delta":{"content":"Tides turn ("}}]}"#,
            r#"{"choices":[{"delta":{"content":"[a.example](https://a.example/)) daily."}}]}"#,
            &format!(r#"{{"choices":[{{"delta":{{"annotations":[{annotation}]}}}}]}}"#),
            &format!(
                r#"{{"choices":[{{"delta":{{"annotations":[{annotation}]}},"finish_reason":"stop"}}]}}"#
            ),
        ]);
        assert_eq!(text, "Tides turn [1] daily.");
        assert_eq!(pages, ["https://a.example/"]);
    }

    #[test]
    fn zhipu_refs_become_markers_by_their_results() {
        let (text, pages) = cited_stream(&[
            r#"{"web_search":[{"title":"潮汐","link":"https://z.example/1","refer":"ref_1"},{"title":"月相","link":"https://z.example/2","refer":"ref_2"}],"choices":[{"delta":{"content":"每天两次[ref_1]，"}}]}"#,
            r#"{"choices":[{"delta":{"content":"满月最高[来源：ref_2]。[note]"}}]}"#,
        ]);
        assert_eq!(text, "每天两次[1]，满月最高[2]。[note]");
        assert_eq!(pages, ["https://z.example/1", "https://z.example/2"]);
    }

    #[test]
    fn groq_browser_marks_go_and_its_pages_are_reported() {
        let message = json!({
            "role": "assistant",
            "content": "Tides turn twice a day【2†L6-L10】.",
            "executed_tools": [{"type": "browser.search", "search_results": {"results": [{"title": "Tides", "url": "https://g.example/", "content": "…"}]}}],
        });
        let mut report = SearchReport::default();
        report.take(&message, &json!({}));
        let pages = std::sync::Mutex::new(Vec::new());
        let sink = |e: ProviderEvent<'_>| {
            if let ProviderEvent::Citation { url, .. } = e {
                pages.lock().unwrap().push(url.to_string());
            }
        };
        let StepResult::Done(text) = parse_agent_response(&message, &report, &sink) else {
            panic!("expected a final answer");
        };
        assert_eq!(text, "Tides turn twice a day.");
        assert_eq!(pages.into_inner().unwrap(), ["https://g.example/"]);
    }

    #[test]
    fn agent_request_body_adds_each_native_search_shape() {
        let openrouter = agent_request_body(
            "openrouter/auto",
            "help",
            &[],
            &[],
            Some(NativeWebSearch::OpenRouter),
            Vendor::Generic,
            &Thinking::default(),
        );
        assert_eq!(openrouter["tools"][0]["type"], "openrouter:web_search");

        let groq = agent_request_body(
            "openai/gpt-oss-120b",
            "help",
            &[],
            &[],
            Some(NativeWebSearch::Groq),
            Vendor::Generic,
            &Thinking::default(),
        );
        assert_eq!(groq["tools"][0]["type"], "browser_search");

        let qwen = agent_request_body(
            "qwen-plus",
            "help",
            &[],
            &[],
            Some(NativeWebSearch::Qwen),
            Vendor::Generic,
            &Thinking::default(),
        );
        assert_eq!(qwen["enable_search"], true);

        let zhipu = agent_request_body(
            "glm-5.2",
            "help",
            &[],
            &[],
            Some(NativeWebSearch::Zhipu),
            Vendor::Generic,
            &Thinking::default(),
        );
        assert_eq!(zhipu["tools"][0]["type"], "web_search");
        assert_eq!(zhipu["tools"][0]["web_search"]["enable"], true);
    }

    #[test]
    fn ark_agent_steps_lift_the_4096_token_answer_cap_and_keep_thinking() {
        let tools = [ToolSpec {
            name: "propose_edit".into(),
            description: "edit".into(),
            parameters: json!({"type": "object"}),
        }];
        let ark = agent_request_body(
            "doubao-seed-2-1-pro-260628",
            "help",
            &[],
            &tools,
            None,
            Vendor::Ark,
            &Thinking::default(),
        );
        assert_eq!(ark["max_tokens"], ARK_AGENT_MAX_TOKENS);
        assert_eq!(ark["tools"][0]["function"]["name"], "propose_edit");
        assert!(ark.get("reasoning_effort").is_none());
        assert!(ark.get("thinking").is_none());

        let generic = agent_request_body(
            "m",
            "help",
            &[],
            &tools,
            None,
            Vendor::Generic,
            &Thinking::default(),
        );
        assert!(generic.get("max_tokens").is_none());
    }

    #[test]
    fn ark_writing_calls_turn_thinking_down_and_others_send_no_such_field() {
        let ark = serde_json::to_value(completion_request(
            "doubao-seed-2-1-turbo-260628",
            "rules".to_string(),
            "text".to_string(),
            Vendor::Ark,
        ))
        .unwrap();
        assert_eq!(ark["reasoning_effort"], "minimal");
        assert_eq!(ark["messages"][1]["content"], "text");

        let generic = serde_json::to_value(completion_request(
            "m",
            "rules".to_string(),
            "text".to_string(),
            Vendor::Generic,
        ))
        .unwrap();
        assert!(generic.get("reasoning_effort").is_none());
        assert!(generic.get("thinking").is_none());
    }

    #[test]
    fn deepseek_writing_calls_switch_thinking_off() {
        let deepseek = serde_json::to_value(completion_request(
            "deepseek-flash",
            "rules".to_string(),
            "text".to_string(),
            Vendor::DeepSeek,
        ))
        .unwrap();
        assert_eq!(deepseek["thinking"], json!({"type": "disabled"}));
        assert!(deepseek.get("reasoning_effort").is_none());
    }

    /// Without it, MiniMax's thinking would land in the reply as `<think>`.
    #[test]
    fn minimax_keeps_its_thinking_out_of_the_answer() {
        let writing = serde_json::to_value(completion_request(
            "MiniMax-M3.1-Flash",
            "rules".to_string(),
            "text".to_string(),
            Vendor::MiniMax,
        ))
        .unwrap();
        assert_eq!(writing["reasoning_split"], true);
        assert_eq!(writing["reasoning_effort"], "low");
        let agent = agent_request_body(
            "MiniMax-M3",
            "help",
            &[],
            &[],
            None,
            Vendor::MiniMax,
            &Thinking::default(),
        );
        assert_eq!(agent["reasoning_split"], true);
        let generic = serde_json::to_value(completion_request(
            "m",
            "rules".to_string(),
            "text".to_string(),
            Vendor::Generic,
        ))
        .unwrap();
        assert!(generic.get("reasoning_split").is_none());
    }

    /// Ark (like DeepSeek) streams a thinking model's reasoning as
    /// `reasoning_content` before the answer, then an `encrypted_content`
    /// chunk with both empty - none of it is the reply.
    #[test]
    fn chat_stream_leaves_reasoning_out_of_the_reply() {
        let (acc, events) = run_stream(&[
            r#"{"choices":[{"delta":{"role":"assistant","content":"","reasoning_content":"The user wants"}}]}"#,
            r#"{"choices":[{"delta":{"content":"","reasoning_content":" a title."}}]}"#,
            r#"{"choices":[{"delta":{"content":"","reasoning_content":"","encrypted_content":"djF+abc"}}]}"#,
            r#"{"choices":[{"delta":{"content":"Field notes"}}]}"#,
            "[DONE]",
        ]);
        // The reasoning shows as thinking, never as reply text.
        assert_eq!(
            events,
            vec!["R:The user wants", "R: a title.", "T:Field notes"]
        );
        match acc.into_step_result(&|_| {}) {
            StepResult::Done(text) => assert_eq!(text, "Field notes"),
            StepResult::ToolCalls(_) => panic!("expected a final answer"),
        }
    }
}
