//! prefs.json: the last editor window size, written by Rust itself on close.
//!
//! Up to 0.9.6 this file also mirrored two frontend settings that take
//! effect in Rust before any webview exists - whether opening several
//! documents at once (Finder "Open With" multi-select, `textus a.md b.md`)
//! spawns one OS window per file or batches them into tabs in a single
//! window, and whether startup restores last session's documents. Settings
//! now live in a file Rust owns (settings.rs), so both are read from there;
//! the old keys here are read once, on the first launch after the move, and
//! left in place for a downgrade.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("prefs.json"))
}

fn read_prefs(app: &AppHandle) -> serde_json::Value {
    let Ok(path) = prefs_path(app) else {
        return serde_json::json!({});
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return serde_json::json!({});
    };
    serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}))
}

/// Merges `value` into the existing prefs.json under `key` instead of
/// overwriting the whole file, which still holds the old mirrored keys.
fn write_pref(app: &AppHandle, key: &str, value: serde_json::Value) -> Result<(), String> {
    let path = prefs_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut prefs = read_prefs(app);
    prefs[key] = value;
    crate::atomic::write_sync(&path, prefs.to_string()).map_err(|e| e.to_string())
}

/// Internal helper for lib.rs's window-spawning decisions. Defaults to
/// "window" on anything but an explicit "tab", same "safe default"
/// precedent as commands::cli.
pub fn read_new_document_mode(app: &AppHandle) -> String {
    match crate::settings::read_setting(app, "newDocumentMode")
        .as_ref()
        .and_then(|v| v.as_str())
    {
        Some("tab") => "tab".to_string(),
        _ => "window".to_string(),
    }
}

/// Internal helper for lib.rs's startup path-collection: whether to reopen
/// last session's documents (default) or start blank.
pub fn read_restore_session_on_startup(app: &AppHandle) -> bool {
    crate::settings::read_setting(app, "restoreSessionOnStartup")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

/// The inner size (logical px) the last closed editor window had, for the
/// next one to open at. One size for every editor window rather than one
/// per label: labels after "main" are minted fresh each run (window-N), so
/// a per-label store would never be read back.
pub fn read_editor_window_size(app: &AppHandle) -> Option<(f64, f64)> {
    read_window_size(app, EDITOR_WINDOW_SIZE, (320.0, 240.0))
}

/// Records `window`'s size for read_editor_window_size.
pub fn remember_editor_window_size(app: &AppHandle, window: &tauri::Window) {
    remember_window_size(app, EDITOR_WINDOW_SIZE, window);
}

/// The Quick Note window's own remembered size (commands/quick_note): a
/// note pad and a document window are not the same shape.
pub fn read_quick_note_window_size(app: &AppHandle) -> Option<(f64, f64)> {
    read_window_size(app, QUICK_NOTE_WINDOW_SIZE, (200.0, 140.0))
}

pub fn remember_quick_note_window_size(app: &AppHandle, window: &tauri::Window) {
    remember_window_size(app, QUICK_NOTE_WINDOW_SIZE, window);
}

const EDITOR_WINDOW_SIZE: &str = "editor_window_size";
const QUICK_NOTE_WINDOW_SIZE: &str = "quick_note_window_size";

fn read_window_size(app: &AppHandle, key: &str, min: (f64, f64)) -> Option<(f64, f64)> {
    let size = read_prefs(app).get(key)?.clone();
    let width = size.get(0)?.as_f64()?;
    let height = size.get(1)?.as_f64()?;
    // A corrupt or hand-edited value must not open an unusable window.
    (width >= min.0 && height >= min.1).then_some((width, height))
}

/// Records `window`'s size under `key`, unless it is maximized, fullscreen
/// or minimized - restoring that size would open a plain window filling the
/// screen, or a degenerate one.
fn remember_window_size(app: &AppHandle, key: &str, window: &tauri::Window) {
    let unsized_state = window.is_maximized().unwrap_or(true)
        || window.is_fullscreen().unwrap_or(true)
        || window.is_minimized().unwrap_or(true);
    if unsized_state {
        return;
    }
    let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
        return;
    };
    let size = size.to_logical::<f64>(scale);
    let _ = write_pref(
        app,
        key,
        serde_json::json!([size.width.round(), size.height.round()]),
    );
}
