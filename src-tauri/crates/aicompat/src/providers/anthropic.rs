pub use crate::agent::StepUsage;
use crate::agent::{
    AgentTurn, EventSink, ImageAttachment, ProviderEvent, StepCitations, StepResult, ToolSpec,
};
use crate::capabilities::{Thinking, THINKING_BINDING_BETA};
use crate::pkce::{generate_pkce, now_ms};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// Values confirmed against earendil-works/pi's anthropic.ts oauth client.
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL: &str = "https://claude.ai/oauth/authorize";
const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
pub const CALLBACK_PORT: u16 = 53692;
pub const REDIRECT_URI: &str = "http://localhost:53692/callback";
const SCOPES: &str =
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
/// Low-cost default for completion and grammar requests. Agent chat chooses
/// its stronger default from the provider catalog.
pub const COMPLETION_MODEL: &str = "claude-haiku-5-5";
const CLAUDE_CODE_IDENTITY: &str = "You are Claude Code, Anthropic's official CLI for Claude.";

#[derive(Serialize, Deserialize, Clone)]
pub struct ClaudeCredential {
    pub access: String,
    pub refresh: String,
    /// ms since epoch
    pub expires: i64,
}

/// The two ways this dialect authenticates. OAuth (Claude Code) tokens are
/// only accepted with the Claude Code identity headers and system prompt
/// they're scoped to; a plain API key uses the standard `x-api-key` header
/// and must NOT claim that identity.
#[derive(Clone)]
pub enum AnthropicAuth {
    Oauth(String),
    ApiKey(String),
}

fn apply_auth(req: reqwest::RequestBuilder, auth: &AnthropicAuth) -> reqwest::RequestBuilder {
    let req = req.header("anthropic-version", "2023-06-01");
    match auth {
        AnthropicAuth::Oauth(token) => req
            .bearer_auth(token)
            .header("anthropic-beta", "claude-code-20250219,oauth-2025-04-20")
            .header("anthropic-dangerous-direct-browser-access", "true")
            .header("user-agent", "claude-cli/1.0.0")
            .header("x-app", "cli"),
        AnthropicAuth::ApiKey(key) => req.header("x-api-key", key),
    }
}

fn system_blocks(instructions: String, auth: &AnthropicAuth) -> Vec<SystemBlock> {
    let mut blocks = Vec::new();
    if matches!(auth, AnthropicAuth::Oauth(_)) {
        blocks.push(SystemBlock {
            kind: "text",
            text: CLAUDE_CODE_IDENTITY.to_string(),
            cache_control: None,
        });
    }
    blocks.push(SystemBlock {
        kind: "text",
        text: instructions,
        cache_control: None,
    });
    blocks
}

/// Builds the browser authorize URL plus the PKCE verifier, which pi's
/// reference implementation reuses as the OAuth `state` value too (unusual,
/// but matches the reference exactly so this login flow actually works).
pub fn build_authorize_request() -> Result<(String, String, String), String> {
    let (verifier, challenge) = generate_pkce();
    let state = verifier.clone();

    let mut authorize_url = url::Url::parse(AUTHORIZE_URL).map_err(|e| e.to_string())?;
    authorize_url
        .query_pairs_mut()
        .append_pair("code", "true")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);

    Ok((authorize_url.to_string(), verifier, state))
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
}

fn credential_from_token(token: TokenResponse) -> ClaudeCredential {
    ClaudeCredential {
        access: token.access_token,
        refresh: token.refresh_token,
        // Reference implementation shaves 5 minutes off to refresh a little early.
        expires: now_ms() + token.expires_in * 1000 - 5 * 60 * 1000,
    }
}

pub async fn exchange_code(
    code: &str,
    state: &str,
    verifier: &str,
) -> Result<ClaudeCredential, String> {
    let client = crate::http::client();
    let res = client
        .post(TOKEN_URL)
        .json(&serde_json::json!({
            "grant_type": "authorization_code",
            "client_id": CLIENT_ID,
            "code": code,
            "state": state,
            "redirect_uri": REDIRECT_URI,
            "code_verifier": verifier,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("token exchange failed ({status}): {body}"));
    }

    Ok(credential_from_token(
        res.json().await.map_err(|e| e.to_string())?,
    ))
}

pub async fn refresh(refresh_token: &str) -> Result<ClaudeCredential, String> {
    let client = crate::http::client();
    let res = client
        .post(TOKEN_URL)
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("token refresh failed ({status}): {body}"));
    }

    Ok(credential_from_token(
        res.json().await.map_err(|e| e.to_string())?,
    ))
}

#[derive(Serialize)]
struct SystemBlock {
    #[serde(rename = "type")]
    kind: &'static str,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<Value>,
}

#[derive(Serialize)]
struct Message {
    role: &'static str,
    content: String,
}

#[derive(Serialize)]
struct MessagesRequest {
    model: String,
    max_tokens: u32,
    system: Vec<SystemBlock>,
    messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<Value>,
}

#[derive(Deserialize, Default)]
struct ContentBlock {
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize, Default)]
struct ResponseUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    cache_creation_input_tokens: u64,
    #[serde(default)]
    cache_read_input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

#[derive(Deserialize, Default)]
struct MessagesResponse {
    #[serde(default)]
    content: Vec<ContentBlock>,
    #[serde(default)]
    usage: ResponseUsage,
}

/// The body of a single-call request (completion, grammar check, the
/// one-off writing calls). The system prompt ends in a cache breakpoint:
/// completions fire on every typing pause and grammar checks on every
/// paragraph, each with the same ~1,100 tokens of instructions in front of
/// a few hundred tokens of text, and Haiku 5.5 caches a prefix from 512
/// tokens - so every request after the first in five minutes reads the
/// instructions at a tenth of the price. The user text after the
/// breakpoint changes every time, so it is never marked.
fn completion_request(
    auth: &AnthropicAuth,
    instructions: String,
    user_text: String,
    model: Option<&str>,
) -> MessagesRequest {
    let model = model.unwrap_or(COMPLETION_MODEL);
    let mut system = system_blocks(instructions, auth);
    if let Some(last) = system.last_mut() {
        last.cache_control = Some(json!({"type": EPHEMERAL}));
    }
    MessagesRequest {
        model: model.to_string(),
        // Room for the longest single-call output (a style profile, a
        // grammar report); short completions never come near it.
        max_tokens: 4096,
        system,
        messages: vec![Message {
            role: "user",
            content: user_text,
        }],
        // Haiku 5.5 thinks by default, which is latency an inline
        // suggestion can't afford; it accepts `disabled` at its default
        // effort. Only for this model - a user-picked one may reject it
        // (Opus 5.5 does, at every effort).
        thinking: (model == COMPLETION_MODEL).then(|| json!({"type": "disabled"})),
    }
}

/// Calls the standard public Anthropic Messages API with either auth kind.
/// `model` overrides COMPLETION_MODEL when set.
pub async fn call_completion(
    auth: &AnthropicAuth,
    instructions: String,
    user_text: String,
    model: Option<&str>,
) -> Result<String, String> {
    call_completion_with_usage(auth, instructions, user_text, model)
        .await
        .map(|(text, _)| text)
}

/// [`call_completion`] plus the request's token usage - what the live eval
/// adds up to know what a run cost.
pub async fn call_completion_with_usage(
    auth: &AnthropicAuth,
    instructions: String,
    user_text: String,
    model: Option<&str>,
) -> Result<(String, StepUsage), String> {
    let body = completion_request(auth, instructions, user_text, model);
    let client = crate::http::client();
    let res = apply_auth(client.post(MESSAGES_URL), auth)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Claude request failed ({status}): {text}"));
    }

    let parsed: MessagesResponse = res.json().await.map_err(|e| e.to_string())?;
    let usage = StepUsage {
        input_tokens: parsed.usage.input_tokens,
        cache_creation_input_tokens: parsed.usage.cache_creation_input_tokens,
        cache_read_input_tokens: parsed.usage.cache_read_input_tokens,
        output_tokens: parsed.usage.output_tokens,
    };
    let text = parsed
        .content
        .into_iter()
        .find_map(|c| c.text)
        .unwrap_or_default();
    Ok((text, usage))
}

#[derive(Deserialize)]
struct ModelListEntry {
    id: String,
    #[serde(default)]
    created_at: Option<String>,
}

#[derive(Deserialize, Default)]
struct ModelListResponse {
    #[serde(default)]
    data: Vec<ModelListEntry>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    last_id: Option<String>,
}

/// Lists available models for the agent model picker in Settings - every
/// page of them (the endpoint returns 20 at a time by default, which
/// silently cut the list short).
pub async fn list_models(auth: &AnthropicAuth) -> Result<Vec<String>, String> {
    let client = crate::http::client();
    let mut entries = Vec::new();
    let mut after: Option<String> = None;
    for _ in 0..10 {
        let mut url = "https://api.anthropic.com/v1/models?limit=100".to_string();
        if let Some(id) = &after {
            url.push_str(&format!("&after_id={id}"));
        }
        let res = apply_auth(client.get(&url), auth)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(format!("Could not list models ({status}): {text}"));
        }
        let page: ModelListResponse = res.json().await.map_err(|e| e.to_string())?;
        entries.extend(page.data.into_iter().map(|m| (m.id, m.created_at)));
        if !page.has_more || page.last_id.is_none() {
            break;
        }
        after = page.last_id;
    }
    Ok(crate::models::tidy(entries))
}

// --- Agentic tool-calling support (the anthropic-messages dialect - see
// `aicompat::agent` for the provider-agnostic loop this feeds).

/// `eager_input_streaming`: the arguments stream as Claude writes them.
/// Without it the API holds each value back until it is whole, so an
/// edit's new text arrived in one piece and a rewrite showed paragraph by
/// paragraph, with nothing between (rc.6). The arguments may then end up
/// invalid JSON - a call that doesn't parse is refused like any other.
fn tool_to_schema(tool: &ToolSpec) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.parameters,
        "eager_input_streaming": true,
    })
}

/// Groups the flat `AgentTurn` history into Messages API turns. This is
/// where the Anthropic dialect genuinely differs from the Responses API one
/// (`responses_api::agent_request_body`, which just emits one item per
/// turn): Messages requires strictly alternating user/assistant roles, so a
/// `ToolCall`/`ToolResult` can't each be their own message the way they are
/// for OpenAI - every `ToolCall` of a step must land in ONE assistant
/// message's `tool_use` blocks, immediately followed by their `ToolResult`s
/// as ONE user message's `tool_result` blocks (matched by id).
/// `run_agent_loop` records a step as its calls, then their results (see
/// agent.rs), so a run of calls and the run of results after it are one
/// step, and a call right after a result starts the next.
///
/// Splitting at steps is also what keeps the prompt cache: merging a later
/// step's calls into the earlier step's message changed that message, so
/// every step re-sent the ones before it uncached. Conversations saved
/// before the loop recorded calls first interleave Call1, Result1, Call2,
/// Result2 - those replay as one pair per call, which is valid and only
/// loses the fact that the calls ran in parallel.
/// An image as a Messages API content block.
fn image_block(image: &ImageAttachment) -> Value {
    json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": image.mime,
            "data": image.data_base64,
        },
    })
}

fn turns_to_messages(history: &[AgentTurn]) -> Vec<Value> {
    let mut messages = Vec::new();
    let mut i = 0;
    while i < history.len() {
        match &history[i] {
            AgentTurn::User { text, images } => {
                // A text-only turn keeps the plain-string `content` shape it
                // always had; only a turn carrying images needs the block
                // form. Same wire meaning, but it keeps the common request
                // byte-identical to what shipped before images existed.
                if images.is_empty() {
                    messages.push(json!({"role": "user", "content": text}));
                } else {
                    let mut content: Vec<Value> = images.iter().map(image_block).collect();
                    content.push(json!({"type": "text", "text": text}));
                    messages.push(json!({"role": "user", "content": content}));
                }
                i += 1;
            }
            AgentTurn::Assistant { text, .. } => {
                // Claude can end a turn with no text (right after tool
                // results, say), but rejects an empty assistant message on
                // replay - and that 400 would then fail every later send in
                // the conversation. The API merges the neighbours left
                // adjacent by skipping it.
                if !text.trim().is_empty() {
                    messages.push(json!({"role": "assistant", "content": text}));
                }
                i += 1;
            }
            AgentTurn::ToolCall { .. } | AgentTurn::ToolResult { .. } => {
                let mut tool_uses = Vec::new();
                let mut tool_results = Vec::new();
                while let Some(turn) = history.get(i) {
                    match turn {
                        // The next step's calls.
                        AgentTurn::ToolCall { .. } if !tool_results.is_empty() => break,
                        AgentTurn::ToolCall {
                            call_id,
                            name,
                            arguments,
                            reasoning,
                        } => {
                            // The step's thinking blocks, ahead of its first
                            // tool_use as Claude wrote them: thinking with
                            // tools needs them back, signatures untouched,
                            // until the step's results are answered.
                            if tool_uses.is_empty() {
                                if let Some(Value::Array(blocks)) = reasoning {
                                    tool_uses.extend(blocks.iter().cloned());
                                }
                            }
                            let input: Value =
                                serde_json::from_str(arguments).unwrap_or_else(|_| json!({}));
                            tool_uses.push(json!({
                                "type": "tool_use",
                                "id": call_id,
                                "name": name,
                                "input": input,
                            }));
                            i += 1;
                        }
                        AgentTurn::ToolResult {
                            call_id,
                            output,
                            images,
                        } => {
                            // A tool_result takes image blocks next to its
                            // text, so a tool's images stay in its result.
                            let content = if images.is_empty() {
                                json!(output)
                            } else {
                                let mut blocks = vec![json!({"type": "text", "text": output})];
                                blocks.extend(images.iter().map(image_block));
                                Value::Array(blocks)
                            };
                            tool_results.push(json!({
                                "type": "tool_result",
                                "tool_use_id": call_id,
                                "content": content,
                            }));
                            i += 1;
                        }
                        _ => break,
                    }
                }
                if !tool_uses.is_empty() {
                    messages.push(json!({"role": "assistant", "content": tool_uses}));
                }
                if !tool_results.is_empty() {
                    messages.push(json!({"role": "user", "content": tool_results}));
                }
            }
        }
    }
    messages
}

const EPHEMERAL: &str = "ephemeral";

/// Makes the last content block of `message` a cache breakpoint. A plain
/// string `content` becomes the one text block it stands for - the same
/// prompt, so the cache entry still matches it once the marker moves on.
fn mark_cache_breakpoint(message: &mut Value) {
    let content = &mut message["content"];
    if let Some(text) = content.as_str() {
        *content = json!([{"type": "text", "text": text}]);
    }
    if let Some(last) = content.as_array_mut().and_then(|blocks| blocks.last_mut()) {
        last["cache_control"] = json!({"type": EPHEMERAL});
    }
}

/// [`turns_to_messages`] with the conversation's two cache breakpoints.
///
/// The message being sent carries the document (agent.rs's request_context)
/// and history later keeps it without, so nothing cached while an exchange
/// ran is ever a prefix of the next exchange's requests. What every later
/// request does share is the history, which agent.rs keeps byte-stable once
/// replayed: the first breakpoint goes on its last block, so this request
/// writes everything up to the message being sent. The second goes on the
/// last block before the newest exchange in that history - exactly where the
/// previous request put its first one - so the cache entry it wrote is read
/// back at a breakpoint of its own, however many blocks the newest exchange
/// added (a breakpoint only looks 20 blocks back for an earlier entry).
fn messages_with_cache_breakpoints(history: &[AgentTurn]) -> Vec<Value> {
    let is_user = |turn: &AgentTurn| matches!(turn, AgentTurn::User { .. });
    let Some(current) = history.iter().rposition(is_user) else {
        return turns_to_messages(history);
    };
    let newest = history[..current].iter().rposition(is_user).unwrap_or(0);
    // Each slice starts at a user turn, which no message spans, so rendering
    // them one by one gives the same messages as rendering them together.
    let mut messages = turns_to_messages(&history[..newest]);
    if let Some(last) = messages.last_mut() {
        mark_cache_breakpoint(last);
    }
    messages.extend(turns_to_messages(&history[newest..current]));
    if let Some(last) = messages.last_mut() {
        mark_cache_breakpoint(last);
    }
    messages.extend(turns_to_messages(&history[current..]));
    messages
}

/// One agent step's Messages API body. Three explicit cache breakpoints
/// plus the automatic one - the API's limit of four: the last system block
/// (tools render before it, so tools and system prompt are cached together,
/// for every exchange and every conversation in the same project and mode),
/// the two in the history (see [`messages_with_cache_breakpoints`]), and the
/// top-level automatic breakpoint, which follows the end of the request so
/// each tool step (up to 12 per message) reads the step before it -
/// document included - instead of paying for it again.
fn agent_request_body(
    auth: &AnthropicAuth,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    thinking: &Thinking,
    model: &str,
) -> (Value, bool) {
    let mut system: Vec<Value> = system_blocks(instructions.to_string(), auth)
        .iter()
        .map(|b| json!({"type": b.kind, "text": b.text}))
        .collect();
    if let Some(last) = system.last_mut() {
        last["cache_control"] = json!({"type": EPHEMERAL});
    }
    let mut tool_schemas = tools.iter().map(tool_to_schema).collect::<Vec<_>>();
    // Claude executes this server tool inside the Messages request: its
    // server_tool_use and result blocks are replayed only to continue a
    // paused turn (agent_step_with_usage), and the citations on the text
    // blocks become the reply's sources (parse_agent_response). The 2026
    // versions route the search through code execution by default; this
    // one searches directly, on every model.
    if web_search {
        tool_schemas.push(json!({
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5,
        }));
    }
    let mut body = json!({
        "model": model,
        // Room for a rewritten section inside one propose_edit call; at
        // 4096 a long rewrite was cut off mid-arguments. Deep thinking
        // spends from the same limit, so it gets twice the room.
        "max_tokens": if thinking.show { DEEP_MAX_TOKENS } else { AGENT_MAX_TOKENS },
        "stream": true,
        "system": system,
        "messages": messages_with_cache_breakpoints(history),
        "tools": tool_schemas,
        "cache_control": {"type": EPHEMERAL},
    });
    let binding_beta = thinking.apply_anthropic(&mut body);
    (body, binding_beta)
}

/// Parses a Messages API `content` block array into a [`StepResult`]: any
/// `tool_use` blocks become tool calls the caller must execute, otherwise
/// the `text` blocks are the model's final answer - joined as they stand:
/// a reply that cites the web comes as many short text blocks, a cited
/// phrase each, and a newline between them broke sentences in two. Text
/// after a search (a server block) starts a new paragraph. Each page a
/// block cites is reported through `on_event` and marked at its end. A tool
/// step's thinking blocks ride on its first call, verbatim, to be sent back
/// with it.
fn parse_agent_response(content: &[Value], on_event: EventSink<'_>) -> StepResult {
    let mut tool_calls = Vec::new();
    let mut text = String::new();
    let mut after_other_block = false;
    let mut citations = StepCitations::default();
    let mut thinking = Vec::new();

    for block in content {
        match block.get("type").and_then(|t| t.as_str()) {
            Some("tool_use") => {
                let call_id = block.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                let name = block
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let arguments = block
                    .get("input")
                    .cloned()
                    .unwrap_or_else(|| json!({}))
                    .to_string();
                tool_calls.push(AgentTurn::ToolCall {
                    call_id: call_id.to_string(),
                    name: name.to_string(),
                    arguments,
                    reasoning: None,
                });
            }
            Some("thinking" | "redacted_thinking") => thinking.push(block.clone()),
            Some("text") => {
                if after_other_block && !text.trim().is_empty() {
                    text.push_str("\n\n");
                }
                after_other_block = false;
                text.push_str(block.get("text").and_then(|t| t.as_str()).unwrap_or(""));
                for citation in block
                    .get("citations")
                    .and_then(|c| c.as_array())
                    .into_iter()
                    .flatten()
                {
                    let Some(url) = citation.get("url").and_then(|u| u.as_str()) else {
                        continue;
                    };
                    let title = citation.get("title").and_then(|t| t.as_str()).unwrap_or("");
                    let marker = citations.cite(url, title, on_event);
                    if !text.ends_with(&marker) {
                        text.push_str(&marker);
                    }
                }
            }
            _ => after_other_block = true,
        }
    }

    if !tool_calls.is_empty() {
        if let (Some(AgentTurn::ToolCall { reasoning, .. }), false) =
            (tool_calls.first_mut(), thinking.is_empty())
        {
            *reasoning = Some(Value::Array(thinking));
        }
        StepResult::calls_with_text(tool_calls, text)
    } else {
        StepResult::Done(text)
    }
}

/// One in-flight content block while a streamed Messages response is being
/// read.
enum StreamBlock {
    Text {
        text: String,
        /// Where a web search result backs the text (citations_delta).
        citations: Vec<Value>,
    },
    /// Readable (or, by default, empty) thinking and the signature that
    /// lets it be sent back.
    Thinking {
        text: String,
        signature: String,
    },
    /// Thinking Claude returned encrypted - sent back as it came.
    Redacted(Value),
    ToolUse {
        id: String,
        name: String,
        /// input_json_delta fragments, concatenated - parsed once at the end.
        args: String,
    },
    /// Any other block - a server_tool_use (web search) and its result -
    /// kept whole, as the API sent it: parse_agent_response doesn't read
    /// them, but a paused turn is continued by sending them back unchanged.
    Other {
        block: Value,
        /// A server_tool_use's input, as input_json_delta fragments.
        args: String,
    },
    Ignored,
}

/// Rebuilds the non-streaming response's `content` array from Messages API
/// SSE events, reporting fragments through `on_event` as they arrive. Kept
/// separate from the HTTP read so the event-to-block bookkeeping is unit
/// testable with plain JSON fixtures.
#[derive(Default)]
struct StreamAccumulator {
    blocks: Vec<StreamBlock>,
    error: Option<String>,
    stop_reason: Option<String>,
    usage: StepUsage,
}

impl StreamAccumulator {
    fn block_at(&mut self, index: usize) -> &mut StreamBlock {
        while self.blocks.len() <= index {
            self.blocks.push(StreamBlock::Ignored);
        }
        &mut self.blocks[index]
    }

    fn apply(&mut self, data: &str, on_event: EventSink<'_>) {
        if self.error.is_some() {
            return;
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            return;
        };
        let index = event.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;

        match event.get("type").and_then(|t| t.as_str()) {
            Some("content_block_start") => {
                let Some(block) = event.get("content_block") else {
                    return;
                };
                match block.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        *self.block_at(index) = StreamBlock::Text {
                            text: String::new(),
                            citations: Vec::new(),
                        }
                    }
                    Some("thinking") => {
                        on_event(ProviderEvent::Thinking(""));
                        let field = |k: &str| {
                            block
                                .get(k)
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string()
                        };
                        *self.block_at(index) = StreamBlock::Thinking {
                            text: field("thinking"),
                            signature: field("signature"),
                        };
                    }
                    Some("redacted_thinking") => {
                        on_event(ProviderEvent::Thinking(""));
                        *self.block_at(index) = StreamBlock::Redacted(block.clone());
                    }
                    Some("tool_use") => {
                        let id = block.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                        let name = block
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default();
                        on_event(ProviderEvent::ToolStart { call_id: id, name });
                        *self.block_at(index) = StreamBlock::ToolUse {
                            id: id.to_string(),
                            name: name.to_string(),
                            args: String::new(),
                        };
                    }
                    _ => {
                        *self.block_at(index) = StreamBlock::Other {
                            block: block.clone(),
                            args: String::new(),
                        }
                    }
                }
            }
            Some("content_block_delta") => {
                let Some(delta) = event.get("delta") else {
                    return;
                };
                match delta.get("type").and_then(|t| t.as_str()) {
                    Some("text_delta") => {
                        let Some(text) = delta.get("text").and_then(|t| t.as_str()) else {
                            return;
                        };
                        if let StreamBlock::Text { text: buf, .. } = self.block_at(index) {
                            buf.push_str(text);
                            on_event(ProviderEvent::Text(text));
                        }
                    }
                    Some("citations_delta") => {
                        if let (Some(citation), StreamBlock::Text { citations, .. }) =
                            (delta.get("citation"), self.block_at(index))
                        {
                            citations.push(citation.clone());
                        }
                    }
                    Some("thinking_delta") => {
                        let Some(part) = delta.get("thinking").and_then(|t| t.as_str()) else {
                            return;
                        };
                        if let StreamBlock::Thinking { text, .. } = self.block_at(index) {
                            text.push_str(part);
                            on_event(ProviderEvent::Thinking(part));
                        }
                    }
                    Some("signature_delta") => {
                        let Some(part) = delta.get("signature").and_then(|t| t.as_str()) else {
                            return;
                        };
                        if let StreamBlock::Thinking { signature, .. } = self.block_at(index) {
                            signature.push_str(part);
                        }
                    }
                    Some("input_json_delta") => {
                        let Some(part) = delta.get("partial_json").and_then(|t| t.as_str()) else {
                            return;
                        };
                        match self.block_at(index) {
                            StreamBlock::ToolUse { id, args, .. } => {
                                args.push_str(part);
                                let call_id = id.clone();
                                on_event(ProviderEvent::ToolArgs {
                                    call_id: &call_id,
                                    delta: part,
                                });
                            }
                            StreamBlock::Other { args, .. } => args.push_str(part),
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
            Some("message_start") => {
                if let Some(usage) = event.pointer("/message/usage") {
                    let n = |k: &str| usage.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
                    self.usage.input_tokens = n("input_tokens");
                    self.usage.cache_creation_input_tokens = n("cache_creation_input_tokens");
                    self.usage.cache_read_input_tokens = n("cache_read_input_tokens");
                }
            }
            Some("message_delta") => {
                if let Some(out) = event
                    .pointer("/usage/output_tokens")
                    .and_then(|v| v.as_u64())
                {
                    self.usage.output_tokens = out;
                }
                if let Some(reason) = event.pointer("/delta/stop_reason").and_then(|r| r.as_str()) {
                    self.stop_reason = Some(reason.to_string());
                }
            }
            Some("error") => {
                let error = event.get("error").cloned().unwrap_or(event.clone());
                self.error = Some(format!("Claude request failed: {error}"));
            }
            _ => {}
        }
    }

    /// The response's content blocks, as the API would have sent them
    /// whole.
    fn into_content(self) -> Vec<Value> {
        self.blocks
            .into_iter()
            .filter_map(|block| match block {
                StreamBlock::Text { text, citations } if citations.is_empty() => {
                    Some(json!({"type": "text", "text": text}))
                }
                StreamBlock::Text { text, citations } => {
                    Some(json!({"type": "text", "text": text, "citations": citations}))
                }
                StreamBlock::Thinking { text, signature } => Some(json!({
                    "type": "thinking",
                    "thinking": text,
                    "signature": signature,
                })),
                StreamBlock::Redacted(block) => Some(block),
                StreamBlock::ToolUse { id, name, args } => {
                    let input: Value = serde_json::from_str(&args).unwrap_or_else(|_| json!({}));
                    Some(json!({"type": "tool_use", "id": id, "name": name, "input": input}))
                }
                StreamBlock::Other { mut block, args } => {
                    if !args.is_empty() {
                        block["input"] = serde_json::from_str(&args).unwrap_or_else(|_| json!({}));
                    }
                    Some(block)
                }
                StreamBlock::Ignored => None,
            })
            .collect()
    }
}

const AGENT_MAX_TOKENS: u32 = 16384;
const DEEP_MAX_TOKENS: u32 = 32768;
/// How many times a turn Claude paused (`pause_turn`: a long run of server
/// searches) is continued before what it has so far is taken as the step.
const MAX_PAUSE_CONTINUATIONS: usize = 3;

/// Runs one round-trip against Claude with the full turn history and tool
/// definitions - the Anthropic twin of `openai_codex::agent_step` - and
/// returns the step's token usage with it. Streams (`stream: true`) so text
/// and tool-call fragments surface through `on_event` as they're generated.
///
/// A turn with server searches in it can stop at `pause_turn`, part-way:
/// taken as the answer, that left a reply that ended mid-research. It is
/// continued the way the API asks - the same request with what Claude sent
/// so far as the last, assistant message - and the parts make the step.
#[allow(clippy::too_many_arguments)]
pub async fn agent_step(
    auth: &AnthropicAuth,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    thinking: &Thinking,
    model: &str,
    on_event: EventSink<'_>,
) -> Result<(StepResult, StepUsage), String> {
    let mut content: Vec<Value> = Vec::new();
    let mut usage = StepUsage::default();
    for round in 0..=MAX_PAUSE_CONTINUATIONS {
        let (mut body, binding_beta) = agent_request_body(
            auth,
            instructions,
            history,
            tools,
            web_search,
            thinking,
            model,
        );
        if !content.is_empty() {
            if let Some(messages) = body["messages"].as_array_mut() {
                messages.push(json!({"role": "assistant", "content": content.clone()}));
            }
        }
        let max_tokens = body["max_tokens"].as_u64().unwrap_or_default();

        let client = crate::http::streaming_client();
        let mut req = apply_auth(client.post(MESSAGES_URL), auth);
        if binding_beta {
            // OAuth requests already carry an anthropic-beta list; a second
            // header of the same name is joined to it.
            req = req.header("anthropic-beta", THINKING_BINDING_BETA);
        }
        let res = req.json(&body).send().await.map_err(|e| e.to_string())?;

        let mut acc = StreamAccumulator::default();
        crate::http::read_sse(res, "Claude", |data| acc.apply(data, on_event)).await?;
        if let Some(error) = acc.error {
            return Err(error);
        }
        // Cut off by the output limit inside a tool call: its arguments are
        // half a JSON object, which would reach the tool as `{}` and send the
        // model round in circles retrying the same oversized call.
        if acc.stop_reason.as_deref() == Some("max_tokens")
            && matches!(acc.blocks.last(), Some(StreamBlock::ToolUse { .. }))
        {
            return Err(format!(
                "Claude hit the {max_tokens}-token output limit in the middle of an edit. \
                 Try asking for a smaller change at a time."
            ));
        }
        usage.add(acc.usage);
        let paused = acc.stop_reason.as_deref() == Some("pause_turn");
        content.extend(acc.into_content());
        if !paused || round == MAX_PAUSE_CONTINUATIONS {
            break;
        }
    }
    Ok((parse_agent_response(&content, on_event), usage))
}

#[cfg(test)]
mod tests;
