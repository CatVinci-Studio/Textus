//! Turns a catalog entry into actual credentials for a request. Isolates the
//! "which auth method is actually configured" decision so `client.rs` and
//! `agent.rs` only deal in dialects, not per-provider auth special-casing.

use crate::ai::catalog::ProviderCatalogEntry;
use aicompat::capabilities::{NativeSearch, ThinkingLevel};
use aicompat::providers::anthropic::{self, AnthropicAuth};
use aicompat::providers::{custom, openai_api_key, openai_codex, AgentProvider, Endpoint};
use tauri::AppHandle;

pub(crate) const NOT_CONFIGURED: &str =
    "This provider isn't set up yet - configure it in Settings > Textus AI.";

pub enum OpenaiAuth {
    /// Browser "sign in with ChatGPT" - talks to the ChatGPT backend, not
    /// the public API (see `openai_codex`).
    Codex {
        access_token: String,
        account_id: String,
    },
    ApiKey(String),
}

/// OAuth (ChatGPT sign-in) is preferred when both are configured - it's the
/// richer entitlement (Plus/Pro), and it's what a user who did both probably
/// wants active.
pub async fn resolve_openai_auth(app: &AppHandle) -> Result<OpenaiAuth, String> {
    if let Ok((access_token, account_id)) =
        crate::auth::openai_codex::get_valid_credential(app).await
    {
        return Ok(OpenaiAuth::Codex {
            access_token,
            account_id,
        });
    }
    let key = crate::auth::keys::load_provider_key(app, "openai")?
        .ok_or_else(|| NOT_CONFIGURED.to_string())?;
    Ok(OpenaiAuth::ApiKey(key))
}

/// Same preference order as `resolve_openai_auth`: OAuth (Claude Pro/Max
/// sign-in) first, falling back to a pasted API key.
pub async fn resolve_anthropic_auth(app: &AppHandle) -> Result<AnthropicAuth, String> {
    if let Ok(access_token) = crate::auth::claude::get_valid_credential(app).await {
        return Ok(AnthropicAuth::Oauth(access_token));
    }
    let key = crate::auth::keys::load_provider_key(app, "anthropic")?
        .ok_or_else(|| NOT_CONFIGURED.to_string())?;
    Ok(AnthropicAuth::ApiKey(key))
}

/// Resolves an `openai-chat-completions` provider to (base_url, api_key,
/// default_model). "custom" is the one id in this dialect with no fixed
/// catalog endpoint - its base_url/key/model are entirely user-supplied.
pub async fn resolve_chat_completions(
    app: &AppHandle,
    entry: &ProviderCatalogEntry,
) -> Result<(String, Option<String>, Option<String>), String> {
    if entry.id == "custom" {
        let config = crate::auth::custom_endpoint::load_custom_endpoint(app)?
            .ok_or_else(|| NOT_CONFIGURED.to_string())?;
        return Ok((config.base_url, config.api_key, Some(config.model)));
    }

    let base_url = entry
        .base_url
        .expect("non-custom chat-completions catalog entries carry a base_url")
        .to_string();
    let key = crate::auth::keys::load_provider_key(app, entry.id)?;
    if key.is_none() && !entry.key_optional {
        return Err(NOT_CONFIGURED.to_string());
    }
    Ok((base_url, key, entry.default_model.map(str::to_string)))
}

/// The provider, credentials and model an agent request runs on - None for
/// a dialect without tool calling, which gets one plain completion
/// (agent.rs's flattened_chat_turn). `model` is the user's Settings choice,
/// or None for the provider's agent default.
pub async fn agent_provider(
    app: &AppHandle,
    entry: &ProviderCatalogEntry,
    model: Option<String>,
    thinking: ThinkingLevel,
    native_search: Option<NativeSearch>,
) -> Result<Option<AgentProvider>, String> {
    let (model, endpoint) = match entry.dialect {
        "openai-responses" => match resolve_openai_auth(app).await? {
            OpenaiAuth::Codex {
                access_token,
                account_id,
            } => (
                // Clamped, not just defaulted: a model saved while the
                // API-key auth method was active is a hard 400 here.
                openai_codex::usable_model(
                    model.as_deref(),
                    entry
                        .agent_default_model
                        .unwrap_or(openai_codex::COMPLETION_MODEL),
                )
                .to_string(),
                Endpoint::Codex {
                    access_token,
                    account_id,
                    originator: crate::app_identity::ORIGINATOR.to_string(),
                },
            ),
            OpenaiAuth::ApiKey(api_key) => (
                model.unwrap_or_else(|| {
                    entry
                        .agent_default_model
                        .unwrap_or(openai_api_key::PUBLIC_API_MODEL)
                        .to_string()
                }),
                Endpoint::OpenaiApiKey { api_key },
            ),
        },
        "anthropic-messages" => {
            let auth = resolve_anthropic_auth(app).await?;
            (
                model.unwrap_or_else(|| {
                    entry
                        .agent_default_model
                        .unwrap_or(anthropic::COMPLETION_MODEL)
                        .to_string()
                }),
                Endpoint::Anthropic { auth },
            )
        }
        "openai-chat-completions" => {
            let (base_url, api_key, default_model) = resolve_chat_completions(app, entry).await?;
            let model = model
                .or_else(|| entry.agent_default_model.map(str::to_string))
                .or(default_model)
                .ok_or_else(|| NOT_CONFIGURED.to_string())?;
            let vendor = chat_vendor(&base_url);
            (
                model,
                Endpoint::ChatCompletions {
                    base_url,
                    api_key,
                    vendor,
                    stream_usage: aicompat::capabilities::provider(entry.id).stream_usage,
                },
            )
        }
        _ => return Ok(None),
    };
    Ok(Some(AgentProvider {
        id: entry.id.to_string(),
        model,
        endpoint,
        thinking,
        native_search,
        enforce_binding: false,
    }))
}

/// Which server a chat-completions base URL points at, for the request
/// fields only it needs. By host rather than catalog id, so a custom
/// endpoint set up with an Ark URL gets them too.
pub fn chat_vendor(base_url: &str) -> custom::Vendor {
    if base_url.contains(".volces.com") {
        custom::Vendor::Ark
    } else {
        custom::Vendor::Generic
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ark_is_recognized_by_host_for_doubao_and_custom_endpoints() {
        let doubao = crate::ai::catalog::find("doubao")
            .and_then(|e| e.base_url)
            .unwrap();
        assert_eq!(chat_vendor(doubao), custom::Vendor::Ark);
        assert_eq!(
            chat_vendor("https://ark.cn-shanghai.volces.com/api/v3/"),
            custom::Vendor::Ark
        );
        assert_eq!(
            chat_vendor("https://api.deepseek.com/v1"),
            custom::Vendor::Generic
        );
    }
}
