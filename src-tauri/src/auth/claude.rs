//! Claude (Anthropic Pro/Max) sign-in, against Anthropic's own OAuth client.

use super::oauth::{self, OAuthProvider};
use aicompat::providers::anthropic::{self, ClaudeCredential};
use tauri::AppHandle;

pub(crate) const FILE: &str = "auth-claude.json";

pub(crate) struct Claude;

static REFRESHING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

impl OAuthProvider for Claude {
    const FILE: &'static str = FILE;
    const NAME: &'static str = "Claude";
    const CALLBACK_PORT: u16 = anthropic::CALLBACK_PORT;
    type Cred = ClaudeCredential;

    fn authorize() -> Result<(String, String, String), String> {
        anthropic::build_authorize_request()
    }
    async fn exchange(
        code: String,
        state: String,
        verifier: String,
    ) -> Result<ClaudeCredential, String> {
        anthropic::exchange_code(&code, &state, &verifier).await
    }
    async fn refresh(token: String) -> Result<ClaudeCredential, String> {
        anthropic::refresh(&token).await
    }
    fn expires(cred: &ClaudeCredential) -> i64 {
        cred.expires
    }
    fn refresh_token(cred: &ClaudeCredential) -> &str {
        &cred.refresh
    }
    fn refreshing() -> &'static tokio::sync::Mutex<()> {
        &REFRESHING
    }
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn claude_login(
    app: AppHandle,
    on_url: tauri::ipc::Channel<String>,
) -> Result<super::AuthStatus, String> {
    oauth::login::<Claude>(&app, on_url).await
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn claude_auth_status(app: AppHandle) -> Result<super::AuthStatus, String> {
    oauth::status::<Claude>(&app)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn claude_logout(app: AppHandle) -> Result<(), String> {
    oauth::logout::<Claude>(&app)
}

/// A valid access token, refreshed first when it is about to lapse.
pub async fn get_valid_credential(app: &AppHandle) -> Result<String, String> {
    Ok(oauth::valid::<Claude>(app).await?.access)
}
