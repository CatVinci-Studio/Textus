//! Undo history kept for a document whose editor was let go (a tab out of
//! sight a while) or closed, like Vim's undofile: one file per document in
//! the app's data folder, kept with the text it ends at, so it is used only
//! when the document opens at that text again. Old ones go after 30 days,
//! and the oldest first once all of them pass 50 MB.

use serde::{Deserialize, Serialize};

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

const KEPT_FOR: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const KEPT_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct UndoFile {
    path: String,
    /// The text the history ends at, as the editor hashes it.
    hash: String,
    history: String,
}

pub(crate) fn undo_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("undo"))
}

fn file_for(dir: &Path, path: &str) -> PathBuf {
    let name = crate::ids::path_key(path, 16);
    dir.join(format!("{name}.json"))
}

fn read(file: &Path) -> Option<UndoFile> {
    crate::json_file::read_or_set_aside(file)
}

pub(crate) fn save_in(dir: &Path, path: &str, hash: &str, history: &str) -> Result<(), String> {
    let kept = UndoFile {
        path: path.into(),
        hash: hash.into(),
        history: history.into(),
    };
    crate::json_file::save(&file_for(dir, path), &kept).map_err(|e| e.to_string())?;
    sweep(dir, SystemTime::now());
    Ok(())
}

pub(crate) fn load_in(dir: &Path, path: &str, hash: &str) -> Option<String> {
    read(&file_for(dir, path))
        .filter(|f| f.path == path && f.hash == hash)
        .map(|f| f.history)
}

/// The history of the document `from`, or of every document in the folder
/// `from`, moved to `to`.
pub(crate) fn move_in(dir: &Path, from: &str, to: &str) -> Result<(), String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let Some(mut kept) = read(&entry.path()) else {
            continue;
        };
        let Some(moved) = crate::ids::moved_path(&kept.path, from, to) else {
            continue;
        };
        let old = file_for(dir, &kept.path);
        kept.path = moved;
        crate::json_file::save(&file_for(dir, &kept.path), &kept).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(old);
    }
    Ok(())
}

/// Takes away what is older than KEPT_FOR, then the oldest until the rest
/// fit in KEPT_BYTES.
fn sweep(dir: &Path, now: SystemTime) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(SystemTime, u64, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            Some((meta.modified().ok()?, meta.len(), e.path()))
        })
        .filter(|(_, _, p)| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort_by_key(|(when, ..)| *when);
    let mut total: u64 = files.iter().map(|(_, len, _)| len).sum();
    for (when, len, path) in files {
        let old = now.duration_since(when).unwrap_or_default() > KEPT_FOR;
        if !old && total <= KEPT_BYTES {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total -= len;
        }
    }
}

/// Keeps `history` for the document at `path` whose text hashes to `hash`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn undo_file_save(
    app: AppHandle,
    path: String,
    hash: String,
    history: String,
) -> Result<(), String> {
    let dir = undo_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || save_in(&dir, &path, &hash, &history))
        .await
        .map_err(|e| e.to_string())?
}

/// The history kept for `path`, if it ends at the text hashing to `hash`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn undo_file_load(
    app: AppHandle,
    path: String,
    hash: String,
) -> Result<Option<String>, String> {
    let dir = undo_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || load_in(&dir, &path, &hash))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_is_given_back_only_for_the_text_it_ends_at() {
        let dir = tempfile::tempdir().unwrap();
        save_in(dir.path(), "/notes/a.md", "h1", "[[1]]").unwrap();
        assert_eq!(
            load_in(dir.path(), "/notes/a.md", "h1").as_deref(),
            Some("[[1]]")
        );
        assert_eq!(load_in(dir.path(), "/notes/a.md", "h2"), None);
        assert_eq!(load_in(dir.path(), "/notes/b.md", "h1"), None);
    }

    #[test]
    fn history_follows_a_renamed_document() {
        let dir = tempfile::tempdir().unwrap();
        save_in(dir.path(), "/notes/a.md", "h1", "[[1]]").unwrap();
        move_in(dir.path(), "/notes/a.md", "/notes/b.md").unwrap();
        assert_eq!(load_in(dir.path(), "/notes/a.md", "h1"), None);
        assert_eq!(
            load_in(dir.path(), "/notes/b.md", "h1").as_deref(),
            Some("[[1]]")
        );
        move_in(dir.path(), "/notes", "/kept").unwrap();
        assert_eq!(
            load_in(dir.path(), "/kept/b.md", "h1").as_deref(),
            Some("[[1]]")
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn old_history_goes_and_the_oldest_goes_first_past_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        save_in(dir.path(), "/a.md", "h", "x").unwrap();
        save_in(dir.path(), "/b.md", "h", "y").unwrap();
        let count = || std::fs::read_dir(dir.path()).unwrap().count();
        sweep(dir.path(), SystemTime::now());
        assert_eq!(count(), 2);
        sweep(
            dir.path(),
            SystemTime::now() + KEPT_FOR + Duration::from_secs(60),
        );
        assert_eq!(count(), 0);

        save_in(dir.path(), "/a.md", "h", "x").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        let big = "z".repeat(KEPT_BYTES as usize);
        save_in(dir.path(), "/b.md", "h", &big).unwrap();
        assert_eq!(load_in(dir.path(), "/a.md", "h"), None);
        assert!(load_in(dir.path(), "/b.md", "h").is_none());
    }
}
