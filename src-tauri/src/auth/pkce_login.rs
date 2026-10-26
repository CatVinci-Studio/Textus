//! The browser half of a PKCE sign-in, shared by every provider: open the
//! sign-in page, wait for the localhost redirect, check `state`, hand back
//! the code. Each provider exchanges the code for tokens itself.

use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// Told a URL (see `PkceLoginRequest::on_authorize_url`).
pub type UrlListener = Box<dyn Fn(&str) + Send + Sync>;

pub struct PkceLoginRequest {
    pub authorize_url: String,
    pub callback_port: u16,
    pub response_html: String,
    pub expected_state: String,
    pub timeout_secs: u64,
    /// Told the sign-in URL first, so the UI can offer it by hand when no
    /// browser comes up.
    pub on_authorize_url: Option<UrlListener>,
}

pub async fn run_pkce_login(app: &AppHandle, req: PkceLoginRequest) -> Result<String, String> {
    let callback_task = wait_for_callback(req.callback_port, req.response_html, req.timeout_secs);

    if let Some(announce) = &req.on_authorize_url {
        announce(&req.authorize_url);
    }
    // Not fatal: the UI shows the link, and the callback still completes.
    if let Err(e) = app.opener().open_url(&req.authorize_url, None::<String>) {
        eprintln!("could not open the browser for sign-in: {e}");
    }

    // Already a full absolute URL: parse it as is.
    let callback_url = callback_task.await?;

    let full_url = reqwest::Url::parse(&callback_url).map_err(|e| e.to_string())?;
    let params: HashMap<_, _> = full_url.query_pairs().collect();

    let returned_state = params.get("state").map(|s| s.as_ref());
    if returned_state != Some(req.expected_state.as_str()) {
        return Err("OAuth state mismatch".to_string());
    }

    params
        .get("code")
        .map(|c| c.to_string())
        .ok_or_else(|| "missing authorization code".to_string())
}

/// Serves the redirect on `port` and returns the full URL it was called
/// with, or fails after `timeout_secs`.
async fn wait_for_callback(
    port: u16,
    response_html: String,
    timeout_secs: u64,
) -> Result<String, String> {
    let (tx, rx) = mpsc::channel::<String>();

    tauri_plugin_oauth::start_with_config(
        tauri_plugin_oauth::OauthConfig {
            ports: Some(vec![port]),
            response: Some(response_html.into()),
            ..Default::default()
        },
        move |url| {
            let _ = tx.send(url);
        },
    )
    .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(timeout_secs)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "login timed out or was cancelled".to_string())
}
