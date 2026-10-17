use serde::Serialize;
use std::path::Path;
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
/// one picked by default, then plain text and any file at all (issue #78 -
/// Markdown alone locked every other file out). The names come from the
/// frontend, in the UI language.
///
/// None on macOS: NSOpenPanel shows no file-type menu, it only greys out
/// what the filters leave out (rfd hands it every filter's extensions at
/// once, with no "any file" among them), so no filter is the "All files"
/// choice there. iOS has its own picker and never opens this one.
fn open_document_filters(text: &str, all: &str) -> Vec<(String, &'static [&'static str])> {
    if cfg!(any(target_os = "macos", target_os = "ios")) {
        return Vec::new();
    }
    vec![
        ("Markdown".to_string(), &["md", "markdown"]),
        (text.to_string(), &["txt", "text"]),
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
    all_filter: Option<String>,
) -> Option<String> {
    let filters = open_document_filters(
        text_filter.as_deref().unwrap_or("Text files"),
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

/// Opens a native "Save As" dialog for a new, never-saved document.
#[tauri::command]
pub async fn save_file_dialog(
    window: tauri::WebviewWindow,
    default_name: String,
) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let default_name = if default_name.trim().is_empty() {
            "Untitled.md"
        } else {
            default_name.trim()
        };
        window_file_dialog(&window)
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

fn require_non_empty(path: &str) -> Result<(), String> {
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

#[derive(Serialize)]
pub struct SavedImage {
    /// What goes into the markdown: "assets/<name>" relative to the document,
    /// or an absolute path for a draft that has no folder yet.
    src: String,
}

/// Persists an image pasted into the editor. Saved documents get a Typora
/// style `assets/` folder next to them and a relative src; unsaved drafts
/// fall back to an assets folder in the app's data dir with an absolute src
/// (still valid after the draft is saved elsewhere).
#[tauri::command]
pub async fn save_pasted_image(
    app: tauri::AppHandle,
    doc_path: Option<String>,
    data_base64: String,
    ext: String,
) -> Result<SavedImage, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use tauri::Manager;

    if !ext.chars().all(|c| c.is_ascii_alphanumeric()) || ext.is_empty() {
        return Err("invalid extension".to_string());
    }
    let bytes = STANDARD.decode(&data_base64).map_err(|e| e.to_string())?;

    let (dir, relative) = match doc_path.as_deref().map(Path::new).and_then(|p| p.parent()) {
        Some(parent) => (parent.join("assets"), true),
        None => (
            app.path()
                .app_data_dir()
                .map_err(|e| e.to_string())?
                .join("assets"),
            false,
        ),
    };
    fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let mut name = format!("image-{stamp}.{ext}");
    let mut n = 1;
    while dir.join(&name).exists() {
        name = format!("image-{stamp}-{n}.{ext}");
        n += 1;
    }
    let full = dir.join(&name);
    // Through a temp file: a crash mid-write must not leave a truncated
    // image that the document already links to.
    crate::atomic::write(&full, bytes)
        .await
        .map_err(|e| e.to_string())?;

    let src = if relative {
        format!("assets/{name}")
    } else {
        full.to_string_lossy().to_string()
    };
    Ok(SavedImage { src })
}

#[derive(Serialize)]
pub struct ImageMigration {
    old: String,
    /// New "assets/<name>" src (relative to the document) on success; None
    /// if this one image failed to move - it's left at its old absolute
    /// path, so nothing is lost, just not tidied up.
    new: Option<String>,
}

async fn move_file(from: &Path, to: &Path) -> std::io::Result<()> {
    if fs::rename(from, to).await.is_ok() {
        return Ok(());
    }
    // rename fails across filesystems/volumes (app data dir and the
    // document's folder aren't guaranteed to share one) - copy then remove
    // the original as a fallback "move".
    fs::copy(from, to).await?;
    fs::remove_file(from).await
}

/// Moves a first-saved draft's pasted images from the app's data dir into a
/// Typora-style `assets/` folder next to the now-real document, rewriting
/// each markdown `src` to the new relative path. Only touches paths that are
/// actually under the app data dir's `assets/` folder - anything else
/// (http(s), data:, or already-relative) is left alone, matching the
/// frontend's job of only offering draft-image candidates here.
#[tauri::command]
pub async fn migrate_draft_images(
    app: tauri::AppHandle,
    doc_path: String,
    srcs: Vec<String>,
) -> Result<Vec<ImageMigration>, String> {
    use tauri::Manager;

    require_non_empty(&doc_path)?;
    let Some(doc_dir) = Path::new(&doc_path).parent() else {
        return Err("document path has no parent directory".to_string());
    };
    let draft_assets_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("assets");
    let dest_dir = doc_dir.join("assets");

    let mut results = Vec::with_capacity(srcs.len());
    for old in srcs {
        let path = Path::new(&old);
        // Not a draft-origin image (e.g. some other absolute path the user
        // inserted directly) - silently skipped, not a migration failure:
        // `new: None` below is reserved for a draft image that WAS found
        // here but failed to move, which is the only case worth a toast.
        if path.parent() != Some(draft_assets_dir.as_path()) {
            continue;
        }
        let Some(name) = path.file_name() else {
            results.push(ImageMigration { old, new: None });
            continue;
        };

        let new = async {
            fs::create_dir_all(&dest_dir).await.ok()?;
            let mut dest_name = name.to_string_lossy().to_string();
            let mut n = 1;
            while dest_dir.join(&dest_name).exists() {
                let stem = Path::new(name).file_stem()?.to_string_lossy();
                let ext = Path::new(name)
                    .extension()
                    .map(|e| e.to_string_lossy().to_string());
                dest_name = match &ext {
                    Some(ext) => format!("{stem}-{n}.{ext}"),
                    None => format!("{stem}-{n}"),
                };
                n += 1;
            }
            move_file(path, &dest_dir.join(&dest_name)).await.ok()?;
            Some(format!("assets/{dest_name}"))
        }
        .await;

        results.push(ImageMigration { old, new });
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
        let filters = open_document_filters("Text", "All files");
        let names: Vec<&str> = filters.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["Markdown", "Text", "All files"]);
        assert_eq!(filters[0].1, ["md", "markdown"]);
        assert_eq!(filters[2].1, ["*"]);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn open_dialog_leaves_every_file_pickable_on_macos() {
        assert!(open_document_filters("Text", "All files").is_empty());
    }
}
