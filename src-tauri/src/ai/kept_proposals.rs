//! The AI's undecided proposals, kept with their document: in a project under
//! `.textus/pending/`, else in the app data's `pending/`. The contents are the
//! frontend's opaque JSON; made pictures go beside it in `<file>.pictures/`.

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

/// The folder beside `file` its pictures are kept in.
fn pictures_dir(file: &Path) -> PathBuf {
    let mut name = file.as_os_str().to_os_string();
    name.push(".pictures");
    PathBuf::from(name)
}

/// A picture id as the image module makes them: letters and digits only, so
/// it can name a file and nothing else.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 16
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

/// The kept picture files in `dir`, as (id, path).
fn kept_pictures(dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let id = path.file_stem()?.to_str()?.to_string();
            let ext = path.extension()?.to_str()?;
            (valid_id(&id) && matches!(ext, "png" | "jpg" | "jpeg" | "webp") && path.is_file())
                .then_some((id, path))
        })
        .collect()
}

/// Keeps the made pictures among `ids` in `dir` and lets go of the rest. One
/// still being made is kept on a later write. Only picture files are ever
/// removed, and the folder once empty.
fn keep_pictures(dir: &Path, ids: &[String]) -> std::io::Result<()> {
    for (id, path) in kept_pictures(dir) {
        if !ids.contains(&id) {
            std::fs::remove_file(path)?;
        }
    }
    let have: Vec<String> = kept_pictures(dir).into_iter().map(|(id, _)| id).collect();
    for id in ids.iter().filter(|id| valid_id(id) && !have.contains(id)) {
        if let Some((bytes, ext)) = crate::ai::images::ready_bytes(id) {
            std::fs::create_dir_all(dir)?;
            crate::atomic::write_sync(&dir.join(format!("{id}.{ext}")), bytes)?;
        }
    }
    if dir.is_dir() && std::fs::read_dir(dir)?.next().is_none() {
        std::fs::remove_dir(dir)?;
    }
    Ok(())
}

/// Puts the pictures kept in `dir` back among the waiting ones, under
/// their ids.
fn restore_pictures(dir: &Path) {
    for (id, path) in kept_pictures(dir) {
        if let Ok(image) = std::fs::read(&path)
            .map_err(|_| ())
            .and_then(|bytes| aicompat::images::checked_image(bytes).map_err(|_| ()))
        {
            crate::ai::images::restore(&id, image);
        }
    }
}

fn app_data(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// The proposals kept for the document, or None when there are none - their
/// pictures waiting again, for the frontend to fetch by id.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn kept_proposals_read(
    app: tauri::AppHandle,
    doc_path: String,
    workspace_root: Option<String>,
) -> Option<serde_json::Value> {
    let file = kept_file(&doc_path, workspace_root.as_deref(), &app_data(&app).ok()?)?;
    let bytes = tokio::fs::read(&file).await.ok()?;
    let dir = pictures_dir(&file);
    tauri::async_runtime::spawn_blocking(move || restore_pictures(&dir))
        .await
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Keeps `kept` for the document, with the made pictures among `pictures`; with
/// None, removes what was kept.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn kept_proposals_write(
    app: tauri::AppHandle,
    doc_path: String,
    workspace_root: Option<String>,
    kept: Option<serde_json::Value>,
    pictures: Vec<String>,
) -> Result<(), String> {
    let file = kept_file(&doc_path, workspace_root.as_deref(), &app_data(&app)?)
        .ok_or_else(|| "not a document path".to_string())?;
    let dir = pictures_dir(&file);
    let ids = if kept.is_some() { pictures } else { Vec::new() };
    tauri::async_runtime::spawn_blocking(move || keep_pictures(&dir, &ids))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
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
    fn made_pictures_are_kept_beside_and_come_back() {
        use crate::ai::images::{pending, ready_bytes, Slot};
        let dir = tempfile::tempdir().unwrap();
        let pictures = pictures_dir(&dir.path().join("story.md.json"));
        // A 1x1 PNG.
        let png = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        )
        .unwrap();
        let made = aicompat::images::checked_image(png.clone()).unwrap();
        pending().push(("kpic01".into(), Slot::Ready(made)));
        pending().push(("kpic02".into(), Slot::Making));
        keep_pictures(&pictures, &["kpic01".into(), "kpic02".into()]).unwrap();
        // The made one only; the other on a later write.
        assert_eq!(
            kept_pictures(&pictures)
                .into_iter()
                .map(|(id, _)| id)
                .collect::<Vec<_>>(),
            ["kpic01"]
        );
        // Gone with the app, back from the file.
        pending().retain(|(id, _)| !id.starts_with("kpic"));
        restore_pictures(&pictures);
        assert_eq!(ready_bytes("kpic01").map(|(b, _)| b), Some(png));
        // Let go of, the folder goes too - nothing else in it is touched.
        keep_pictures(&pictures, &[]).unwrap();
        assert!(!pictures.exists());
        pending().retain(|(id, _)| !id.starts_with("kpic"));
    }

    #[test]
    fn only_picture_files_are_let_go_of() {
        let dir = tempfile::tempdir().unwrap();
        let pictures = dir.path().join("x.pictures");
        std::fs::create_dir_all(&pictures).unwrap();
        std::fs::write(pictures.join("notes.txt"), "mine").unwrap();
        std::fs::write(pictures.join("abc123.png"), "png").unwrap();
        keep_pictures(&pictures, &[]).unwrap();
        assert!(pictures.join("notes.txt").exists());
        assert!(!pictures.join("abc123.png").exists());
        assert!(!valid_id("../x") && !valid_id("A1") && valid_id("k3f9z0"));
    }

    #[test]
    fn a_relative_path_keeps_nothing() {
        assert!(kept_file("notes.md", None, Path::new("/data")).is_none());
    }
}
