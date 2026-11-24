//! The tree's Trash with a way back: where each item went is kept, so an
//! undo can put it back where it was. macOS through NSFileManager, which
//! names the item in the Trash (the trash crate's Finder way names
//! nothing); Windows and Linux through the trash crate's own list, read
//! once before a batch and once after it.

use std::path::Path;
#[cfg(desktop)]
use std::path::PathBuf;

/// `paths` to the Trash in turn, each first allowed by `may`, up to one
/// that fails: where the Trash keeps each that went (the place an undo puts
/// it back from, None when the system doesn't say), and why the next one
/// didn't go.
#[cfg(desktop)]
pub(crate) fn trash_keeping_places(
    paths: &[PathBuf],
    may: impl Fn(&Path) -> Result<(), String>,
) -> (Vec<Option<String>>, Option<String>) {
    platform::trash_all(paths, may)
}

/// `one` for each of `paths` in turn, each first allowed by `may`, up to
/// one that fails: what each gave, and why the next one failed.
#[cfg(desktop)]
fn each<T>(
    paths: &[PathBuf],
    may: impl Fn(&Path) -> Result<(), String>,
    mut one: impl FnMut(&Path) -> Result<T, String>,
) -> (Vec<T>, Option<String>) {
    let mut done = Vec::new();
    for path in paths {
        match may(path).and_then(|()| one(path)) {
            Ok(value) => done.push(value),
            Err(e) => return (done, Some(e)),
        }
    }
    (done, None)
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
    use std::path::{Path, PathBuf};

    fn trash(path: &Path) -> Result<Option<String>, String> {
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

    pub(super) fn trash_all(
        paths: &[PathBuf],
        may: impl Fn(&Path) -> Result<(), String>,
    ) -> (Vec<Option<String>>, Option<String>) {
        super::each(paths, may, trash)
    }

    /// The Trash is a folder on the same disk: a rename puts it back.
    pub(super) fn put_back(place: &str, path: &Path) -> Result<(), String> {
        super::rename_back(Path::new(place), path)
    }
}

#[cfg(any(windows, target_os = "linux"))]
mod platform {
    use super::Held;
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};
    use trash::os_limited::{list, restore_all};

    fn held() -> Vec<trash::TrashItem> {
        list().unwrap_or_default()
    }

    pub(super) fn trash_all(
        paths: &[PathBuf],
        may: impl Fn(&Path) -> Result<(), String>,
    ) -> (Vec<Option<String>>, Option<String>) {
        let before: HashSet<_> = held().into_iter().map(|item| item.id).collect();
        let (done, error) = super::each(paths, may, |path| {
            trash::delete(path).map_err(|e| e.to_string())
        });
        let new = held()
            .into_iter()
            .filter(|item| !before.contains(&item.id))
            .map(|item| Held {
                id: item.id.to_string_lossy().to_string(),
                name: item.name.to_string_lossy().to_string(),
                parent: item.original_parent.to_string_lossy().to_string(),
                time: item.time_deleted,
            })
            .collect();
        let went: Vec<String> = paths[..done.len()]
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        (super::places_of(&went, new), error)
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

    #[cfg(desktop)]
    pub(super) fn trash_all(
        paths: &[std::path::PathBuf],
        may: impl Fn(&Path) -> Result<(), String>,
    ) -> (Vec<Option<String>>, Option<String>) {
        super::each(paths, may, |path| {
            crate::atomic::user_file_to_trash(path, None).map(|()| None)
        })
    }

    pub(super) fn put_back(_place: &str, _path: &Path) -> Result<(), String> {
        Err(crate::errors::error("goneFromTrash"))
    }
}

/// An item the system's Trash holds, as its list gives it.
#[cfg_attr(not(any(windows, target_os = "linux", test)), allow(dead_code))]
struct Held {
    id: String,
    name: String,
    /// The folder it came from, in the system's spelling (Windows' `\\?\`).
    parent: String,
    time: i64,
}

/// A path's folder and name, its folder spelled one way: no `\\?\`, "/"
/// between parts, and on Windows in one case.
#[cfg_attr(not(any(windows, target_os = "linux", test)), allow(dead_code))]
fn folder_and_name(path: &str) -> (String, String) {
    let path = path
        .strip_prefix(r"\\?\")
        .unwrap_or(path)
        .replace('\\', "/");
    let path = path.trim_end_matches('/');
    let (dir, name) = path.rsplit_once('/').unwrap_or(("", path));
    let dir = if cfg!(windows) {
        dir.to_lowercase()
    } else {
        dir.to_string()
    };
    (dir, name.to_string())
}

/// Where each path of `went` is kept among `new`, the items the Trash
/// holds that it didn't before: the newest from its folder under its name,
/// else under its name less the extension (a list that shows names as
/// Explorer does); each item taken once.
#[cfg_attr(not(any(windows, target_os = "linux", test)), allow(dead_code))]
fn places_of(went: &[String], mut new: Vec<Held>) -> Vec<Option<String>> {
    new.sort_by_key(|item| std::cmp::Reverse(item.time));
    let mut taken = vec![false; new.len()];
    let mut find = |dir: &str, name: &str| {
        let at = new.iter().enumerate().position(|(i, item)| {
            !taken[i] && {
                let (parent, _) = folder_and_name(&format!("{}/x", item.parent));
                parent == dir && item.name == name
            }
        })?;
        taken[at] = true;
        Some(new[at].id.clone())
    };
    let wanted: Vec<_> = went.iter().map(|p| folder_and_name(p)).collect();
    let mut places: Vec<Option<String>> =
        wanted.iter().map(|(dir, name)| find(dir, name)).collect();
    for (place, (dir, name)) in places.iter_mut().zip(&wanted) {
        if place.is_none() {
            let stem = Path::new(name)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string());
            *place = stem.and_then(|stem| find(dir, &stem));
        }
    }
    places
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
            let (places, error) = trash_keeping_places(std::slice::from_ref(&file), |_| Ok(()));
            assert_eq!(error, None);
            let place = places[0].clone().expect("where it went");
            assert!(!file.exists());
            put_back(&place, &file).unwrap();
            assert_eq!(std::fs::read_to_string(&file).unwrap(), "back");
            std::fs::remove_file(&file).unwrap();
        }
    }

    fn held(id: &str, parent: &str, name: &str, time: i64) -> Held {
        Held {
            id: id.into(),
            name: name.into(),
            parent: parent.into(),
            time,
        }
    }

    /// Windows' list: each item found by the folder it came from and its
    /// name, else its name less the extension, newest first, once each.
    #[test]
    fn each_trashed_path_is_found_by_its_folder_and_name() {
        let went = [
            r"C:\n\a\plan.md".to_string(),
            r"C:\n\b\plan.md".to_string(),
            r"C:\n\b\report.pdf".to_string(),
            r"C:\n\b\gone.md".to_string(),
        ];
        let new = vec![
            held("$R1", r"\\?\C:\n\b", "plan.md", 5),
            held("$R2", r"C:\n\a", "plan.md", 5),
            held("$R0", r"C:\n\a", "plan.md", 1),
            held("$R3", r"C:\n\b", "report", 5),
        ];
        assert_eq!(
            places_of(&went, new),
            [
                Some("$R2".to_string()),
                Some("$R1".to_string()),
                Some("$R3".to_string()),
                None
            ]
        );
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
