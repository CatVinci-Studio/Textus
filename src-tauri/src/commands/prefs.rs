//! The last editor window's size and place, kept in the UI state by Rust
//! on close. Settings Rust needs early come from settings.json instead.

use crate::settings::Stores;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

/// A pair of numbers kept under `key` in the UI state.
fn kept_pair(app: &AppHandle, key: &str) -> Option<(f64, f64)> {
    let (state, _) = app.try_state::<Stores>()?.ui_state.snapshot();
    let pair = state.get(key)?;
    Some((pair.get(0)?.as_f64()?, pair.get(1)?.as_f64()?))
}

fn keep(app: &AppHandle, key: &str, value: Value) {
    if let Some(stores) = app.try_state::<Stores>() {
        let mut patch = Map::new();
        patch.insert(key.into(), value);
        stores.ui_state.patch(&patch);
    }
}

/// Whether to reopen last session's documents (default) or start blank.
pub fn read_restore_session_on_startup(app: &AppHandle) -> bool {
    crate::settings::read_flag(app, "restoreSessionOnStartup")
}

/// The inner size (logical px) the last closed editor window had, for the next
/// one. One size for all: labels after "main" are minted fresh each run.
pub fn read_editor_window_size(app: &AppHandle) -> Option<(f64, f64)> {
    let (width, height) = kept_pair(app, "editorWindowSize")?;
    // A corrupt or hand-edited value must not open an unusable window.
    (width >= 320.0 && height >= 240.0).then_some((width, height))
}

/// Where the last closed editor window was (outer position, logical px), for
/// the main window to open there again.
pub fn read_editor_window_position(app: &AppHandle) -> Option<(f64, f64)> {
    kept_pair(app, "editorWindowPosition")
}

/// Records `window`'s size and place, unless it is maximized, fullscreen or
/// minimized. Not the place on Wayland, which never tells an app where its window is.
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
    keep(
        app,
        "editorWindowSize",
        json!([size.width.round(), size.height.round()]),
    );
    if !crate::editor_windows::window_place_known() {
        return;
    }
    if let Ok(at) = window.outer_position() {
        let at = at.to_logical::<f64>(scale);
        keep(
            app,
            "editorWindowPosition",
            json!([at.x.round(), at.y.round()]),
        );
    }
}
