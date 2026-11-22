//! A file dragged in from a file manager and linked from a document: copied
//! next to it first, where its pictures go, so the link travels with it.

use super::*;

/// Copies `source` into the folder a pasted picture of `doc_path` would go
/// to (a vault's attachment folder, else Settings > Images > Folder), under
/// its own name - numbered when another file has it, the same one if it is
/// there already - and returns the link to write. Keep in step with
/// `insertDropped` in file-drop-insert.ts, which writes the link.
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
    for n in 0..10_000 {
        let candidate = numbered_name(&name, n);
        let path = dir.join(&candidate);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(claimed) => {
                drop(claimed);
                if let Err(e) = std::fs::copy(from, &path) {
                    let _ = std::fs::remove_file(&path);
                    return Err(e);
                }
                return Ok(candidate);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if same_bytes(from, &path) {
                    return Ok(candidate);
                }
            }
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::other(format!("no free name for {name}")))
}

fn same_bytes(a: &Path, b: &Path) -> bool {
    let (Ok(ma), Ok(mb)) = (std::fs::metadata(a), std::fs::metadata(b)) else {
        return false;
    };
    ma.len() == mb.len() && std::fs::read(a).ok() == std::fs::read(b).ok()
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
