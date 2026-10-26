//! Tabs in flight between windows: the floating tab drag, its pill window, and
//! the native mouse tracking behind both drag flows.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State};
// Everything that emits events or shows the pill is macOS-only; other platforms
// compile only stub command bodies.
#[cfg(target_os = "macos")]
use tauri::{Emitter, EventTarget, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};

/// A tab dragged out of the tab bar, carrying its live content (it may be
/// unsaved). Keyed by the one new window's label, a 1:1 handoff.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct DetachedTab {
    path: Option<String>,
    content: String,
    #[serde(rename = "savedContent")]
    saved_content: String,
    /// The source tab's disk-mtime snapshot, so the receiving window's
    /// external-change detection keeps its baseline.
    #[serde(rename = "diskMtime")]
    disk_mtime: Option<f64>,
    /// Bundled Help doc id when the dragged tab is a Help document, keeping its
    /// title and dedupe in the new window.
    #[serde(rename = "helpDoc", default, skip_serializing_if = "Option::is_none")]
    help_doc: Option<String>,
    /// The Word document an unsaved tab was opened from.
    #[serde(
        rename = "importedFrom",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    imported_from: Option<String>,
}
pub struct PendingDetachedTabs(pub Mutex<HashMap<String, DetachedTab>>);

/// Windows with a live drag-tracking thread, so onMoved firing again doesn't
/// spawn a second poller.
#[derive(Default)]
pub struct DragTrackers {
    #[cfg(target_os = "macos")]
    active: Mutex<std::collections::HashSet<String>>,
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn take_detached_tab(
    window: tauri::Window,
    pending: State<PendingDetachedTabs>,
) -> Option<DetachedTab> {
    pending.0.lock().unwrap().remove(window.label())
}

#[derive(serde::Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct WindowBounds {
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    /// Physical-per-logical-pixel ratio for this window, which may sit on a
    /// different-DPI display. Always finite, so specta types it `number`.
    #[serde(rename = "scaleFactor")]
    #[cfg_attr(test, specta(type = specta_typescript::Number))]
    scale_factor: f64,
}

/// Physical-pixel screen bounds of every open window, so a single-tab window
/// dragged by its title bar can spot entering another window's tab row.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn list_window_bounds(app: tauri::AppHandle) -> Vec<WindowBounds> {
    app.webview_windows()
        .iter()
        .filter_map(|(label, window)| {
            // Never a drop target: the pill being dragged, a detached chat (a dropped tab
            // would vanish), or a hidden window.
            if !crate::commands::chat_window::is_editor_window(label)
                || !window.is_visible().unwrap_or(false)
            {
                return None;
            }
            let pos = window.outer_position().ok()?;
            let size = window.outer_size().ok()?;
            let scale_factor = window.scale_factor().ok()?;
            Some(WindowBounds {
                label: label.clone(),
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                scale_factor,
            })
        })
        .collect()
}

/// The floating tab pill: a webview can't paint outside its window, so the
/// in-flight tab is a tiny always-on-top transparent window, made fresh per drag.
pub const DRAG_PILL_LABEL: &str = "drag-pill";
#[cfg(target_os = "macos")]
const DRAG_PILL_WIDTH: f64 = 200.0;
#[cfg(target_os = "macos")]
const DRAG_PILL_HEIGHT: f64 = 34.0;

/// Percent-encode a URL query value (RFC 3986 unreserved set, byte-wise).
#[cfg(target_os = "macos")]
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
#[cfg(target_os = "macos")]
fn create_drag_pill(app: &tauri::AppHandle, title: &str, dirty: bool, x: f64, y: f64) {
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
#[cfg(target_os = "macos")]
fn move_drag_pill(app: &tauri::AppHandle, x: f64, y: f64) {
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
#[cfg(target_os = "macos")]
fn park_drag_pill(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(DRAG_PILL_LABEL) {
        let _ = window.hide();
    }
}

/// The drag ended: a lingering hidden pill would keep the app alive after the
/// last real window closes.
#[cfg(target_os = "macos")]
fn destroy_drag_pill(app: &tauri::AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(window) = app.get_webview_window(DRAG_PILL_LABEL) {
            let _ = window.destroy();
        }
    });
}

/// Height of the strip along a window's top edge that counts as its tab row for
/// drops. Keep in step with TAB_ROW_HEIGHT_LOGICAL in useTabDragMerge.ts.
#[cfg(target_os = "macos")]
const TAB_ROW_HEIGHT_LOGICAL: f64 = 72.0;

/// Which window's tab row (if any) is under the cursor. The pill and hidden
/// windows never are; the drag source is, so a tab can drop back where it came from.
#[cfg(target_os = "macos")]
fn top_strip_hit(app: &tauri::AppHandle, x: f64, y: f64) -> Option<String> {
    for (label, window) in app.webview_windows() {
        if !crate::commands::chat_window::is_editor_window(&label)
            || !window.is_visible().unwrap_or(false)
        {
            continue;
        }
        let (Ok(pos), Ok(size), Ok(scale)) = (
            window.outer_position(),
            window.outer_size(),
            window.scale_factor(),
        ) else {
            continue;
        };
        let wx = pos.x as f64 / scale;
        let wy = pos.y as f64 / scale;
        let ww = size.width as f64 / scale;
        if x >= wx && x <= wx + ww && y >= wy && y <= wy + TAB_ROW_HEIGHT_LOGICAL {
            return Some(label);
        }
    }
    None
}

/// One floating tab drag at a time, app-wide - there's only one mouse.
#[cfg(target_os = "macos")]
static FLOATING_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);

/// The floating tab. Once a tab is in flight its document is handed to Rust and
/// its source is gone (destroy is what macOS honors mid-drag). This thread polls
/// the cursor until release: over a tab row the tab lands there, else in a new window.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn start_floating_tab_drag(
    window: tauri::WebviewWindow,
    tab: DetachedTab,
    title: String,
    dirty: bool,
    destroy_source: bool,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, tab, title, dirty, destroy_source);
        Err("floating tab drags require macOS cursor tracking".to_string())
    }
    #[cfg(target_os = "macos")]
    {
        if FLOATING_DRAG_ACTIVE.swap(true, Ordering::SeqCst) {
            return Err("a floating tab drag is already active".to_string());
        }
        let app = window.app_handle().clone();
        if destroy_source {
            let _ = window.destroy();
        }
        std::thread::spawn(move || {
            let mut pill_exists = false;
            let mut pill_parked = false;
            let mut hover: Option<String> = None;
            let mut hit: Option<String> = None;
            let mut ticks: u32 = 0;

            let (x, y, final_hit) = loop {
                let (x, y, down) = mouse::state();
                if !down {
                    // Release: one fresh hit test decides; the cached one may be two ticks stale.
                    break (x, y, top_strip_hit(&app, x, y));
                }
                // The pill moves every tick; the costly hit test runs every 3rd.
                if ticks.is_multiple_of(3) {
                    hit = top_strip_hit(&app, x, y);
                }
                ticks += 1;

                match &hit {
                    Some(label) => {
                        // Snapped into a row: the target's preview pill stands for the tab, the
                        // floating pill parks.
                        if pill_exists && !pill_parked {
                            park_drag_pill(&app);
                            pill_parked = true;
                        }
                        if hover.as_deref() != Some(label.as_str()) {
                            if let Some(prev) = &hover {
                                let _ = app.emit_to(
                                    EventTarget::webview_window(prev),
                                    "drag-hover",
                                    Option::<DragHoverPreview>::None,
                                );
                            }
                            hover = Some(label.clone());
                        }
                        // Every tick: the x lets the preview pill ride the cursor along the bar.
                        let _ = app.emit_to(
                            EventTarget::webview_window(label),
                            "drag-hover",
                            Some(DragHoverPreview {
                                title: title.clone(),
                                dirty,
                                x,
                            }),
                        );
                    }
                    None => {
                        if let Some(prev) = hover.take() {
                            let _ = app.emit_to(
                                EventTarget::webview_window(&prev),
                                "drag-hover",
                                Option::<DragHoverPreview>::None,
                            );
                        }
                        if pill_exists {
                            move_drag_pill(&app, x, y);
                            pill_parked = false;
                        } else {
                            pill_exists = true;
                            pill_parked = false;
                            create_drag_pill(&app, &title, dirty, x, y);
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(15));
            };

            // A preview on a window that isn't the landing one gets an explicit off; the
            // landing window swaps its preview for the tab itself, without a gap flash.
            if let Some(prev) = &hover {
                if final_hit.as_deref() != Some(prev.as_str()) {
                    let _ = app.emit_to(
                        EventTarget::webview_window(prev),
                        "drag-hover",
                        Option::<DragHoverPreview>::None,
                    );
                }
            }
            match final_hit {
                Some(label) => {
                    let _ = app.emit_to(
                        EventTarget::webview_window(&label),
                        "receive-detached-tab",
                        DroppedTab { tab, x },
                    );
                }
                None => {
                    let label = format!("window-{}", crate::next_window_id());
                    app.state::<PendingDetachedTabs>()
                        .0
                        .lock()
                        .unwrap()
                        .insert(label.clone(), tab);
                    let app2 = app.clone();
                    let position = (x - 100.0, (y - 14.0).max(0.0));
                    let _ = app.run_on_main_thread(move || {
                        let _ = crate::build_window(&app2, &label, Some(position));
                    });
                }
            }
            destroy_drag_pill(&app);
            FLOATING_DRAG_ACTIVE.store(false, Ordering::SeqCst);
        });
        Ok(())
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, serde::Serialize)]
struct DragTick {
    x: f64,
    y: f64,
    down: bool,
}

/// Global cursor position (logical points, top-left origin) and left-button
/// state via CoreGraphics, which needs no Accessibility consent.
#[cfg(target_os = "macos")]
mod mouse {
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        // state_id 0 = kCGEventSourceStateCombinedSessionState, button 0 = left
        fn CGEventSourceButtonState(state_id: u32, button: u32) -> bool;
        fn CGEventCreate(source: *const std::ffi::c_void) -> *const std::ffi::c_void;
        fn CGEventGetLocation(event: *const std::ffi::c_void) -> CGPoint;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const std::ffi::c_void);
    }

    pub fn left_button_down() -> bool {
        unsafe { CGEventSourceButtonState(0, 0) }
    }

    pub fn state() -> (f64, f64, bool) {
        unsafe {
            let event = CGEventCreate(std::ptr::null());
            let loc = CGEventGetLocation(event);
            CFRelease(event);
            (loc.x, loc.y, CGEventSourceButtonState(0, 0))
        }
    }
}

/// Tauri's onMoved has no "drag ended" event, so on the first onMoved the
/// frontend starts this: a thread streams `window-drag-tick` {x, y, down} until the
/// button is released. Returns false when there is nothing to track.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn start_window_drag_tracking(
    window: tauri::WebviewWindow,
    trackers: State<DragTrackers>,
) -> bool {
    #[cfg(target_os = "macos")]
    {
        if !mouse::left_button_down() {
            return false;
        }
        let label = window.label().to_string();
        if !trackers.active.lock().unwrap().insert(label.clone()) {
            return true; // already streaming to this window
        }
        let app = window.app_handle().clone();
        std::thread::spawn(move || {
            loop {
                // The window dies mid-drag when it turns into a floating tab; that thread owns
                // the drag from there.
                if app.get_webview_window(&label).is_none() {
                    break;
                }
                let (x, y, down) = mouse::state();
                let _ = app.emit_to(
                    EventTarget::webview_window(&label),
                    "window-drag-tick",
                    DragTick { x, y, down },
                );
                if !down {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            app.state::<DragTrackers>()
                .active
                .lock()
                .unwrap()
                .remove(&label);
        });
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, trackers);
        false
    }
}

/// Payload of "drag-hover", re-emitted every tick with the live cursor x so the
/// receiver can slide the incoming tab along its bar. None on leave.
#[cfg(target_os = "macos")]
#[derive(Clone, serde::Serialize)]
struct DragHoverPreview {
    title: String,
    dirty: bool,
    x: f64,
}

/// Payload of "receive-detached-tab": the document and the drop's cursor x, so
/// the tab lands at the slot it hovered.
#[cfg(target_os = "macos")]
#[derive(Clone, serde::Serialize)]
struct DroppedTab {
    #[serde(flatten)]
    tab: DetachedTab,
    x: f64,
}
