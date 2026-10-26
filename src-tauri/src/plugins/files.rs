//! The plugin API's file calls beyond plain reads and writes (details, a
//! no-overwrite create, a read-then-write that never loses a change), and the
//! plugin's secrets. Each is checked against `state.json`.

use super::access::{inside, refused, require_not_app_data};
use super::{require_id, state};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::Path;
use tauri::Manager;

/// A file's details (textus.files.stat).
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FsStat {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified_ms: Option<f64>,
}

/// The file at `path`, or None when nothing is there.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_stat(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
) -> Result<Option<FsStat>, String> {
    if !state::read(&app).allows(&id, "files.read") {
        return Err(refused(&id, "files.read"));
    }
    let path = inside(Path::new(&root), Path::new(&path))?;
    require_not_app_data(&app, &path)?;
    let Ok(meta) = tokio::fs::metadata(&path).await else {
        return Ok(None);
    };
    Ok(Some(FsStat {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        path: path.to_string_lossy().to_string(),
        is_dir: meta.is_dir(),
        size: meta.len(),
        modified_ms: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64),
    }))
}

/// A new file holding `text`, and the folders it is in; refused when
/// something is there already.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_create(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
    text: String,
) -> Result<(), String> {
    if !state::read(&app).allows(&id, "files.write") {
        return Err(refused(&id, "files.write"));
    }
    let path = inside(Path::new(&root), Path::new(&path))?;
    require_not_app_data(&app, &path)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    // create_new: the check and the creation are one step, so two plugins making
    // the same note can't both win.
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => {
                format!("{} is already there.", path.display())
            }
            _ => e.to_string(),
        })?;
    file.write_all(text.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    file.flush().await.map_err(|e| e.to_string())
}

/// What a read for a change hands over: the text, and a token naming that
/// version of the file, which the write gives back.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct VersionedText {
    text: String,
    token: String,
}

fn token_of(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// A text file and its version; "" and the empty file's version when it isn't
/// there yet.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_read_versioned(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
) -> Result<VersionedText, String> {
    if !state::read(&app).allows(&id, "files.read") {
        return Err(refused(&id, "files.read"));
    }
    let path = inside(Path::new(&root), Path::new(&path))?;
    require_not_app_data(&app, &path)?;
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.to_string()),
    };
    Ok(VersionedText {
        token: token_of(&bytes),
        text: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Writes `text` only if the file is still the version `token` names:
/// false, and nothing written, when it changed since it was read.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_write_if(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
    text: String,
    token: String,
) -> Result<bool, String> {
    if !state::read(&app).allows(&id, "files.write") {
        return Err(refused(&id, "files.write"));
    }
    let path = inside(Path::new(&root), Path::new(&path))?;
    require_not_app_data(&app, &path)?;
    let now = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.to_string()),
    };
    if token_of(&now) != token {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    crate::atomic::write(&path, text.into_bytes())
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

type Secrets = BTreeMap<String, BTreeMap<String, String>>;

/// Every plugin's secrets, in one owner-only file apart from settings and storage.
fn secrets_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("plugin_secrets.json"))
}

fn read_secrets(app: &tauri::AppHandle) -> Result<Secrets, String> {
    let path = secrets_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Secrets::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn write_secrets(app: &tauri::AppHandle, secrets: &Secrets) -> Result<(), String> {
    let json = serde_json::to_string(secrets).map_err(|e| e.to_string())?;
    crate::atomic::write_secret_sync(&secrets_path(app)?, json).map_err(|e| e.to_string())
}

/// One of the plugin's own secrets; it needs no permission, and reaches no
/// other plugin's.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_secret_get(
    app: tauri::AppHandle,
    id: String,
    key: String,
) -> Result<Option<String>, String> {
    require_id(&id)?;
    if !state::read(&app).runs(&id) {
        return Err(format!("{id} is turned off."));
    }
    Ok(read_secrets(&app)?
        .get(&id)
        .and_then(|s| s.get(&key))
        .cloned())
}

/// Keeps a secret of the plugin's; `None` forgets it.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_secret_set(
    app: tauri::AppHandle,
    id: String,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    require_id(&id)?;
    if !state::read(&app).runs(&id) {
        return Err(format!("{id} is turned off."));
    }
    if key.is_empty() || key.len() > 200 {
        return Err("A secret's key is 1 to 200 characters.".into());
    }
    let mut secrets = read_secrets(&app)?;
    match value {
        Some(value) => {
            secrets.entry(id).or_default().insert(key, value);
        }
        None => {
            if let Some(own) = secrets.get_mut(&id) {
                own.remove(&key);
                if own.is_empty() {
                    secrets.remove(&id);
                }
            }
        }
    }
    write_secrets(&app, &secrets)
}

/// An uninstalled plugin's secrets go with it.
pub fn forget_secrets(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let mut secrets = read_secrets(app)?;
    if secrets.remove(id).is_some() {
        write_secrets(app, &secrets)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::token_of;

    #[test]
    fn a_token_names_the_bytes() {
        assert_eq!(token_of(b"a"), token_of(b"a"));
        assert_ne!(token_of(b"a"), token_of(b"b"));
        assert_eq!(token_of(b"").len(), 64);
    }
}
