//! The user's own OpenAI-compatible endpoints: relays, proxies, services the
//! catalog doesn't list. Each is a provider of its own, by id.

use crate::app_dirs::AppDirs;
use aicompat::providers::custom;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

mod store;
pub use store::{is_custom_id, CustomEndpoint};
use store::{Edit, StoredFile};

/// Sent to every window after a save or a removal, so each reads the list
/// anew. As `CHANGED_EVENT` in `src/ai/custom-endpoints.ts`.
const CHANGED_EVENT: &str = "custom-endpoints-changed";

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
    Ok(read_file(&config_file_path(app)?))
}

fn read_file(path: &Path) -> Vec<CustomEndpoint> {
    if !path.exists() {
        return Vec::new();
    }
    // A broken one is kept aside: the endpoints are entered again, not stuck.
    crate::json_file::read_or_set_aside::<StoredFile>(path)
        .map(StoredFile::into_endpoints)
        .unwrap_or_default()
}

/// The endpoint a provider id names.
pub fn load_custom_endpoint(app: &AppHandle, id: &str) -> Result<Option<CustomEndpoint>, String> {
    Ok(load_custom_endpoints(app)?.into_iter().find(|e| e.id == id))
}

fn write_file(path: &Path, endpoints: Vec<CustomEndpoint>) -> Result<(), String> {
    if endpoints.is_empty() {
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    crate::atomic::write_secret_sync(path, store::to_json(endpoints)?).map_err(|e| e.to_string())
}

/// One change at a time: two saves at once would each drop the other's
/// endpoint, and its key.
static WRITING: Mutex<()> = Mutex::new(());

/// Reads the endpoints at `path`, changes them and writes them back, as one
/// step.
fn update_file<T>(
    path: &Path,
    change: impl FnOnce(Vec<CustomEndpoint>) -> (Vec<CustomEndpoint>, T),
) -> Result<T, String> {
    let _guard = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let (endpoints, out) = change(read_file(path));
    write_file(path, endpoints)?;
    Ok(out)
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
    let id = update_file(&config_file_path(&app)?, |endpoints| {
        store::save(endpoints, edit, store::new_id)
    })?;
    crate::settings::emit_to_all(&app, CHANGED_EVENT, ());
    Ok(id)
}

#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn clear_custom_endpoint(app: AppHandle, id: String) -> Result<(), String> {
    update_file(&config_file_path(&app)?, |mut endpoints| {
        endpoints.retain(|e| e.id != id);
        (endpoints, ())
    })?;
    crate::settings::emit_to_all(&app, CHANGED_EVENT, ());
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_removals_at_once_keep_every_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE);
        let edit = |i: usize| Edit {
            id: Some(format!("custom:{i}")),
            name: format!("Relay {i}"),
            base_url: format!("https://relay{i}.example/v1"),
            api_key: Some(format!("sk-{i}")),
            model: "m".into(),
        };
        update_file(&path, |e| store::save(e, edit(0), store::new_id)).unwrap();
        std::thread::scope(|s| {
            for i in 1..=24 {
                let path = &path;
                s.spawn(move || {
                    update_file(path, |e| store::save(e, edit(i), store::new_id)).unwrap();
                });
            }
            s.spawn(|| {
                update_file(&path, |mut e| {
                    e.retain(|e| e.id != "custom:0");
                    (e, ())
                })
                .unwrap();
            });
        });
        let kept = read_file(&path);
        assert_eq!(kept.len(), 24);
        assert!(kept.iter().all(|e| e.id != "custom:0"));
        assert!(kept.iter().all(|e| e.api_key.is_some()));
    }
}
