//! The notes a writer leaves on their own document (the margin's "Me"
//! cards, src/ai/margin/useOwnNotes.ts): kept beside the app's data, never
//! in the Markdown or the user's folder - one file per document, named by
//! a hash of its path, under `own-notes/` in the app's data folder. Each
//! note is found again by its words and the text before them. A document
//! open in Textus while it is renamed or saved elsewhere keeps its notes
//! (they are written under the new path); one renamed or moved outside
//! Textus loses them.

use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn notes_file(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let hash: String = Sha256::digest(path.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("own-notes")
        .join(format!("{hash}.json")))
}

/// The notes kept for the document at `path`, as the JSON they were
/// written as - none when it has none.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn own_notes_read(app: AppHandle, path: String) -> Result<Option<String>, String> {
    match tokio::fs::read_to_string(notes_file(&app, &path)?).await {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Keeps `notes` (a JSON array) for the document at `path`; an empty one
/// removes its file.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn own_notes_write(app: AppHandle, path: String, notes: String) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_str(&notes).map_err(|e| e.to_string())?;
    let file = notes_file(&app, &path)?;
    if parsed.as_array().is_some_and(|a| a.is_empty()) {
        return match tokio::fs::remove_file(&file).await {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    if !parsed.is_array() {
        return Err("notes must be a list".into());
    }
    if let Some(dir) = file.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| e.to_string())?;
    }
    crate::atomic::write(&file, notes)
        .await
        .map_err(|e| e.to_string())
}
