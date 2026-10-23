//! The AI's proposals the writer hasn't decided on yet, kept with the
//! document they were made for: closing the document, or quitting, used to
//! lose them. In a project they are a file of the project's own,
//! `.textus/pending/<the document's path in the project>.json`, so they
//! travel with it; outside one, the app's data folder keeps them under
//! `pending/`, named by a hash of the document's path. What a file holds
//! is the frontend's (ai/revision/kept-proposals.ts) - opaque JSON here.

use crate::ai::workspace::project_dir;
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

const PENDING_FOLDER: &str = "pending";

/// Where `doc_path`'s undecided proposals are kept: in its project's
/// `.textus/pending/`, mirroring its place in the project, or in
/// `app_data`'s `pending/`. None for a path that isn't absolute.
fn kept_file(doc_path: &str, workspace_root: Option<&str>, app_data: &Path) -> Option<PathBuf> {
    let doc = Path::new(doc_path);
    if !doc.is_absolute() {
        return None;
    }
    // A project that has its `.textus/` already: a loose document's folder
    // doesn't get one for this.
    let in_project = crate::ai::workspace::project_root(Some(doc_path), workspace_root)
        .filter(|root| project_dir(root).is_dir())
        .and_then(|root| {
            let rel = doc.strip_prefix(&root).ok()?;
            // Only the plain names of folders and the file: nothing that
            // climbs out of the project's pending folder.
            rel.components()
                .all(|c| matches!(c, Component::Normal(_)))
                .then(|| project_dir(&root).join(PENDING_FOLDER).join(rel))
        });
    let base = in_project.unwrap_or_else(|| {
        let hash = Sha256::digest(doc_path.as_bytes());
        let name: String = hash.iter().take(16).map(|b| format!("{b:02x}")).collect();
        app_data.join(PENDING_FOLDER).join(name)
    });
    let mut name = base.file_name()?.to_os_string();
    name.push(".json");
    Some(base.with_file_name(name))
}

fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// The proposals kept for the document, or None when there are none.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn kept_proposals_read(
    app: tauri::AppHandle,
    doc_path: String,
    workspace_root: Option<String>,
) -> Option<serde_json::Value> {
    let file = kept_file(&doc_path, workspace_root.as_deref(), &app_data(&app).ok()?)?;
    let bytes = tokio::fs::read(file).await.ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Keeps `kept` for the document - or, with None, removes what was kept,
/// once every proposal is decided.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn kept_proposals_write(
    app: tauri::AppHandle,
    doc_path: String,
    workspace_root: Option<String>,
    kept: Option<serde_json::Value>,
) -> Result<(), String> {
    let file = kept_file(&doc_path, workspace_root.as_deref(), &app_data(&app)?)
        .ok_or_else(|| "not a document path".to_string())?;
    match kept {
        Some(kept) => {
            if let Some(dir) = file.parent() {
                tokio::fs::create_dir_all(dir)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            let json = serde_json::to_vec(&kept).map_err(|e| e.to_string())?;
            crate::atomic::write(&file, json)
                .await
                .map_err(|e| e.to_string())
        }
        None => match tokio::fs::remove_file(&file).await {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_project_document_keeps_its_proposals_in_the_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("novel");
        std::fs::create_dir_all(root.join(".textus")).unwrap();
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        let doc = root.join("chapters").join("one.md");
        let data = dir.path().join("data");
        let file = kept_file(doc.to_str().unwrap(), Some(root.to_str().unwrap()), &data).unwrap();
        assert_eq!(
            file,
            root.join(".textus")
                .join("pending")
                .join("chapters")
                .join("one.md.json")
        );
    }

    #[test]
    fn a_document_outside_a_project_keeps_them_in_the_app_data() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("loose.md");
        let data = dir.path().join("data");
        let file = kept_file(doc.to_str().unwrap(), None, &data).unwrap();
        assert_eq!(file.parent().unwrap(), data.join("pending"));
        let name = file.file_name().unwrap().to_str().unwrap();
        assert!(name.ends_with(".json") && name.len() == 32 + 5, "{name}");
        // The same document, the same file; another, another.
        assert_eq!(kept_file(doc.to_str().unwrap(), None, &data).unwrap(), file);
        let other = dir.path().join("other.md");
        assert_ne!(
            kept_file(other.to_str().unwrap(), None, &data).unwrap(),
            file
        );
    }

    #[test]
    fn a_folder_without_textus_is_not_given_one() {
        let dir = tempfile::tempdir().unwrap();
        let doc = dir.path().join("notes").join("loose.md");
        std::fs::create_dir_all(doc.parent().unwrap()).unwrap();
        let data = dir.path().join("data");
        let file = kept_file(doc.to_str().unwrap(), None, &data).unwrap();
        assert!(file.starts_with(data.join("pending")), "{file:?}");
    }

    #[test]
    fn a_relative_path_keeps_nothing() {
        assert!(kept_file("notes.md", None, Path::new("/data")).is_none());
    }
}
