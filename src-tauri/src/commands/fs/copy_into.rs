//! The sidebar tree's copies: a paste, Duplicate, a drag with ⌥ or Ctrl,
//! and files dragged from a file manager onto a folder. Never over anything.

use super::dropped::{copy_file_new, into_free_name};
use super::secrets::{not_a_secret, own_config_dir};
use super::*;
use crate::ids::Numbered;

/// How a copy is named: as itself, refused when that is taken; numbered
/// when taken (`report 2.pdf`), as a file manager keeps both; or as a copy
/// beside the original in the words of the pattern, as Finder names one
/// ("{name} copy": `report copy.pdf`, then `report copy 2.pdf`).
/// Its TypeScript side is `CopyNaming` in src/platform/bindings/files.ts.
#[derive(serde::Deserialize, Clone, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum CopyNaming {
    Own,
    Numbered,
    Beside(String),
}

/// The file tree's copy (a paste, Duplicate, a drag with ⌥ or Ctrl): the
/// file or folder `path` copied into the folder `into`, named as `naming`
/// says. Returns the copy's path in `into`'s spelling. Its TypeScript side
/// is `fs.copyEntry` in src/platform/ipc-files.ts.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn tree_copy_entry(
    app: tauri::AppHandle,
    path: String,
    into: String,
    naming: CopyNaming,
) -> Result<String, String> {
    require_non_empty(&path)?;
    require_non_empty(&into)?;
    not_a_secret(&app, &path)?;
    let config = own_config_dir(&app);
    let (from, dir) = (PathBuf::from(&path), PathBuf::from(&into));
    let name = tokio::task::spawn_blocking(move || {
        copy_entry(&from, &dir, &naming, &|p: &Path| {
            config.as_deref().is_some_and(|c| p.starts_with(c))
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Path::new(&into).join(name).to_string_lossy().to_string())
}

/// The names a copy of `name` tries, in order, as `naming` says.
fn names_for(naming: &CopyNaming, name: &str, is_dir: bool) -> Box<dyn Iterator<Item = String>> {
    let name = name.to_string();
    match naming {
        CopyNaming::Own => Box::new(std::iter::once(name)),
        CopyNaming::Numbered => Box::new(copy_names(name, Numbered::for_entry(is_dir))),
        CopyNaming::Beside(pattern) => {
            let (stem, ext) = match name.rsplit_once('.') {
                Some((stem, ext)) if !is_dir && !stem.is_empty() => {
                    (stem.to_string(), format!(".{ext}"))
                }
                _ => (name.clone(), String::new()),
            };
            let pattern = if pattern.contains("{name}") {
                pattern.as_str()
            } else {
                "{name} copy"
            };
            let first = format!("{}{ext}", pattern.replace("{name}", &stem));
            Box::new(copy_names(first, Numbered::for_entry(is_dir)))
        }
    }
}

/// `tree_copy_entry` off the async runtime: the name the copy took.
/// `secret`: a place never copied from (the app's keys).
fn copy_entry(
    from: &Path,
    into: &Path,
    naming: &CopyNaming,
    secret: &dyn Fn(&Path) -> bool,
) -> Result<String, String> {
    let from = std::fs::canonicalize(from).map_err(|e| e.to_string())?;
    let into = std::fs::canonicalize(into).map_err(|e| e.to_string())?;
    if !into.is_dir() {
        return Err(crate::errors::error("notFolder"));
    }
    let name = from
        .file_name()
        .ok_or("No file name")?
        .to_string_lossy()
        .to_string();
    if matches!(naming, CopyNaming::Own) && std::fs::symlink_metadata(into.join(&name)).is_ok() {
        return Err(crate::errors::error("exists"));
    }
    if from.is_dir() {
        if into.starts_with(&from) {
            return Err(crate::errors::error("copyIntoItself"));
        }
        // The name claimed first, then filled: what fails inside is no
        // taken name to number past.
        let made = into_free_name(
            &into,
            names_for(naming, &name, true),
            |to| std::fs::create_dir(to),
            |_| false,
        )
        .map_err(crate::errors::exists_or)?;
        let to = into.join(&made);
        if let Err(e) = copy_tree(&from, &to, secret) {
            // Half a copy is no copy: the folder made here a moment ago goes.
            let _ = std::fs::remove_dir_all(&to);
            return Err(e.to_string());
        }
        Ok(made)
    } else {
        into_free_name(
            &into,
            names_for(naming, &name, false),
            |to| copy_file_new(&from, to),
            |_| false,
        )
        .map_err(crate::errors::exists_or)
    }
}

/// `name`, then numbered from 2 as a file manager names a copy.
fn copy_names(name: String, style: Numbered) -> impl Iterator<Item = String> {
    (0..10_000)
        .filter(|&n| n != 1)
        .map(move |n| crate::ids::numbered(&name, n, style))
}

/// What the folder `from` holds, copied into the new folder `to`. A link to a
/// file is copied as that file; a link to a folder is left out, as a loop
/// back up would never end.
fn copy_tree(from: &Path, to: &Path, secret: &dyn Fn(&Path) -> bool) -> std::io::Result<()> {
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let path = entry.path();
        let kind = entry.file_type()?;
        let target = if kind.is_symlink() {
            match std::fs::canonicalize(&path) {
                Ok(real) if real.is_file() => real,
                _ => continue,
            }
        } else {
            path.clone()
        };
        if secret(&target) {
            continue;
        }
        let dest = to.join(entry.file_name());
        if kind.is_dir() {
            std::fs::create_dir(&dest)?;
            copy_tree(&path, &dest, secret)?;
        } else {
            std::fs::copy(&target, &dest)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("textus-copy-into-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    const NOTHING_SECRET: &dyn Fn(&Path) -> bool = &|_| false;

    #[test]
    fn a_folder_is_copied_with_all_it_holds() {
        let root = scratch("tree");
        let photos = root.join("downloads/photos");
        std::fs::create_dir_all(photos.join("trip/day 1")).unwrap();
        std::fs::write(photos.join("cover.png"), b"c").unwrap();
        std::fs::write(photos.join("trip/day 1/boat.png"), b"b").unwrap();
        std::fs::create_dir_all(photos.join("empty")).unwrap();
        let notes = root.join("notes");
        std::fs::create_dir_all(&notes).unwrap();

        assert_eq!(
            copy_entry(&photos, &notes, &CopyNaming::Numbered, NOTHING_SECRET).unwrap(),
            "photos"
        );
        let copy = notes.join("photos");
        assert_eq!(std::fs::read(copy.join("cover.png")).unwrap(), b"c");
        assert_eq!(
            std::fs::read(copy.join("trip/day 1/boat.png")).unwrap(),
            b"b"
        );
        assert!(copy.join("empty").is_dir());
        // Copied, not moved.
        assert!(photos.join("cover.png").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_taken_name_is_numbered_never_overwritten() {
        let root = scratch("clash");
        let downloads = root.join("downloads");
        let notes = root.join("notes");
        std::fs::create_dir_all(downloads.join("my.photos")).unwrap();
        std::fs::create_dir_all(&notes).unwrap();
        std::fs::write(downloads.join("report.pdf"), b"new").unwrap();
        std::fs::write(notes.join("report.pdf"), b"old").unwrap();

        let report = downloads.join("report.pdf");
        assert_eq!(
            copy_entry(&report, &notes, &CopyNaming::Numbered, NOTHING_SECRET).unwrap(),
            "report 2.pdf"
        );
        assert_eq!(
            copy_entry(&report, &notes, &CopyNaming::Numbered, NOTHING_SECRET).unwrap(),
            "report 3.pdf"
        );
        assert_eq!(std::fs::read(notes.join("report.pdf")).unwrap(), b"old");
        assert_eq!(std::fs::read(notes.join("report 2.pdf")).unwrap(), b"new");
        // The same bytes are copied again too: a copy is what was asked for.
        assert_eq!(
            copy_entry(
                &notes.join("report.pdf"),
                &notes,
                &CopyNaming::Numbered,
                NOTHING_SECRET
            )
            .unwrap(),
            "report 4.pdf"
        );
        // A folder after its whole name, a dot in it or not.
        let folder = downloads.join("my.photos");
        assert_eq!(
            copy_entry(&folder, &notes, &CopyNaming::Numbered, NOTHING_SECRET).unwrap(),
            "my.photos"
        );
        assert_eq!(
            copy_entry(&folder, &notes, &CopyNaming::Numbered, NOTHING_SECRET).unwrap(),
            "my.photos 2"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_folder_is_never_copied_into_itself_or_below() {
        let root = scratch("itself");
        let book = root.join("book");
        std::fs::create_dir_all(book.join("chapters")).unwrap();
        for into in [book.clone(), book.join("chapters")] {
            let err = copy_entry(&book, &into, &CopyNaming::Numbered, NOTHING_SECRET).unwrap_err();
            assert!(crate::errors::is(&err, "copyIntoItself"), "{err}");
        }
        assert!(!book.join("book").exists());
        assert!(!book.join("chapters/book").exists());
        // Into its own folder, beside itself: a numbered copy.
        assert_eq!(
            copy_entry(&book, &root, &CopyNaming::Numbered, NOTHING_SECRET).unwrap(),
            "book 2"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_copy_beside_is_named_as_a_file_manager_names_one() {
        let root = scratch("beside");
        std::fs::create_dir_all(root.join("my.photos")).unwrap();
        std::fs::write(root.join("plan.md"), b"p").unwrap();
        let copy = CopyNaming::Beside("{name} copy".into());
        let plan = root.join("plan.md");
        assert_eq!(
            copy_entry(&plan, &root, &copy, NOTHING_SECRET).unwrap(),
            "plan copy.md"
        );
        assert_eq!(
            copy_entry(&plan, &root, &copy, NOTHING_SECRET).unwrap(),
            "plan copy 2.md"
        );
        let zh = CopyNaming::Beside("{name} 副本".into());
        assert_eq!(
            copy_entry(&plan, &root, &zh, NOTHING_SECRET).unwrap(),
            "plan 副本.md"
        );
        // A folder's whole name, a dot in it or not.
        let photos = root.join("my.photos");
        assert_eq!(
            copy_entry(&photos, &root, &copy, NOTHING_SECRET).unwrap(),
            "my.photos copy"
        );
        // Its own name refused when taken, never numbered or over it.
        let other = root.join("other");
        std::fs::create_dir_all(&other).unwrap();
        assert_eq!(
            copy_entry(&plan, &other, &CopyNaming::Own, NOTHING_SECRET).unwrap(),
            "plan.md"
        );
        let err = copy_entry(&plan, &other, &CopyNaming::Own, NOTHING_SECRET).unwrap_err();
        assert!(crate::errors::is(&err, "exists"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn what_is_secret_is_left_out() {
        let root = scratch("secret");
        let source = root.join("source");
        std::fs::create_dir_all(source.join("keys")).unwrap();
        std::fs::write(source.join("keys/api.json"), b"k").unwrap();
        std::fs::write(source.join("note.md"), b"n").unwrap();
        let into = root.join("into");
        std::fs::create_dir_all(&into).unwrap();
        let keys = std::fs::canonicalize(source.join("keys")).unwrap();
        let secret = move |p: &Path| p.starts_with(&keys);
        copy_entry(&source, &into, &CopyNaming::Numbered, &secret).unwrap();
        assert!(into.join("source/note.md").is_file());
        assert!(!into.join("source/keys").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    #[cfg(unix)]
    fn a_folder_that_fails_halfway_leaves_nothing_behind() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("half");
        let source = root.join("source");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("a.md"), b"a").unwrap();
        let locked = source.join("locked.md");
        std::fs::write(&locked, b"l").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        let into = root.join("into");
        std::fs::create_dir_all(&into).unwrap();
        let unreadable = std::fs::File::open(&locked).is_err();
        let result = copy_entry(&source, &into, &CopyNaming::Numbered, NOTHING_SECRET);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o644)).unwrap();
        // Running as root reads anything: nothing to fail then.
        if unreadable {
            assert!(result.is_err());
            assert!(!into.join("source").exists());
            assert!(!into.join("source 2").exists());
        }
        let _ = std::fs::remove_dir_all(&root);
    }
}
