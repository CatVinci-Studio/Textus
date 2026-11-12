//! The plugin API's file calls beyond plain reads and writes (details, a
//! no-overwrite create, a read-then-write that never loses a change), and the
//! plugin's secrets. Each is checked against `state.json`.

use super::access::{granted_path, FsEntry};
use super::{require_id, state};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use tauri::Manager;

/// The file at `path`, or None when nothing is there.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_stat(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
) -> Result<Option<FsEntry>, String> {
    let path = granted_path(&app, &id, "files.read", &root, &path)?;
    let Ok(meta) = tokio::fs::metadata(&path).await else {
        return Ok(None);
    };
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(Some(FsEntry::of(name, &path, &meta)))
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
    let path = granted_path(&app, &id, "files.write", &root, &path)?;
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
    let path = granted_path(&app, &id, "files.read", &root, &path)?;
    if tokio::fs::metadata(&path)
        .await
        .is_ok_and(|m| m.len() > super::access::MAX_READ_BYTES)
    {
        return Err(crate::errors::error("fileTooBig"));
    }
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
    let path = granted_path(&app, &id, "files.write", &root, &path)?;
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

/// Where plugins' secrets are kept, in the app's config folder.
pub(crate) const SECRETS_FILE: &str = "plugin_secrets.json";

type Secrets = BTreeMap<String, BTreeMap<String, String>>;

/// Every plugin's secrets, in one owner-only file apart from settings and storage.
fn secrets_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(SECRETS_FILE))
}

fn read_secrets(app: &tauri::AppHandle) -> Result<Secrets, String> {
    let path = secrets_path(app)?;
    match std::fs::read(&path) {
        // A file that doesn't parse is kept aside, not written over.
        Ok(bytes) => Ok(crate::json_file::parse_or_set_aside(&path, &bytes).unwrap_or_default()),
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
#[tauri::command(async)]
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

/// One read-change-write of the secrets file at a time: two saves at once
/// would each write over the other's.
static SECRETS_WRITING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Keeps a secret of the plugin's; `None` forgets it.
#[tauri::command(async)]
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
    let _one = SECRETS_WRITING.lock().unwrap_or_else(|e| e.into_inner());
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
    let _one = SECRETS_WRITING.lock().unwrap_or_else(|e| e.into_inner());
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

/// An Obsidian vault's own settings file, `<vault>/.obsidian/<name>`, as
/// text; None when it isn't there. The one hidden folder plugins may read
/// from, and only a file at its top: a plugin's saved data lives deeper
/// (plugins/<id>/data.json) and holds its tokens.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_app_settings(
    app: tauri::AppHandle,
    id: String,
    vault: String,
    name: String,
) -> Result<Option<String>, String> {
    if !super::state::read(&app).allows(&id, "files.read") {
        return Err(super::access::refused(&id, "files.read"));
    }
    if !settings_file_name(&name) {
        return Err(format!("{name} isn't a settings file's name."));
    }
    let path = super::access::inside(
        std::path::Path::new(&vault),
        &std::path::Path::new(".obsidian").join(&name),
    )?;
    super::access::require_not_app_data(&app, &path)?;
    match tokio::fs::read(&path).await {
        Ok(bytes) if bytes.len() as u64 <= super::access::MAX_READ_BYTES => {
            Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
        }
        Ok(_) => Err(crate::errors::error("fileTooBig")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Obsidian plugins whose settings hold folders and templates, never a
/// token, so a plugin doing the same job may follow them.
const SHARED_PLUGIN_SETTINGS: [&str; 2] = [
    "obsidian-zotero-desktop-connector",
    "obsidian-citation-plugin",
];

/// A file's name at the top of the settings folder (no folders, nothing
/// hidden), or the data.json of a plugin whose settings are shared.
fn settings_file_name(name: &str) -> bool {
    if let Some(id) = name
        .strip_prefix("plugins/")
        .and_then(|rest| rest.strip_suffix("/data.json"))
    {
        return SHARED_PLUGIN_SETTINGS.contains(&id);
    }
    !name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

#[cfg(test)]
mod app_settings_tests {
    #[test]
    fn only_a_file_at_the_settings_folders_top_is_named() {
        assert!(super::settings_file_name("bookmarks.json"));
        assert!(!super::settings_file_name("plugins/x/data.json"));
        assert!(super::settings_file_name(
            "plugins/obsidian-citation-plugin/data.json"
        ));
        assert!(!super::settings_file_name(
            "plugins/obsidian-citation-plugin/../x/data.json"
        ));
        assert!(!super::settings_file_name("../.env"));
        assert!(!super::settings_file_name(".hidden"));
        assert!(!super::settings_file_name(""));
    }
}
