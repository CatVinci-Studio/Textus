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
    /// Hidden: a name starting with a dot, or on Windows a file marked hidden or
    /// system (desktop.ini).
    hidden: bool,
}

/// Whether Windows marks `meta` hidden or system; never elsewhere.
#[cfg(windows)]
fn marked_hidden(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const HIDDEN: u32 = 0x2;
    const SYSTEM: u32 = 0x4;
    meta.file_attributes() & (HIDDEN | SYSTEM) != 0
}

#[cfg(not(windows))]
fn marked_hidden(_meta: &std::fs::Metadata) -> bool {
    false
}

/// A native file dialog owned by the window that asked for it. Unowned, a
/// Windows dialog can open behind the app, and a macOS sheet can land on a hidden window.
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

/// The file types File > Open offers: Markdown first, then text, Word and any
/// file. None on macOS, where NSOpenPanel has no type menu, so no filter means
/// "All files".
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

/// Opens a native file picker for a CSS theme file.
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

/// Picks a settings file to import (Settings › General).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn open_settings_file_dialog(window: tauri::WebviewWindow) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        window_file_dialog(&window)
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

/// Asks where to export the settings to, as `default_name`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn save_settings_file_dialog(
    window: tauri::WebviewWindow,
    default_name: String,
) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        window_file_dialog(&window)
            .set_file_name(default_name)
            .add_filter("JSON", &["json"])
            .blocking_save_file()
            .map(|p| with_default_extension(p.to_string(), "json"))
    })
    .await
    .ok()
    .flatten()
}

/// Opens a native file picker for one image, for a missing image's card. The
/// frontend names the filter and lists the image types.
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

/// Opens a native "Save As" dialog for a never-saved document, in `default_dir`
/// when given (beside the Word file it came from).
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

/// GTK and the desktop portal return the name as typed ("notes"), where Windows
/// and macOS append the filter's extension; a name with no extension gets the default.
pub(crate) fn with_default_extension(path: String, ext: &str) -> String {
    if Path::new(&path).extension().is_some() {
        path
    } else {
        format!("{path}.{ext}")
    }
}

pub(crate) fn require_non_empty(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("empty path".to_string());
    }
    Ok(())
}

/// Lists the immediate children of a directory; the frontend asks again per
/// expanded folder. Async so a slow network mount doesn't stall the app.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    require_non_empty(&path)?;
    let mut reader = fs::read_dir(&path).await.map_err(|e| e.to_string())?;
    let mut items: Vec<DirEntryInfo> = Vec::new();

    while let Some(entry) = reader.next_entry().await.map_err(|e| e.to_string())? {
        let file_type = entry.file_type().await.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata().await.ok();
        let modified_ms = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64);
        items.push(DirEntryInfo {
            hidden: name.starts_with('.') || meta.as_ref().is_some_and(marked_hidden),
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

/// Millisecond mtime of a file, or None if it doesn't exist; the frontend
/// compares it to detect external modifications.
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

/// Reads a file as base64, to inline a CSS theme's local `url(...)` assets: a
/// runtime `<style>` tag has no base to resolve relative paths against.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn read_binary_file_base64(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    require_non_empty(&path)?;
    let bytes = fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

/// Persists an image pasted into the editor. Saved documents get it in their
/// image folder with a relative src; unsaved drafts use the app's assets folder, absolute.
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

/// Brings a document's images into the image folder of the file it was just
/// saved as, rewriting each `src`: a draft's pasted images are moved, and on Save
/// As images relative to the old document are copied. Anything else is left alone.
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
            // Not a draft-origin image: skipped, not a failure. `new: None` is only for
            // an image found here that failed to move.
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

/// Moves a picture that an accepted AI picture replaced to the Trash, once the
/// user said so; never deletes it.
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
