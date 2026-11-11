//! Where a conversation's file changes are kept, and putting one on disk
//! or taking it off.

use super::{write, FileChange};
use std::path::{Path, PathBuf};

pub(super) fn save(record: &Path, change: &FileChange) -> Result<(), String> {
    std::fs::create_dir_all(record).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(change).map_err(|e| e.to_string())?;
    crate::atomic::write_sync(&record.join(format!("{}.json", change.id)), text)
        .map_err(|e| e.to_string())
}

pub(super) fn load(record: &Path, id: &str) -> Result<FileChange, String> {
    if !crate::ai::scratch::valid_id(id) {
        return Err("Unknown change.".to_string());
    }
    let text = std::fs::read_to_string(record.join(format!("{id}.json")))
        .map_err(|_| "That change is no longer kept.".to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Where `conversation`'s changes are kept: the app's data, which the
/// system doesn't clear as it does a temporary folder (they undo changes to
/// the user's files, and hold a file taken away where there is no Trash).
/// Those an older Textus kept in the conversation's scratch folder move
/// there the first time.
pub(super) fn record_of(conversation: &str) -> Result<PathBuf, String> {
    let scratch = crate::ai::scratch::conversation_dir(conversation)?.join("changes");
    let Some(data) = crate::ai::kept_proposals::app_data_dir() else {
        return Ok(scratch);
    };
    let record = data.join("ai-changes").join(conversation);
    if scratch.is_dir() && !record.exists() {
        if let Some(parent) = record.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if std::fs::rename(&scratch, &record).is_err() {
            return Ok(scratch);
        }
    }
    Ok(record)
}

/// How long a conversation's change records are kept after its last change.
const KEPT_FOR: std::time::Duration = std::time::Duration::from_secs(90 * 24 * 60 * 60);

/// Lets go of change records no conversation has touched for
/// [`KEPT_FOR`]: to the Trash where there is one (a record may hold a file
/// taken away), and only records - never the user's own files.
pub(crate) fn forget_old_records(data: &Path) {
    let Ok(entries) = std::fs::read_dir(data.join("ai-changes")) else {
        return;
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|at| now.duration_since(at).ok())
            .is_some_and(|age| age > KEPT_FOR);
        if old && entry.path().is_dir() {
            let _ = crate::atomic::to_trash(&entry.path());
        }
    }
}

/// Puts `change` on disk (`on`) or takes it off: written, or the file
/// back as it was - one the change made moved to the Trash, never
/// deleted. Refused where the file no longer reads as the change left it.
pub(super) fn set(record: &Path, change: &mut FileChange, on: bool) -> Result<(), String> {
    if change.applied == on {
        return Ok(());
    }
    let file = Path::new(&change.file);
    let now = std::fs::read_to_string(file).ok();
    let expected = if on {
        change.before.clone()
    } else {
        Some(change.after.clone())
    };
    if now != expected {
        return Err(format!(
            "`{}` was changed since, so it is left as it is.",
            change.path
        ));
    }
    match (on, &change.before) {
        (true, _) => write(file, &change.after)?,
        (false, Some(before)) => write(file, before)?,
        // A file it made, discarded: to the Trash, where the user can get it
        // back; set aside in the record where there is none.
        (false, None) => {
            // Tests' files, and a phone's, go aside in the record.
            #[cfg(all(desktop, not(test)))]
            let trashed = trash::delete(file).is_ok();
            #[cfg(any(not(desktop), test))]
            let trashed = false;
            if !trashed {
                set_aside(file, &record.join(format!("{}.removed", change.id)))?
            }
        }
    }
    change.applied = on;
    Ok(())
}

/// Moves `file` to `to`; across disks (a scratch folder in memory), a copy
/// kept there first.
fn set_aside(file: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(file, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(file, to).map_err(|e| e.to_string())?;
    std::fs::remove_file(file).map_err(|e| e.to_string())
}
