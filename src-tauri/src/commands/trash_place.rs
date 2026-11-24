//! The tree's Trash with a way back: where each item went is kept, so an
//! undo can put it back where it was. macOS through NSFileManager, which
//! names the item in the Trash (the trash crate's Finder way names
//! nothing); Windows and Linux through the trash crate's own list.

use std::path::Path;

/// `path` to the Trash; returns where it went there, the place an undo
/// puts it back from, or None when the system doesn't say.
// A phone deletes instead (tree_ops.rs).
#[cfg_attr(mobile, allow(dead_code))]
pub(crate) fn trash_keeping_place(path: &Path) -> Result<Option<String>, String> {
    platform::trash(path)
}

/// The item the Trash holds at `place` put back at `path`; refused when
/// something is at `path` now (`exists`) or the item is no longer in the
/// Trash (`goneFromTrash`). Never over anything.
pub(crate) fn put_back(place: &str, path: &Path) -> Result<(), String> {
    if std::fs::symlink_metadata(path).is_ok() {
        return Err(crate::errors::error("exists"));
    }
    platform::put_back(place, path)
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    use std::path::Path;

    pub(super) fn trash(path: &Path) -> Result<Option<String>, String> {
        let text = path.to_str().ok_or("Not a UTF-8 path")?;
        let url = NSURL::fileURLWithPath(&NSString::from_str(text));
        let mut went = None;
        NSFileManager::defaultManager()
            .trashItemAtURL_resultingItemURL_error(&url, Some(&mut went))
            .map_err(|e| e.localizedDescription().to_string())?;
        Ok(went
            .and_then(|url| url.path())
            .map(|place| place.to_string()))
    }

    /// The Trash is a folder on the same disk: a rename puts it back.
    pub(super) fn put_back(place: &str, path: &Path) -> Result<(), String> {
        super::rename_back(Path::new(place), path)
    }
}

#[cfg(any(windows, target_os = "linux"))]
mod platform {
    use std::collections::HashSet;
    use std::path::Path;
    use trash::os_limited::{list, restore_all};

    /// The ids of what the Trash holds from `path`.
    fn held_from(path: &Path) -> Result<Vec<trash::TrashItem>, String> {
        Ok(list()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|item| item.original_path() == path)
            .collect())
    }

    pub(super) fn trash(path: &Path) -> Result<Option<String>, String> {
        // What was there from the same path before is told apart by its id.
        let before: HashSet<_> = held_from(path)
            .unwrap_or_default()
            .into_iter()
            .map(|item| item.id)
            .collect();
        trash::delete(path).map_err(|e| e.to_string())?;
        Ok(held_from(path)
            .unwrap_or_default()
            .into_iter()
            .filter(|item| !before.contains(&item.id))
            .max_by_key(|item| item.time_deleted)
            .map(|item| item.id.to_string_lossy().to_string()))
    }

    pub(super) fn put_back(place: &str, path: &Path) -> Result<(), String> {
        let item = list()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|item| item.id.to_string_lossy() == place && item.original_path() == path)
            .ok_or_else(|| crate::errors::error("goneFromTrash"))?;
        restore_all([item]).map_err(|e| match e {
            trash::Error::RestoreCollision { .. } => crate::errors::error("exists"),
            e => e.to_string(),
        })
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
mod platform {
    use std::path::Path;

    #[cfg_attr(mobile, allow(dead_code))]
    pub(super) fn trash(path: &Path) -> Result<Option<String>, String> {
        crate::atomic::user_file_to_trash(path, None).map(|()| None)
    }

    pub(super) fn put_back(_place: &str, _path: &Path) -> Result<(), String> {
        Err(crate::errors::error("goneFromTrash"))
    }
}

/// `place` renamed back to `path`, in the folder it was in.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn rename_back(place: &Path, path: &Path) -> Result<(), String> {
    if std::fs::symlink_metadata(place).is_err() {
        return Err(crate::errors::error("goneFromTrash"));
    }
    std::fs::rename(place, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder standing in for the Trash: the user's own is never touched.
    #[test]
    fn put_back_returns_an_item_and_refuses_a_taken_place_or_a_gone_one() {
        let tmp = tempfile::tempdir().unwrap();
        let trash = tmp.path().join(".Trash");
        let notes = tmp.path().join("notes");
        std::fs::create_dir_all(&trash).unwrap();
        std::fs::create_dir_all(&notes).unwrap();
        let held = trash.join("plan 10.32.15.md");
        std::fs::write(&held, "plan").unwrap();
        let home = notes.join("plan.md");

        std::fs::write(&home, "another").unwrap();
        assert_eq!(
            put_back(held.to_str().unwrap(), &home).unwrap_err(),
            crate::errors::error("exists")
        );
        std::fs::remove_file(&home).unwrap();
        rename_back(&held, &home).unwrap();
        assert_eq!(std::fs::read_to_string(&home).unwrap(), "plan");
        assert_eq!(
            rename_back(&held, &notes.join("again.md")).unwrap_err(),
            crate::errors::error("goneFromTrash")
        );
    }
}
