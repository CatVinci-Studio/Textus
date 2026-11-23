//! Files and folders dragged from a file manager onto a folder of the
//! sidebar's tree: copied in, never moved, never over anything there.

use super::dropped::{copy_file_new, into_free_name};
use super::secrets::{not_a_secret, own_config_dir};
use super::*;

/// Copies the file or folder `source` (a folder with all it holds) into the
/// folder `into` under its own name, or numbered as a file manager names a
/// copy (`report 2.pdf`, `photos 2`) when that is taken, and returns the
/// copy's path in `into`'s spelling. A folder is never copied into itself.
/// Its TypeScript side is `fs.copyIntoFolder` in src/platform/ipc-files.ts.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn copy_into_folder(
    app: tauri::AppHandle,
    source: String,
    into: String,
) -> Result<String, String> {
    require_non_empty(&source)?;
    require_non_empty(&into)?;
    not_a_secret(&app, &source)?;
    let config = own_config_dir(&app);
    let (from, dir) = (PathBuf::from(&source), PathBuf::from(&into));
    let name = tokio::task::spawn_blocking(move || {
        copy_entry(&from, &dir, &|p: &Path| {
            config.as_deref().is_some_and(|c| p.starts_with(c))
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Path::new(&into).join(name).to_string_lossy().to_string())
}

/// `copy_into_folder` off the async runtime: the name the copy took.
/// `secret`: a place never copied from (the app's keys).
fn copy_entry(from: &Path, into: &Path, secret: &dyn Fn(&Path) -> bool) -> Result<String, String> {
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
    let io = |e: std::io::Error| e.to_string();
    if from.is_dir() {
        if into.starts_with(&from) {
            return Err(crate::errors::error("copyIntoItself"));
        }
        into_free_name(
            &into,
            copy_names(&name, crate::ids::Numbered::SpaceWhole),
            |to| {
                std::fs::create_dir(to)?;
                copy_tree(&from, to, secret)
            },
            |_| false,
        )
        .map_err(io)
    } else {
        into_free_name(
            &into,
            copy_names(&name, crate::ids::Numbered::Space),
            |to| copy_file_new(&from, to),
            |_| false,
        )
        .map_err(io)
    }
}

/// `name`, then numbered from 2 as a file manager names a copy.
fn copy_names(name: &str, style: crate::ids::Numbered) -> impl Iterator<Item = String> + '_ {
    (0..10_000)
        .filter(|&n| n != 1)
        .map(move |n| crate::ids::numbered(name, n, style))
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
            copy_entry(&photos, &notes, NOTHING_SECRET).unwrap(),
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
            copy_entry(&report, &notes, NOTHING_SECRET).unwrap(),
            "report 2.pdf"
        );
        assert_eq!(
            copy_entry(&report, &notes, NOTHING_SECRET).unwrap(),
            "report 3.pdf"
        );
        assert_eq!(std::fs::read(notes.join("report.pdf")).unwrap(), b"old");
        assert_eq!(std::fs::read(notes.join("report 2.pdf")).unwrap(), b"new");
        // The same bytes are copied again too: a copy is what was asked for.
        assert_eq!(
            copy_entry(&notes.join("report.pdf"), &notes, NOTHING_SECRET).unwrap(),
            "report 4.pdf"
        );
        // A folder after its whole name, a dot in it or not.
        let folder = downloads.join("my.photos");
        assert_eq!(
            copy_entry(&folder, &notes, NOTHING_SECRET).unwrap(),
            "my.photos"
        );
        assert_eq!(
            copy_entry(&folder, &notes, NOTHING_SECRET).unwrap(),
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
            let err = copy_entry(&book, &into, NOTHING_SECRET).unwrap_err();
            assert!(crate::errors::is(&err, "copyIntoItself"), "{err}");
        }
        assert!(!book.join("book").exists());
        assert!(!book.join("chapters/book").exists());
        // Into its own folder, beside itself: a numbered copy.
        assert_eq!(copy_entry(&book, &root, NOTHING_SECRET).unwrap(), "book 2");
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
        copy_entry(&source, &into, &secret).unwrap();
        assert!(into.join("source/note.md").is_file());
        assert!(!into.join("source/keys").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
