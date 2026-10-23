pub use crate::agent::StepUsage;
use crate::agent::{
    AgentTurn, EventSink, ImageAttachment, ProviderEvent, StepCitations, StepResult, ToolSpec,
};
use crate::capabilities::{Thinking, THINKING_BINDING_BETA};
use crate::pkce::{generate_pkce, now_ms};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

mod oauth;
pub use oauth::*;
mod completion;
pub use completion::*;
mod messages;
pub(crate) use messages::*;
mod stream;
pub(crate) use stream::*;

pub const CALLBACK_PORT: u16 = 53692;
pub const REDIRECT_URI: &str = "http://localhost:53692/callback";

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
