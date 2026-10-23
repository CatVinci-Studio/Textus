//! The folder the sidebar is opened on (File > Open Folder…) and the index
//! behind its file-name search. The frontend half is src/app/useOpenFolder.ts
//! and src/sidebar/FileSearch.tsx.

use crate::ai::project::is_too_broad;
use crate::walk::{walk, Limits, LIMITS};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// One indexed file - generated into src/platform/bindings/files.ts.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct IndexedFile {
    /// Absolute, to open it.
    path: String,
    /// From the indexed folder, `/`-separated, to show where it is.
    rel: String,
}

/// Generated into src/platform/bindings/files.ts.
#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(specta::Type))]
pub struct FolderIndex {
    files: Vec<IndexedFile>,
    /// A limit was hit: there may be more files than `files` holds.
    truncated: bool,
}

/// Every file under `root`, the way fd finds them - see crate::walk, which
/// the AI's project tools walk with too.
fn index(root: &Path, limits: &Limits) -> FolderIndex {
    let walk = walk(root, limits, |_| true);
    FolderIndex {
        files: walk
            .files
            .into_iter()
            .map(|f| IndexedFile {
                path: f.path.to_string_lossy().into_owned(),
                rel: f.rel,
            })
            .collect(),
        truncated: walk.truncated,
    }
}

/// The files under `root`, for the sidebar's file-name search. Refuses the
/// home folder and a drive root ("TOO_BROAD"), as the AI's project folder
/// does: a walk there would be everything the user owns.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn index_folder(root: String) -> Result<FolderIndex, String> {
    crate::commands::fs::require_non_empty(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root);
        if is_too_broad(&root) {
            return Err("TOO_BROAD".to_string());
        }
        if !root.is_dir() {
            return Err("NOT_A_FOLDER".to_string());
        }
        Ok(index(&root, &LIMITS))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// File > Open Folder…: a folder picker. The home folder or a drive root is
/// refused here, where the choice is made, with "TOO_BROAD" for the
/// frontend to explain - the sidebar's search, and the AI that may follow
/// the folder, would otherwise reach everything the user owns.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn pick_open_folder(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::fs::window_file_dialog(&window).blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?
    .map(|p| p.to_string());
    if picked
        .as_deref()
        .is_some_and(|p| is_too_broad(Path::new(p)))
    {
        return Err("TOO_BROAD".to_string());
    }
    Ok(picked)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(root: &Path, rel: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    fn rels(index: &FolderIndex) -> Vec<&str> {
        index.files.iter().map(|f| f.rel.as_str()).collect()
    }

    // How the walk skips, orders and stops is tested in crate::walk.
    #[test]
    fn indexes_every_file_type_with_absolute_paths() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "b.md");
        touch(dir.path(), "photo.png");
        touch(dir.path(), ".hidden.md");
        let index = index(dir.path(), &LIMITS);
        assert_eq!(rels(&index), ["b.md", "photo.png"]);
        assert!(!index.truncated);
        assert_eq!(
            index.files[0].path,
            dir.path().join("b.md").to_string_lossy().into_owned()
        );
    }

    #[test]
    fn says_when_a_limit_was_hit() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "a.md");
        touch(dir.path(), "b.md");
        let limits = Limits { files: 1, ..LIMITS };
        assert!(index(dir.path(), &limits).truncated);
    }

    #[test]
    fn refuses_a_root_that_is_too_broad() {
        let err = tauri::async_runtime::block_on(index_folder("/".to_string())).unwrap_err();
        assert_eq!(err, "TOO_BROAD");
        if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
            let err =
                tauri::async_runtime::block_on(index_folder(home.to_string_lossy().into_owned()))
                    .unwrap_err();
            assert_eq!(err, "TOO_BROAD");
        }
    }

    #[test]
    fn indexes_a_folder_through_the_command() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "a.md");
        let index =
            tauri::async_runtime::block_on(index_folder(dir.path().to_string_lossy().into_owned()))
                .unwrap();
        assert_eq!(rels(&index), ["a.md"]);
    }

    /// How long the walk takes on a real folder: `TEXTUS_INDEX_BENCH=<dir>
    /// cargo test --release index_benchmark -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn index_benchmark() {
        let Some(dir) = std::env::var_os("TEXTUS_INDEX_BENCH") else {
            return;
        };
        let root = PathBuf::from(dir);
        for _ in 0..3 {
            let start = std::time::Instant::now();
            let index = index(&root, &LIMITS);
            println!(
                "{} files, truncated {}, {:?}",
                index.files.len(),
                index.truncated,
                start.elapsed()
            );
        }
    }
}
