//! Tabs in flight between windows: the floating tab drag, its pill window, and
//! the native mouse tracking behind both drag flows.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State};
// Everything that emits events or shows the pill is macOS-only; other platforms
// compile only stub command bodies.
#[cfg(any(target_os = "macos", windows))]
use tauri::{Emitter, EventTarget};

#[cfg(any(target_os = "macos", windows))]
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
    #[cfg(any(target_os = "macos", windows))]
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

/// A tab's own right-click Move to New Window: the tab handed to a fresh
/// small window (build_small_window), which takes it as it opens.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn move_tab_to_new_window(
    app: tauri::AppHandle,
    pending: State<'_, PendingDetachedTabs>,
    tab: DetachedTab,
) -> Result<(), String> {
    let label = format!("window-{}", crate::editor_windows::next_window_id());
    pending.0.lock().unwrap().insert(label.clone(), tab);
    crate::editor_windows::build_small_window(&app, &label, None).map_err(|e| {
        pending.0.lock().unwrap().remove(&label);
        e.to_string()
    })
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
    app.windows()
        .iter()
        .filter_map(|(label, window)| {
            // Never a drop target: the pill being dragged, a detached chat (a dropped tab
            // would vanish), or a hidden window.
            if !crate::windows::is_editor_window(label) || !window.is_visible().unwrap_or(false) {
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

mod pill;
pub use pill::DRAG_PILL_LABEL;
#[cfg(any(target_os = "macos", windows))]
use pill::{create_drag_pill, destroy_drag_pill, move_drag_pill, park_drag_pill};

/// Which window (if any) is under the cursor, and whether over its tab row -
/// the `row` logical points along its top, as the window measures it (the
/// tab joins the row) - or its documents (it opens beside them, split).
/// The pill and hidden windows never are; the drag source is, so a tab can
/// drop back where it came from.
#[cfg(any(target_os = "macos", windows))]
fn window_hit(app: &tauri::AppHandle, x: f64, y: f64, row: f64) -> Option<(String, bool)> {
    for (label, window) in app.windows() {
        if !crate::windows::is_editor_window(&label) || !window.is_visible().unwrap_or(false) {
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
        let wh = size.height as f64 / scale;
        if x >= wx && x <= wx + ww && y >= wy && y <= wy + wh {
            return Some((label, y <= wy + row));
        }
    }
    None
}

/// One floating tab drag at a time, app-wide - there's only one mouse.
#[cfg(any(target_os = "macos", windows))]
static FLOATING_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);

/// The floating tab. Once a tab is in flight its document is handed to Rust and
/// its source is gone (destroy is what macOS honors mid-drag). This thread polls
/// the cursor until release: over a tab row the tab lands there, over a
/// window's documents it opens split there, else in a new window.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn start_floating_tab_drag(
    window: tauri::WebviewWindow,
    tab: DetachedTab,
    title: String,
    dirty: bool,
    destroy_source: bool,
    row_height: f64,
) -> Result<(), String> {
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (window, tab, title, dirty, destroy_source, row_height);
        Err("floating tab drags need global cursor tracking".to_string())
    }
    #[cfg(any(target_os = "macos", windows))]
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
            let mut hit: Option<(String, bool)> = None;
            let mut ticks: u32 = 0;

            let (x, y, final_hit) = loop {
                let (x, y, down) = mouse::state();
                if !down {
                    // Release: one fresh hit test decides; the cached one may be two ticks stale.
                    break (x, y, window_hit(&app, x, y, row_height));
                }
                // The pill moves every tick; the costly hit test runs every 3rd.
                if ticks.is_multiple_of(3) {
                    hit = window_hit(&app, x, y, row_height);
                }
                ticks += 1;

                match &hit {
                    Some((label, row)) => {
                        // Snapped into a row: the target's preview pill stands for the tab, the
                        // floating pill parks. Over the documents it rides on, the window
                        // showing where the split would open.
                        if *row && pill_exists && !pill_parked {
                            park_drag_pill(&app);
                            pill_parked = true;
                        } else if !*row {
                            if pill_exists {
                                move_drag_pill(&app, x, y);
                                pill_parked = false;
                            } else {
                                pill_exists = true;
                                pill_parked = false;
                                create_drag_pill(&app, &title, dirty, x, y);
                            }
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
                                y,
                                row: *row,
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
                if final_hit.as_ref().map(|(l, _)| l.as_str()) != Some(prev.as_str()) {
                    let _ = app.emit_to(
                        EventTarget::webview_window(prev),
                        "drag-hover",
                        Option::<DragHoverPreview>::None,
                    );
                }
            }
            match final_hit {
                Some((label, row)) => {
                    let _ = app.emit_to(
                        EventTarget::webview_window(&label),
                        "receive-detached-tab",
                        DroppedTab { tab, x, y, row },
                    );
                }
                None => {
                    let label = format!("window-{}", crate::editor_windows::next_window_id());
                    app.state::<PendingDetachedTabs>()
                        .0
                        .lock()
                        .unwrap()
                        .insert(label.clone(), tab);
                    let app2 = app.clone();
                    let position = (x - 100.0, (y - 14.0).max(0.0));
                    let _ = app.run_on_main_thread(move || {
                        let _ = crate::editor_windows::build_small_window(
                            &app2,
                            &label,
                            Some(position),
                        );
                    });
                }
            }
            destroy_drag_pill(&app);
            FLOATING_DRAG_ACTIVE.store(false, Ordering::SeqCst);
        });
        Ok(())
    }
}

#[cfg(any(target_os = "macos", windows))]
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

/// The same on Windows: the cursor in physical pixels, divided by the scale
/// of the display it is on, so it compares with windows' logical bounds.
#[cfg(windows)]
mod mouse {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    pub fn left_button_down() -> bool {
        // The high bit is set while the button is down.
        unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 }
    }

    pub fn state() -> (f64, f64, bool) {
        let mut point = POINT::default();
        unsafe {
            let _ = GetCursorPos(&mut point);
            let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
            let (mut dpi_x, mut dpi_y) = (96u32, 96u32);
            let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);
            let scale = dpi_x.max(1) as f64 / 96.0;
            (
                point.x as f64 / scale,
                point.y as f64 / scale,
                left_button_down(),
            )
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
    #[cfg(any(target_os = "macos", windows))]
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
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (window, trackers);
        false
    }
}

/// Payload of "drag-hover", re-emitted every tick with the live cursor so the
/// receiver can slide the incoming tab along its bar (`row`), or show where
/// over its documents it would open. None on leave.
#[cfg(any(target_os = "macos", windows))]
#[derive(Clone, serde::Serialize)]
struct DragHoverPreview {
    title: String,
    dirty: bool,
    x: f64,
    y: f64,
    row: bool,
}

/// Payload of "receive-detached-tab": the document and the drop's cursor, so
/// the tab lands at the slot it hovered, or opens split where it was let go
/// over the documents (`row` false).
#[cfg(any(target_os = "macos", windows))]
#[derive(Clone, serde::Serialize)]
struct DroppedTab {
    #[serde(flatten)]
    tab: DetachedTab,
    x: f64,
    y: f64,
    row: bool,
}
