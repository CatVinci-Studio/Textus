//! What Textus keeps for a document beside the app's data - the writer's
//! notes and tracked changes, the AI's undecided proposals, the undo
//! history - follows it when it, or its folder, moves in Textus.

use crate::commands::own_notes::{part_file_in, OwnPart};
use crate::commands::undo_files;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// The documents a move took along, as (old path, new path): the one
/// document, or every file now under the folder `to`.
fn moved_pairs(from: &str, to: &str) -> Vec<(String, String)> {
    if !Path::new(to).is_dir() {
        return vec![(from.to_string(), to.to_string())];
    }
    let mut pairs = Vec::new();
    let mut stack = vec![PathBuf::from(to)];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() {
                stack.push(path);
            } else if let Some(rest) = path.to_str().and_then(|p| p.strip_prefix(to)) {
                pairs.push((format!("{from}{rest}"), format!("{to}{rest}")));
            }
        }
    }
    pairs
}

/// `old` renamed to `new` when it is there and `new` isn't yet.
fn carry(old: &Path, new: &Path) {
    if old.exists() && !new.exists() {
        let _ = std::fs::rename(old, new);
    }
}

/// Moves what is kept under `data` for `from` (a document or a folder) to `to`.
pub(crate) fn move_in(data: &Path, from: &str, to: &str) -> Result<(), String> {
    for (old, new) in moved_pairs(from, to) {
        for part in [OwnPart::Notes, OwnPart::Revisions] {
            carry(
                &part_file_in(data, &old, part),
                &part_file_in(data, &new, part),
            );
        }
        let (was, now) = (
            crate::ai::kept_proposals::pending_file_in(data, &old),
            crate::ai::kept_proposals::pending_file_in(data, &new),
        );
        carry(&was, &now);
        carry(
            &crate::ai::kept_proposals::pictures_dir(&was),
            &crate::ai::kept_proposals::pictures_dir(&now),
        );
    }
    undo_files::move_in(&data.join("undo"), from, to)
}

/// What is kept for `from` follows it to `to` (both already moved on disk).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn document_data_move(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        move_in(&data, &from, &to)?;
        // Its conversations too, every document of a moved folder's.
        let stores = app.state::<crate::settings::Stores>();
        crate::settings::move_conversations(&app, &stores, &[(from, to)]);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_proposals_and_history_follow_a_document_and_a_folder() {
        let data = tempfile::tempdir().unwrap();
        let docs = tempfile::tempdir().unwrap();
        let root = docs.path().to_str().unwrap();
        let (a, b) = (format!("{root}/a.md"), format!("{root}/kept/b.md"));
        std::fs::create_dir_all(docs.path().join("kept")).unwrap();
        std::fs::write(&b, "x").unwrap();
        let notes = part_file_in(data.path(), &a, OwnPart::Notes);
        std::fs::create_dir_all(notes.parent().unwrap()).unwrap();
        std::fs::write(&notes, "[1]").unwrap();
        let pending = crate::ai::kept_proposals::pending_file_in(data.path(), &a);
        std::fs::create_dir_all(pending.parent().unwrap()).unwrap();
        std::fs::write(&pending, "{}").unwrap();
        undo_files::save_in(&data.path().join("undo"), &a, "h", "[]").unwrap();

        move_in(data.path(), &a, &b).unwrap();
        assert!(part_file_in(data.path(), &b, OwnPart::Notes).is_file());
        assert!(crate::ai::kept_proposals::pending_file_in(data.path(), &b).is_file());
        assert!(undo_files::load_in(&data.path().join("undo"), &b, "h").is_some());

        // The folder moves: its documents' notes go with it.
        let moved = format!("{root}/moved");
        std::fs::rename(docs.path().join("kept"), &moved).unwrap();
        move_in(data.path(), &format!("{root}/kept"), &moved).unwrap();
        let c = format!("{moved}/b.md");
        assert!(part_file_in(data.path(), &c, OwnPart::Notes).is_file());
        assert!(!notes.exists());
    }
}
