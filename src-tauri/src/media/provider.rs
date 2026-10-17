use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, future::Future, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
pub struct MediaError {
    pub code: &'static str,
    pub message: String,
}
impl MediaError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

/// Mirrors platform/ipc.ts. No API keys are stored in this shape.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaProviderConfig {
    pub provider: String,
    pub endpoint: String,
    pub model: String,
    pub voice: Option<String>,
}
pub type MediaProviders = BTreeMap<String, MediaProviderConfig>;
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

pub fn credential_id(capability: &str) -> Result<&'static str, MediaError> {
    match capability {
        "stt" => Ok("__media_stt"),
        "tts" => Ok("__media_tts"),
        "image" => Ok("__media_image"),
        _ => Err(MediaError::new("configuration", "Unknown media capability")),
    }
}

pub fn validate_config(config: &MediaProviderConfig) -> Result<(), MediaError> {
    let url = reqwest::Url::parse(&config.endpoint)
        .map_err(|_| MediaError::new("configuration", "Invalid provider endpoint"))?;
    if !matches!(config.provider.as_str(), "openai" | "openai-compatible")
        || config.model.trim().is_empty()
        || config.model.len() > 200
        || !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(MediaError::new("configuration", "Use an HTTP(S) API base URL without credentials, query or fragment, and specify a model"));
    }
    Ok(())
}

fn config_file(app: &AppHandle) -> Result<PathBuf, MediaError> {
    app.path()
        .app_config_dir()
        .map(|p| p.join("media-providers.json"))
        .map_err(|_| MediaError::new("configuration", "Cannot locate media configuration"))
}

pub fn load_config(app: &AppHandle) -> Result<MediaProviders, MediaError> {
    let path = config_file(app)?;
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            MediaError::new(
                "configuration",
                "Media configuration is invalid; save the provider settings again",
            )
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(_) => Err(MediaError::new(
            "configuration",
            "Cannot read media configuration",
        )),
    }
}

#[tauri::command]
pub fn media_provider_status(app: AppHandle) -> Result<MediaProviders, MediaError> {
    load_config(&app)
}

#[tauri::command]
pub fn media_configure_provider(
    app: AppHandle,
    capability: String,
    config: Option<MediaProviderConfig>,
) -> Result<(), MediaError> {
    credential_id(&capability)?;
    if let Some(ref config) = config {
        validate_config(config)?;
    }
    let _guard = CONFIG_LOCK
        .lock()
        .map_err(|_| MediaError::new("configuration", "Media configuration is busy"))?;
    let mut configs = load_config(&app)?;
    if let Some(config) = config {
        configs.insert(capability, config);
    } else {
        configs.remove(&capability);
    }
    let path = config_file(&app)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|_| {
        MediaError::new(
            "configuration",
            "Cannot create media configuration directory",
        )
    })?;
    let bytes = serde_json::to_vec(&configs)
        .map_err(|_| MediaError::new("configuration", "Cannot serialize media configuration"))?;
    crate::atomic::write_secret_sync(&path, bytes)
        .map_err(|_| MediaError::new("configuration", "Cannot save media configuration"))
}

pub fn request(
    app: &AppHandle,
    capability: &str,
    suffix: &str,
) -> Result<(reqwest::RequestBuilder, MediaProviderConfig), MediaError> {
    let config = load_config(app)?.remove(capability).ok_or_else(|| {
        MediaError::new(
            "not_configured",
            format!("Configure the {capability} provider in Settings > Textus AI > Media"),
        )
    })?;
    validate_config(&config)?;
    let key = crate::auth::keys::load_provider_key(app, credential_id(capability)?)
        .map_err(|_| MediaError::new("authentication", "Cannot read the provider credential"))?;
    if config.provider == "openai" && key.as_ref().is_none_or(|k| k.trim().is_empty()) {
        return Err(MediaError::new(
            "not_configured",
            "Add an API key for this media provider",
        ));
    }
    let client = aicompat::http::media_client(if capability == "image" { 180 } else { 120 })
        .map_err(|_| MediaError::new("network", "Cannot create media client"))?;
    let mut request = client.post(format!(
        "{}/{}",
        config.endpoint.trim_end_matches('/'),
        suffix
    ));
    if let Some(key) = key.filter(|k| !k.trim().is_empty()) {
        request = request.bearer_auth(key);
    }
    Ok((request, config))
}

pub fn status_error(status: reqwest::StatusCode) -> MediaError {
    let code = match status.as_u16() {
        401 | 403 => "authentication",
        413 | 429 => "limit",
        _ => "service",
    };
    MediaError::new(
        code,
        format!("Media provider returned HTTP {}", status.as_u16()),
    )
}
pub fn network_error(error: reqwest::Error) -> MediaError {
    if error.is_timeout() {
        MediaError::new("timeout", "Media request timed out")
    } else {
        MediaError::new(
            "network",
            "Media request failed; check the provider endpoint and connection",
        )
    }
}

pub async fn read_response(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, MediaError> {
    if !response.status().is_success() {
        return Err(status_error(response.status()));
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(MediaError::new(
            "limit",
            "Media response exceeds the size limit",
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if bytes.len() + chunk.len() > limit {
            return Err(MediaError::new(
                "limit",
                "Media response exceeds the size limit",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub async fn cancellable<T>(
    request_id: &str,
    timeout: u64,
    future: impl Future<Output = Result<T, MediaError>>,
) -> Result<T, MediaError> {
    if request_id.is_empty() || request_id.len() > 128 {
        return Err(MediaError::new(
            "invalid_request",
            "Invalid media request id",
        ));
    }
    let id = format!("media:{request_id}");
    let receiver = crate::ai::cancel::register(id.clone());
    let result = tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(timeout), future) => result.unwrap_or_else(|_| Err(MediaError::new("timeout", "Media request timed out"))),
        _ = receiver => Err(MediaError::new("cancelled", "Media request cancelled")),
    };
    crate::ai::cancel::unregister(&id);
    result
}

#[tauri::command]
pub fn media_cancel(request_id: String) {
    crate::ai::cancel::ai_cancel(format!("media:{request_id}"));
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn config_rejects_missing_models_and_embedded_credentials() {
        let mut config = MediaProviderConfig {
            provider: "openai-compatible".into(),
            endpoint: "https://example.com/v1".into(),
            model: "whisper-1".into(),
            voice: None,
        };
        assert!(validate_config(&config).is_ok());
        config.endpoint = "https://secret@example.com/v1".into();
        assert!(validate_config(&config).is_err());
        config.endpoint = "https://example.com/v1?key=secret".into();
        assert!(validate_config(&config).is_err());
        config.endpoint = "https://example.com/v1".into();
        config.model.clear();
        assert!(validate_config(&config).is_err());
    }
    #[test]
    fn keeps_credentials_separate_and_maps_status_errors() {
        assert_eq!(credential_id("stt").unwrap(), "__media_stt");
        assert!(credential_id("chat").is_err());
        assert_eq!(
            status_error(reqwest::StatusCode::UNAUTHORIZED).code,
            "authentication"
        );
        assert_eq!(
            status_error(reqwest::StatusCode::TOO_MANY_REQUESTS).code,
            "limit"
        );
    }
    fn local_response(raw: &'static str) -> String {
        use std::io::{Read, Write};
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = server.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut socket, _) = server.accept().unwrap();
            let mut request = [0; 4096];
            let _ = socket.read(&mut request);
            socket.write_all(raw.as_bytes()).unwrap();
        });
        format!("http://{address}")
    }
    #[tokio::test]
    async fn bounds_content_length_and_chunked_response_without_echoing_provider_body() {
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        for response in ["HTTP/1.1 200 OK\r\nContent-Length: 999999\r\nConnection: close\r\n\r\n", "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n8\r\n12345678\r\n0\r\n\r\n"] {
            let response = client.get(local_response(response)).send().await.unwrap();
            assert_eq!(read_response(response, 4).await.unwrap_err().code, "limit");
        }
        let response = client
            .get(local_response(
                "HTTP/1.1 401 Unauthorized\r\nContent-Length: 6\r\nConnection: close\r\n\r\nsecret",
            ))
            .send()
            .await
            .unwrap();
        let error = read_response(response, 100).await.unwrap_err();
        assert_eq!(error.code, "authentication");
        assert!(!error.message.contains("secret"));
    }
    #[tokio::test]
    async fn cancellation_and_timeouts_release_the_request() {
        let cancel = tokio::spawn(async {
            tokio::time::sleep(Duration::from_millis(5)).await;
            media_cancel("test-cancel".into());
        });
        let result = cancellable::<()>("test-cancel", 2, std::future::pending()).await;
        cancel.await.unwrap();
        assert_eq!(result.unwrap_err().code, "cancelled");
        assert!(cancellable("test-cancel", 1, async { Ok(()) })
            .await
            .is_ok());
        assert_eq!(
            cancellable::<()>("timeout-test", 0, std::future::pending())
                .await
                .unwrap_err()
                .code,
            "timeout"
        );
    }
}
