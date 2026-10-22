//! A single chat completion with no tools, and the models a server
//! lists.

use super::*;

#[derive(Serialize)]
pub(crate) struct ChatMessage {
    pub(crate) role: &'static str,
    pub(crate) content: String,
}

#[derive(Serialize)]
pub(crate) struct ChatRequest {
    pub(crate) model: String,
    pub(crate) messages: Vec<ChatMessage>,
    /// Ark's and MiniMax's switch for their thinking models - see
    /// [`Vendor::Ark`] and [`Vendor::MiniMax`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reasoning_effort: Option<&'static str>,
    /// DeepSeek's switch - see [`Vendor::DeepSeek`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) thinking: Option<Value>,
    /// MiniMax's - see [`Vendor::MiniMax`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reasoning_split: Option<bool>,
}

#[derive(Deserialize, Default)]
pub(crate) struct ChatChoiceMessage {
    #[serde(default)]
    pub(crate) content: Option<String>,
}

#[derive(Deserialize, Default)]
pub(crate) struct ChatChoice {
    #[serde(default)]
    pub(crate) message: ChatChoiceMessage,
}

#[derive(Deserialize, Default)]
pub(crate) struct ChatResponse {
    #[serde(default)]
    pub(crate) choices: Vec<ChatChoice>,
}

pub(crate) fn completion_request(
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
pub(crate) struct ModelListEntry {
    pub(crate) id: String,
    /// Unix seconds, when the endpoint says (OpenAI and most compatibles).
    #[serde(default)]
    pub(crate) created: Option<i64>,
}

#[derive(Deserialize, Default)]
pub(crate) struct ModelListResponse {
    #[serde(default)]
    pub(crate) data: Vec<ModelListEntry>,
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
