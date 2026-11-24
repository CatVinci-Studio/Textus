//! The last editor window's size and place, kept in the UI state by Rust
//! on close. Settings Rust needs early come from settings.json instead.

use crate::settings::Stores;
use crate::window_frame::{self, Kept, Live, Mode};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::sync::Mutex;
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

/// The last closed editor window's frame: its normal size, its place (outer
/// position) and whether it was left maximized or full screen.
pub fn read_editor_frame(app: &AppHandle) -> Option<Kept> {
    let mode = app
        .try_state::<Stores>()?
        .ui_state
        .snapshot()
        .0
        .get("editorWindowMode")
        .and_then(|mode| serde_json::from_value(mode.clone()).ok())
        .unwrap_or_default();
    Some(Kept {
        size: read_editor_window_size(app)?,
        position: kept_pair(app, "editorWindowPosition"),
        mode,
    })
}

/// Each editor window's normal bounds as last seen, by label: what it goes back
/// to, kept when it closes maximized or full screen.
static NORMAL: Mutex<BTreeMap<String, Kept>> = Mutex::new(BTreeMap::new());

fn normal_bounds_of(label: &str) -> Option<Kept> {
    NORMAL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(label)
        .copied()
}

pub fn seed_bounds(label: &str, bounds: Kept) {
    NORMAL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(label.to_string(), bounds);
}

pub fn forget_bounds(label: &str) {
    NORMAL
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(label);
}

/// A window moved or resized: its bounds, while normal. Not the place on
/// Wayland, which never tells an app where its window is.
pub fn note_bounds(window: &tauri::Window) {
    if let Some(bounds) = read_live(window)
        .as_ref()
        .and_then(window_frame::normal_bounds)
    {
        seed_bounds(window.label(), bounds);
    }
}

fn read_live(window: &tauri::Window) -> Option<Live> {
    let scale = window.scale_factor().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    let position = if crate::editor_windows::window_place_known() {
        let at = window.outer_position().ok()?.to_logical::<f64>(scale);
        Some((at.x.round(), at.y.round()))
    } else {
        None
    };
    let mode = if window.is_fullscreen().ok()? {
        Mode::Fullscreen
    } else if window.is_maximized().ok()? {
        Mode::Maximized
    } else {
        Mode::Normal
    };
    Some(Live {
        frame: Kept {
            size: (size.width.round(), size.height.round()),
            position,
            mode,
        },
        minimized: window.is_minimized().ok()?,
    })
}

/// What to keep of `window` as it closes.
pub fn closing_frame(window: &tauri::Window) -> Option<Kept> {
    let live = read_live(window)?;
    window_frame::on_close(&live, normal_bounds_of(window.label()))
}

/// Records `window`'s frame for the next window a launch opens.
pub fn remember_editor_window(app: &AppHandle, window: &tauri::Window) {
    let Some(kept) = closing_frame(window) else {
        return;
    };
    keep(app, "editorWindowSize", json!([kept.size.0, kept.size.1]));
    if let Some((x, y)) = kept.position {
        keep(app, "editorWindowPosition", json!([x, y]));
    }
    keep(app, "editorWindowMode", json!(kept.mode));
}

/// As the app quits, before any window closes: the window last in use for the
/// next launch, and each window's frame with its documents.
pub fn remember_open_windows(app: &AppHandle) {
    if let Some(window) = crate::editor_windows::last_editor(app) {
        remember_editor_window(app, &window);
    }
    if let Some(state) = app.try_state::<crate::commands::session::SessionTabsState>() {
        crate::commands::session::keep_open_frames(app, &state);
    }
}
