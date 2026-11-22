//! The user's own OpenAI-compatible endpoints: relays, proxies, services the
//! catalog doesn't list. Each is a provider of its own, by id.

use crate::app_dirs::AppDirs;
use aicompat::providers::custom;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

mod store;
pub use store::{is_custom_id, CustomEndpoint};
use store::{Edit, StoredFile};

/// This file, in the app's config folder.
pub(crate) const FILE: &str = "custom_endpoint.json";

fn config_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().own_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(FILE))
}

/// What the settings page is told about one saved endpoint. The key never
/// goes back to the webview; `has_api_key` says whether one is stored.
/// Keep in step with `CustomEndpointConfig` in `src/platform/ipc-auth.ts`.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct CustomEndpointStatus {
    id: String,
    name: String,
    base_url: String,
    has_api_key: bool,
    model: String,
}

pub fn load_custom_endpoints(app: &AppHandle) -> Result<Vec<CustomEndpoint>, String> {
    let path = config_file_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    // A broken one is kept aside: the endpoints are entered again, not stuck.
    Ok(crate::json_file::read_or_set_aside::<StoredFile>(&path)
        .map(StoredFile::into_endpoints)
        .unwrap_or_default())
}

/// The endpoint a provider id names.
pub fn load_custom_endpoint(app: &AppHandle, id: &str) -> Result<Option<CustomEndpoint>, String> {
    Ok(load_custom_endpoints(app)?.into_iter().find(|e| e.id == id))
}

fn write(app: &AppHandle, endpoints: Vec<CustomEndpoint>) -> Result<(), String> {
    let path = config_file_path(app)?;
    if endpoints.is_empty() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    crate::atomic::write_secret_sync(&path, store::to_json(endpoints)?).map_err(|e| e.to_string())
}

#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn custom_endpoints_status(app: AppHandle) -> Result<Vec<CustomEndpointStatus>, String> {
    Ok(load_custom_endpoints(&app)?
        .into_iter()
        .map(|c| CustomEndpointStatus {
            has_api_key: c.api_key.as_deref().is_some_and(|k| !k.is_empty()),
            id: c.id,
            name: c.name,
            base_url: c.base_url,
            model: c.model,
        })
        .collect())
}

/// Saves an endpoint (`id` None: a new one) and returns its id. A missing key
/// keeps the stored one while the URL stays the same; for another URL the old
/// key is dropped rather than sent to the new host.
#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn set_custom_endpoint(
    app: AppHandle,
    id: Option<String>,
    name: String,
    base_url: String,
    api_key: Option<String>,
    model: String,
) -> Result<String, String> {
    let edit = Edit {
        id,
        name,
        base_url,
        api_key,
        model,
    };
    let (endpoints, id) = store::save(load_custom_endpoints(&app)?, edit, store::new_id);
    write(&app, endpoints)?;
    Ok(id)
}

#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn clear_custom_endpoint(app: AppHandle, id: String) -> Result<(), String> {
    let mut endpoints = load_custom_endpoints(&app)?;
    endpoints.retain(|e| e.id != id);
    write(&app, endpoints)
}

/// The models `base_url` lists, asked with the key typed or else the stored
/// key of endpoint `id`, for the URL it was saved with only.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn fetch_custom_models(
    app: AppHandle,
    id: Option<String>,
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    crate::ai::ensure_on(&app)?;
    let stored = match id {
        Some(id) => load_custom_endpoint(&app, &id).ok().flatten(),
        None => None,
    };
    let api_key = store::resolve_key(stored.as_ref(), &base_url, api_key);
    custom::list_models(&base_url, api_key.as_deref()).await
}
