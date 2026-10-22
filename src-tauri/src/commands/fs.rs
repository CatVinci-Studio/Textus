use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tokio::fs;

mod pictures;
pub(crate) use pictures::*;

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct DirEntryInfo {
    name: String,
    path: String,
    is_dir: bool,
    /// Last modified, in ms since the epoch, for the tree's sort by date;
    /// None where the system doesn't say.
    modified_ms: Option<f64>,
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
#[cfg_attr(test, specta::specta)]
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
#[cfg_attr(test, specta::specta)]
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
#[cfg_attr(test, specta::specta)]
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
#[cfg_attr(test, specta::specta)]
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
#[cfg_attr(test, specta::specta)]
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
        let modified_ms = entry
            .metadata()
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64);
        items.push(DirEntryInfo {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: file_type.is_dir(),
            modified_ms,
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
#[cfg_attr(test, specta::specta)]
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
#[cfg_attr(test, specta::specta)]
pub async fn read_text_file(path: String) -> Result<String, String> {
    require_non_empty(&path)?;
    fs::read_to_string(&path).await.map_err(|e| e.to_string())
}

/// Reads a file as base64 - used to inline a CSS theme's local font/image
/// `url(...)` assets as data URIs, since a relative path in a `<style>` tag
/// injected at runtime has no base to resolve against.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn read_binary_file_base64(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    require_non_empty(&path)?;
    let bytes = fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

/// Persists an image pasted into the editor. Saved documents get it in
/// their image folder (`folder`, see ImageFolder) and a relative src;
/// unsaved drafts fall back to an assets folder in the app's data dir with
/// an absolute src (still valid after the draft is saved elsewhere).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
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
#[cfg_attr(test, specta::specta)]
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
#[cfg_attr(test, specta::specta)]
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

/// Moves a picture that an accepted AI picture replaced to the system's
/// Trash (Recycle Bin), once the user said so - never deletes it; it can
/// be put back from there.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn move_picture_to_trash(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    path: String,
) -> Result<(), String> {
    let assets = draft_assets_dir(&app).ok();
    let file = may_trash_picture(
        assets.as_deref(),
        doc_path.as_deref().map(Path::new),
        Path::new(&path),
    )?;
    trash::delete(&file).map_err(|e| format!("Couldn't move the old picture to the Trash: {e}"))
}

#[cfg(test)]
mod tests;
