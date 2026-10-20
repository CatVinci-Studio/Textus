use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tokio::fs;

#[derive(Serialize)]
pub struct DirEntryInfo {
    name: String,
    path: String,
    is_dir: bool,
}

/// A native file dialog owned by the window that asked for it. Unowned, a
/// Windows dialog isn't modal and can open behind the app, looking like the
/// click did nothing. On macOS the dialog is a sheet either way (rfd attaches
/// an unowned one to the app's main window), but unowned it took the first
/// window AppKit still lists whenever no window was main - a closed one,
/// kept hidden, which came back on screen empty with the sheet on it.
pub(crate) fn window_file_dialog(
    window: &tauri::WebviewWindow,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    use tauri_plugin_dialog::DialogExt;
    let dialog = window.dialog().file();
    // set_parent is desktop-only API; iOS presents the picker modally over
    // its single window anyway.
    #[cfg(desktop)]
    let dialog = dialog.set_parent(window);
    dialog
}

/// The file types File > Open offers, in order: Markdown first, as the
/// one picked by default, then plain text, Word documents (opened as a new
/// Markdown document, word_import.rs) and any file at all (issue #78 -
/// Markdown alone locked every other file out). The names come from the
/// frontend, in the UI language.
///
/// None on macOS: NSOpenPanel shows no file-type menu, it only greys out
/// what the filters leave out (rfd hands it every filter's extensions at
/// once, with no "any file" among them), so no filter is the "All files"
/// choice there. iOS has its own picker and never opens this one.
fn open_document_filters(
    text: &str,
    word: &str,
    all: &str,
) -> Vec<(String, &'static [&'static str])> {
    if cfg!(any(target_os = "macos", target_os = "ios")) {
        return Vec::new();
    }
    vec![
        ("Markdown".to_string(), &["md", "markdown"]),
        (text.to_string(), &["txt", "text"]),
        (word.to_string(), &["docx"]),
        // rfd writes it out as the any-file pattern each dialog takes.
        (all.to_string(), &["*"]),
    ]
}

/// Opens a native file picker for the document to open: a Markdown file by
/// default, any file once the user switches the type.
#[tauri::command]
pub async fn open_file_dialog(
    window: tauri::WebviewWindow,
    text_filter: Option<String>,
    word_filter: Option<String>,
    all_filter: Option<String>,
) -> Option<String> {
    let filters = open_document_filters(
        text_filter.as_deref().unwrap_or("Text files"),
        word_filter.as_deref().unwrap_or("Word documents"),
        all_filter.as_deref().unwrap_or("All files"),
    );
    tauri::async_runtime::spawn_blocking(move || {
        filters
            .iter()
            .fold(window_file_dialog(&window), |dialog, (name, exts)| {
                dialog.add_filter(name, exts)
            })
            .blocking_pick_file()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

/// Opens a native file picker for a CSS theme file (e.g. a Typora-compatible
/// community theme).
#[tauri::command]
pub async fn open_css_file_dialog(window: tauri::WebviewWindow) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        window_file_dialog(&window)
            .add_filter("CSS", &["css"])
            .blocking_pick_file()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

/// Opens a native file picker for one image: "Choose image…" on a missing
/// image's card (src/editor/images/missing-image.ts). The frontend names the
/// filter in the UI language and lists the types its image store takes
/// (IMAGE_FILE_EXTENSIONS in src/editor/images/pasted-files.ts).
#[tauri::command]
pub async fn open_image_file_dialog(
    window: tauri::WebviewWindow,
    filter_name: String,
    extensions: Vec<String>,
) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
        window_file_dialog(&window)
            .add_filter(&filter_name, &exts)
            .blocking_pick_file()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

/// Opens a native "Save As" dialog for a new, never-saved document - in
/// `default_dir` when given: beside the Word file a document was opened
/// from.
#[tauri::command]
pub async fn save_file_dialog(
    window: tauri::WebviewWindow,
    default_name: String,
    default_dir: Option<String>,
) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let default_name = if default_name.trim().is_empty() {
            "Untitled.md"
        } else {
            default_name.trim()
        };
        let dialog = window_file_dialog(&window);
        let dialog = match default_dir.filter(|dir| Path::new(dir).is_dir()) {
            Some(dir) => dialog.set_directory(dir),
            None => dialog,
        };
        dialog
            .set_file_name(default_name)
            .add_filter("Markdown", &["md"])
            .blocking_save_file()
            .map(|p| with_default_extension(p.to_string(), "md"))
    })
    .await
    .ok()
    .flatten()
}

/// GTK and the desktop portal hand back exactly what was typed - "notes",
/// not "notes.md" - where Windows and macOS append the filter's extension.
/// A name with no extension at all gets the default one; any extension the
/// user did type is respected.
pub(crate) fn with_default_extension(path: String, ext: &str) -> String {
    if Path::new(&path).extension().is_some() {
        path
    } else {
        format!("{path}.{ext}")
    }
}

// The chat's "+" button used to live here as a text-only `read_to_string`,
// which is why a PDF looked like a dead button. It now has its own module -
// see commands/attachment.rs.

pub(crate) fn require_non_empty(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("empty path".to_string());
    }
    Ok(())
}

/// Lists the immediate children of a directory (non-recursive; the frontend
/// calls this again when a subfolder is expanded, so startup never walks the
/// whole tree). Async so a slow/network-mounted directory doesn't stall the
/// app while it's being read.
#[tauri::command]
pub async fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    require_non_empty(&path)?;
    let mut reader = fs::read_dir(&path).await.map_err(|e| e.to_string())?;
    let mut items: Vec<DirEntryInfo> = Vec::new();

    while let Some(entry) = reader.next_entry().await.map_err(|e| e.to_string())? {
        let file_type = entry.file_type().await.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        items.push(DirEntryInfo {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: file_type.is_dir(),
        });
    }

    items.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(items)
}

/// Millisecond mtime of a file, or None if it doesn't exist. The frontend
/// snapshots this when a document is read or written, then compares against
/// it to detect external modifications (reload on window focus, and the
/// overwrite-conflict prompt before saving).
#[tauri::command]
pub async fn file_mtime_ms(path: String) -> Result<Option<f64>, String> {
    require_non_empty(&path)?;
    match fs::metadata(&path).await {
        Ok(meta) => {
            let modified = meta.modified().map_err(|e| e.to_string())?;
            let ms = modified
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_millis() as f64;
            Ok(Some(ms))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    require_non_empty(&path)?;
    fs::read_to_string(&path).await.map_err(|e| e.to_string())
}

/// Reads a file as base64 - used to inline a CSS theme's local font/image
/// `url(...)` assets as data URIs, since a relative path in a `<style>` tag
/// injected at runtime has no base to resolve against.
#[tauri::command]
pub async fn read_binary_file_base64(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    require_non_empty(&path)?;
    let bytes = fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

/// Where a saved document's images go: Settings > Images > Folder
/// (`imageFolder` in src/settings/SettingsContext.tsx), worked out for one
/// document. src/settings/image-folder.ts previews the same rules for the
/// example in Settings; change both.
#[derive(Debug, PartialEq)]
struct ImageFolder {
    dir: PathBuf,
    /// The folder as the markdown names it: relative to the document, with
    /// forward slashes on every platform; "" for the document's own folder.
    src_prefix: String,
}

impl ImageFolder {
    /// The setting is "./" (the document's own folder) or a subfolder of
    /// it. It never leaves that folder - no "..", nothing absolute: an
    /// absolute folder would write this machine's paths into every document
    /// instead of links that travel with it. An empty segment ("img//x") is
    /// refused, not read as a root.
    fn resolve(doc_path: &Path, setting: &str) -> Result<Self, String> {
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
    fn src(&self, name: &str) -> String {
        if self.src_prefix.is_empty() {
            name.to_string()
        } else {
            format!("{}/{name}", self.src_prefix)
        }
    }
}

#[derive(Serialize)]
pub struct SavedImage {
    /// What goes into the markdown: a path relative to the document, or an
    /// absolute path for a draft that has no folder yet.
    src: String,
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

/// Persists an image pasted into the editor. Saved documents get it in
/// their image folder (`folder`, see ImageFolder) and a relative src;
/// unsaved drafts fall back to an assets folder in the app's data dir with
/// an absolute src (still valid after the draft is saved elsewhere).
#[tauri::command]
pub async fn save_pasted_image(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    data_base64: String,
    ext: String,
    folder: String,
) -> Result<SavedImage, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    if !ext.chars().all(|c| c.is_ascii_alphanumeric()) || ext.is_empty() {
        return Err("invalid extension".to_string());
    }
    let bytes = STANDARD.decode(&data_base64).map_err(|e| e.to_string())?;

    let folder = match doc_path.as_deref() {
        Some(doc) => Some(ImageFolder::resolve(Path::new(doc), &folder)?),
        None => None,
    };
    let dir = match &folder {
        Some(folder) => folder.dir.clone(),
        None => draft_assets_dir(&app)?,
    };
    fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let name = write_new_file(&dir, &format!("image-{stamp}.{ext}"), &bytes, false)
        .await
        .map_err(|e| e.to_string())?;

    let src = match folder {
        Some(folder) => folder.src(&name),
        None => dir.join(&name).to_string_lossy().to_string(),
    };
    Ok(SavedImage { src })
}

/// `name` with "-n" before its extension: "a.png", "a-1.png", "a-2.png"...
fn numbered_name(name: &str, n: usize) -> String {
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
async fn write_new_file(
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
pub struct ImageMigration {
    old: String,
    /// New src (relative to the document) on success; None if this one
    /// image failed to move or copy - it's left at its old path, so nothing
    /// is lost, just not tidied up.
    new: Option<String>,
}

/// The picture formats Save As carries along with a document - the
/// editor's (src/editor/images/pasted-files.ts). A relative link to any
/// other kind of file is left as written, never copied.
fn is_image_file(path: &Path) -> bool {
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
async fn copy_image(from: &Path, dest_dir: &Path) -> Option<String> {
    let name = from.file_name()?.to_string_lossy().to_string();
    let bytes = fs::read(from).await.ok()?;
    fs::create_dir_all(dest_dir).await.ok()?;
    write_new_file(dest_dir, &name, &bytes, true).await.ok()
}

/// Brings a document's images into the image folder (`folder`, see
/// ImageFolder) of the file it was just saved as, rewriting each markdown
/// `src` to the new relative path. Two kinds of src are taken:
/// - a draft's pasted image, an absolute path in the app data dir's
///   `assets/` folder (save_pasted_image): moved, the draft is gone;
/// - with `source_doc_path` (Save As of a document that had a file), a
///   path relative to that document: copied, since the old file still
///   links to it. Such an image used to stay behind, and the new file's
///   link pointed at nothing.
///
/// Anything else - another absolute path, a relative one naming no
/// picture, every relative one when the folder didn't change - is left
/// alone, matching the frontend's job of only offering candidates here.
#[tauri::command]
pub async fn migrate_draft_images(
    app: tauri::AppHandle,
    doc_path: String,
    srcs: Vec<String>,
    folder: String,
    source_doc_path: Option<String>,
) -> Result<Vec<ImageMigration>, String> {
    require_non_empty(&doc_path)?;
    let draft_assets_dir = draft_assets_dir(&app)?;
    migrate_images(
        Path::new(&doc_path),
        srcs,
        &folder,
        source_doc_path.as_deref().map(Path::new),
        &draft_assets_dir,
    )
    .await
}

pub(super) async fn migrate_images(
    doc_path: &Path,
    srcs: Vec<String>,
    folder: &str,
    source_doc_path: Option<&Path>,
    draft_assets_dir: &Path,
) -> Result<Vec<ImageMigration>, String> {
    let folder = ImageFolder::resolve(doc_path, folder)?;
    // Saved into the folder it was in: its relative links all still hold.
    let source_dir = source_doc_path
        .and_then(Path::parent)
        .filter(|dir| Some(*dir) != doc_path.parent());

    let mut results = Vec::with_capacity(srcs.len());
    for old in srcs {
        let path = Path::new(&old);
        let new = if path.is_absolute() || path.has_root() {
            // Not a draft-origin image (e.g. some other absolute path the
            // user inserted directly) - silently skipped, not a failure:
            // `new: None` is reserved for an image that WAS found here but
            // failed to move, the only case worth a toast.
            if path.parent() != Some(draft_assets_dir) {
                continue;
            }
            let moved = copy_image(path, &folder.dir).await;
            if moved.is_some() {
                let _ = fs::remove_file(path).await;
            }
            moved
        } else {
            let Some(from) = source_dir.map(|dir| dir.join(path)) else {
                continue;
            };
            if !is_image_file(&from) || !fs::metadata(&from).await.is_ok_and(|m| m.is_file()) {
                continue;
            }
            copy_image(&from, &folder.dir).await
        };
        results.push(ImageMigration {
            old,
            new: new.map(|name| folder.src(&name)),
        });
    }
    Ok(results)
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    require_non_empty(&path)?;
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    crate::atomic::write(Path::new(&path), contents)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn open_dialog_defaults_to_markdown_and_offers_any_file() {
        let filters = open_document_filters("Text", "Word", "All files");
        let names: Vec<&str> = filters.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["Markdown", "Text", "Word", "All files"]);
        assert_eq!(filters[0].1, ["md", "markdown"]);
        assert_eq!(filters[2].1, ["docx"]);
        assert_eq!(filters[3].1, ["*"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn open_dialog_leaves_every_file_pickable_on_macos() {
        assert!(open_document_filters("Text", "Word", "All files").is_empty());
    }

    fn doc() -> PathBuf {
        Path::new("notes").join("week").join("My Notes.md")
    }

    /// The folder for `setting` and the src a pasted "a.png" gets in it.
    fn image_in(setting: &str) -> (PathBuf, String) {
        let folder = ImageFolder::resolve(&doc(), setting).unwrap();
        let src = folder.src("a.png");
        (folder.dir, src)
    }

    #[test]
    fn the_default_image_folder_is_assets_next_to_the_document() {
        let dir = doc().parent().unwrap().join("assets");
        assert_eq!(image_in("assets"), (dir, "assets/a.png".to_string()));
    }

    #[test]
    fn dot_slash_puts_images_beside_the_document() {
        let dir = doc().parent().unwrap().to_path_buf();
        assert_eq!(image_in("./"), (dir.clone(), "a.png".to_string()));
        assert_eq!(image_in("."), (dir, "a.png".to_string()));
    }

    #[test]
    fn a_subfolder_is_written_with_forward_slashes() {
        let dir = doc().parent().unwrap().join("img").join("shots");
        let expected = (dir, "img/shots/a.png".to_string());
        assert_eq!(image_in("img/shots"), expected);
        assert_eq!(image_in("img\\shots\\"), expected);
        assert_eq!(image_in("  ./img/./shots/  "), expected);
    }

    #[test]
    fn an_image_folder_never_leaves_the_documents_folder() {
        for setting in ["..", "../images", "img/../../x", "img/.."] {
            assert!(
                ImageFolder::resolve(&doc(), setting).is_err(),
                "{setting:?} was accepted"
            );
        }
    }

    #[test]
    fn empty_absolute_and_doubled_slash_folders_are_refused() {
        for setting in ["", "  ", "/", "/tmp/img", "\\img", "img//x", "//server/x"] {
            assert!(
                ImageFolder::resolve(&doc(), setting).is_err(),
                "{setting:?} was accepted"
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_windows_drive_is_refused_as_an_image_folder() {
        for setting in ["C:\\img", "C:img", "C:/img"] {
            assert!(ImageFolder::resolve(&doc(), setting).is_err());
        }
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 8)]
    async fn images_written_at_once_never_overwrite_each_other() {
        let dir = tempfile::tempdir().unwrap();
        let writes: Vec<_> = (0..16u8)
            .map(|i| {
                let dir = dir.path().to_path_buf();
                tokio::spawn(async move {
                    let name = write_new_file(&dir, "image-1.png", &[i; 64], false).await;
                    (i, name.unwrap())
                })
            })
            .collect();
        let mut names = std::collections::HashSet::new();
        for write in writes {
            let (i, name) = write.await.unwrap();
            let held = fs::read(dir.path().join(&name)).await.unwrap();
            assert_eq!(held, [i; 64], "{name} was overwritten");
            names.insert(name);
        }
        assert_eq!(names.len(), 16);
    }

    #[tokio::test]
    async fn a_taken_name_is_numbered_unless_it_holds_the_same_picture() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.png"), b"one").unwrap();
        let name = write_new_file(dir.path(), "a.png", b"two", true).await;
        assert_eq!(name.unwrap(), "a-1.png");
        let name = write_new_file(dir.path(), "a.png", b"one", true).await;
        assert_eq!(name.unwrap(), "a.png");
        assert_eq!(std::fs::read(dir.path().join("a.png")).unwrap(), b"one");
    }

    /// Two folders under one root, a document "A/a.md" and its picture.
    fn two_folders() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let a = root.path().join("A");
        let b = root.path().join("B");
        std::fs::create_dir_all(a.join("pics")).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(a.join("pics").join("p.png"), b"picture").unwrap();
        (root, a.join("a.md"), b.join("b.md"))
    }

    #[tokio::test]
    async fn save_as_elsewhere_copies_relative_images_into_the_image_folder() {
        let (root, old, new) = two_folders();
        let srcs = vec!["pics/p.png".to_string(), "notes.txt".to_string()];
        let drafts = root.path().join("drafts");
        let moved = migrate_images(&new, srcs, "assets", Some(&old), &drafts)
            .await
            .unwrap();
        assert_eq!(moved.len(), 1);
        assert_eq!(moved[0].old, "pics/p.png");
        assert_eq!(moved[0].new.as_deref(), Some("assets/p.png"));
        let b = new.parent().unwrap();
        assert_eq!(std::fs::read(b.join("assets/p.png")).unwrap(), b"picture");
        // The old document still links to its copy.
        assert!(old.parent().unwrap().join("pics/p.png").is_file());
    }

    #[tokio::test]
    async fn save_as_in_the_same_folder_leaves_relative_images_alone() {
        let (root, old, _) = two_folders();
        let renamed = old.with_file_name("renamed.md");
        let drafts = root.path().join("drafts");
        let srcs = vec!["pics/p.png".to_string()];
        let moved = migrate_images(&renamed, srcs, "assets", Some(&old), &drafts)
            .await
            .unwrap();
        assert!(moved.is_empty());
    }

    #[tokio::test]
    async fn a_drafts_pasted_image_moves_into_the_image_folder() {
        let (root, _, new) = two_folders();
        let drafts = root.path().join("drafts");
        std::fs::create_dir_all(&drafts).unwrap();
        let pasted = drafts.join("image-1.png");
        std::fs::write(&pasted, b"pasted").unwrap();
        let srcs = vec![pasted.to_string_lossy().to_string()];
        let moved = migrate_images(&new, srcs, "./", None, &drafts)
            .await
            .unwrap();
        assert_eq!(moved[0].new.as_deref(), Some("image-1.png"));
        assert!(!pasted.exists());
        let b = new.parent().unwrap();
        assert_eq!(std::fs::read(b.join("image-1.png")).unwrap(), b"pasted");
    }
}
