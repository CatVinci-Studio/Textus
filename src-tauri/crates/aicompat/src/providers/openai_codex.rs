use crate::agent::{AgentTurn, EventSink, StepResult, ToolSpec};
use crate::capabilities::Thinking;
use crate::pkce::{decode_base64url, generate_pkce, generate_state, now_ms};
use crate::responses_api::{
    self, read_streamed_output, text_from_streamed_output, ResponsesRequest,
};
use serde::{Deserialize, Serialize};

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
pub const CALLBACK_PORT: u16 = 1455;
pub const REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const SCOPE: &str = "openid profile email offline_access";
const JWT_CLAIM_PATH: &str = "https://api.openai.com/auth";

// The Codex OAuth token only works against ChatGPT's backend API (used by
// the chatgpt.com web app and the Codex CLI), not the public
// api.openai.com Responses API. Confirmed against the equivalent open-source
// client implementation (earendil-works/pi).
const CODEX_RESPONSES_URL: &str = "https://chatgpt.com/backend-api/codex/responses";
pub const COMPLETION_MODEL: &str = "gpt-6-luna";

/// The only models the ChatGPT-account backend accepts. Anything else comes
/// back as `400 The '<model>' model is not supported when using Codex with a
/// ChatGPT account` - including models that are perfectly valid on the public
/// API-key endpoint, which is the same provider entry with the other auth
/// method.
///
/// Mirrored by OPENAI_OAUTH_*_MODEL_PRESETS in src/settings/agent-models.ts,
/// which is what the Settings picker offers while this login is active.
pub const SUPPORTED_MODELS: &[&str] = &["gpt-6-astra", "gpt-6.1-sol", "gpt-6-luna"];

/// Clamps a requested model to something this login can actually use.
///
/// The saved model outlives the auth method that was active when it was
/// picked: sign in with an API key, choose `gpt-5.4`, later switch to "sign
/// in with ChatGPT", and every request 400s. Worse, the model can arrive from
/// a settings blob written by an older version and migrated forward
/// (SettingsContext's migrateAgentModels), so the user never chose it at all
/// and has no idea why the agent stopped answering.
///
/// The Settings panel normalizes the stored value too, but only while it is
/// open - which is not where a request's correctness can live.
pub fn usable_model<'a>(requested: Option<&'a str>, fallback: &'a str) -> &'a str {
    match requested {
        Some(model) if SUPPORTED_MODELS.contains(&model) => model,
        _ => fallback,
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CodexCredential {
    pub access: String,
    pub refresh: String,
    /// ms since epoch
    pub expires: i64,
    pub account_id: String,
}

/// Builds the browser authorize URL plus the PKCE verifier and state that
/// must be kept around for the token exchange / callback verification.
/// `originator` identifies the calling app to OpenAI (any short slug works -
/// this mirrors what the Codex CLI itself sends, just naming a different
/// client).
pub fn build_authorize_request(originator: &str) -> Result<(String, String, String), String> {
    let (verifier, challenge) = generate_pkce();
    let state = generate_state();

    let mut authorize_url = url::Url::parse(AUTHORIZE_URL).map_err(|e| e.to_string())?;
    authorize_url
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("id_token_add_organizations", "true")
        .append_pair("codex_cli_simplified_flow", "true")
        .append_pair("originator", originator);

    Ok((authorize_url.to_string(), verifier, state))
}

fn decode_account_id(access_token: &str) -> Option<String> {
    let payload_b64 = access_token.split('.').nth(1)?;
    let payload_bytes = decode_base64url(payload_b64)?;
    let payload: serde_json::Value = serde_json::from_slice(&payload_bytes).ok()?;
    payload
        .get(JWT_CLAIM_PATH)?
        .get("chatgpt_account_id")?
        .as_str()
        .map(|s| s.to_string())
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
}

fn credential_from_token(token: TokenResponse) -> Result<CodexCredential, String> {
    let account_id = decode_account_id(&token.access_token)
        .ok_or_else(|| "failed to extract account id from token".to_string())?;
    Ok(CodexCredential {
        access: token.access_token,
        refresh: token.refresh_token,
        expires: now_ms() + token.expires_in * 1000,
        account_id,
    })
}

pub async fn exchange_code(code: &str, verifier: &str) -> Result<CodexCredential, String> {
    let client = crate::http::client();
    let res = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", CLIENT_ID),
            ("code", code),
            ("code_verifier", verifier),
            ("redirect_uri", REDIRECT_URI),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("token exchange failed ({status}): {body}"));
    }

    credential_from_token(res.json().await.map_err(|e| e.to_string())?)
}

pub async fn refresh(refresh_token: &str) -> Result<CodexCredential, String> {
    let client = crate::http::client();
    let res = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", CLIENT_ID),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("token refresh failed ({status}): {body}"));
    }

    credential_from_token(res.json().await.map_err(|e| e.to_string())?)
}

pub async fn call_completion(
    access_token: &str,
    account_id: &str,
    originator: &str,
    instructions: String,
    user_text: String,
    model: Option<&str>,
) -> Result<String, String> {
    let body = ResponsesRequest::new(
        usable_model(model, COMPLETION_MODEL),
        instructions,
        user_text,
    )
    .streaming();

    let client = crate::http::streaming_client();
    let res = client
        .post(CODEX_RESPONSES_URL)
        .bearer_auth(access_token)
        .header("chatgpt-account-id", account_id)
        .header("originator", originator)
        .header("OpenAI-Beta", "responses=experimental")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let output = read_streamed_output(res, "Codex", &|_| {}).await?;
    Ok(text_from_streamed_output(&output))
}

/// Runs one round-trip against Codex with the full turn history and tool
/// definitions. Returns either the model's final text, or one-or-more tool
/// calls the caller must execute and feed back via `AgentTurn::ToolResult`
/// before calling this again. Request/response shape is shared with every
/// other Responses-API dialect - see `responses_api::agent_request_body` /
/// `parse_agent_output`.
// The authentication headers plus the provider-neutral agent inputs make
// eight arguments at this wire-format boundary. Grouping them would merely
// hide the same values in a one-use transport struct.
#[allow(clippy::too_many_arguments)]
pub async fn agent_step(
    access_token: &str,
    account_id: &str,
    originator: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    thinking: &Thinking,
    model: &str,
    on_event: EventSink<'_>,
) -> Result<StepResult, String> {
    // The ChatGPT backend only serves SSE (streaming: true is mandatory).
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
        .post(CODEX_RESPONSES_URL)
        .bearer_auth(access_token)
        .header("chatgpt-account-id", account_id)
        .header("originator", originator)
        .header("OpenAI-Beta", "responses=experimental")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let output = read_streamed_output(res, "Codex", on_event).await?;
    Ok(responses_api::parse_agent_output(&output))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact failure this guard exists for: a model saved while the
    /// API-key auth method was active (or migrated forward from an older
    /// settings blob) is a hard 400 once the login is a ChatGPT account.
    #[test]
    fn a_model_this_login_cannot_use_falls_back_to_the_default() {
        assert_eq!(usable_model(Some("gpt-5.4"), "gpt-6.1-sol"), "gpt-6.1-sol");
        assert_eq!(
            usable_model(Some("gpt-4o-mini"), "gpt-6.1-sol"),
            "gpt-6.1-sol"
        );
    }

    /// The GPT-5.6 family was the previous preset list; Codex no longer
    /// serves it, so a choice saved by an older version must not survive.
    #[test]
    fn a_retired_preset_falls_back_to_the_default() {
        assert_eq!(
            usable_model(Some("gpt-5.6-terra"), "gpt-6.1-sol"),
            "gpt-6.1-sol"
        );
    }

    #[test]
    fn a_supported_model_is_passed_through() {
        assert_eq!(
            usable_model(Some("gpt-6-astra"), "gpt-6.1-sol"),
            "gpt-6-astra"
        );
    }

    #[test]
    fn no_choice_means_the_default() {
        assert_eq!(usable_model(None, "gpt-6.1-sol"), "gpt-6.1-sol");
    }
}
