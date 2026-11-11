//! Rename and delete for the iPhone's document list, inside the app's own
//! Documents folder; iOS only. Every path is checked to lie inside Documents first.

use std::path::{Path, PathBuf};
use tauri::Manager;
use tokio::fs;

/// The canonical Documents folder, and `path` checked to be strictly inside
/// it. `must_exist` false checks the parent instead, for a path about to be created.
fn inside_documents(
    app: &tauri::AppHandle,
    path: &str,
    must_exist: bool,
) -> Result<PathBuf, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let path = Path::new(path);
    let resolved = if must_exist {
        path.canonicalize().map_err(|e| e.to_string())?
    } else {
        let parent = path.parent().ok_or("No parent folder")?;
        let name = path.file_name().ok_or("No file name")?;
        parent.canonicalize().map_err(|e| e.to_string())?.join(name)
    };
    if resolved == docs || !resolved.starts_with(&docs) {
        return Err(crate::errors::error("outsideDocuments"));
    }
    Ok(resolved)
}

/// Renames in place (same folder). Returns the new path.
#[tauri::command]
pub async fn rename_entry(
    app: tauri::AppHandle,
    path: String,
    name: String,
) -> Result<String, String> {
    crate::ids::typed_name(&name)?;
    let from = inside_documents(&app, &path, true)?;
    let to = from.with_file_name(name.trim());
    let to = inside_documents(&app, &to.to_string_lossy(), false)?;
    if fs::try_exists(&to).await.unwrap_or(false) {
        return Err(crate::errors::error("exists"));
    }
    fs::rename(&from, &to).await.map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().to_string())
}

/// Deletes a document. There is no Trash in an app's sandbox, so the
/// frontend confirms first. Files only: the list never shows a folder.
#[tauri::command]
pub async fn delete_entry(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = inside_documents(&app, &path, true)?;
    if fs::metadata(&target)
        .await
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err(crate::errors::error("notDocument"));
    }
    fs::remove_file(&target).await.map_err(|e| e.to_string())
}
