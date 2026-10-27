use super::pkce_login::{run_pkce_login, PkceLoginRequest};
use aicompat::providers::openai_codex::{self, CodexCredential};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const LOGIN_TIMEOUT_SECS: u64 = 5 * 60;

/// Held while a token refresh is in flight (see get_valid_credential).
static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Whether a token expiring at `expires` (ms since the epoch) is due for a
/// refresh: a minute's margin, so it doesn't lapse mid-request.
fn expires_soon(expires: i64) -> bool {
    expires - aicompat::pkce::now_ms() < 60_000
}

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct AuthStatus {
    configured: bool,
    account_id: Option<String>,
}

fn auth_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("auth-codex.json"))
}

fn save_credential(app: &AppHandle, cred: &CodexCredential) -> Result<(), String> {
    let path = auth_file_path(app)?;
    let json = serde_json::to_string_pretty(cred).map_err(|e| e.to_string())?;
    crate::atomic::write_secret_sync(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn load_credential(app: &AppHandle) -> Result<Option<CodexCredential>, String> {
    let path = auth_file_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| e.to_string())
}

/// Runs the Codex (ChatGPT Plus/Pro) OAuth login and stores the credential in
/// the app config dir (0600). Uses the Codex CLI's own OAuth client id.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn codex_login(
    app: AppHandle,
    on_url: tauri::ipc::Channel<String>,
) -> Result<AuthStatus, String> {
    let (authorize_url, verifier, state) =
        openai_codex::build_authorize_request(crate::app_identity::ORIGINATOR)?;

    let code = run_pkce_login(
        &app,
        PkceLoginRequest {
            authorize_url,
            callback_port: openai_codex::CALLBACK_PORT,
            response_html: aicompat::success_page_html("ChatGPT", crate::app_identity::APP_NAME),
            expected_state: state,
            timeout_secs: LOGIN_TIMEOUT_SECS,
            on_authorize_url: Some(Box::new(move |url| {
                let _ = on_url.send(url.to_string());
            })),
        },
    )
    .await?;

    let credential = openai_codex::exchange_code(&code, &verifier).await?;
    let account_id = credential.account_id.clone();
    save_credential(&app, &credential)?;

    Ok(AuthStatus {
        configured: true,
        account_id: Some(account_id),
    })
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn codex_auth_status(app: AppHandle) -> Result<AuthStatus, String> {
    match load_credential(&app)? {
        Some(cred) => Ok(AuthStatus {
            configured: true,
            account_id: Some(cred.account_id),
        }),
        None => Ok(AuthStatus {
            configured: false,
            account_id: None,
        }),
    }
}

/// Whether a ChatGPT sign-in is stored (it may still need refreshing).
pub fn signed_in(app: &AppHandle) -> bool {
    matches!(load_credential(app), Ok(Some(_)))
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn codex_logout(app: AppHandle) -> Result<(), String> {
    let path = auth_file_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Returns a valid (access_token, account_id) pair, refreshing the token
/// first if it's expired or close to expiring.
pub async fn get_valid_credential(app: &AppHandle) -> Result<(String, String), String> {
    let cred = load_credential(app)?.ok_or_else(|| "not logged in".to_string())?;

    if !expires_soon(cred.expires) {
        return Ok((cred.access, cred.account_id));
    }

    // One refresh at a time: the refresh token rotates, so two racing requests
    // leave the loser with invalid_grant. A waiter re-reads the stored token.
    let _refreshing = REFRESH_LOCK.lock().await;
    let cred = load_credential(app)?.ok_or_else(|| "not logged in".to_string())?;
    if !expires_soon(cred.expires) {
        return Ok((cred.access, cred.account_id));
    }

    let refreshed = openai_codex::refresh(&cred.refresh).await?;
    let access = refreshed.access.clone();
    let account_id = refreshed.account_id.clone();
    save_credential(app, &refreshed)?;
    Ok((access, account_id))
}
