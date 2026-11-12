//! A provider's account sign-in, one way for every provider: the browser's
//! PKCE login, the credential kept as a secret file in the app's config
//! folder, refreshed once at a time before it lapses. Each provider gives
//! only its endpoints and its credential (claude.rs, openai_codex.rs).

use super::pkce_login::{run_pkce_login, PkceLoginRequest};
use serde::{de::DeserializeOwned, Serialize};
use std::future::Future;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const LOGIN_TIMEOUT_SECS: u64 = 5 * 60;

pub(crate) trait OAuthProvider {
    /// The credential's file, in the app's config folder.
    const FILE: &'static str;
    /// Named on the page the browser shows once signed in.
    const NAME: &'static str;
    const CALLBACK_PORT: u16;
    type Cred: Serialize + DeserializeOwned + Send;

    /// The authorize URL, the PKCE verifier and the state.
    fn authorize() -> Result<(String, String, String), String>;
    fn exchange(
        code: String,
        state: String,
        verifier: String,
    ) -> impl Future<Output = Result<Self::Cred, String>> + Send;
    fn refresh(token: String) -> impl Future<Output = Result<Self::Cred, String>> + Send;
    /// When it lapses (ms since the epoch), and its refresh token.
    fn expires(cred: &Self::Cred) -> i64;
    fn refresh_token(cred: &Self::Cred) -> &str;
    /// Held while a refresh is in flight: the refresh token rotates, so two
    /// at once leave the loser with invalid_grant.
    fn refreshing() -> &'static tokio::sync::Mutex<()>;
}

/// Due for a refresh: a minute's margin, so it doesn't lapse mid-request.
fn expires_soon(expires: i64) -> bool {
    expires - aicompat::pkce::now_ms() < 60_000
}

fn file<P: OAuthProvider>(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(P::FILE))
}

fn save<P: OAuthProvider>(app: &AppHandle, cred: &P::Cred) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cred).map_err(|e| e.to_string())?;
    crate::atomic::write_secret_sync(&file::<P>(app)?, json).map_err(|e| e.to_string())
}

fn load<P: OAuthProvider>(app: &AppHandle) -> Result<Option<P::Cred>, String> {
    Ok(crate::json_file::read_or_set_aside(&file::<P>(app)?))
}

/// Signs in through the browser; `on_url` gets the page to open.
pub(crate) async fn login<P: OAuthProvider>(
    app: &AppHandle,
    on_url: tauri::ipc::Channel<String>,
) -> Result<super::AuthStatus, String> {
    let (authorize_url, verifier, state) = P::authorize()?;
    let code = run_pkce_login(
        app,
        PkceLoginRequest {
            authorize_url,
            callback_port: P::CALLBACK_PORT,
            response_html: aicompat::success_page_html(P::NAME, crate::app_identity::APP_NAME),
            expected_state: state.clone(),
            timeout_secs: LOGIN_TIMEOUT_SECS,
            on_authorize_url: Some(Box::new(move |url| {
                let _ = on_url.send(url.to_string());
            })),
        },
    )
    .await?;
    let credential = P::exchange(code, state, verifier).await?;
    save::<P>(app, &credential)?;
    Ok(super::AuthStatus { configured: true })
}

pub(crate) fn status<P: OAuthProvider>(app: &AppHandle) -> Result<super::AuthStatus, String> {
    Ok(super::AuthStatus {
        configured: load::<P>(app)?.is_some(),
    })
}

/// Whether a sign-in is kept (it may still need refreshing).
pub(crate) fn signed_in<P: OAuthProvider>(app: &AppHandle) -> bool {
    matches!(load::<P>(app), Ok(Some(_)))
}

pub(crate) fn logout<P: OAuthProvider>(app: &AppHandle) -> Result<(), String> {
    match std::fs::remove_file(file::<P>(app)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// A credential good for a request, refreshed first when it is about to
/// lapse; a waiter on another's refresh reads the one it stored.
pub(crate) async fn valid<P: OAuthProvider>(app: &AppHandle) -> Result<P::Cred, String> {
    let cred = load::<P>(app)?.ok_or_else(|| "not logged in".to_string())?;
    if !expires_soon(P::expires(&cred)) {
        return Ok(cred);
    }
    let _refreshing = P::refreshing().lock().await;
    let cred = load::<P>(app)?.ok_or_else(|| "not logged in".to_string())?;
    if !expires_soon(P::expires(&cred)) {
        return Ok(cred);
    }
    let refreshed = P::refresh(P::refresh_token(&cred).to_string()).await?;
    // Signed out while it refreshed: stay signed out.
    if load::<P>(app)?.is_none() {
        return Err("not logged in".to_string());
    }
    save::<P>(app, &refreshed)?;
    Ok(refreshed)
}
