use crate::agent::{AgentTurn, EventSink, StepResult, StepUsage, ToolSpec};
use crate::capabilities::Thinking;
use crate::responses_api::{self, extract_response_text, ResponsesRequest};

const PUBLIC_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
/// Low-cost default for completion and grammar requests. Agent chat chooses
/// its stronger default from the provider catalog.
pub const PUBLIC_API_MODEL: &str = "gpt-6-luna";

/// Standard public OpenAI Responses API, authenticated with a plain API key
/// rather than Codex OAuth. `model` overrides PUBLIC_API_MODEL when set.
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

/// Runs one streamed round-trip against the public Responses API with the full
/// turn history and tool definitions.
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
) -> Result<(StepResult, Option<StepUsage>), String> {
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

    let (output, usage) = responses_api::read_streamed_response(res, "OpenAI", on_event).await?;
    Ok((responses_api::parse_agent_output(&output, on_event), usage))
}
