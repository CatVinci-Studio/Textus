//! Signing in with a Claude subscription: the authorize link, and the
//! code and refresh token exchanged for a credential.

use super::*;

pub(crate) const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

pub(crate) const AUTHORIZE_URL: &str = "https://claude.ai/oauth/authorize";

pub(crate) const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";

pub(crate) const SCOPES: &str =
    "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

/// Builds the browser authorize URL plus the PKCE verifier, which also serves
/// as the OAuth `state` value, as the login flow expects.
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
pub(crate) struct TokenResponse {
    pub(crate) access_token: String,
    pub(crate) refresh_token: String,
    pub(crate) expires_in: i64,
}

pub(crate) fn credential_from_token(token: TokenResponse) -> ClaudeCredential {
    ClaudeCredential {
        access: token.access_token,
        refresh: token.refresh_token,
        // Refresh a little early.
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
