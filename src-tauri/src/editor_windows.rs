//! Editor windows: built with the platform's chrome, numbered, opened and
//! reopened, with what each platform needs.

use super::*;

/// Each new window is an independent instance of the SPA; labels only need to
/// be unique.
#[cfg(desktop)]
pub(crate) static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

#[cfg(desktop)]
pub(crate) fn next_window_id() -> u32 {
    WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed)
}

/// Editor windows by when the user was last in them, latest first: what comes
/// from outside any window (the tray, a menu with none focused) goes to the
/// first, and a dropped tab to the frontmost of the windows under it.
static RECENT: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

pub(crate) fn note_focused(label: &str) {
    if crate::windows::is_editor_window(label) {
        let mut recent = RECENT.lock().unwrap_or_else(|e| e.into_inner());
        recent.retain(|l| l != label);
        recent.insert(0, label.to_string());
    }
}

/// How recently the window was in use: 0 for the latest, MAX for never.
pub(crate) fn focus_rank(label: &str) -> usize {
    RECENT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .position(|l| l == label)
        .unwrap_or(usize::MAX)
}

/// The editor window last in use while it is still open, else any editor.
pub(crate) fn last_editor(app: &tauri::AppHandle) -> Option<tauri::Window> {
    app.windows()
        .into_iter()
        .filter(|(label, _)| crate::windows::is_editor_window(label))
        .min_by_key(|(label, _)| focus_rank(label))
        .map(|(_, window)| window)
}

/// Places a window, gives it this app's chrome, and builds it, for editor and
/// chat windows alike. macOS uses an overlay title bar; Windows and Linux drop
/// the native frame and draw the caption (tao still handles edge resizing).
#[cfg(desktop)]
pub(crate) fn build_with_app_chrome(
    builder: WebviewWindowBuilder<'_, tauri::Wry, tauri::AppHandle>,
    position: Option<(f64, f64)>,
) -> tauri::Result<tauri::WebviewWindow> {
    let mut builder = builder;
    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    #[cfg(any(windows, target_os = "linux"))]
    let builder = builder.decorations(false);
    let window = builder.build()?;
    hide_native_menu_bar(&window);
    #[cfg(target_os = "linux")]
    end_web_process_with_window(&window);
    #[cfg(target_os = "macos")]
    draw_at_full_frame_rate(&window);
    Ok(window)
}

/// macOS: the page draws at the screen's own rate. WebKit holds rendering
/// near 60 fps by default, half a 120 Hz ProMotion display's frames for
/// typing and animation (scrolling runs on its own). The switch is in
/// WebKit's feature list (SPI); a WebKit without it is left as it is.
#[cfg(target_os = "macos")]
fn draw_at_full_frame_rate(window: &tauri::WebviewWindow) {
    use objc2::runtime::{AnyClass, AnyObject, NSObjectProtocol};
    use objc2::{msg_send, sel};
    use objc2_foundation::{NSArray, NSString};
    use objc2_web_kit::WKWebView;
    let _ = window.with_webview(|webview| unsafe {
        let view: &WKWebView = &*webview.inner().cast();
        let prefs = view.configuration().preferences();
        let Some(class) = AnyClass::get(c"WKPreferences") else {
            return;
        };
        if !class.responds_to(sel!(_features))
            || !prefs.respondsToSelector(sel!(_setEnabled:forFeature:))
        {
            return;
        }
        let features: Option<objc2::rc::Retained<NSArray<AnyObject>>> = msg_send![class, _features];
        let wanted = NSString::from_str("PreferPageRenderingUpdatesNear60FPSEnabled");
        for feature in features.iter().flat_map(|list| list.iter()) {
            let key: Option<objc2::rc::Retained<NSString>> = msg_send![&*feature, key];
            if key.is_some_and(|key| key.isEqualToString(&wanted)) {
                let _: () = msg_send![&*prefs, _setEnabled: false, forFeature: &*feature];
            }
        }
    });
}

/// Linux: a window's web process ends with the window. WebKitGTK otherwise
/// keeps ~150 MB per closed window running, which background mode exposed.
/// Its caches are sized for documents, too.
#[cfg(target_os = "linux")]
pub(crate) fn end_web_process_with_window(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| {
        use gtk::prelude::WidgetExt;
        use webkit2gtk::WebViewExt;
        let view = webview.inner();
        // A document viewer's caches, not a browser's: WebKitGTK otherwise
        // grows its memory caches with every page a tab loads.
        if let Some(context) = view.context() {
            use webkit2gtk::WebContextExt;
            context.set_cache_model(webkit2gtk::CacheModel::DocumentViewer);
        }
        view.connect_destroy(|view| view.terminate_web_process());
    });
}

/// Tells a window's page when macOS enters full screen and when it starts
/// leaving (`window-fullscreen`), via AppKit notifications, since size checks
/// lag. Main thread only, once.
#[cfg(target_os = "macos")]
pub(crate) fn watch_fullscreen(app: &tauri::AppHandle) {
    use objc2_app_kit::{
        NSWindowDidEnterFullScreenNotification, NSWindowWillExitFullScreenNotification,
    };
    use objc2_foundation::{NSNotification, NSNotificationCenter};
    use std::ptr::NonNull;
    let center = NSNotificationCenter::defaultCenter();
    // SAFETY: AppKit's notification names, constant for the process.
    let names = unsafe {
        [
            (NSWindowDidEnterFullScreenNotification, true),
            (NSWindowWillExitFullScreenNotification, false),
        ]
    };
    for (name, fullscreen) in names {
        let app = app.clone();
        let block = block2::RcBlock::new(move |note: NonNull<NSNotification>| {
            // SAFETY: AppKit hands the block a live notification.
            let Some(window) = (unsafe { note.as_ref() }).object() else {
                return;
            };
            let window = objc2::rc::Retained::as_ptr(&window) as *mut std::ffi::c_void;
            for (label, webview) in app.windows() {
                if webview.ns_window().ok() == Some(window) {
                    let _ = app.emit_to(label.as_str(), "window-fullscreen", fullscreen);
                }
            }
        });
        // SAFETY: any window's notification (no object), delivered on the
        // thread that posts it - AppKit's main thread.
        let observer = unsafe {
            center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
        };
        std::mem::forget(observer);
    }
}

/// Whether this process talks to a Wayland compositor (no window positions, no
/// always-on-top). Detected once on the main thread: GDK panics elsewhere.
#[cfg(target_os = "linux")]
pub(crate) fn is_wayland() -> bool {
    WAYLAND.get().copied().unwrap_or_else(|| {
        // Not detected yet: the environment says the same in every normal setup.
        std::env::var_os("WAYLAND_DISPLAY").is_some()
            && std::env::var("GDK_BACKEND").map_or(true, |b| b.contains("wayland"))
    })
}

#[cfg(target_os = "linux")]
pub(crate) static WAYLAND: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// Whether the system tells an app where its window is and lets it put it
/// there - everywhere but Wayland.
#[cfg(desktop)]
pub(crate) fn window_place_known() -> bool {
    #[cfg(target_os = "linux")]
    return !is_wayland();
    #[cfg(not(target_os = "linux"))]
    true
}

/// Main thread only (GDK); see `is_wayland`.
#[cfg(target_os = "linux")]
pub(crate) fn detect_wayland() {
    use gtk::prelude::*;
    let wayland = gtk::gdk::Display::default()
        .is_some_and(|display| display.type_().name() == "GdkWaylandDisplay");
    let _ = WAYLAND.set(wayland);
}

/// Takes the native menu bar off a window without detaching its menu. Keep the
/// cfg in step with `appDrawsWindowFrame`. Hiding, not removing, keeps the
/// accelerators on Windows; GTK drops them, so the frontend handles those keys.
#[cfg(desktop)]
pub(crate) fn hide_native_menu_bar(window: &tauri::WebviewWindow) {
    #[cfg(any(windows, target_os = "linux"))]
    let _ = window.hide_menu();
    #[cfg(not(any(windows, target_os = "linux")))]
    let _ = window;
}

/// From a command, only an async one: a sync command building a window can
/// deadlock WebView2 on Windows.
#[cfg(desktop)]
pub(crate) fn build_window(
    app: &tauri::AppHandle,
    label: &str,
    position: Option<(f64, f64)>,
) -> tauri::Result<()> {
    build_editor_window(app, label, position, false)
}

/// A small window, as VS Code's for an editor moved out: its documents and
/// a slim bar, no activity rail or sidebar until asked for, smaller.
#[cfg(desktop)]
pub(crate) fn build_small_window(
    app: &tauri::AppHandle,
    label: &str,
    position: Option<(f64, f64)>,
) -> tauri::Result<()> {
    build_editor_window(app, label, position, true)
}

/// A small window's size: room for a page of text, not a workspace.
#[cfg(desktop)]
const SMALL_WINDOW_SIZE: (f64, f64) = (640.0, 720.0);

#[cfg(desktop)]
fn build_editor_window(
    app: &tauri::AppHandle,
    label: &str,
    position: Option<(f64, f64)>,
    small: bool,
) -> tauri::Result<()> {
    // Another window opens where the system puts it, no bigger than the main screen.
    let wanted = if small {
        SMALL_WINDOW_SIZE
    } else {
        commands::prefs::read_editor_window_size(app).unwrap_or((800.0, 600.0))
    };
    let (_, (width, height)) = window_frame::place(None, wanted, &screens(app), EDITOR_MIN_SIZE);
    let url = if small {
        "index.html?window=small"
    } else {
        "index.html"
    };
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(app_identity::APP_NAME)
        .inner_size(width, height)
        .min_inner_size(EDITOR_MIN_SIZE.0, EDITOR_MIN_SIZE.1);
    build_with_app_chrome(settings::with_boot(builder, app, label), position)?;
    Ok(())
}

/// Below this the window bar's controls run into each other. The first
/// window's (tauri.conf.json) is held to it by a test.
#[cfg(desktop)]
pub(crate) const EDITOR_MIN_SIZE: (f64, f64) = (480.0, 320.0);

/// The screens' work areas in logical px, the main screen first.
#[cfg(desktop)]
fn screens(app: &tauri::AppHandle) -> Vec<window_frame::Screen> {
    let main = app.primary_monitor().ok().flatten().map(|m| *m.position());
    let mut monitors = app.available_monitors().unwrap_or_default();
    monitors.sort_by_key(|m| Some(*m.position()) != main);
    monitors
        .iter()
        .map(|m| {
            let area = m.work_area();
            let scale = m.scale_factor();
            window_frame::Screen {
                x: f64::from(area.position.x) / scale,
                y: f64::from(area.position.y) / scale,
                width: f64::from(area.size.width) / scale,
                height: f64::from(area.size.height) / scale,
            }
        })
        .collect()
}

#[cfg(desktop)]
pub(crate) fn open_new_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    build_window(app, &format!("window-{}", next_window_id()), None)
}

/// The Dock icon, Open Textus in the tray, or a relaunch while in the background:
/// a minimised or hidden editor window comes back, or else the app opens as a
/// launch would, so closing the last window and returning matches a relaunch.
#[cfg(desktop)]
pub(crate) fn reopen_without_windows(app: &tauri::AppHandle) {
    if let Some(window) = last_editor(app) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let windows = if commands::prefs::read_restore_session_on_startup(app) {
        commands::session::read_session_windows(app)
    } else {
        Vec::new()
    };
    if windows.is_empty() {
        let _ = open_new_window(app);
    } else {
        queue_windows_to_open(app, windows);
    }
}

/// Builds the window tauri.conf.json declares with `"create": false`: Tauri
/// builds config windows before setup, and this one needs the settings store
/// and the remembered size.
pub(crate) fn build_main_window(app: &tauri::App) -> tauri::Result<()> {
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
    else {
        return Ok(());
    };
    let builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
    // Where the last window closed, if still on a screen, else centred on the main
    // one; no bigger than its screen.
    #[cfg(desktop)]
    let builder = {
        let app = app.handle();
        let saved = if window_place_known() {
            commands::prefs::read_editor_window_position(app)
        } else {
            None
        };
        let size =
            commands::prefs::read_editor_window_size(app).unwrap_or((config.width, config.height));
        let (at, (width, height)) =
            window_frame::place(saved, size, &screens(app), EDITOR_MIN_SIZE);
        let builder = builder.inner_size(width, height);
        match at {
            Some((x, y)) if window_place_known() => builder.position(x, y),
            _ => builder,
        }
    };
    let window = settings::with_boot(builder, app.handle(), "main").build()?;
    // As every other window built with the app's chrome.
    #[cfg(target_os = "macos")]
    draw_at_full_frame_rate(&window);
    #[cfg(target_os = "linux")]
    end_web_process_with_window(&window);
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let _ = window;
    Ok(())
}

#[cfg(all(test, desktop))]
mod min_size_tests {
    #[test]
    fn the_first_window_has_every_window_s_least_size() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let window = &conf["app"]["windows"][0];
        assert_eq!(window["minWidth"].as_f64(), Some(super::EDITOR_MIN_SIZE.0));
        assert_eq!(window["minHeight"].as_f64(), Some(super::EDITOR_MIN_SIZE.1));
    }
}
