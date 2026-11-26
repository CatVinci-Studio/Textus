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

/// Windows between full screen's Will and Did notes, by NSWindow address:
/// their lights stay hidden through every title bar AppKit makes meanwhile.
#[cfg(target_os = "macos")]
static TRANSIT: Mutex<Option<std::collections::HashSet<usize>>> = Mutex::new(None);

/// The window bar row for each Interface Size step (small, medium, large,
/// and the touch screens' two larger, which keep Large's bar), as
/// `src/engine/tokens/ui-sizes.css` sets `--window-bar-row`: a window's
/// lights go in place as it opens, before its page can say.
#[cfg(any(target_os = "macos", test))]
const BAR_ROWS: [f64; 5] = [36.0, 40.0, 48.0, 48.0, 48.0];

/// The bar row Interface Size gives, from the settings as saved: the page's
/// own steps (src/prefs/appearance-tables.json), old scales mapped on.
#[cfg(any(target_os = "macos", test))]
fn bar_row(settings: &serde_json::Value) -> f64 {
    let tables: serde_json::Value =
        serde_json::from_str(include_str!("../../../src/prefs/appearance-tables.json"))
            .unwrap_or_default();
    let saved = settings
        .get("uiTextScale")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);
    let scale = tables["uiTextScalesBefore"][saved.to_string()]
        .as_f64()
        .unwrap_or(saved);
    let step = tables["uiTextScales"]
        .as_array()
        .and_then(|steps| steps.iter().position(|s| s.as_f64() == Some(scale)))
        .unwrap_or(1);
    BAR_ROWS[step.min(BAR_ROWS.len() - 1)]
}

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
/// moves the title bar, and on leaving full screen. While full screen comes
/// or goes, AppKit draws the lights in its own spot and makes new title bars
/// for the animation: they are hidden from its start, again on each resize
/// meanwhile, and shown once placed at its end, so they don't jump. A window
/// of Textus's that becomes key without a bar height yet gets the one its
/// settings give, so a new window's lights don't wait for its page. Main
/// thread, once.
#[cfg(target_os = "macos")]
pub(crate) fn watch(app: &tauri::AppHandle) {
    use crate::editor_windows::on_window_note;
    use objc2_app_kit::{
        NSWindowDidBecomeKeyNotification, NSWindowDidChangeBackingPropertiesNotification,
        NSWindowDidChangeScreenNotification, NSWindowDidDeminiaturizeNotification,
        NSWindowDidEnterFullScreenNotification, NSWindowDidExitFullScreenNotification,
        NSWindowDidResizeNotification, NSWindowWillCloseNotification,
        NSWindowWillEnterFullScreenNotification, NSWindowWillExitFullScreenNotification,
    };
    // SAFETY: AppKit's notification names, constant for the process.
    let (resized, key, entering, entered, leaving, left, closing) = unsafe {
        (
            NSWindowDidResizeNotification,
            NSWindowDidBecomeKeyNotification,
            NSWindowWillEnterFullScreenNotification,
            NSWindowDidEnterFullScreenNotification,
            NSWindowWillExitFullScreenNotification,
            NSWindowDidExitFullScreenNotification,
            NSWindowWillCloseNotification,
        )
    };
    for window in ours(app) {
        settle(app, window);
    }
    // Other times AppKit may lay the title bar out again: a new display or
    // scale, back from the Dock. place does nothing where they already are.
    // SAFETY: AppKit's notification names, constant for the process.
    for note in unsafe {
        [
            NSWindowDidChangeBackingPropertiesNotification,
            NSWindowDidChangeScreenNotification,
            NSWindowDidDeminiaturizeNotification,
        ]
    } {
        on_window_note(note, place);
    }
    on_window_note(resized, |window| {
        place(window);
        // Shown again once no full-screen change is under way: one that
        // failed or was cut short sends no Did note.
        show(window, !in_transit(window));
    });
    let opened = app.clone();
    on_window_note(key, move |window| {
        if ours(&opened).contains(&window) {
            settle(&opened, window);
        }
    });
    for note in [entering, leaving] {
        let app = app.clone();
        on_window_note(note, move |window| {
            transit(window, true);
            show(window, false);
            fail_safe(&app, window);
        });
    }
    for note in [entered, left] {
        on_window_note(note, |window| {
            transit(window, false);
            place(window);
            show(window, true);
        });
    }
    // A window closing takes its bar height along: kept, one more for each
    // window opened, and an address AppKit may give a new window later.
    on_window_note(closing, |window| {
        if let Some(bars) = BARS.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            bars.remove(&(window as usize));
        }
        transit(window, false);
    });
}

/// The NSWindows of Textus's own webview windows.
#[cfg(target_os = "macos")]
fn ours(app: &tauri::AppHandle) -> Vec<*mut std::ffi::c_void> {
    use tauri::Manager;
    app.webview_windows()
        .values()
        .filter_map(|w| w.ns_window().ok())
        .collect()
}

/// A window without a bar height yet gets its settings' one, and its lights
/// placed. Main thread.
#[cfg(target_os = "macos")]
fn settle(app: &tauri::AppHandle, window: *mut std::ffi::c_void) {
    use tauri::Manager;
    let Some(stores) = app.try_state::<crate::settings::Stores>() else {
        return;
    };
    let fresh = {
        let mut bars = BARS.lock().unwrap_or_else(|e| e.into_inner());
        let bars = bars.get_or_insert_with(HashMap::new);
        let fresh = !bars.contains_key(&(window as usize));
        if fresh {
            bars.insert(window as usize, bar_row(&stores.settings.snapshot().0));
        }
        fresh
    };
    if fresh {
        place(window);
    }
}

#[cfg(target_os = "macos")]
fn transit(window: *mut std::ffi::c_void, on: bool) {
    let mut set = TRANSIT.lock().unwrap_or_else(|e| e.into_inner());
    let set = set.get_or_insert_with(Default::default);
    if on {
        set.insert(window as usize);
    } else {
        set.remove(&(window as usize));
    }
}

#[cfg(target_os = "macos")]
fn in_transit(window: *mut std::ffi::c_void) -> bool {
    TRANSIT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|set| set.contains(&(window as usize)))
}

/// Shows the lights again two seconds on if no Did note came (AppKit says a
/// full-screen change failed only to the window's delegate), on a window
/// still open.
#[cfg(target_os = "macos")]
fn fail_safe(app: &tauri::AppHandle, window: *mut std::ffi::c_void) {
    let key = window as usize;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let window = key as *mut std::ffi::c_void;
            if in_transit(window) && ours(&handle).contains(&window) {
                transit(window, false);
                place(window);
                show(window, true);
            }
        });
    });
}

/// Shows or hides `window`'s three lights, for one of Textus's windows (one
/// with a bar height): the title bar's container they sit in, as Electron
/// does. AppKit makes new buttons while full screen comes and goes, so hiding
/// the buttons themselves misses the ones it shows. Main thread.
#[cfg(target_os = "macos")]
fn show(window: *mut std::ffi::c_void, visible: bool) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    let ours = BARS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|bars| bars.contains_key(&(window as usize)));
    if !ours {
        return;
    }
    // SAFETY: on the main thread, a live window (a notification's), every
    // object checked before it is messaged.
    unsafe {
        let window = &*(window as *const AnyObject);
        let button: *mut AnyObject = msg_send![window, standardWindowButton: 0usize];
        if button.is_null() {
            return;
        }
        let title_view: *mut AnyObject = msg_send![&*button, superview];
        if title_view.is_null() {
            return;
        }
        let container: *mut AnyObject = msg_send![&*title_view, superview];
        if container.is_null() {
            return;
        }
        let _: () = msg_send![&*container, setHidden: !visible];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_window_takes_the_bar_row_its_interface_size_gives() {
        let at = |scale: f64| bar_row(&serde_json::json!({ "uiTextScale": scale }));
        assert_eq!(at(0.85), 36.0);
        assert_eq!(at(1.0), 40.0);
        assert_eq!(at(1.25), 48.0);
        // A scale from before the three steps, mapped as the page maps it.
        assert_eq!(at(0.9), 36.0);
        assert_eq!(bar_row(&serde_json::json!({})), 40.0);
    }

    #[test]
    fn the_rows_are_the_pages_own() {
        let css = include_str!("../../../src/engine/tokens/ui-sizes.css");
        let rows: Vec<f64> = css
            .lines()
            .filter_map(|l| l.trim().strip_prefix("--window-bar-row:"))
            .filter_map(|v| v.trim().trim_end_matches("px;").parse().ok())
            .collect();
        // medium (the default), small, large; then the phone's, not a Mac's.
        assert_eq!(&rows[..3], &[BAR_ROWS[1], BAR_ROWS[0], BAR_ROWS[2]]);
    }
}
