//! A writer's own notes and tracked changes for a document, kept in the app's
//! data folder (named by a hash of the path), never in the Markdown. A file
//! renamed outside Textus loses them.

use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// What is kept for a document: its own notes (a list), or its tracked changes
/// (an object).
#[derive(serde::Deserialize, Clone, Copy, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum OwnPart {
    Notes,
    Revisions,
}

fn part_file(app: &AppHandle, path: &str, part: OwnPart) -> Result<PathBuf, String> {
    let hash: String = Sha256::digest(path.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let name = match part {
        OwnPart::Notes => format!("{hash}.json"),
        OwnPart::Revisions => format!("{hash}.revisions.json"),
    };
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("own-notes")
        .join(name))
}

/// What is kept of `part` for the document at `path`, as the JSON it was
/// written as - none when nothing is.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn own_notes_read(
    app: AppHandle,
    path: String,
    part: OwnPart,
) -> Result<Option<String>, String> {
    match tokio::fs::read_to_string(part_file(&app, &path, part)?).await {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Keeps `value` (JSON: a list of notes, or the revisions' object) as
/// `part` for the document at `path`; an empty one removes its file.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn own_notes_write(
    app: AppHandle,
    path: String,
    part: OwnPart,
    value: String,
) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_str(&value).map_err(|e| e.to_string())?;
    let file = part_file(&app, &path, part)?;
    let empty = match (&parsed, part) {
        (serde_json::Value::Array(a), OwnPart::Notes) => a.is_empty(),
        (serde_json::Value::Object(o), OwnPart::Revisions) => o.is_empty(),
        _ => return Err("not what this part keeps".into()),
    };
    if empty {
        return match tokio::fs::remove_file(&file).await {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    if let Some(dir) = file.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| e.to_string())?;
    }
    crate::atomic::write(&file, value)
        .await
        .map_err(|e| e.to_string())
}
