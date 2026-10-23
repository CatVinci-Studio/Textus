use aicompat::providers::custom;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
pub struct CustomEndpointConfig {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
}

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("custom_endpoint.json"))
}

/// What the settings page is told about the saved endpoint. The key itself
/// never goes back to the webview - it is a secret like the provider keys,
/// which only ever report whether one is set. `api_key` stays in the shape
/// (always null) so the page's existing type still fits; `has_api_key`
/// says whether one is stored.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct CustomEndpointStatus {
    base_url: String,
    api_key: Option<String>,
    has_api_key: bool,
    model: String,
}

/// Saves the endpoint. A missing key keeps the stored one while the URL
/// stays the same: the settings page no longer gets the key back, so an
/// empty key field on re-save means "unchanged", not "remove it" (clearing
/// the endpoint removes it). Saved for another URL, the old key is dropped
/// rather than sent to the new host with every request (see resolve_key).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn set_custom_endpoint(
    app: AppHandle,
    base_url: String,
    api_key: Option<String>,
    model: String,
) -> Result<(), String> {
    let path = config_file_path(&app)?;
    let api_key = key_for(&app, &base_url, api_key);
    let config = CustomEndpointConfig {
        base_url,
        api_key,
        model,
    };
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    crate::atomic::write_secret_sync(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_custom_endpoint(app: &AppHandle) -> Result<Option<CustomEndpointConfig>, String> {
    let path = config_file_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn custom_endpoint_status(app: AppHandle) -> Result<Option<CustomEndpointStatus>, String> {
    Ok(load_custom_endpoint(&app)?.map(|c| CustomEndpointStatus {
        has_api_key: c.api_key.as_deref().is_some_and(|k| !k.is_empty()),
        api_key: None,
        base_url: c.base_url,
        model: c.model,
    }))
}

/// The key to use with `base_url` - to save it, fetch its models or test
/// it. A stored config that can't be read counts as none: saving over it
/// is how the user repairs it, so it must not fail the save.
fn key_for(app: &AppHandle, base_url: &str, typed: Option<String>) -> Option<String> {
    resolve_key(load_custom_endpoint(app).ok().flatten(), base_url, typed)
}

/// The key typed, else the stored one - but only for the URL it was saved
/// with, so editing the URL to another host and pressing "Fetch models" or
/// "Save" doesn't hand that host the old key.
fn resolve_key(
    stored: Option<CustomEndpointConfig>,
    base_url: &str,
    typed: Option<String>,
) -> Option<String> {
    if let Some(key) = typed.filter(|k| !k.trim().is_empty()) {
        return Some(key);
    }
    stored
        .filter(|c| same_endpoint(&c.base_url, base_url))
        .and_then(|c| c.api_key)
}

fn same_endpoint(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/') == b.trim().trim_end_matches('/')
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn clear_custom_endpoint(app: AppHandle) -> Result<(), String> {
    let path = config_file_path(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn fetch_custom_models(
    app: AppHandle,
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    crate::ai::ensure_on(&app)?;
    let api_key = key_for(&app, &base_url, api_key);
    custom::list_models(&base_url, api_key.as_deref()).await
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn test_custom_endpoint(
    app: AppHandle,
    base_url: String,
    api_key: Option<String>,
) -> Result<(), String> {
    crate::ai::ensure_on(&app)?;
    let api_key = key_for(&app, &base_url, api_key);
    custom::list_models(&base_url, api_key.as_deref())
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoints_match_ignoring_a_trailing_slash_only() {
        assert!(same_endpoint(
            "http://localhost:11434/v1/",
            "http://localhost:11434/v1"
        ));
        assert!(!same_endpoint(
            "http://localhost:11434/v1",
            "https://evil.example/v1"
        ));
    }

    #[test]
    fn the_stored_key_only_goes_to_the_url_it_was_saved_for() {
        let stored = || {
            Some(CustomEndpointConfig {
                base_url: "https://api.example/v1".to_string(),
                api_key: Some("sk-stored".to_string()),
                model: "m".to_string(),
            })
        };
        // Re-saved or tested with the key field left blank.
        assert_eq!(
            resolve_key(stored(), "https://api.example/v1/", None).as_deref(),
            Some("sk-stored")
        );
        assert_eq!(
            resolve_key(stored(), "https://api.example/v1", Some(" ".into())).as_deref(),
            Some("sk-stored")
        );
        // Moved to another host: the old key stays behind.
        assert_eq!(resolve_key(stored(), "http://other.example/v1", None), None);
        // A typed key always wins; nothing stored means no key.
        assert_eq!(
            resolve_key(stored(), "http://other.example/v1", Some("sk-new".into())).as_deref(),
            Some("sk-new")
        );
        assert_eq!(resolve_key(None, "https://api.example/v1", None), None);
    }
}
