//! A writer's own notes and tracked changes for a document, never in the
//! Markdown. Notes are kept in its project's `.textus/notes/`, by the
//! document's path in the project, so they go wherever the folder goes (Git
//! included); a document in no project, and tracked changes, keep them in
//! the app's data folder, named by a hash of the path. They follow a move
//! made in Textus (doc_data); one made outside loses them.

use crate::app_dirs::AppDirs;
use std::path::{Path, PathBuf};
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

fn part_file(
    app: &AppHandle,
    path: &str,
    part: OwnPart,
    folder: Option<&str>,
) -> Result<PathBuf, String> {
    let data = app.path().own_data_dir().map_err(|e| e.to_string())?;
    Ok(kept_file_in(&data, path, part, folder))
}

/// The projects `path` may keep its notes in, nearest first: each folder
/// above it holding `.textus/` (up to the home folder), and `folder`, the
/// window's open one, when it holds the document.
fn projects_of(path: &str, folder: Option<&str>) -> Vec<PathBuf> {
    let Some(dir) = Path::new(path).parent() else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = dir
        .ancestors()
        .take_while(|d| !crate::ai::project::is_too_broad(d))
        .filter(|d| crate::ai::workspace::project_dir(d).is_dir())
        .map(Path::to_path_buf)
        .collect();
    if let Some(folder) = folder.map(Path::new) {
        if dir.starts_with(folder)
            && !crate::ai::project::is_too_broad(folder)
            && !out.iter().any(|d| d == folder)
        {
            out.push(folder.to_path_buf());
        }
    }
    out
}

/// Where `part` of `path` is kept: notes in a project's
/// `.textus/notes/<its path there>.json` - the one already holding them,
/// else the nearest; everything else, and the notes of a document in no
/// project, under the app's data folder.
pub(crate) fn kept_file_in(
    data: &Path,
    path: &str,
    part: OwnPart,
    folder: Option<&str>,
) -> PathBuf {
    if part == OwnPart::Notes {
        let files: Vec<PathBuf> = projects_of(path, folder)
            .iter()
            .filter_map(|root| {
                let rel = Path::new(path).strip_prefix(root).ok()?;
                let mut name = rel.as_os_str().to_owned();
                name.push(".json");
                Some(
                    crate::ai::workspace::project_dir(root)
                        .join("notes")
                        .join(name),
                )
            })
            .collect();
        if let Some(file) = files.iter().find(|f| f.is_file()).or(files.first()) {
            return file.clone();
        }
    }
    part_file_in(data, path, part)
}

/// Notes kept in the app's data folder from before they went to the
/// project: moved to `kept` when it is elsewhere and free.
pub(crate) fn adopt_old_notes(data: &Path, path: &str, kept: &Path) {
    let old = part_file_in(data, path, OwnPart::Notes);
    if old == kept || !old.is_file() || kept.exists() {
        return;
    }
    if let Some(dir) = kept.parent() {
        if std::fs::create_dir_all(dir).is_err() {
            return;
        }
    }
    if std::fs::rename(&old, kept).is_err() && std::fs::copy(&old, kept).is_ok() {
        let _ = std::fs::remove_file(&old);
    }
}

/// Every document under `folder` with notes still in the app's data folder:
/// they go to the project (`folder` or one nearer), so whoever shares the
/// folder sees them.
pub(crate) fn adopt_folder_in(data: &Path, folder: &str) {
    if crate::ai::project::is_too_broad(Path::new(folder)) {
        return;
    }
    let windows = folder.contains('\\') && !folder.contains('/');
    let base = folder.trim_end_matches(['/', '\\']);
    for rel in crate::ai::project::walk_text_files(Path::new(folder)).files {
        let rel = if windows { rel.replace('/', "\\") } else { rel };
        let sep = if windows { '\\' } else { '/' };
        let path = format!("{base}{sep}{rel}");
        if part_file_in(data, &path, OwnPart::Notes).is_file() {
            let kept = kept_file_in(data, &path, OwnPart::Notes, Some(folder));
            adopt_old_notes(data, &path, &kept);
        }
    }
}

/// Brings the notes of the documents under `folder`, just opened, into it.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn own_notes_adopt(app: AppHandle, folder: String) -> Result<(), String> {
    let data = app.path().own_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || adopt_folder_in(&data, &folder))
        .await
        .map_err(|e| e.to_string())
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
    folder: Option<String>,
) -> Result<Option<String>, String> {
    let file = part_file(&app, &path, part, folder.as_deref())?;
    if part == OwnPart::Notes {
        let data = app.path().own_data_dir().map_err(|e| e.to_string())?;
        let (path, file) = (path.clone(), file.clone());
        let _ = tauri::async_runtime::spawn_blocking(move || adopt_old_notes(&data, &path, &file))
            .await;
    }
    match tokio::fs::read_to_string(file).await {
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
    folder: Option<String>,
) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_str(&value).map_err(|e| e.to_string())?;
    let file = part_file(&app, &path, part, folder.as_deref())?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_go_to_the_project_and_old_ones_are_brought_over() {
        let data = tempfile::tempdir().unwrap();
        let docs = tempfile::tempdir().unwrap();
        let root = docs.path().to_str().unwrap();
        let doc = format!("{root}/ch/a.md");
        // In no project and no folder open: the app's data folder.
        assert_eq!(
            kept_file_in(data.path(), &doc, OwnPart::Notes, None),
            part_file_in(data.path(), &doc, OwnPart::Notes)
        );
        // In the window's folder: its .textus, by the path in it.
        let kept = kept_file_in(data.path(), &doc, OwnPart::Notes, Some(root));
        assert_eq!(kept, docs.path().join(".textus/notes/ch/a.md.json"));
        // Tracked changes stay in the app's data folder.
        assert_eq!(
            kept_file_in(data.path(), &doc, OwnPart::Revisions, Some(root)),
            part_file_in(data.path(), &doc, OwnPart::Revisions)
        );
        let old = part_file_in(data.path(), &doc, OwnPart::Notes);
        std::fs::create_dir_all(old.parent().unwrap()).unwrap();
        std::fs::write(&old, "[1]").unwrap();
        adopt_old_notes(data.path(), &doc, &kept);
        assert_eq!(std::fs::read_to_string(&kept).unwrap(), "[1]");
        assert!(!old.exists());
        // Once .textus is there it is the project, with no folder open; a
        // nearer one doesn't hide the notes already kept, but takes new ones.
        assert_eq!(kept_file_in(data.path(), &doc, OwnPart::Notes, None), kept);
        std::fs::create_dir_all(docs.path().join("ch/.textus")).unwrap();
        assert_eq!(kept_file_in(data.path(), &doc, OwnPart::Notes, None), kept);
        // Named as the folder is, with its own separator, as the app does.
        let b = docs.path().join("ch").join("b.md");
        let b = b.to_str().unwrap();
        assert_eq!(
            kept_file_in(data.path(), b, OwnPart::Notes, None),
            docs.path().join("ch/.textus/notes/b.md.json")
        );
        // A folder opened brings its documents' old notes in.
        std::fs::write(b, "b").unwrap();
        let old = part_file_in(data.path(), b, OwnPart::Notes);
        std::fs::write(&old, "[2]").unwrap();
        adopt_folder_in(data.path(), root);
        assert!(!old.exists());
        let moved = docs.path().join("ch/.textus/notes/b.md.json");
        assert_eq!(std::fs::read_to_string(moved).unwrap(), "[2]");
    }
}
