//! macOS: the traffic lights on the window bar's middle line, whatever its
//! height (Interface Size's presets, 36 to 48). AppKit puts them in its own
//! 28-32pt title bar and puts them back when it lays that out again (a new
//! title, a resize), so each window's bar height is kept and the lights put
//! back after each.

#[cfg(target_os = "macos")]
use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::sync::Mutex;

/// Each window's bar height, by its NSWindow's address.
#[cfg(target_os = "macos")]
static BARS: Mutex<Option<HashMap<usize, f64>>> = Mutex::new(None);

/// The window bar's height in points, from the page as Interface Size sets
/// it; the lights follow it now and after each resize. Nothing off macOS.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn set_window_bar_height(window: tauri::WebviewWindow, height: f64) {
    #[cfg(target_os = "macos")]
    {
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        BARS.lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_or_insert_with(HashMap::new)
            .insert(ns_window as usize, height);
        let _ = window.clone().run_on_main_thread(move || {
            if let Ok(ns_window) = window.ns_window() {
                place(ns_window);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, height);
}

/// The window's title, set here so the lights go back on the bar's middle
/// line in the same step: a new title puts them back in AppKit's title bar.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn set_window_title(window: tauri::WebviewWindow, title: String) {
    #[cfg(target_os = "macos")]
    let _ = window.clone().run_on_main_thread(move || {
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        let text = objc2_foundation::NSString::from_str(&title);
        // SAFETY: on the main thread, the window's own live NSWindow.
        unsafe {
            let _: () = objc2::msg_send![&*(ns_window as *const objc2::runtime::AnyObject), setTitle: &*text];
        }
        place(ns_window);
    });
    #[cfg(not(target_os = "macos"))]
    let _ = window.set_title(&title);
}

/// Moves `window`'s three buttons onto its bar's middle line, the
/// title bar's view grown to the bar so they stay clickable. Main thread.
#[cfg(target_os = "macos")]
fn place(window: *mut std::ffi::c_void) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_core_foundation::{CGPoint, CGRect};
    let Some(bar) = BARS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|bars| bars.get(&(window as usize)).copied())
    else {
        return;
    };
    // SAFETY: on the main thread, a live window (its own handle's, or a
    // notification's), every object checked before it is messaged.
    unsafe {
        let window = &*(window as *const AnyObject);
        let style: usize = msg_send![window, styleMask];
        // Full screen: the system shows the lights in its own bar.
        if style & (1 << 14) != 0 {
            return;
        }
        let buttons: [*mut AnyObject; 3] = [0usize, 1, 2].map(|kind| {
            let button: *mut AnyObject = msg_send![window, standardWindowButton: kind];
            button
        });
        if buttons.iter().any(|b| b.is_null()) {
            return;
        }
        let title_view: *mut AnyObject = msg_send![&*buttons[0], superview];
        if title_view.is_null() {
            return;
        }
        let container: *mut AnyObject = msg_send![&*title_view, superview];
        if container.is_null() {
            return;
        }
        let first: CGRect = msg_send![&*buttons[0], frame];
        let y = ((bar - first.size.height) / 2.0).round();
        let held: CGRect = msg_send![&*container, frame];
        let frame: CGRect = msg_send![window, frame];
        let top = frame.size.height - bar;
        // Already in place: the common case, checked on every update.
        if first.origin.y == y && held.size.height == bar && held.origin.y == top {
            return;
        }
        let mut room = held;
        room.size.height = bar;
        room.origin.y = top;
        let _: () = msg_send![&*container, setFrame: room];
        let mut inner: CGRect = msg_send![&*title_view, frame];
        inner.origin.y = 0.0;
        inner.size.height = bar;
        let _: () = msg_send![&*title_view, setFrame: inner];
        for button in buttons {
            let at: CGRect = msg_send![&*button, frame];
            let origin = CGPoint { x: at.origin.x, y };
            let _: () = msg_send![&*button, setFrameOrigin: origin];
        }
    }
}

/// Places the lights again after each resize, where the window's height
/// moves the title bar, and on leaving full screen. Main thread, once.
#[cfg(target_os = "macos")]
pub(crate) fn watch() {
    use objc2_app_kit::{NSWindowDidExitFullScreenNotification, NSWindowDidResizeNotification};
    use objc2_foundation::{NSNotification, NSNotificationCenter};
    use std::ptr::NonNull;
    let center = NSNotificationCenter::defaultCenter();
    // SAFETY: AppKit's notification names, constant for the process.
    let names = unsafe {
        [
            NSWindowDidResizeNotification,
            NSWindowDidExitFullScreenNotification,
        ]
    };
    for name in names {
        let block = block2::RcBlock::new(move |note: NonNull<NSNotification>| {
            // SAFETY: AppKit hands the block a live notification.
            let Some(window) = (unsafe { note.as_ref() }).object() else {
                return;
            };
            place(objc2::rc::Retained::as_ptr(&window) as *mut std::ffi::c_void);
        });
        // SAFETY: any window's notification (no object), delivered on the
        // thread that posts it - AppKit's main thread.
        let observer = unsafe {
            center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
        };
        std::mem::forget(observer);
    }
}
