//! Per-provider API keys, stored together in one 0600 JSON file
//! (`provider_keys.json`, provider id -> key). Replaces the old single-key
//! `api_key.json`, which held only the OpenAI key - that file is migrated in
//! on first read and removed.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn keys_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("provider_keys.json"))
}

fn legacy_openai_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("api_key.json"))
}

fn read_keys(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let path = keys_file_path(app)?;
    let mut keys: HashMap<String, String> = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        parse_or_set_aside(&path, &text)
    } else {
        HashMap::new()
    };

    let legacy = legacy_openai_key_path(app)?;
    if legacy.exists() {
        #[derive(serde::Deserialize)]
        struct LegacyRecord {
            key: String,
        }
        if let Ok(record) =
            serde_json::from_str::<LegacyRecord>(&fs::read_to_string(&legacy).unwrap_or_default())
        {
            keys.entry("openai".to_string()).or_insert(record.key);
            write_keys(app, &keys)?;
        }
        let _ = fs::remove_file(&legacy);
    }

    Ok(keys)
}

/// Parses the keys file; when it doesn't parse, moves it aside and starts
/// from no keys. Failing instead made every key command fail, including
/// the "set key" that would have repaired it - one bad byte locked the user
/// out of every provider until they found and deleted the file by hand.
/// The bad file is kept (`provider_keys.json.corrupt-<n>`) rather than
/// deleted, since it may still hold keys worth copying out.
fn parse_or_set_aside(path: &Path, text: &str) -> HashMap<String, String> {
    match serde_json::from_str(text) {
        Ok(keys) => keys,
        Err(parse_error) => {
            match set_aside(path) {
                Ok(moved) => eprintln!(
                    "provider keys: {} is not valid JSON ({parse_error}); moved it to {}",
                    path.display(),
                    moved.display()
                ),
                Err(e) => eprintln!(
                    "provider keys: {} is not valid JSON ({parse_error}) and could not be moved aside: {e}",
                    path.display()
                ),
            }
            HashMap::new()
        }
    }
}

/// Renames `path` to the first free `<name>.corrupt-<n>` beside it.
fn set_aside(path: &Path) -> std::io::Result<PathBuf> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut n = 1u32;
    loop {
        let candidate = path.with_file_name(format!("{name}.corrupt-{n}"));
        if !candidate.exists() {
            fs::rename(path, &candidate)?;
            return Ok(candidate);
        }
        n += 1;
    }
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

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn set_provider_api_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    let mut keys = read_keys(&app)?;
    keys.insert(provider, key);
    write_keys(&app, &keys)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn provider_api_key_status(app: AppHandle, provider: String) -> Result<bool, String> {
    Ok(read_keys(&app)?.contains_key(&provider))
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn clear_provider_api_key(app: AppHandle, provider: String) -> Result<(), String> {
    let mut keys = read_keys(&app)?;
    if keys.remove(&provider).is_some() {
        write_keys(&app, &keys)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_corrupt_keys_file_is_moved_aside_not_fatal() {
        let dir = std::env::temp_dir().join(format!("textus-keys-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("provider_keys.json");
        // An earlier casualty already holds the first slot.
        fs::write(dir.join("provider_keys.json.corrupt-1"), "old").unwrap();
        fs::write(&path, "{\"openai\": \"sk-").unwrap();

        let keys = parse_or_set_aside(&path, &fs::read_to_string(&path).unwrap());

        assert!(keys.is_empty());
        assert!(!path.exists());
        assert_eq!(
            fs::read_to_string(dir.join("provider_keys.json.corrupt-2")).unwrap(),
            "{\"openai\": \"sk-"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_valid_keys_file_parses() {
        let keys = parse_or_set_aside(Path::new("unused"), r#"{"openai":"sk-1"}"#);
        assert_eq!(keys.get("openai").map(String::as_str), Some("sk-1"));
    }
}
