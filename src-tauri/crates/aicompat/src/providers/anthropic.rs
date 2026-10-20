use crate::agent::{AgentTurn, EventSink, ImageAttachment, ProviderEvent, StepResult, ToolSpec};
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
        });
    }
    blocks.push(SystemBlock {
        kind: "text",
        text: instructions,
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
    let model = model.unwrap_or(COMPLETION_MODEL);
    let body = MessagesRequest {
        model: model.to_string(),
        // Room for the longest single-call output (a style profile, a
        // grammar report); short completions never come near it.
        max_tokens: 4096,
        system: system_blocks(instructions, auth),
        messages: vec![Message {
            role: "user",
            content: user_text,
        }],
        // Haiku 5.5 thinks by default, which is latency an inline
        // suggestion can't afford; it accepts `disabled` at its default
        // effort. Only for this model - a user-picked one may reject it
        // (Opus 5.5 does, at every effort).
        thinking: (model == COMPLETION_MODEL).then(|| json!({"type": "disabled"})),
    };

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

fn tool_to_schema(tool: &ToolSpec) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.parameters,
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
            AgentTurn::Assistant { text } => {
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
                        } => {
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
    model: &str,
) -> Value {
    let mut system: Vec<Value> = system_blocks(instructions.to_string(), auth)
        .iter()
        .map(|b| json!({"type": b.kind, "text": b.text}))
        .collect();
    if let Some(last) = system.last_mut() {
        last["cache_control"] = json!({"type": EPHEMERAL});
    }
    let mut tool_schemas = tools.iter().map(tool_to_schema).collect::<Vec<_>>();
    // Claude executes this server tool inside the Messages request. Its
    // server_tool_use/result blocks are intentionally ignored by
    // parse_agent_response; the final cited text blocks are still retained.
    if web_search {
        tool_schemas.push(json!({
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5,
        }));
    }
    json!({
        "model": model,
        // Room for a rewritten section inside one propose_edit call; at
        // 4096 a long rewrite was cut off mid-arguments.
        "max_tokens": AGENT_MAX_TOKENS,
        "stream": true,
        "system": system,
        "messages": messages_with_cache_breakpoints(history),
        "tools": tool_schemas,
        "cache_control": {"type": EPHEMERAL},
    })
}

/// Parses a Messages API `content` block array into a [`StepResult`]: any
/// `tool_use` blocks become tool calls the caller must execute, otherwise
/// the `text` blocks are the model's final answer.
fn parse_agent_response(content: &[Value]) -> StepResult {
    let mut tool_calls = Vec::new();
    let mut text_parts = Vec::new();

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
                });
            }
            Some("text") => {
                if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                    text_parts.push(text.to_string());
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

/// One in-flight content block while a streamed Messages response is being
/// read. Only the kinds parse_agent_response cares about get accumulated;
/// everything else (server_tool_use, web_search results, thinking) stays
/// Ignored, exactly as the non-streaming path ignores those block types.
enum StreamBlock {
    Text(String),
    ToolUse {
        id: String,
        name: String,
        /// input_json_delta fragments, concatenated - parsed once at the end.
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

/// Token accounting for one agent step, as Claude reports it in the
/// stream's message_start / message_delta events. Cache reads are what
/// prompt caching saves - the live eval checks they actually happen.
#[derive(Default, Debug, Clone, Copy)]
pub struct StepUsage {
    pub input_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub output_tokens: u64,
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
                    Some("text") => *self.block_at(index) = StreamBlock::Text(String::new()),
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
                    _ => *self.block_at(index) = StreamBlock::Ignored,
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
                        if let StreamBlock::Text(buf) = self.block_at(index) {
                            buf.push_str(text);
                            on_event(ProviderEvent::Text(text));
                        }
                    }
                    Some("input_json_delta") => {
                        let Some(part) = delta.get("partial_json").and_then(|t| t.as_str()) else {
                            return;
                        };
                        if let StreamBlock::ToolUse { id, args, .. } = self.block_at(index) {
                            args.push_str(part);
                            let call_id = id.clone();
                            on_event(ProviderEvent::ToolArgs {
                                call_id: &call_id,
                                delta: part,
                            });
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

    fn into_content(self) -> Vec<Value> {
        self.blocks
            .into_iter()
            .filter_map(|block| match block {
                StreamBlock::Text(text) => Some(json!({"type": "text", "text": text})),
                StreamBlock::ToolUse { id, name, args } => {
                    let input: Value = serde_json::from_str(&args).unwrap_or_else(|_| json!({}));
                    Some(json!({"type": "tool_use", "id": id, "name": name, "input": input}))
                }
                StreamBlock::Ignored => None,
            })
            .collect()
    }
}

const AGENT_MAX_TOKENS: u32 = 16384;

/// Runs one round-trip against Claude with the full turn history and tool
/// definitions - the Anthropic twin of `openai_codex::agent_step`. Streams
/// (`stream: true`) so text and tool-call fragments surface through
/// `on_event` as they're generated.
pub async fn agent_step(
    auth: &AnthropicAuth,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    model: &str,
    on_event: EventSink<'_>,
) -> Result<StepResult, String> {
    agent_step_with_usage(
        auth,
        instructions,
        history,
        tools,
        web_search,
        model,
        on_event,
    )
    .await
    .map(|(step, _)| step)
}

/// [`agent_step`] plus the step's token usage.
pub async fn agent_step_with_usage(
    auth: &AnthropicAuth,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    model: &str,
    on_event: EventSink<'_>,
) -> Result<(StepResult, StepUsage), String> {
    let body = agent_request_body(auth, instructions, history, tools, web_search, model);

    let client = crate::http::streaming_client();
    let res = apply_auth(client.post(MESSAGES_URL), auth)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

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
            "Claude hit the {AGENT_MAX_TOKENS}-token output limit in the middle of an edit. \
             Try asking for a smaller change at a time."
        ));
    }
    let usage = acc.usage;
    Ok((parse_agent_response(&acc.into_content()), usage))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::ImageAttachment;

    #[test]
    fn turns_to_messages_maps_plain_turns_1_to_1() {
        let history = vec![
            AgentTurn::User {
                text: "hi".to_string(),
                images: Vec::new(),
            },
            AgentTurn::Assistant {
                text: "hello".to_string(),
            },
        ];
        let messages = turns_to_messages(&history);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[0]["content"], "hi");
        assert_eq!(messages[1]["role"], "assistant");
        assert_eq!(messages[1]["content"], "hello");
    }

    #[test]
    fn turns_to_messages_skips_empty_assistant_turns() {
        let history = vec![
            AgentTurn::User {
                text: "hi".to_string(),
                images: Vec::new(),
            },
            AgentTurn::Assistant {
                text: " ".to_string(),
            },
            AgentTurn::User {
                text: "again".to_string(),
                images: Vec::new(),
            },
        ];
        let messages = turns_to_messages(&history);
        assert_eq!(messages.len(), 2);
        assert!(messages.iter().all(|m| m["role"] == "user"));
    }

    /// Two things worth pinning: the base64 source shape Claude requires,
    /// and that a text-only turn keeps its plain-string `content`. The
    /// second matters because it is the shape every request had before
    /// images existed - regressing it would change every conversation, not
    /// just the ones with a picture in them.
    #[test]
    fn images_use_the_base64_source_block_and_text_only_turns_stay_strings() {
        let with_image = turns_to_messages(&[AgentTurn::User {
            text: "what is this?".to_string(),
            images: vec![ImageAttachment {
                name: "chart.png".to_string(),
                mime: "image/png".to_string(),
                data_base64: "AAAA".to_string(),
            }],
        }]);
        assert_eq!(with_image[0]["content"][0]["type"], "image");
        assert_eq!(with_image[0]["content"][0]["source"]["type"], "base64");
        assert_eq!(
            with_image[0]["content"][0]["source"]["media_type"],
            "image/png"
        );
        assert_eq!(with_image[0]["content"][0]["source"]["data"], "AAAA");
        assert_eq!(with_image[0]["content"][1]["text"], "what is this?");

        let text_only = turns_to_messages(&[AgentTurn::User {
            text: "hi".to_string(),
            images: Vec::new(),
        }]);
        assert_eq!(text_only[0]["content"], "hi");
    }

    fn user(text: &str) -> AgentTurn {
        AgentTurn::User {
            text: text.to_string(),
            images: Vec::new(),
        }
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

    fn assistant(text: &str) -> AgentTurn {
        AgentTurn::Assistant {
            text: text.to_string(),
        }
    }

    /// Messages takes image blocks inside a tool_result, so a tool's
    /// images stay with its text - no extra user message.
    #[test]
    fn tool_result_images_ride_inside_the_tool_result() {
        let history = vec![
            call("v", "map"),
            AgentTurn::ToolResult {
                call_id: "v".to_string(),
                output: "Here is map.png.".to_string(),
                images: vec![ImageAttachment {
                    name: "map.png".to_string(),
                    mime: "image/png".to_string(),
                    data_base64: "AAAA".into(),
                }],
            },
            result("w", "plain"),
        ];
        let messages = turns_to_messages(&history);
        assert_eq!(messages.len(), 2);
        let results = messages[1]["content"].as_array().unwrap();
        let blocks = results[0]["content"].as_array().unwrap();
        assert_eq!(blocks[0]["text"], "Here is map.png.");
        assert_eq!(blocks[1]["type"], "image");
        assert_eq!(blocks[1]["source"]["media_type"], "image/png");
        assert_eq!(blocks[1]["source"]["data"], "AAAA");
        // A result without images keeps the plain string.
        assert_eq!(results[1]["content"], "plain");
    }

    #[test]
    fn turns_to_messages_groups_each_steps_tool_calls_into_one_pair() {
        // run_agent_loop records a step as Call1, Call2, Result1, Result2:
        // that step must become exactly one assistant message (both tool_use
        // blocks) followed by one user message (both tool_result blocks), or
        // Claude rejects the request for having consecutive assistant
        // messages. Call3, after a result, is the next step's own pair.
        let history = vec![
            user("do it"),
            call("1", "a"),
            call("2", "b"),
            result("1", "found a"),
            result("2", "found b"),
            call("3", "c"),
            result("3", "found c"),
            assistant("done"),
        ];

        let messages = turns_to_messages(&history);
        // user, assistant(tool_use x2), user(tool_result x2),
        // assistant(tool_use), user(tool_result), assistant
        assert_eq!(messages.len(), 6);

        assert_eq!(messages[1]["role"], "assistant");
        let tool_uses = messages[1]["content"].as_array().unwrap();
        assert_eq!(tool_uses.len(), 2);
        assert_eq!(tool_uses[0]["type"], "tool_use");
        assert_eq!(tool_uses[0]["id"], "1");
        assert_eq!(tool_uses[0]["input"]["query"], "a");
        assert_eq!(tool_uses[1]["id"], "2");

        assert_eq!(messages[2]["role"], "user");
        let tool_results = messages[2]["content"].as_array().unwrap();
        assert_eq!(tool_results.len(), 2);
        assert_eq!(tool_results[0]["type"], "tool_result");
        assert_eq!(tool_results[0]["tool_use_id"], "1");
        assert_eq!(tool_results[0]["content"], "found a");
        assert_eq!(tool_results[1]["tool_use_id"], "2");

        assert_eq!(messages[3]["content"][0]["id"], "3");
        assert_eq!(messages[4]["content"][0]["tool_use_id"], "3");
        assert_eq!(messages[5]["role"], "assistant");
        assert_eq!(messages[5]["content"], "done");
    }

    /// Saved before the loop recorded calls first: Call1, Result1, Call2,
    /// Result2. Each call becomes its own pair - still one result per call
    /// in the message right after it, so the API accepts it.
    #[test]
    fn interleaved_history_replays_as_one_pair_per_call() {
        let history = vec![
            user("do it"),
            call("1", "a"),
            result("1", "found a"),
            call("2", "b"),
            result("2", "found b"),
            assistant("done"),
        ];
        let roles: Vec<_> = turns_to_messages(&history)
            .iter()
            .map(|m| m["role"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            roles,
            [
                "user",
                "assistant",
                "user",
                "assistant",
                "user",
                "assistant"
            ]
        );
    }

    fn api_key() -> AnthropicAuth {
        AnthropicAuth::ApiKey("k".to_string())
    }

    fn body(history: &[AgentTurn]) -> Value {
        agent_request_body(&api_key(), "rules", history, &[], false, "m")
    }

    /// Where the request's cache_control markers sit, as "system/i" and
    /// "messages/i" paths - the top-level automatic one is not listed.
    fn breakpoints(body: &Value) -> Vec<String> {
        let mut found = Vec::new();
        for section in ["system", "messages"] {
            for (i, item) in body[section].as_array().unwrap().iter().enumerate() {
                let blocks = match section {
                    "system" => vec![item.clone()],
                    _ => item["content"].as_array().cloned().unwrap_or_default(),
                };
                if blocks.iter().any(|b| b.get("cache_control").is_some()) {
                    found.push(format!("{section}/{i}"));
                }
            }
        }
        found
    }

    /// The prompt a request sends, without its cache markers: a marked
    /// message's one text block is the plain string it was before marking.
    fn prompt_of(messages: &[Value]) -> Vec<Value> {
        messages
            .iter()
            .map(|m| {
                let mut m = m.clone();
                if let Some(blocks) = m["content"].as_array_mut() {
                    for block in blocks.iter_mut() {
                        block.as_object_mut().unwrap().remove("cache_control");
                    }
                    if let [only] = blocks.as_slice() {
                        if only["type"] == "text" && only.as_object().unwrap().len() == 2 {
                            m["content"] = only["text"].clone();
                        }
                    }
                }
                m
            })
            .collect()
    }

    #[test]
    fn the_request_marks_the_system_prompt_and_the_history_for_caching() {
        // First message: only the system prompt has a history-independent
        // breakpoint; the automatic one covers the rest.
        let first = body(&[user("doc + q1")]);
        assert_eq!(breakpoints(&first), ["system/0"]);
        assert_eq!(first["cache_control"]["type"], "ephemeral");

        // Second: the end of the history too - not the message being sent,
        // which carries the document and is never sent again as it is.
        let second = body(&[user("q1"), assistant("a1"), user("doc + q2")]);
        assert_eq!(breakpoints(&second), ["system/0", "messages/1"]);

        // Third: also the end of the history before the newest exchange.
        // Three explicit markers and the automatic one: the API's limit.
        let third = body(&[
            user("q1"),
            assistant("a1"),
            user("q2"),
            call("1", "a"),
            result("1", "found"),
            assistant("a2"),
            user("doc + q3"),
        ]);
        assert_eq!(
            breakpoints(&third),
            ["system/0", "messages/1", "messages/5"]
        );
        assert!(third["messages"][6]["content"].is_string());

        // An OAuth request's identity block comes first; the marker stays
        // on the last block, so it still covers the whole system prompt.
        let oauth = agent_request_body(
            &AnthropicAuth::Oauth("t".to_string()),
            "rules",
            &[user("q")],
            &[],
            false,
            "m",
        );
        assert_eq!(breakpoints(&oauth), ["system/1"]);
    }

    /// The property the breakpoints rely on, through a whole conversation:
    /// each tool step's prompt starts with the step before it, and each
    /// exchange's starts with the previous exchange's up to the block that
    /// one marked as the end of its history - so every request reads what
    /// the one before it wrote.
    #[test]
    fn every_request_starts_with_what_the_one_before_it_cached() {
        let prompt = |request: &Value| prompt_of(request["messages"].as_array().unwrap());
        // What run_agent_loop sends: the history, the current message with
        // the document, then each step's calls and results.
        let exchange = |history: &[AgentTurn], sent: &str, steps: &[&[AgentTurn]]| {
            let mut turns = history.to_vec();
            turns.push(user(sent));
            let mut requests = vec![body(&turns)];
            for step in steps {
                turns.extend(step.iter().cloned());
                requests.push(body(&turns));
            }
            requests
        };
        let read_then_edit: [&[AgentTurn]; 2] = [
            &[
                call("r1", "a"),
                call("r2", "b"),
                result("r1", "x"),
                result("r2", "y"),
            ],
            &[call("e", "c"), result("e", "Edit proposed")],
        ];
        let first = exchange(&[], "doc + q1", &read_then_edit);
        for step in first.windows(2) {
            let (before, after) = (prompt(&step[0]), prompt(&step[1]));
            assert_eq!(after[..before.len()], before[..]);
            assert_eq!(step[0]["system"], step[1]["system"]);
        }
        // The edit step's pair is its own: the read step's stays as it was.
        assert_eq!(prompt(&first[2]).len(), 5);

        // History keeps each message without its document (agent.rs).
        let mut history = vec![user("q1")];
        history.extend(read_then_edit.iter().flat_map(|s| s.iter().cloned()));
        history.push(assistant("a1"));
        let second = &exchange(&history, "doc' + q2", &[])[0];
        history.extend([user("q2"), assistant("a2")]);
        let third = &exchange(&history, "doc'' + q3", &[])[0];
        // Exchange 2 marks the end of exchange 1; exchange 3 marks that same
        // block (and the end of exchange 2), so it reads what exchange 2
        // wrote there without relying on the lookback.
        assert_eq!(breakpoints(second), ["system/0", "messages/5"]);
        assert_eq!(breakpoints(third), ["system/0", "messages/5", "messages/7"]);
        assert_eq!(prompt(third)[..=5], prompt(second)[..=5]);
        assert_eq!(second["system"], third["system"]);
        assert_eq!(first[0]["system"], second["system"]);
    }

    #[test]
    fn parse_agent_response_prefers_tool_use_over_text() {
        let content = vec![
            json!({"type": "tool_use", "id": "c1", "name": "propose_edit", "input": {"action": "append", "text": "hi"}}),
            json!({"type": "text", "text": "ignored while a tool call is pending"}),
        ];
        match parse_agent_response(&content) {
            StepResult::ToolCalls(calls) => {
                assert_eq!(calls.len(), 1);
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
                let parsed: Value = serde_json::from_str(arguments).unwrap();
                assert_eq!(parsed["action"], "append");
            }
            StepResult::Done(_) => panic!("expected tool calls"),
        }
    }

    /// Feeds SSE data payloads through the accumulator, collecting the
    /// events it reports as "T:text", "S:id:name", "A:id:delta" strings.
    fn run_stream(events: &[Value]) -> (StreamAccumulator, Vec<String>) {
        let reported = std::sync::Mutex::new(Vec::new());
        let sink = |e: ProviderEvent<'_>| {
            reported.lock().unwrap().push(match e {
                ProviderEvent::Text(t) => format!("T:{t}"),
                ProviderEvent::ToolStart { call_id, name } => format!("S:{call_id}:{name}"),
                ProviderEvent::ToolArgs { call_id, delta } => format!("A:{call_id}:{delta}"),
            });
        };
        let mut acc = StreamAccumulator::default();
        for event in events {
            acc.apply(&event.to_string(), &sink);
        }
        let reported = reported.into_inner().unwrap();
        (acc, reported)
    }

    #[test]
    fn stream_accumulator_rebuilds_text_and_tool_use_blocks() {
        let (acc, events) = run_stream(&[
            json!({"type": "message_start"}),
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "I'll "}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "fix that."}}),
            json!({"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "tu_1", "name": "propose_edit"}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"action\":"}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "\"append\",\"text\":\"hi\"}"}}),
            json!({"type": "content_block_stop", "index": 1}),
            json!({"type": "message_stop"}),
        ]);

        assert_eq!(
            events,
            vec![
                "T:I'll ",
                "T:fix that.",
                "S:tu_1:propose_edit",
                "A:tu_1:{\"action\":",
                "A:tu_1:\"append\",\"text\":\"hi\"}",
            ]
        );

        let content = acc.into_content();
        assert_eq!(
            content[0],
            json!({"type": "text", "text": "I'll fix that."})
        );
        assert_eq!(content[1]["type"], "tool_use");
        assert_eq!(content[1]["input"]["action"], "append");
        // The rebuilt content parses exactly like a non-streamed response.
        match parse_agent_response(&content) {
            StepResult::ToolCalls(calls) => assert_eq!(calls.len(), 1),
            StepResult::Done(_) => panic!("expected tool calls"),
        }
    }

    #[test]
    fn stream_accumulator_ignores_server_tool_blocks_and_reports_errors() {
        let (acc, events) = run_stream(&[
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search"}}),
            json!({"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "answer"}}),
            json!({"type": "error", "error": {"type": "overloaded_error", "message": "busy"}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "after error, ignored"}}),
        ]);
        assert_eq!(events, vec!["T:answer"]);
        assert!(acc.error.as_deref().unwrap().contains("overloaded_error"));
    }

    #[test]
    fn parse_agent_response_joins_text_blocks_when_no_tool_use() {
        let content = vec![
            json!({"type": "text", "text": "part one"}),
            json!({"type": "text", "text": "part two"}),
        ];
        match parse_agent_response(&content) {
            StepResult::Done(text) => assert_eq!(text, "part one\npart two"),
            StepResult::ToolCalls(_) => panic!("expected a final answer"),
        }
    }
}
