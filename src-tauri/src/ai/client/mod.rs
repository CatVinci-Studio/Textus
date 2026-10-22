use crate::ai::catalog;
use crate::ai::route::{self, OpenaiAuth, NOT_CONFIGURED};
use aicompat::providers::{anthropic, custom, openai_api_key, openai_codex};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

mod completion;
mod grammar;
pub(crate) use completion::*;
pub(crate) use grammar::*;

/// `model` overrides the provider's default model; inline completion always
/// passes `None`, only the agent chat path sets it. Dispatches by dialect -
/// see `catalog::PROVIDER_CATALOG` for which id speaks which dialect, and
/// `ai::route` for how a provider resolves to actual credentials.
pub(crate) async fn call(
    app: &AppHandle,
    provider: &str,
    instructions: String,
    user_text: String,
    model: Option<&str>,
) -> Result<String, String> {
    let entry = catalog::find(provider).ok_or_else(|| format!("unknown provider: {provider}"))?;
    match entry.dialect {
        "openai-responses" => match route::resolve_openai_auth(app).await? {
            OpenaiAuth::Codex {
                access_token,
                account_id,
            } => {
                openai_codex::call_completion(
                    &access_token,
                    &account_id,
                    crate::app_identity::ORIGINATOR,
                    instructions,
                    user_text,
                    model,
                )
                .await
            }
            OpenaiAuth::ApiKey(key) => {
                openai_api_key::call_completion(&key, instructions, user_text, model).await
            }
        },
        "anthropic-messages" => {
            let auth = route::resolve_anthropic_auth(app).await?;
            anthropic::call_completion(&auth, instructions, user_text, model).await
        }
        "openai-chat-completions" => {
            let (base_url, api_key, default_model) =
                route::resolve_chat_completions(app, entry).await?;
            let model = model
                .map(str::to_string)
                .or(default_model)
                .ok_or_else(|| NOT_CONFIGURED.to_string())?;
            custom::call_completion(
                &base_url,
                api_key.as_deref(),
                &model,
                instructions,
                user_text,
                route::chat_vendor(&base_url),
            )
            .await
        }
        other => Err(format!("unhandled dialect: {other}")),
    }
}

/// Live model list for the agent model picker in Settings. "custom" isn't
/// handled here - it already has fetch_custom_models, which also lets the
/// frontend try before saving a config.
#[tauri::command]
pub async fn fetch_agent_models(app: AppHandle, provider: String) -> Result<Vec<String>, String> {
    crate::ai::ensure_on(&app)?;
    let entry = catalog::find(&provider).ok_or_else(|| format!("unknown provider: {provider}"))?;
    if !entry.models_listable {
        return Err(format!(
            "{} doesn't support listing models - pick one from the preset list.",
            entry.label
        ));
    }
    match entry.dialect {
        "anthropic-messages" => {
            let auth = route::resolve_anthropic_auth(&app).await?;
            anthropic::list_models(&auth).await
        }
        // OAuth (Codex) tokens 403 on GET /v1/models ("Missing scopes:
        // api.model.read", a Console/API-key permission Codex tokens don't
        // have) - only the API-key path can list.
        "openai-responses" => {
            let key = crate::auth::keys::load_provider_key(&app, "openai")?
                .ok_or_else(|| NOT_CONFIGURED.to_string())?;
            custom::list_models("https://api.openai.com/v1", Some(&key)).await
        }
        "openai-chat-completions" if provider != "custom" => {
            let key = crate::auth::keys::load_provider_key(&app, &provider)?;
            custom::list_models(
                entry
                    .base_url
                    .expect("chat-completions catalog entries carry a base_url"),
                key.as_deref(),
            )
            .await
        }
        _ => Err(format!("models can't be listed for provider: {provider}")),
    }
}

/// Mirrors the frontend's proxy setting into aicompat's shared HTTP client.
/// Settings live in the frontend's localStorage, which Rust can't read (same
/// mirroring precedent as commands::prefs), so the frontend re-sends this on
/// startup and on every change. Rejects unparseable proxy URLs.
#[tauri::command]
pub fn set_ai_proxy(proxy: Option<String>) -> Result<(), String> {
    aicompat::http::set_proxy(proxy)
}

#[cfg(test)]
mod tests;
