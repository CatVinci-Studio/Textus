//! prefs.json: the last editor window's size and place, written by Rust
//! itself on close.
//! Settings Rust needs before any webview exists are read from settings.json
//! (settings.rs), not from here.

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
    let size = read_prefs(app).get("editor_window_size")?.clone();
    let width = size.get(0)?.as_f64()?;
    let height = size.get(1)?.as_f64()?;
    // A corrupt or hand-edited value must not open an unusable window.
    (width >= 320.0 && height >= 240.0).then_some((width, height))
}

/// Where the last closed editor window was (its outer position, logical
/// px), for the main window to open there again (window_frame.rs).
pub fn read_editor_window_position(app: &AppHandle) -> Option<(f64, f64)> {
    let at = read_prefs(app).get("editor_window_position")?.clone();
    Some((at.get(0)?.as_f64()?, at.get(1)?.as_f64()?))
}

/// Records `window`'s size and place for read_editor_window_size and
/// read_editor_window_position, unless it is maximized, fullscreen or
/// minimized - restoring that size would open a plain window filling the
/// screen, or a degenerate one. Not the place on Wayland, which tells an
/// app nothing of where its window is.
pub fn remember_editor_window(app: &AppHandle, window: &tauri::Window) {
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
        "editor_window_size",
        serde_json::json!([size.width.round(), size.height.round()]),
    );
    if !crate::window_place_known() {
        return;
    }
    if let Ok(at) = window.outer_position() {
        let at = at.to_logical::<f64>(scale);
        let _ = write_pref(
            app,
            "editor_window_position",
            serde_json::json!([at.x.round(), at.y.round()]),
        );
    }
}
