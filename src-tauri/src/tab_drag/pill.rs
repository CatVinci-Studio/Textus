//! The floating tab pill: a webview can't paint outside its window, so the
//! in-flight tab is a tiny always-on-top transparent window, made fresh per
//! drag, moved under the cursor, parked over a tab row and destroyed at the end.

#[cfg(any(target_os = "macos", windows))]
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub const DRAG_PILL_LABEL: &str = "drag-pill";
#[cfg(any(target_os = "macos", windows))]
const DRAG_PILL_WIDTH: f64 = 200.0;
#[cfg(any(target_os = "macos", windows))]
const DRAG_PILL_HEIGHT: f64 = 34.0;

/// Percent-encode a URL query value (RFC 3986 unreserved set, byte-wise).
#[cfg(any(target_os = "macos", windows))]
fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Create the floating pill centered under the cursor (global logical points),
/// click-through and never focused. Window creation must be on the main thread.
#[cfg(any(target_os = "macos", windows))]
pub(super) fn create_drag_pill(app: &tauri::AppHandle, title: &str, dirty: bool, x: f64, y: f64) {
    let url = format!(
        "dragpill.html?title={}&dirty={}",
        url_encode(title),
        if dirty { 1 } else { 0 }
    );
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(existing) = app.get_webview_window(DRAG_PILL_LABEL) {
            let _ = existing.destroy();
        }
        let built = WebviewWindowBuilder::new(&app, DRAG_PILL_LABEL, WebviewUrl::App(url.into()))
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .shadow(false)
            .inner_size(DRAG_PILL_WIDTH, DRAG_PILL_HEIGHT)
            .position(x - DRAG_PILL_WIDTH / 2.0, y - DRAG_PILL_HEIGHT / 2.0)
            .build();
        if let Ok(window) = built {
            let _ = window.set_ignore_cursor_events(true);
        }
    });
}

/// Reposition the pill under the cursor mid-drag; also re-shows it after a
/// park_drag_pill.
#[cfg(any(target_os = "macos", windows))]
pub(super) fn move_drag_pill(app: &tauri::AppHandle, x: f64, y: f64) {
    if let Some(window) = app.get_webview_window(DRAG_PILL_LABEL) {
        let _ = window.set_position(tauri::LogicalPosition::new(
            x - DRAG_PILL_WIDTH / 2.0,
            y - DRAG_PILL_HEIGHT / 2.0,
        ));
        let _ = window.show();
    }
}

/// Hide (don't destroy) the pill while over a target tab row, where the target
/// shows the preview pill in its bar instead.
#[cfg(any(target_os = "macos", windows))]
pub(super) fn park_drag_pill(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(DRAG_PILL_LABEL) {
        let _ = window.hide();
    }
}

/// The drag ended: a lingering hidden pill would keep the app alive after the
/// last real window closes.
#[cfg(any(target_os = "macos", windows))]
pub(super) fn destroy_drag_pill(app: &tauri::AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(window) = app.get_webview_window(DRAG_PILL_LABEL) {
            let _ = window.destroy();
        }
    });
}
