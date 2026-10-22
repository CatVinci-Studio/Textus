//! A single message with no tools, and the models the account lists.

use super::*;

#[derive(Serialize)]
pub(crate) struct SystemBlock {
    #[serde(rename = "type")]
    pub(crate) kind: &'static str,
    pub(crate) text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cache_control: Option<Value>,
}

#[derive(Serialize)]
pub(crate) struct Message {
    pub(crate) role: &'static str,
    pub(crate) content: String,
}

#[derive(Serialize)]
pub(crate) struct MessagesRequest {
    pub(crate) model: String,
    pub(crate) max_tokens: u32,
    pub(crate) system: Vec<SystemBlock>,
    pub(crate) messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) thinking: Option<Value>,
}

#[derive(Deserialize, Default)]
pub(crate) struct ContentBlock {
    #[serde(default)]
    pub(crate) text: Option<String>,
}

#[derive(Deserialize, Default)]
pub(crate) struct ResponseUsage {
    #[serde(default)]
    pub(crate) input_tokens: u64,
    #[serde(default)]
    pub(crate) cache_creation_input_tokens: u64,
    #[serde(default)]
    pub(crate) cache_read_input_tokens: u64,
    #[serde(default)]
    pub(crate) output_tokens: u64,
}

#[derive(Deserialize, Default)]
pub(crate) struct MessagesResponse {
    #[serde(default)]
    pub(crate) content: Vec<ContentBlock>,
    #[serde(default)]
    pub(crate) usage: ResponseUsage,
}

/// The body of a single-call request (completion, grammar check, the
/// one-off writing calls). The system prompt ends in a cache breakpoint:
/// completions fire on every typing pause and grammar checks on every
/// paragraph, each with the same ~1,100 tokens of instructions in front of
/// a few hundred tokens of text, and Haiku 5.5 caches a prefix from 512
/// tokens - so every request after the first in five minutes reads the
/// instructions at a tenth of the price. The user text after the
/// breakpoint changes every time, so it is never marked.
pub(crate) fn completion_request(
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
pub(crate) struct ModelListEntry {
    pub(crate) id: String,
    #[serde(default)]
    pub(crate) created_at: Option<String>,
}

#[derive(Deserialize, Default)]
pub(crate) struct ModelListResponse {
    #[serde(default)]
    pub(crate) data: Vec<ModelListEntry>,
    #[serde(default)]
    pub(crate) has_more: bool,
    #[serde(default)]
    pub(crate) last_id: Option<String>,
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
