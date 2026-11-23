//! A file dragged in from a file manager and linked from a document: copied
//! next to it first, where its pictures go, so the link travels with it.

use super::*;

/// Copies `source` into the folder a pasted picture of `doc_path` would go
/// to (a vault's attachment folder, else Settings > Images > Folder), under
/// its own name - numbered when another file has it, the same one if it is
/// there already - and returns the link to write. Its TypeScript side is
/// `copiedFileLink` in src/app/file-drop/dropped-markdown.ts.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn save_dropped_file(
    app: tauri::AppHandle,
    doc_path: String,
    source: String,
    folder: String,
) -> Result<SavedImage, String> {
    require_non_empty(&doc_path)?;
    require_non_empty(&source)?;
    not_a_secret(&app, &source)?;
    let doc = PathBuf::from(&doc_path);
    let (folder, conventions) = match crate::conventions::attachment_folder(&doc) {
        Some((folder, conventions)) => (folder, Some(conventions)),
        None => (ImageFolder::resolve(&doc, &folder)?, None),
    };
    let from = PathBuf::from(&source);
    let dir = folder.dir.clone();
    let name = tokio::task::spawn_blocking(move || copy_in(&from, &dir))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let written = folder.dir.join(&name);
    // A link, not an embed: `[[report.pdf]]`, which a vault opens.
    let embed = conventions
        .as_ref()
        .and_then(|c| crate::conventions::wiki_embed(c, &doc, &written))
        .map(|embed| embed.trim_start_matches('!').to_string());
    Ok(SavedImage {
        src: folder.src(&name),
        embed,
        path: Some(written.to_string_lossy().to_string()),
    })
}

/// Copies `from` into `dir` as its own name or the first free numbered one,
/// claimed with create_new so two drops can't take one name; a file already
/// there with the same bytes is taken instead. Copied, not read whole: a
/// video may be gigabytes.
fn copy_in(from: &Path, dir: &Path) -> std::io::Result<String> {
    let name = from
        .file_name()
        .ok_or_else(|| std::io::Error::other("no file name"))?
        .to_string_lossy()
        .to_string();
    if !from.is_file() {
        return Err(std::io::Error::other("not a file"));
    }
    std::fs::create_dir_all(dir)?;
    // Already in that folder: linked where it is.
    if from.parent().and_then(|p| std::fs::canonicalize(p).ok()) == std::fs::canonicalize(dir).ok()
    {
        return Ok(name);
    }
    into_free_name(
        dir,
        (0..10_000).map(|n| numbered_name(&name, n)),
        |path| copy_file_new(from, path),
        |path| same_bytes(from, path),
    )
}

/// Makes something in `dir` under the first of `names` that is free and
/// returns that name: `make` makes it at a path, failing with
/// AlreadyExists when the name is taken (create_new, create_dir), so two
/// at once can't take one name; a name taken by what `reuse` accepts is
/// taken as it is. Every copy into a folder names itself here.
pub(super) fn into_free_name(
    dir: &Path,
    names: impl Iterator<Item = String>,
    mut make: impl FnMut(&Path) -> std::io::Result<()>,
    reuse: impl Fn(&Path) -> bool,
) -> std::io::Result<String> {
    let mut first = None;
    for candidate in names {
        first.get_or_insert_with(|| candidate.clone());
        let path = dir.join(&candidate);
        match make(&path) {
            Ok(()) => return Ok(candidate),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if reuse(&path) {
                    return Ok(candidate);
                }
            }
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::other(format!(
        "no free name for {}",
        first.unwrap_or_default()
    )))
}

/// Copies the file `from` to `to`, claimed with create_new: AlreadyExists
/// when `to` is taken, and nothing left behind when the copy fails.
pub(super) fn copy_file_new(from: &Path, to: &Path) -> std::io::Result<()> {
    drop(
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(to)?,
    );
    std::fs::copy(from, to).map(|_| ()).map_err(|e| {
        let _ = std::fs::remove_file(to);
        e
    })
}

/// Read a piece at a time: a file of the same name and size is compared
/// without holding either whole.
fn same_bytes(a: &Path, b: &Path) -> bool {
    use std::io::Read;
    let (Ok(fa), Ok(fb)) = (std::fs::File::open(a), std::fs::File::open(b)) else {
        return false;
    };
    let same_len = match (fa.metadata(), fb.metadata()) {
        (Ok(ma), Ok(mb)) => ma.len() == mb.len(),
        _ => false,
    };
    if !same_len {
        return false;
    }
    let (mut ra, mut rb) = (std::io::BufReader::new(fa), std::io::BufReader::new(fb));
    let (mut ba, mut bb) = ([0u8; 64 * 1024], [0u8; 64 * 1024]);
    loop {
        let Ok(n) = ra.read(&mut ba) else {
            return false;
        };
        if n == 0 {
            return true;
        }
        if rb.read_exact(&mut bb[..n]).is_err() || ba[..n] != bb[..n] {
            return false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_dropped_file_is_copied_under_its_own_name_or_a_numbered_one() {
        let root = std::env::temp_dir().join(format!("textus-dropped-{}", std::process::id()));
        let downloads = root.join("downloads");
        let assets = root.join("notes/assets");
        std::fs::create_dir_all(&downloads).unwrap();
        let report = downloads.join("report.pdf");
        std::fs::write(&report, b"one").unwrap();

        assert_eq!(copy_in(&report, &assets).unwrap(), "report.pdf");
        assert_eq!(std::fs::read(assets.join("report.pdf")).unwrap(), b"one");
        // The same file again: the copy there is taken.
        assert_eq!(copy_in(&report, &assets).unwrap(), "report.pdf");
        // Another file of that name: numbered beside it.
        std::fs::write(&report, b"two").unwrap();
        assert_eq!(copy_in(&report, &assets).unwrap(), "report-1.pdf");
        assert_eq!(std::fs::read(assets.join("report-1.pdf")).unwrap(), b"two");
        // Already in the folder: linked where it is, not copied.
        assert_eq!(
            copy_in(&assets.join("report.pdf"), &assets).unwrap(),
            "report.pdf"
        );
        // A folder is no file to copy.
        assert!(copy_in(&downloads, &assets).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
