//! Per-provider API keys, stored together in one 0600 JSON file
//! (`provider_keys.json`, provider id -> key).

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// This file, in the app's config folder.
pub(crate) const FILE: &str = "provider_keys.json";

fn keys_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(FILE))
}

fn read_keys(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    Ok(crate::json_file::read_or_set_aside(&keys_file_path(app)?).unwrap_or_default())
}

/// One change at a time: two saves at once would each drop the other's key.
static WRITING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Reads the keys, changes them and writes them back, as one step.
fn update_keys(
    app: &AppHandle,
    change: impl FnOnce(&mut HashMap<String, String>) -> bool,
) -> Result<(), String> {
    let _guard = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let mut keys = read_keys(app)?;
    if change(&mut keys) {
        write_keys(app, &keys)?;
    }
    Ok(())
}

fn write_keys(app: &AppHandle, keys: &HashMap<String, String>) -> Result<(), String> {
    let path = keys_file_path(app)?;
    let json = serde_json::to_string(keys).map_err(|e| e.to_string())?;
    crate::atomic::write_secret_sync(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_provider_key(app: &AppHandle, provider: &str) -> Result<Option<String>, String> {
    Ok(read_keys(app)?.get(provider).cloned())
}

#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn set_provider_api_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    update_keys(&app, |keys| {
        keys.insert(provider, key);
        true
    })
}

#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn provider_api_key_status(app: AppHandle, provider: String) -> Result<bool, String> {
    Ok(read_keys(&app)?.contains_key(&provider))
}

#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn clear_provider_api_key(app: AppHandle, provider: String) -> Result<(), String> {
    update_keys(&app, |keys| keys.remove(&provider).is_some())
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_corrupt_sign_in_file_reads_as_signed_out() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth-codex.json");
        std::fs::write(&path, "{").unwrap();
        let cred: Option<aicompat::providers::openai_codex::CodexCredential> =
            crate::json_file::read_or_set_aside(&path);
        assert!(cred.is_none());
        assert!(dir.path().join("auth-codex.json.corrupt-1").exists());
    }
}
