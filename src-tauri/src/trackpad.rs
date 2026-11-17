//! A finger on a Mac's trackpad, put down and lifted: what a page's wheel
//! events never say. The document's own give at its ends (the page's
//! elastic-overscroll.ts) springs back the moment the finger lifts, as a
//! Mac page does, rather than guessing from a pause.

/// Tells a window's page `trackpad-touch` (true: the finger is down for a
/// scroll; false: it lifted) from the scroll events AppKit hands the app.
/// Main thread only, once.
#[cfg(target_os = "macos")]
pub(crate) fn watch_trackpad(app: &tauri::AppHandle) {
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventPhase};
    use std::ptr::NonNull;
    use tauri::Emitter;
    let app = app.clone();
    let block = block2::RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit hands the block a live event and takes it back.
        let e = unsafe { event.as_ref() };
        let phase = e.phase();
        let down = if phase.contains(NSEventPhase::Began) {
            Some(true)
        } else if phase.intersects(NSEventPhase::Ended.union(NSEventPhase::Cancelled)) {
            Some(false)
        } else {
            None
        };
        // The monitor runs on the main thread, where AppKit hands it events.
        let main = objc2::MainThreadMarker::new();
        let window = main.and_then(|mtm| e.window(mtm));
        if let (Some(down), Some(window)) = (down, window) {
            let window = objc2::rc::Retained::as_ptr(&window) as *mut std::ffi::c_void;
            for (label, webview) in tauri::Manager::webview_windows(&app) {
                if webview.ns_window().ok() == Some(window) {
                    let _ = app.emit_to(label.as_str(), "trackpad-touch", down);
                }
            }
        }
        event.as_ptr()
    });
    // SAFETY: a local monitor on the main thread; the event goes on as it came.
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::ScrollWheel, &block)
    };
    std::mem::forget(monitor);
}
