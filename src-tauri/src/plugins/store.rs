//! A plugin's own data, in two places it alone reaches:
//!
//! - global: `<config>/textus/plugins/<id>/`, beside the global agent.md
//!   and skills - one for every document;
//! - project: `<folder>/.textus/plugins/<id>/`, in the folder the window
//!   has open - with `project.data`, as it writes into the user's folder.
//!
//! Each holds keys (`kv/`, a file per key, so a write rewrites that key
//! alone - version history kept every snapshot in one file and rewrote it
//! all on each save) and files of the plugin's own (`files/`). Each is held
//! to the quota, and nothing reaches outside it.

use super::access::inside;
use super::require_id;
use super::state;
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// The most a plugin keeps in one place.
const QUOTA_BYTES: u64 = 50 * 1024 * 1024;
/// The longest a key may be.
const MAX_KEY_BYTES: usize = 200;

/// Which of a plugin's two places.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum StoreScope {
    Global,
    Project,
}

/// The folder of `id`'s `scope`: `root` is the folder the window has open,
/// for the project's.
fn place(
    app: &tauri::AppHandle,
    id: &str,
    scope: StoreScope,
    root: Option<&str>,
) -> Result<PathBuf, String> {
    require_id(id)?;
    let state = state::read(app);
    if !state.runs(id) {
        return Err(format!("{id} is turned off."));
    }
    match scope {
        StoreScope::Global => Ok(crate::ai::workspace::global_agent_dir(app)?
            .join("plugins")
            .join(id)),
        StoreScope::Project => {
            if !state.allows(id, "project.data") {
                return Err(format!("{id} was not granted project.data."));
            }
            let root = root
                .filter(|r| !r.is_empty())
                .ok_or("No folder is open, so there is no project to keep it in.")?;
            Ok(project_place(Path::new(root), id))
        }
    }
}

fn project_place(root: &Path, id: &str) -> PathBuf {
    root.join(".textus").join("plugins").join(id)
}

/// A key as a file name: letters, digits, `-` and `_` as they are, every
/// other byte as `%XX` - so no key names a path, and each comes back.
fn key_file(key: &str) -> Result<String, String> {
    if key.is_empty() || key.len() > MAX_KEY_BYTES {
        return Err(format!("A key is 1 to {MAX_KEY_BYTES} bytes."));
    }
    let mut out = String::with_capacity(key.len() + 5);
    for b in key.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out.push_str(".json");
    Ok(out)
}

fn file_key(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".json")?;
    let mut bytes = Vec::with_capacity(stem.len());
    let mut chars = stem.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let hex = [chars.next()?, chars.next()?];
            bytes.push(u8::from_str_radix(std::str::from_utf8(&hex).ok()?, 16).ok()?);
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8(bytes).ok()
}

/// How much `dir` holds, every file in it.
fn size_of(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => size_of(&e.path()),
            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

/// Writes `bytes` to `path` in `place` unless that takes it over the quota.
fn write_within(place: &Path, path: &Path, bytes: &[u8]) -> Result<(), String> {
    let old = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    // A file written again replaces itself: its old size doesn't count.
    if size_of(place).saturating_sub(old) + bytes.len() as u64 > QUOTA_BYTES {
        return Err("The plugin's storage is full (50 MB).".to_string());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    crate::atomic::write_sync(path, bytes).map_err(|e| e.to_string())
}

fn get(place: &Path, key: &str) -> Result<Option<serde_json::Value>, String> {
    match std::fs::read(place.join("kv").join(key_file(key)?)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn set(place: &Path, key: &str, value: &serde_json::Value) -> Result<(), String> {
    let path = place.join("kv").join(key_file(key)?);
    if value.is_null() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    let json = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    write_within(place, &path, &json)
}

fn keys(place: &Path) -> Vec<String> {
    let mut keys: Vec<String> = std::fs::read_dir(place.join("kv"))
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| file_key(&e.file_name().to_string_lossy()))
                .collect()
        })
        .unwrap_or_default();
    keys.sort();
    keys
}

/// `rel` inside the place's `files/`, made first so a new one resolves.
fn file_in(place: &Path, rel: &str) -> Result<PathBuf, String> {
    let files = place.join("files");
    std::fs::create_dir_all(&files).map_err(|e| e.to_string())?;
    inside(&files, Path::new(rel))
}

fn list_files(dir: &Path, base: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let path = e.path();
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            list_files(&path, base, out);
        } else if let Ok(rel) = path.strip_prefix(base) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

/// What the plugin kept under `key`, or null.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_store_get(
    app: tauri::AppHandle,
    id: String,
    scope: StoreScope,
    root: Option<String>,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    get(&place(&app, &id, scope, root.as_deref())?, &key)
}

/// Keeps `value` under `key`; null takes the key away.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_store_set(
    app: tauri::AppHandle,
    id: String,
    scope: StoreScope,
    root: Option<String>,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    set(&place(&app, &id, scope, root.as_deref())?, &key, &value)
}

/// Every key the plugin keeps there, in order.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_store_keys(
    app: tauri::AppHandle,
    id: String,
    scope: StoreScope,
    root: Option<String>,
) -> Result<Vec<String>, String> {
    Ok(keys(&place(&app, &id, scope, root.as_deref())?))
}

/// One of the plugin's own files there, as text.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_store_read(
    app: tauri::AppHandle,
    id: String,
    scope: StoreScope,
    root: Option<String>,
    path: String,
) -> Result<String, String> {
    let place = place(&app, &id, scope, root.as_deref())?;
    std::fs::read_to_string(file_in(&place, &path)?).map_err(|e| e.to_string())
}

/// Writes one of the plugin's own files there.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_store_write(
    app: tauri::AppHandle,
    id: String,
    scope: StoreScope,
    root: Option<String>,
    path: String,
    text: String,
) -> Result<(), String> {
    let place = place(&app, &id, scope, root.as_deref())?;
    let file = file_in(&place, &path)?;
    write_within(&place, &file, text.as_bytes())
}

/// The plugin's own files there, as paths under its `files/`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_store_files(
    app: tauri::AppHandle,
    id: String,
    scope: StoreScope,
    root: Option<String>,
) -> Result<Vec<String>, String> {
    let files = place(&app, &id, scope, root.as_deref())?.join("files");
    let mut out = Vec::new();
    list_files(&files, &files, &mut out);
    out.sort();
    Ok(out)
}

/// Deletes one of the plugin's own files there.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_store_delete(
    app: tauri::AppHandle,
    id: String,
    scope: StoreScope,
    root: Option<String>,
    path: String,
) -> Result<(), String> {
    let place = place(&app, &id, scope, root.as_deref())?;
    match std::fs::remove_file(file_in(&place, &path)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// How much a plugin keeps in each place - Settings shows it, and empties
/// it on Clear data. `root` is the open folder, for the project's.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_store_usage(
    app: tauri::AppHandle,
    id: String,
    root: Option<String>,
) -> Result<(u64, u64), String> {
    require_id(&id)?;
    let global = crate::ai::workspace::global_agent_dir(&app)?
        .join("plugins")
        .join(&id);
    let project = root
        .filter(|r| !r.is_empty())
        .map(|r| size_of(&project_place(Path::new(&r), &id)))
        .unwrap_or(0);
    Ok((size_of(&global), project))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_key_is_a_file_name_and_comes_back() {
        for key in ["notes", "v:/a/b.md", "../../etc", "日记 2026", "a%b.c"] {
            let file = key_file(key).unwrap();
            assert!(!file.contains('/') && !file.contains(".."), "{file}");
            assert_eq!(file_key(&file).as_deref(), Some(key));
        }
        assert!(key_file("").is_err());
        assert!(key_file(&"x".repeat(MAX_KEY_BYTES + 1)).is_err());
    }

    #[test]
    fn keys_are_kept_and_taken_away_one_file_each() {
        let tmp = tempfile::tempdir().unwrap();
        let place = tmp.path().join("p");
        set(&place, "a", &json!({"n": 1})).unwrap();
        set(&place, "v:/doc.md", &json!("text")).unwrap();
        assert_eq!(get(&place, "a").unwrap(), Some(json!({"n": 1})));
        assert_eq!(keys(&place), vec!["a".to_string(), "v:/doc.md".to_string()]);
        set(&place, "a", &serde_json::Value::Null).unwrap();
        assert_eq!(get(&place, "a").unwrap(), None);
        assert_eq!(std::fs::read_dir(place.join("kv")).unwrap().count(), 1);
    }

    #[test]
    fn files_stay_in_their_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let place = tmp.path().join("p");
        let f = file_in(&place, "board/one.md").unwrap();
        write_within(&place, &f, b"# One").unwrap();
        assert!(file_in(&place, "../kv/a.json").is_err());
        assert!(file_in(&place, "/etc/passwd").is_err());
        let mut out = Vec::new();
        list_files(&place.join("files"), &place.join("files"), &mut out);
        assert_eq!(out, vec!["board/one.md".to_string()]);
    }

    #[test]
    fn the_quota_holds_and_a_rewrite_counts_once() {
        let tmp = tempfile::tempdir().unwrap();
        let place = tmp.path().join("p");
        let big = vec![b'x'; (QUOTA_BYTES - 10) as usize];
        let f = file_in(&place, "big.bin").unwrap();
        write_within(&place, &f, &big).unwrap();
        // The same file again replaces itself: still within.
        write_within(&place, &f, &big).unwrap();
        assert!(set(&place, "more", &json!("x".repeat(64))).is_err());
    }

    #[test]
    fn a_project_place_is_under_its_textus_folder() {
        assert_eq!(
            project_place(Path::new("/notes"), "catvinci.kanban"),
            Path::new("/notes/.textus/plugins/catvinci.kanban")
        );
    }
}
