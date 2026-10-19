//! The folder the sidebar is opened on (File > Open Folder…) and the index
//! behind its file-name search. The frontend half is src/app/useOpenFolder.ts
//! and src/sidebar/FileSearch.tsx.

use crate::ai::project::{is_too_broad, SKIPPED_DIRS};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// What the search lists: the documents Textus opens, the same types
/// File > Open offers before "All files" (fs.rs's open_document_filters).
const INDEXED_EXTENSIONS: &[&str] = &["md", "markdown", "txt", "text"];

/// Where the walk stops. A writing folder this size is rare; a folder that
/// is really a whole disk of code must not keep a thread busy for long.
/// Each limit leaves the index marked `truncated`, which the sidebar says.
struct Limits {
    files: usize,
    entries: usize,
    depth: usize,
}

const LIMITS: Limits = Limits {
    files: 10_000,
    entries: 200_000,
    depth: 24,
};

/// One indexed file. Shared with the frontend's IndexedFile in
/// src/platform/ipc.ts - change both.
#[derive(Serialize, Debug, PartialEq)]
pub struct IndexedFile {
    /// Absolute, to open it.
    path: String,
    /// From the indexed folder, `/`-separated, to show where it is.
    rel: String,
}

/// Shared with the frontend's FolderIndex in src/platform/ipc.ts.
#[derive(Serialize, Debug)]
pub struct FolderIndex {
    files: Vec<IndexedFile>,
    /// A limit was hit: there may be more files than `files` holds.
    truncated: bool,
}

fn is_indexed(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| INDEXED_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// The documents under `root`, depth-first in name order (a folder's files
/// before its subfolders'), skipping hidden entries and SKIPPED_DIRS as the
/// AI's project walk does. Symlinks are not followed, so a link back up the
/// tree can't loop.
fn index(root: &Path, limits: &Limits) -> FolderIndex {
    let mut files = Vec::new();
    let mut visited = 0usize;
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        visited += entries.len();
        if visited > limits.entries {
            return FolderIndex {
                files,
                truncated: true,
            };
        }
        entries.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
        let mut subdirs = Vec::new();
        for entry in entries {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                if !SKIPPED_DIRS.contains(&name.as_ref()) && depth + 1 < limits.depth {
                    subdirs.push((path, depth + 1));
                }
            } else if kind.is_file() && is_indexed(&path) {
                if files.len() >= limits.files {
                    return FolderIndex {
                        files,
                        truncated: true,
                    };
                }
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                files.push(IndexedFile {
                    path: path.to_string_lossy().into_owned(),
                    rel,
                });
            }
        }
        // Reversed so the stack pops subfolders in name order.
        stack.extend(subdirs.into_iter().rev());
    }
    FolderIndex {
        files,
        truncated: false,
    }
}

/// The documents under `root`, for the sidebar's file-name search. Refuses
/// the home folder and a drive root ("TOO_BROAD"), as the AI's project
/// folder does: a walk there would be everything the user owns.
#[tauri::command]
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

    /// A throwaway folder under the system temp dir, removed when dropped.
    struct Scratch(PathBuf);

    impl Drop for Scratch {
        fn drop(&mut self) {
            // Only ever a folder this module made under the temp dir.
            let ours = self
                .0
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("textus-folder-"));
            if ours
                && self
                    .0
                    .starts_with(std::env::temp_dir().canonicalize().unwrap())
            {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }

    fn scratch(name: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("textus-folder-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        Scratch(dir.canonicalize().unwrap())
    }

    fn touch(root: &Path, rel: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"x").unwrap();
    }

    fn rels(index: &FolderIndex) -> Vec<&str> {
        index.files.iter().map(|f| f.rel.as_str()).collect()
    }

    #[test]
    fn lists_documents_in_name_order_with_a_folders_files_first() {
        let dir = scratch("order");
        touch(&dir.0, "b.md");
        touch(&dir.0, "A.txt");
        touch(&dir.0, "notes/章节一.markdown");
        touch(&dir.0, "notes/deep/c.md");
        let index = index(&dir.0, &LIMITS);
        assert_eq!(
            rels(&index),
            ["A.txt", "b.md", "notes/章节一.markdown", "notes/deep/c.md"]
        );
        assert!(!index.truncated);
        assert_eq!(
            index.files[1].path,
            dir.0.join("b.md").to_string_lossy().into_owned()
        );
    }

    #[test]
    fn skips_hidden_entries_build_folders_and_other_file_types() {
        let dir = scratch("skips");
        touch(&dir.0, "keep.md");
        touch(&dir.0, ".hidden.md");
        touch(&dir.0, ".git/notes.md");
        touch(&dir.0, "node_modules/pkg/readme.md");
        touch(&dir.0, "target/out.md");
        touch(&dir.0, "photo.png");
        touch(&dir.0, "data.json");
        assert_eq!(rels(&index(&dir.0, &LIMITS)), ["keep.md"]);
    }

    #[test]
    fn stops_at_the_file_limit_and_says_so() {
        let dir = scratch("files-cap");
        for i in 0..5 {
            touch(&dir.0, &format!("{i}.md"));
        }
        let limits = Limits { files: 3, ..LIMITS };
        let index = index(&dir.0, &limits);
        assert_eq!(rels(&index), ["0.md", "1.md", "2.md"]);
        assert!(index.truncated);
    }

    #[test]
    fn stops_at_the_entries_limit_however_few_documents_it_found() {
        let dir = scratch("entries-cap");
        touch(&dir.0, "a/one.md");
        for i in 0..10 {
            touch(&dir.0, &format!("b/{i}.png"));
        }
        let limits = Limits {
            entries: 6,
            ..LIMITS
        };
        let index = index(&dir.0, &limits);
        assert_eq!(rels(&index), ["a/one.md"]);
        assert!(index.truncated);
    }

    #[test]
    fn does_not_descend_past_the_depth_limit() {
        let dir = scratch("depth");
        touch(&dir.0, "top.md");
        touch(&dir.0, "1/2/3/deep.md");
        let limits = Limits { depth: 2, ..LIMITS };
        assert_eq!(rels(&index(&dir.0, &limits)), ["top.md"]);
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
        let dir = scratch("command");
        touch(&dir.0, "a.md");
        let index =
            tauri::async_runtime::block_on(index_folder(dir.0.to_string_lossy().into_owned()))
                .unwrap();
        assert_eq!(rels(&index), ["a.md"]);
    }
}
