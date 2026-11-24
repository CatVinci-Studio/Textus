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

    /// What the Trash holds under `path`'s name. Told apart by id, not by
    /// the folder it came from, which the system spells its own way
    /// (Windows' `\\?\C:\…`).
    fn held_named(path: &Path) -> Result<Vec<trash::TrashItem>, String> {
        let name = path.file_name().ok_or("No file name")?;
        Ok(list()
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|item| item.name == name)
            .collect())
    }

    pub(super) fn trash(path: &Path) -> Result<Option<String>, String> {
        let before: HashSet<_> = held_named(path)
            .unwrap_or_default()
            .into_iter()
            .map(|item| item.id)
            .collect();
        trash::delete(path).map_err(|e| e.to_string())?;
        Ok(held_named(path)
            .unwrap_or_default()
            .into_iter()
            .filter(|item| !before.contains(&item.id))
            .max_by_key(|item| item.time_deleted)
            .map(|item| item.id.to_string_lossy().to_string()))
    }

    /// Back where the Trash says it came from, which is `_path`.
    pub(super) fn put_back(place: &str, _path: &Path) -> Result<(), String> {
        let item = list()
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|item| item.id.to_string_lossy() == place)
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

    /// The system's own Trash, once by hand (`--ignored`): a file there and
    /// back, from the boot disk's temp folder and from `TRASH_TEST_DIR`.
    #[test]
    #[ignore]
    fn the_system_trash_keeps_where_it_put_a_file_and_gives_it_back() {
        let dirs = [
            Some(std::env::temp_dir()),
            std::env::var_os("TRASH_TEST_DIR").map(Into::into),
        ];
        for dir in dirs.into_iter().flatten() {
            let file = dir.join(format!("textus-trash-test-{}.md", std::process::id()));
            std::fs::write(&file, "back").unwrap();
            let place = trash_keeping_place(&file).unwrap().expect("where it went");
            assert!(!file.exists());
            put_back(&place, &file).unwrap();
            assert_eq!(std::fs::read_to_string(&file).unwrap(), "back");
            std::fs::remove_file(&file).unwrap();
        }
    }

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
