use crate::agent::{AgentTurn, EventSink, StepResult, ToolSpec};
use crate::capabilities::Thinking;
use crate::responses_api::{self, extract_response_text, read_streamed_output, ResponsesRequest};

const PUBLIC_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
/// Low-cost default for completion and grammar requests. Agent chat chooses
/// its stronger default from the provider catalog.
pub const PUBLIC_API_MODEL: &str = "gpt-6-luna";

/// Standard public OpenAI Responses API, authenticated with a plain user
/// API key rather than Codex OAuth - the fallback path for users who'd
/// rather paste a key than sign in with ChatGPT. `model` overrides
/// PUBLIC_API_MODEL when set.
pub async fn call_completion(
    api_key: &str,
    instructions: String,
    user_text: String,
    model: Option<&str>,
) -> Result<String, String> {
    let body = ResponsesRequest::new(model.unwrap_or(PUBLIC_API_MODEL), instructions, user_text);

    let client = crate::http::client();
    let res = client
        .post(PUBLIC_RESPONSES_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    extract_response_text(res, "OpenAI").await
}

/// Runs one round-trip against the public Responses API with the full turn
/// history and tool definitions - the API-key twin of
/// `openai_codex::agent_step`, same wire format (see `responses_api`), just
/// authenticated with a plain key. Streams (`stream: true`) so text and
/// tool-call fragments surface through `on_event` as they're generated.
#[allow(clippy::too_many_arguments)]
pub async fn agent_step(
    api_key: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    thinking: &Thinking,
    model: &str,
    on_event: EventSink<'_>,
) -> Result<StepResult, String> {
    let body = responses_api::agent_request_body(
        model,
        instructions,
        history,
        tools,
        web_search,
        thinking,
        true,
    );

    let client = crate::http::streaming_client();
    let res = client
        .post(PUBLIC_RESPONSES_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let output = read_streamed_output(res, "OpenAI", on_event).await?;
    Ok(responses_api::parse_agent_output(&output))
}
