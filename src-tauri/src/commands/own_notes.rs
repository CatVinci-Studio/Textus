//! A writer's own notes and tracked changes for a document, kept in the app's
//! data folder (named by a hash of the path), never in the Markdown. They
//! follow a move made in Textus (doc_data); one made outside loses them.

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
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(part_file_in(&data, path, part))
}

/// The file `part` of `path` is kept in, under the app's data folder.
pub(crate) fn part_file_in(data: &std::path::Path, path: &str, part: OwnPart) -> PathBuf {
    let hash = crate::ids::path_key(path, 32);
    let name = match part {
        OwnPart::Notes => format!("{hash}.json"),
        OwnPart::Revisions => format!("{hash}.revisions.json"),
    };
    data.join("own-notes").join(name)
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
