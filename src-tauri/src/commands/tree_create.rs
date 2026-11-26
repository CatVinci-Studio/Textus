//! New document and new folder for the sidebar's file tree, and the folders
//! on the way a name with slashes gives. Nothing here overwrites: a taken
//! name is refused, and leaves no folder made for it behind.

use super::tree_ops::{document_name, existing_dir};
use std::path::{Path, PathBuf};
use tokio::fs;

/// What a new document or folder made: its path, and the topmost entry
/// made for it (the first folder on the way that wasn't there, else the
/// entry itself), which an undo takes away. Shape shared with
/// `fs.createDocument` in src/platform/ipc-files.ts.
#[derive(serde::Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct Created {
    pub path: String,
    pub made: String,
}

/// A typed name that may name folders on the way (`2026/March/plan`):
/// those folders and the last name, each one name that can't walk out.
fn typed_path(name: &str) -> Result<(Vec<&str>, &str), String> {
    let mut parts = name
        .trim()
        .split(|c| c == '/' || (cfg!(windows) && c == '\\'))
        .map(crate::ids::typed_name)
        .collect::<Result<Vec<_>, _>>()?;
    let last = parts.pop().ok_or_else(|| crate::errors::error("badName"))?;
    Ok((parts, last))
}

/// `dir`, then the folders on the way, made where missing: the folder they
/// lead to, and the topmost one made.
async fn way_down(dir: &str, folders: &[&str]) -> Result<(PathBuf, Option<PathBuf>), String> {
    let mut at = existing_dir(dir).await?;
    let mut made = None;
    for folder in folders {
        at.push(folder);
        match fs::create_dir(&at).await {
            Ok(()) => {
                made.get_or_insert_with(|| at.clone());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && at.is_dir() => {}
            Err(e) => {
                take_back(&at, made.as_deref()).await;
                return Err(e.to_string());
            }
        }
    }
    Ok((at, made))
}

/// The folders `way_down` made, from `at` up to `top`, taken away: an entry
/// that couldn't be made leaves none behind. Only empty ones go.
async fn take_back(at: &Path, top: Option<&Path>) {
    let Some(top) = top else {
        return;
    };
    for dir in at.ancestors().filter(|d| d.starts_with(top)) {
        if fs::remove_dir(dir).await.is_err() {
            return;
        }
    }
}

/// `name` made in `dir` by `make`, with the folders on the way.
async fn create(
    dir: &str,
    name: &str,
    entry: impl Fn(&str) -> String,
    make: impl AsyncFn(&Path) -> std::io::Result<()>,
) -> Result<Created, String> {
    let (folders, name) = typed_path(name)?;
    let (dir, made) = way_down(dir, &folders).await?;
    let path = dir.join(entry(name));
    if let Err(e) = make(&path).await {
        take_back(&dir, made.as_deref()).await;
        return Err(crate::errors::exists_or(e));
    }
    let text = |p: &Path| p.to_string_lossy().to_string();
    Ok(Created {
        made: text(made.as_deref().unwrap_or(&path)),
        path: text(&path),
    })
}

/// Creates an empty Markdown document in `dir`, and the folders on the way
/// a name with slashes gives.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn tree_create_document(dir: String, name: String) -> Result<Created, String> {
    create(&dir, &name, document_name, async |path| {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .await
            .map(drop)
    })
    .await
}

/// Creates a folder in `dir`, and the folders on the way a name with
/// slashes gives.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn tree_create_folder(dir: String, name: String) -> Result<Created, String> {
    create(&dir, &name, str::to_string, async |path| {
        fs::create_dir(path).await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_name_with_slashes_makes_the_folders_on_the_way() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let doc = tree_create_document(root.clone(), "2026/March/plan".into())
            .await
            .unwrap();
        assert_eq!(Path::new(&doc.path), dir.path().join("2026/March/plan.md"));
        // The topmost folder made is what an undo takes away.
        assert_eq!(Path::new(&doc.made), dir.path().join("2026"));
        // An existing folder on the way is used, not refused.
        let sub = tree_create_folder(root.clone(), "2026/April".into())
            .await
            .unwrap();
        assert!(Path::new(&sub.path).is_dir());
        assert_eq!(sub.made, sub.path);
        for bad in ["../out", "a/../../out", "/abs", "a//b", "a/", " / "] {
            assert!(
                tree_create_document(root.clone(), bad.into())
                    .await
                    .is_err(),
                "{bad}"
            );
        }
        assert!(!dir.path().parent().unwrap().join("out.md").exists());
    }

    #[tokio::test]
    async fn an_entry_that_cant_be_made_leaves_no_folder_made_for_it() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        std::fs::create_dir(dir.path().join("kept")).unwrap();
        let taken = async |_: &Path| Err(std::io::ErrorKind::AlreadyExists.into());
        let err = create(&root, "kept/new/deep/plan", str::to_string, taken)
            .await
            .unwrap_err();
        assert_eq!(err, crate::errors::error("exists"));
        assert!(!dir.path().join("kept/new").exists());
        assert!(dir.path().join("kept").is_dir());
    }
}
