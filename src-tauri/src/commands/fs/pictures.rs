//! Pictures on disk: the folder a pasted one is saved in, a name that
//! takes no other file's place, a draft's pictures moved with it when it
//! is saved, and which one may go to the Trash.

use super::*;

/// Where a saved document's images go: Settings > Images > Folder
/// (`imageFolder` in src/settings/SettingsContext.tsx), worked out for one
/// document. src/settings/image-folder.ts previews the same rules for the
/// example in Settings; change both.
#[derive(Debug, PartialEq)]
pub(crate) struct ImageFolder {
    pub(crate) dir: PathBuf,
    /// The folder as the markdown names it: relative to the document, with
    /// forward slashes on every platform; "" for the document's own folder.
    pub(crate) src_prefix: String,
}

impl ImageFolder {
    /// The setting is "./" (the document's own folder) or a subfolder of
    /// it. It never leaves that folder - no "..", nothing absolute: an
    /// absolute folder would write this machine's paths into every document
    /// instead of links that travel with it. An empty segment ("img//x") is
    /// refused, not read as a root.
    pub(crate) fn resolve(doc_path: &Path, setting: &str) -> Result<Self, String> {
        let invalid = || format!("invalid image folder: {setting:?}");
        let doc_dir = doc_path.parent().ok_or_else(invalid)?;
        let setting = setting.trim();
        // A Windows drive ("C:\img", or "C:img" - relative to that drive's
        // current folder, not the document's) is a root too.
        if setting.is_empty()
            || Path::new(setting)
                .components()
                .any(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
        {
            return Err(invalid());
        }
        let segments: Vec<&str> = setting.split(['/', '\\']).collect();
        let mut parts: Vec<&str> = Vec::new();
        for (i, segment) in segments.iter().enumerate() {
            match *segment {
                // A trailing slash: "./", "img/".
                "" if i > 0 && i == segments.len() - 1 => {}
                "" | ".." => return Err(invalid()),
                "." => {}
                name => parts.push(name),
            }
        }
        Ok(Self {
            dir: parts
                .iter()
                .fold(doc_dir.to_path_buf(), |dir, p| dir.join(p)),
            src_prefix: parts.join("/"),
        })
    }

    /// The src the markdown gets for the file `name` in this folder.
    pub(crate) fn src(&self, name: &str) -> String {
        if self.src_prefix.is_empty() {
            name.to_string()
        } else {
            format!("{}/{name}", self.src_prefix)
        }
    }
}

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct SavedImage {
    /// What goes into the markdown: a path relative to the document, or an
    /// absolute path for a draft that has no folder yet.
    pub(crate) src: String,
}

/// Where the images of a document that has no file yet are kept: a pasted
/// one (save_pasted_image), a Word document's (word_import.rs). They move
/// into the document's image folder when it is first saved
/// (migrate_draft_images).
pub(crate) fn draft_assets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("assets"))
        .map_err(|e| e.to_string())
}

/// `name` with "-n" before its extension: "a.png", "a-1.png", "a-2.png"...
pub(crate) fn numbered_name(name: &str, n: usize) -> String {
    if n == 0 {
        return name.to_string();
    }
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => format!("{stem}-{n}.{ext}"),
        _ => format!("{name}-{n}"),
    }
}

/// Writes `bytes` into `dir` as `name`, or the first free `numbered_name`,
/// and returns the name used. The name is claimed with create_new before
/// anything is written: checking that a name was free and then writing it
/// let two saves at once (pastes in two windows within the same
/// millisecond) take the same name, and the second overwrote the first's
/// image. With `reuse`, a file that already holds exactly these bytes is
/// taken as the copy instead of adding another one beside it.
pub(crate) async fn write_new_file(
    dir: &Path,
    name: &str,
    bytes: &[u8],
    reuse: bool,
) -> std::io::Result<String> {
    let (dir, name, bytes) = (dir.to_path_buf(), name.to_string(), bytes.to_vec());
    tokio::task::spawn_blocking(move || write_new_file_sync(&dir, &name, &bytes, reuse))
        .await
        .map_err(std::io::Error::other)?
}

/// `write_new_file` for a caller already off the async runtime - a Word
/// document's pictures, saved while it is converted (word_import.rs).
pub(crate) fn write_new_file_sync(
    dir: &Path,
    name: &str,
    bytes: &[u8],
    reuse: bool,
) -> std::io::Result<String> {
    for n in 0..10_000 {
        let candidate = numbered_name(name, n);
        let path = dir.join(&candidate);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(claimed) => {
                drop(claimed);
                // Through a temp file: a crash mid-write must not leave a
                // truncated image that the document already links to.
                if let Err(e) = crate::atomic::write_sync(&path, bytes) {
                    let _ = std::fs::remove_file(&path);
                    return Err(e);
                }
                return Ok(candidate);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if reuse && std::fs::read(&path).is_ok_and(|held| held == bytes) {
                    return Ok(candidate);
                }
            }
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::other(format!("no free name for {name}")))
}

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct ImageMigration {
    pub(crate) old: String,
    /// New src (relative to the document) on success; None if this one
    /// image failed to move or copy - it's left at its old path, so nothing
    /// is lost, just not tidied up.
    pub(crate) new: Option<String>,
}

/// The picture formats Save As carries along with a document - the
/// editor's (src/editor/images/pasted-files.ts). A relative link to any
/// other kind of file is left as written, never copied.
pub(crate) fn is_image_file(path: &Path) -> bool {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "tif" | "tiff"
    )
}

/// Copies `from` into `dest_dir` under its own name (numbered when another
/// picture has it) and returns the name used.
pub(crate) async fn copy_image(from: &Path, dest_dir: &Path) -> Option<String> {
    let name = from.file_name()?.to_string_lossy().to_string();
    let bytes = fs::read(from).await.ok()?;
    fs::create_dir_all(dest_dir).await.ok()?;
    write_new_file(dest_dir, &name, &bytes, true).await.ok()
}

/// The extensions a picture moved to the Trash may have.
#[cfg(desktop)]
pub(crate) const PICTURE_EXTENSIONS: [&str; 8] =
    ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"];

/// Whether `path`, a picture an accepted AI picture replaced, may go to the
/// Trash for the document at `doc_path`: a picture file in the document's
/// own folder (or under it), or among the drafts' images - never anything
/// else, whatever the document's Markdown said.
#[cfg(desktop)]
pub(crate) fn may_trash_picture(
    app_assets: Option<&Path>,
    doc_path: Option<&Path>,
    path: &Path,
) -> Result<PathBuf, String> {
    let is_picture = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| PICTURE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()));
    if !is_picture {
        return Err("Only a picture file goes to the Trash this way.".into());
    }
    let file =
        std::fs::canonicalize(path).map_err(|e| format!("The old picture isn't there: {e}"))?;
    if !file.is_file() {
        return Err("The old picture isn't a file.".into());
    }
    let within = |dir: &Path| {
        std::fs::canonicalize(dir)
            .map(|dir| file.starts_with(dir))
            .unwrap_or(false)
    };
    let in_doc_folder = doc_path.and_then(Path::parent).is_some_and(within);
    let in_drafts = app_assets.is_some_and(within);
    if !in_doc_folder && !in_drafts {
        return Err(
            "The old picture is outside the document's folder; it was left where it is.".into(),
        );
    }
    Ok(file)
}
