//! A plugin's requests to the hosts it was granted (`network:<host>`). Each
//! plugin keeps one client, so its connections stay open between requests
//! (no new TLS handshake each time) and HTTP/2 carries several at once; a
//! request given a `cancelId` stops when the plugin cancels it.

use super::access::{refused, running, url_allowed};
use super::state;
use crate::locks::locked;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tokio::sync::oneshot;

/// The most a response may be.
const MAX_HTTP_BYTES: usize = 32 * 1024 * 1024;

#[derive(Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    url: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    /// Text, or base64 with `body_base64`.
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    body_base64: bool,
    /// The plugin's name for this request, to cancel it by.
    #[serde(default)]
    cancel_id: Option<String>,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    /// The body, base64.
    body: String,
}

/// A plugin's client, built for the grants and proxy it has now.
struct Kept {
    granted: Vec<String>,
    proxy: Option<String>,
    client: reqwest::Client,
}

static CLIENTS: LazyLock<Mutex<HashMap<String, Kept>>> = LazyLock::new(Default::default);
/// The requests given a `cancelId`, by plugin and that id; each with its
/// own number, so a later request under the same id never ends this one's.
type Pending = HashMap<(String, String), (u64, oneshot::Sender<()>)>;
static PENDING: LazyLock<Mutex<Pending>> = LazyLock::new(Default::default);
static REQUESTS: AtomicU64 = AtomicU64::new(0);

/// The plugin's client; a new one once its grants or the proxy change.
fn client_for(id: &str, granted: &[String]) -> Result<reqwest::Client, String> {
    let proxy = aicompat::http::proxy_url();
    let mut clients = locked(&CLIENTS);
    if let Some(kept) = clients.get(id) {
        if kept.granted == granted && kept.proxy == proxy {
            return Ok(kept.client.clone());
        }
    }
    // A redirect must stay within what was granted too.
    let redirect_grants = granted.to_vec();
    let client = crate::net::public_client(Duration::from_secs(10), Duration::from_secs(60))?
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() > 5 || !url_allowed(&redirect_grants, attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    clients.insert(
        id.to_string(),
        Kept {
            granted: granted.to_vec(),
            proxy,
            client: client.clone(),
        },
    );
    Ok(client)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_http(
    app: tauri::AppHandle,
    id: String,
    request: HttpRequest,
) -> Result<HttpResponse, String> {
    let state = state::read(&app);
    running(&state, &id)?;
    let granted = state
        .plugins
        .get(&id)
        .map(|p| p.granted.clone())
        .unwrap_or_default();
    let cancel_id = request.cancel_id.clone();
    cancellable(&id, cancel_id, send(&id, &granted, request)).await
}

/// `work`, or "cancelled" as soon as the plugin cancels `cancel_id`
/// (plugin_http_cancel): a request, or a call to the AI model.
pub(super) async fn cancellable<T>(
    id: &str,
    cancel_id: Option<String>,
    work: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let Some(cancel_id) = cancel_id else {
        return work.await;
    };
    let key = (id.to_string(), cancel_id);
    let (cancel, cancelled) = oneshot::channel();
    let own = REQUESTS.fetch_add(1, Ordering::Relaxed);
    locked(&PENDING).insert(key.clone(), (own, cancel));
    let answer = tokio::select! {
        answer = work => answer,
        // Only a cancel sent: a sender dropped for another request isn't one.
        Ok(()) = cancelled => Err("cancelled".to_string()),
    };
    let mut pending = locked(&PENDING);
    if pending.get(&key).is_some_and(|(n, _)| *n == own) {
        pending.remove(&key);
    }
    answer
}

/// Stops the plugin's request named `cancel_id`, if it is still going: its
/// connection is dropped and `plugin_http` answers "cancelled".
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_http_cancel(id: String, cancel_id: String) {
    if let Some((_, cancel)) = locked(&PENDING).remove(&(id, cancel_id)) {
        let _ = cancel.send(());
    }
}

async fn send(id: &str, granted: &[String], request: HttpRequest) -> Result<HttpResponse, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let url = reqwest::Url::parse(&request.url).map_err(|e| e.to_string())?;
    if !url_allowed(granted, &url) {
        return Err(refused(
            id,
            &format!("network:{}", url.host_str().unwrap_or("")),
        ));
    }
    let method = reqwest::Method::from_bytes(
        request
            .method
            .as_deref()
            .unwrap_or("GET")
            .to_ascii_uppercase()
            .as_bytes(),
    )
    .map_err(|e| e.to_string())?;
    let mut builder = client_for(id, granted)?.request(method, url);
    for (name, value) in &request.headers {
        // The plugin is not the user's browser: no cookies of theirs.
        if name.eq_ignore_ascii_case("cookie") {
            continue;
        }
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(if request.body_base64 {
            STANDARD.decode(body).map_err(|e| e.to_string())?
        } else {
            body.into_bytes()
        });
    }
    let response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter(|(name, _)| name.as_str() != "set-cookie")
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
        .collect();
    let body = crate::net::read_limited(response, MAX_HTTP_BYTES)
        .await?
        .ok_or_else(|| "The response is too big.".to_string())?;
    Ok(HttpResponse {
        status,
        headers,
        body: STANDARD.encode(body),
    })
}

#[cfg(test)]
mod tests;
