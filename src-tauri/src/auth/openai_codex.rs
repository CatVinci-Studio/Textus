//! ChatGPT (Plus/Pro) sign-in, with the Codex CLI's own OAuth client id.

use super::oauth::{self, OAuthProvider};
use aicompat::providers::openai_codex::{self, CodexCredential};
use tauri::AppHandle;

pub(crate) const FILE: &str = "auth-codex.json";

pub(crate) struct ChatGpt;

static REFRESHING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

impl OAuthProvider for ChatGpt {
    const FILE: &'static str = FILE;
    const NAME: &'static str = "ChatGPT";
    const CALLBACK_PORT: u16 = openai_codex::CALLBACK_PORT;
    type Cred = CodexCredential;

    fn authorize() -> Result<(String, String, String), String> {
        openai_codex::build_authorize_request(crate::app_identity::ORIGINATOR)
    }
    async fn exchange(
        code: String,
        _state: String,
        verifier: String,
    ) -> Result<CodexCredential, String> {
        openai_codex::exchange_code(&code, &verifier).await
    }
    async fn refresh(token: String) -> Result<CodexCredential, String> {
        openai_codex::refresh(&token).await
    }
    fn expires(cred: &CodexCredential) -> i64 {
        cred.expires
    }
    fn refresh_token(cred: &CodexCredential) -> &str {
        &cred.refresh
    }
    fn refreshing() -> &'static tokio::sync::Mutex<()> {
        &REFRESHING
    }
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn codex_login(
    app: AppHandle,
    on_url: tauri::ipc::Channel<String>,
) -> Result<super::AuthStatus, String> {
    oauth::login::<ChatGpt>(&app, on_url).await
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn codex_auth_status(app: AppHandle) -> Result<super::AuthStatus, String> {
    oauth::status::<ChatGpt>(&app)
}

/// Whether a ChatGPT sign-in is stored (it may still need refreshing).
pub fn signed_in(app: &AppHandle) -> bool {
    oauth::signed_in::<ChatGpt>(app)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn codex_logout(app: AppHandle) -> Result<(), String> {
    oauth::logout::<ChatGpt>(&app)
}

/// A valid (access token, account id) pair, refreshed first when it is
/// about to lapse.
pub async fn get_valid_credential(app: &AppHandle) -> Result<(String, String), String> {
    let cred = oauth::valid::<ChatGpt>(app).await?;
    Ok((cred.access, cred.account_id))
}
