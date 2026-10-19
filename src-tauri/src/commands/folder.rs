//! The folder the sidebar is opened on (File > Open Folder…) and the index
//! behind its file-name search. The frontend half is src/app/useOpenFolder.ts
//! and src/sidebar/FileSearch.tsx.

use crate::ai::project::{is_too_broad, SKIPPED_DIRS};
use ignore::{WalkBuilder, WalkState};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Where the walk stops. Each limit leaves the index marked `truncated`,
/// which the sidebar says. A folder of writing is far below all of them; a
/// folder that is really a disk of code or photos must not keep the
/// machine busy, and the time budget holds on a slow network drive too.
struct Limits {
    files: usize,
    /// Everything looked at, folders and skipped files included: a tree of
    /// a million entries holding few files still ends.
    entries: usize,
    depth: usize,
    time: Duration,
}

const LIMITS: Limits = Limits {
    files: 50_000,
    entries: 500_000,
    depth: 24,
    time: Duration::from_secs(3),
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

/// Every file under `root`, in path order, the way fd finds them: a
/// parallel walk (the `ignore` crate's, ripgrep's walker) that skips hidden
/// entries and whatever `.gitignore` and `.ignore` files leave out - inside
/// a git repository or not - plus SKIPPED_DIRS, as the AI's project walk
/// does. Symlinks are not followed, so a link back up the tree can't loop.
fn index(root: &Path, limits: &Limits) -> FolderIndex {
    let deadline = Instant::now() + limits.time;
    let files = Mutex::new(Vec::new());
    let visited = AtomicUsize::new(0);
    let truncated = AtomicBool::new(false);
    WalkBuilder::new(root)
        .require_git(false)
        .follow_links(false)
        .max_depth(Some(limits.depth))
        .filter_entry(|entry| {
            !(entry.file_type().is_some_and(|t| t.is_dir())
                && SKIPPED_DIRS.contains(&entry.file_name().to_string_lossy().as_ref()))
        })
        .build_parallel()
        .run(|| {
            Box::new(|entry| {
                let Ok(entry) = entry else {
                    return WalkState::Continue;
                };
                let seen = visited.fetch_add(1, Ordering::Relaxed) + 1;
                if seen > limits.entries || Instant::now() > deadline {
                    truncated.store(true, Ordering::Relaxed);
                    return WalkState::Quit;
                }
                if !entry.file_type().is_some_and(|t| t.is_file()) {
                    return WalkState::Continue;
                }
                let path = entry.path();
                let rel = path
                    .strip_prefix(root)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .replace('\\', "/");
                let mut files = files.lock().unwrap();
                if files.len() >= limits.files {
                    truncated.store(true, Ordering::Relaxed);
                    return WalkState::Quit;
                }
                files.push(IndexedFile {
                    path: path.to_string_lossy().into_owned(),
                    rel,
                });
                WalkState::Continue
            })
        });
    let mut files = files.into_inner().unwrap();
    // The threads finish in any order; the frontend sorts for the reader,
    // this keeps the answer the same from one walk to the next.
    files.sort_by(|a, b| a.rel.cmp(&b.rel));
    FolderIndex {
        files,
        truncated: truncated.into_inner(),
    }
}

/// The files under `root`, for the sidebar's file-name search. Refuses the
/// home folder and a drive root ("TOO_BROAD"), as the AI's project folder
/// does: a walk there would be everything the user owns.
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

    fn write(root: &Path, rel: &str, text: &str) {
        fs::write(root.join(rel), text).unwrap();
    }

    fn rels(index: &FolderIndex) -> Vec<&str> {
        index.files.iter().map(|f| f.rel.as_str()).collect()
    }

    #[test]
    fn lists_every_file_type_in_path_order() {
        let dir = scratch("order");
        touch(&dir.0, "b.md");
        touch(&dir.0, "A.txt");
        touch(&dir.0, "notes/章节一.markdown");
        touch(&dir.0, "notes/deep/c.md");
        touch(&dir.0, "photo.png");
        let index = index(&dir.0, &LIMITS);
        assert_eq!(
            rels(&index),
            [
                "A.txt",
                "b.md",
                "notes/deep/c.md",
                "notes/章节一.markdown",
                "photo.png"
            ]
        );
        assert!(!index.truncated);
        assert_eq!(
            index.files[1].path,
            dir.0.join("b.md").to_string_lossy().into_owned()
        );
    }

    #[test]
    fn skips_hidden_entries_and_build_folders() {
        let dir = scratch("skips");
        touch(&dir.0, "keep.md");
        touch(&dir.0, ".hidden.md");
        touch(&dir.0, ".git/notes.md");
        touch(&dir.0, "node_modules/pkg/readme.md");
        touch(&dir.0, "target/out.md");
        touch(&dir.0, "sub/node_modules/x.md");
        assert_eq!(rels(&index(&dir.0, &LIMITS)), ["keep.md"]);
    }

    #[test]
    fn leaves_out_what_gitignore_and_ignore_files_do_outside_a_repository() {
        let dir = scratch("gitignore");
        write(&dir.0, ".gitignore", "drafts/\n*.log\n");
        touch(&dir.0, "keep.md");
        touch(&dir.0, "drafts/old.md");
        touch(&dir.0, "build.log");
        touch(&dir.0, "notes/a.md");
        touch(&dir.0, "notes/scratch.md");
        write(&dir.0, "notes/.ignore", "scratch.md\n");
        assert_eq!(rels(&index(&dir.0, &LIMITS)), ["keep.md", "notes/a.md"]);
    }

    #[test]
    fn stops_at_the_file_limit_across_threads_and_says_so() {
        let dir = scratch("files-cap");
        for i in 0..200 {
            touch(&dir.0, &format!("{}/{i}.md", i % 8));
        }
        let limits = Limits {
            files: 10,
            ..LIMITS
        };
        let index = index(&dir.0, &limits);
        assert_eq!(index.files.len(), 10);
        assert!(index.truncated);
    }

    #[test]
    fn stops_at_the_entries_limit_however_few_files_it_found() {
        let dir = scratch("entries-cap");
        for i in 0..50 {
            touch(&dir.0, &format!("{}/{i}.md", i % 5));
        }
        let limits = Limits {
            entries: 12,
            ..LIMITS
        };
        let index = index(&dir.0, &limits);
        assert!(index.files.len() < 12);
        assert!(index.truncated);
    }

    #[test]
    fn stops_when_the_time_is_up() {
        let dir = scratch("time");
        touch(&dir.0, "a.md");
        let limits = Limits {
            time: Duration::ZERO,
            ..LIMITS
        };
        assert!(index(&dir.0, &limits).truncated);
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
            let start = Instant::now();
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
