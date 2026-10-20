use crate::agent::{AgentTurn, EventSink, StepResult, StepUsage, ToolSpec};
use crate::capabilities::Thinking;
use crate::responses_api;

fn responses_url(base_url: &str) -> String {
    format!("{}/responses", base_url.trim_end_matches('/'))
}

/// Runs an Agent step against a third-party OpenAI-compatible Responses API.
/// xAI uses this path because its native web search is available on
/// `/responses`, while its `/chat/completions` endpoint does not expose the
/// same server-side tool. Not streamed: the page citations come with the
/// finished output, reported through `on_event`.
#[allow(clippy::too_many_arguments)]
pub async fn agent_step(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    thinking: &Thinking,
    on_event: EventSink<'_>,
) -> Result<(StepResult, Option<StepUsage>), String> {
    let body = responses_api::agent_request_body(
        model,
        instructions,
        history,
        tools,
        web_search,
        thinking,
        false,
    );

    let client = crate::http::client();
    let mut req = client.post(responses_url(base_url)).json(&body);
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Responses API request failed ({status}): {text}"));
    }

    let parsed: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let output = parsed
        .get("output")
        .and_then(|o| o.as_array())
        .cloned()
        .unwrap_or_default();
    let usage = parsed.get("usage").and_then(StepUsage::from_openai);
    Ok((responses_api::parse_agent_output(&output, on_event), usage))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses_url_handles_trailing_slash() {
        assert_eq!(
            responses_url("https://api.x.ai/v1/"),
            "https://api.x.ai/v1/responses"
        );
    }
}
