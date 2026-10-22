//! Tabs in flight between windows: the floating tab drag, its pill window,
//! and the native mouse tracking behind both drag flows (a tab pulled off a
//! tab bar, or a whole single-tab window dragged by its title bar). The
//! frontend counterpart is app/useTabDragMerge.ts.

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State};
// Everything that emits events or shows the pill lives behind the macOS-only
// drag threads - other platforms compile only the stub command bodies.
#[cfg(target_os = "macos")]
use tauri::{Emitter, EventTarget, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};

/// A tab dragged out of the tab bar (Settings > General > tab mode):
/// unlike PendingOpenPaths, this carries live in-memory content, not just a
/// path - the tab may be an unsaved draft, or have edits that haven't hit
/// disk yet, and dragging it out must not lose that. Keyed by the specific
/// new window's label (not a shared queue) since it's a 1:1 handoff to the
/// one window spawned for it, not a batch any window could claim.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct DetachedTab {
    path: Option<String>,
    content: String,
    #[serde(rename = "savedContent")]
    saved_content: String,
    /// The source tab's disk-mtime snapshot, carried along so the receiving
    /// window's external-change detection keeps its baseline instead of
    /// re-adopting whatever is on disk after the drop.
    #[serde(rename = "diskMtime")]
    disk_mtime: Option<f64>,
    /// Bundled Help doc id ("markdown"/"agent") when the dragged tab is a
    /// Help document - keeps its title and per-doc dedupe working in the
    /// window it lands in.
    #[serde(rename = "helpDoc", default, skip_serializing_if = "Option::is_none")]
    help_doc: Option<String>,
    /// The Word document an unsaved tab was opened from - its title, and
    /// where its first save is suggested (src/document/word-import.ts).
    #[serde(
        rename = "importedFrom",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    imported_from: Option<String>,
}
pub struct PendingDetachedTabs(pub Mutex<HashMap<String, DetachedTab>>);

/// Windows that currently have a live drag-tracking thread (see
/// start_window_drag_tracking) - guards against spawning a second poller for
/// the same window when onMoved fires again before the first tick lands.
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
    /// Physical-per-logical-pixel ratio, so the frontend can convert its own
    /// "the tab row is the top N logical pixels" constant into physical
    /// pixels for THIS SPECIFIC window (which may sit on a different-DPI
    /// display than the one being dragged from).
    /// Always a finite ratio: `number`, not specta's `number | null` for
    /// an f64 (the null a NaN would serialize to).
    #[serde(rename = "scaleFactor")]
    #[cfg_attr(test, specta(type = specta_typescript::Number))]
    scale_factor: f64,
}

/// Physical-pixel screen bounds of every open window - lets a single-tab
/// window being dragged by its title bar (useTabDragMerge.ts's onMoved/tick
/// effect) spot the moment its cursor enters another window's tab row, which
/// is when it hands itself over to start_floating_tab_drag.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn list_window_bounds(app: tauri::AppHandle) -> Vec<WindowBounds> {
    app.webview_windows()
        .iter()
        .filter_map(|(label, window)| {
            // The floating drag pill is the thing BEING dragged, never a
            // drop target; neither is a detached chat window (no tab bar, no
            // document - a tab dropped there would just vanish), and a hidden
            // window can't be one either.
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

/// The floating tab pill: while a tab is dragged between windows it exists
/// as this dedicated tiny always-on-top transparent window (a webview can't
/// paint outside its own window, so the in-flight tab has to BE a window).
/// One per app, created fresh per drag (create_drag_pill) and destroyed on
/// release (destroy_drag_pill) - recreating is cheap (the page is a static
/// ~1KB dragpill.html) and passing title/dirty in the URL avoids any
/// eval-before-page-load race a persistent window would need to handle.
pub const DRAG_PILL_LABEL: &str = "drag-pill";
#[cfg(target_os = "macos")]
const DRAG_PILL_WIDTH: f64 = 200.0;
#[cfg(target_os = "macos")]
const DRAG_PILL_HEIGHT: f64 = 34.0;

/// Percent-encode a URL query value (std has no urlencoder; this is the
/// RFC 3986 unreserved set, byte-wise, so any title round-trips).
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

/// Create the floating pill centered under the cursor (x/y in global
/// logical points), like a tab held by its middle. Click-through
/// (set_ignore_cursor_events) so it never swallows pointer events, never
/// focused so it never steals keyboard focus. Window creation must happen
/// on the main thread on macOS, and the drag thread isn't one; hence the
/// run_on_main_thread hop.
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
/// park_drag_pill (leaving a tab row un-merged puts the pill back in hand).
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

/// Hide (don't destroy) the pill while the cursor is over a target tab row:
/// the target shows the preview pill IN its bar instead, so the tab visually
/// snaps into the row while the drag is still live.
#[cfg(target_os = "macos")]
fn park_drag_pill(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(DRAG_PILL_LABEL) {
        let _ = window.hide();
    }
}

/// The drag ended (merged, detached, or cancelled) - the pill must not
/// outlive it, also because a lingering hidden window would keep the app
/// alive after the last real window closes.
#[cfg(target_os = "macos")]
fn destroy_drag_pill(app: &tauri::AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        if let Some(window) = app.get_webview_window(DRAG_PILL_LABEL) {
            let _ = window.destroy();
        }
    });
}

/// Height of the strip along a window's top edge that counts as its "tab
/// row" for drop purposes - the tab bar when it has one, or the title strip
/// of a single-tab window. Must equal useTabDragMerge.ts's
/// TAB_ROW_HEIGHT_LOGICAL (it was 60 here against 72 there, so the macOS drop
/// zone was smaller than the one the frontend highlighted).
#[cfg(target_os = "macos")]
const TAB_ROW_HEIGHT_LOGICAL: f64 = 72.0;

/// Which window's tab row (if any) is under the cursor (global logical
/// points). The pill itself and hidden windows are never targets; the drag
/// SOURCE deliberately is one - dropping a pulled-out tab back onto its own
/// window's row simply re-inserts it there.
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

/// THE floating tab. The moment a tab becomes "in flight" - pulled past a
/// tab bar's detach threshold, or a whole single-tab window dragged onto
/// another window's tab row - its document is handed to Rust and its
/// source ceases to exist (the caller removes the pill from its bar, or
/// destroy_source tears the whole window down; destroy is the one window
/// operation macOS reliably honors mid-native-drag, unlike hide, which the
/// drag session ignores). From here this thread owns the drag outright,
/// polling the real cursor/button (see mod mouse): over a tab row, the
/// tab rides that row as the preview pill (the floating pill parks);
/// elsewhere it rides the cursor as the pill (created lazily the first
/// time it's actually needed). Release resolves it: over a row -> pushed
/// to that window as a real tab; anywhere else -> a fresh window right
/// there, via the same PendingDetachedTabs handoff a tab-bar detach has
/// always used. Nothing polls outside an active drag, and the thread ends
/// itself on release.
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
                    // Release: one fresh hit test decides - the cached one
                    // may be up to two ticks stale.
                    break (x, y, top_strip_hit(&app, x, y));
                }
                // Pill movement wants near-pointer-rate smoothness; the hit
                // test costs several event-loop round trips per window, so
                // it runs every 3rd tick and the last result stands between.
                if ticks.is_multiple_of(3) {
                    hit = top_strip_hit(&app, x, y);
                }
                ticks += 1;

                match &hit {
                    Some(label) => {
                        // Snapped into a row: the preview pill in the
                        // target's bar represents the tab now, the floating
                        // pill parks.
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
                        // Every tick, not just on target change: the x is
                        // what lets the preview pill ride the cursor along
                        // the target's bar.
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

            // A preview left on a window that ISN'T where the tab lands
            // gets an explicit off; the landing window's preview is
            // deliberately left alone - its receive-detached-tab listener
            // swaps it for the real tab without an empty-gap flash.
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

/// Global cursor position (logical points, top-left origin - the same space
/// as the browser's PointerEvent.screenX/Y) and left-button state, via
/// CoreGraphics. Neither call needs Accessibility/Input Monitoring consent:
/// they read shared session state, they don't tap the event stream.
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

/// Tauri's onMoved fires on every tick of a native window drag but there is
/// no "drag ended" event, and a merge decision made on anything short of the
/// actual button release is wrong (a debounce merges while the user is
/// merely holding still). So: the frontend calls this on the FIRST onMoved
/// of a drag, and a short-lived thread streams `window-drag-tick`
/// {x, y, down} events (cursor in global logical points) to the calling
/// window until the left button is truly released - the final tick carries
/// down=false. Lazy by construction: no thread exists outside an active
/// drag, and it exits itself on release. Returns false when there's nothing
/// to track (button already up - e.g. a programmatic setPosition fired
/// onMoved - or a non-macOS platform).
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
                // The window dies mid-drag when it turns into a floating
                // tab (start_floating_tab_drag destroys it) - that thread
                // owns the drag from there, this one is done.
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

/// Payload of the "drag-hover" event a floating tab drag emits to the
/// window whose tab row it's currently over - re-emitted on every tick
/// with the live cursor x (global logical), so the receiver can render the
/// incoming tab as a real pill sliding along its bar with the cursor, its
/// neighbors giving way. Cleared with None on leave.
#[cfg(target_os = "macos")]
#[derive(Clone, serde::Serialize)]
struct DragHoverPreview {
    title: String,
    dirty: bool,
    x: f64,
}

/// Payload of "receive-detached-tab": the document plus where (cursor x,
/// global logical) it was dropped - the receiver derives the insertion
/// index from it, so the tab lands at the slot it was hovering, not at
/// the end of the bar.
#[cfg(target_os = "macos")]
#[derive(Clone, serde::Serialize)]
struct DroppedTab {
    #[serde(flatten)]
    tab: DetachedTab,
    x: f64,
}
