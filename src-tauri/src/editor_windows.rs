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

/// A new editor window's label.
#[cfg(desktop)]
pub(crate) fn new_window_label() -> String {
    format!("window-{}", next_window_id())
}

/// Editor windows by when the user was last in them, latest first: what comes
/// from outside any window (the tray, a menu with none focused) goes to the
/// first, and a dropped tab to the frontmost of the windows under it.
#[cfg(desktop)]
static RECENT: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

#[cfg(desktop)]
pub(crate) fn note_focused(label: &str) {
    if crate::windows::is_editor_window(label) {
        let mut recent = RECENT.lock().unwrap_or_else(|e| e.into_inner());
        recent.retain(|l| l != label);
        recent.insert(0, label.to_string());
    }
}

/// How recently the window was in use: 0 for the latest, MAX for never.
#[cfg(desktop)]
pub(crate) fn focus_rank(label: &str) -> usize {
    RECENT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .position(|l| l == label)
        .unwrap_or(usize::MAX)
}

/// The editor window last in use while it is still open, else any editor.
#[cfg(desktop)]
pub(crate) fn last_editor(app: &tauri::AppHandle) -> Option<tauri::Window> {
    app.windows()
        .into_iter()
        .filter(|(label, _)| crate::windows::is_editor_window(label))
        .min_by_key(|(label, _)| focus_rank(label))
        .map(|(_, window)| window)
}

/// Places a window, gives it this app's chrome, and builds it, for editor and
/// chat windows alike. macOS uses an overlay title bar; Windows and Linux drop
/// the native title bar and draw the caption, Linux keeping GTK's shadow.
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
    // Windows 10 draws an undecorated window's shadow with a 1px border in
    // the accent colour, on three sides: none, and the page draws its own
    // edge in the theme's colour (window-outline.css).
    #[cfg(windows)]
    let builder = builder.shadow(!crate::commands::system_info::is_windows_10());
    #[cfg(target_os = "linux")]
    let builder = builder.visible(false);
    let window = builder.build()?;
    hide_native_menu_bar(&window);
    #[cfg(target_os = "linux")]
    {
        end_web_process_with_window(&window);
        show_with_gtk_frame(&window)?;
    }
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

/// Linux: the undecorated window gets GTK's own frame, its shadow and outer
/// resize margin, under an empty title bar, then shows. On the main thread
/// (windows are built from async commands too), while still hidden: X11
/// rebuilds a shown window whose frame changes. Showing shows the menu bar
/// again, so it is hidden after.
#[cfg(target_os = "linux")]
fn show_with_gtk_frame(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let shown = window.clone();
    window.run_on_main_thread(move || {
        use gtk::prelude::*;
        let Ok(gtk_window) = shown.gtk_window() else {
            return;
        };
        // tao adds the empty title bar only on Wayland; without it X11 shows mutter's.
        if gtk_window.titlebar().is_none() {
            let bar = gtk::EventBox::new();
            bar.show();
            gtk_window.set_titlebar(Some(&bar));
        }
        gtk_window.set_decorated(true);
        gtk_window.show_all();
        hide_native_menu_bar(&shown);
    })
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

/// Tells a window's page when macOS starts entering full screen and when it
/// starts leaving (`window-fullscreen`), via AppKit notifications, since size
/// checks lag. At the start, both ways: AppKit animates between pictures of
/// the window, so a layout changed only once it has entered pops in after
/// the animation. Main thread only, once.
#[cfg(target_os = "macos")]
pub(crate) fn watch_fullscreen(app: &tauri::AppHandle) {
    use objc2_app_kit::{
        NSWindowWillEnterFullScreenNotification, NSWindowWillExitFullScreenNotification,
    };
    // SAFETY: AppKit's notification names, constant for the process.
    let names = unsafe {
        [
            (NSWindowWillEnterFullScreenNotification, true),
            (NSWindowWillExitFullScreenNotification, false),
        ]
    };
    for (name, fullscreen) in names {
        let app = app.clone();
        on_window_note(name, move |window| {
            for (label, webview) in app.windows() {
                if webview.ns_window().ok() == Some(window) {
                    let _ = app.emit_to(label.as_str(), "window-fullscreen", fullscreen);
                }
            }
        });
    }
}

/// Calls `act` with the NSWindow each time any window posts `name`, for the
/// life of the process. Main thread.
#[cfg(target_os = "macos")]
pub(crate) fn on_window_note(
    name: &objc2_foundation::NSNotificationName,
    act: impl Fn(*mut std::ffi::c_void) + 'static,
) {
    use objc2_foundation::{NSNotification, NSNotificationCenter};
    use std::ptr::NonNull;
    let block = block2::RcBlock::new(move |note: NonNull<NSNotification>| {
        // SAFETY: AppKit hands the block a live notification.
        let Some(window) = (unsafe { note.as_ref() }).object() else {
            return;
        };
        act(objc2::rc::Retained::as_ptr(&window) as *mut std::ffi::c_void);
    });
    // SAFETY: any window's notification (no object), delivered on the
    // thread that posts it - AppKit's main thread.
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(name),
            None,
            None,
            &block,
        )
    };
    std::mem::forget(observer);
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
    build_editor_window(app, label, position, false, None)
}

/// A window that comes back as it was left (`frame`, fitted to today's
/// screens), or else opens as a new one does.
#[cfg(desktop)]
pub(crate) fn build_window_as_left(
    app: &tauri::AppHandle,
    label: &str,
    frame: Option<window_frame::Kept>,
) -> tauri::Result<()> {
    build_editor_window(app, label, None, false, frame)
}

/// A small window, as VS Code's for an editor moved out: its documents and
/// a slim bar, no activity rail or sidebar until asked for, smaller.
#[cfg(desktop)]
pub(crate) fn build_small_window(
    app: &tauri::AppHandle,
    label: &str,
    position: Option<(f64, f64)>,
) -> tauri::Result<()> {
    build_editor_window(app, label, position, true, None)
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
    frame: Option<window_frame::Kept>,
) -> tauri::Result<()> {
    let url = if small {
        "index.html?window=small"
    } else {
        "index.html"
    };
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(app_identity::APP_NAME)
        .min_inner_size(EDITOR_MIN_SIZE.0, EDITOR_MIN_SIZE.1);
    let builder = match frame {
        Some(frame) => as_left(app, label, builder, frame),
        None => {
            // Another window opens where the system puts it, no bigger than the main screen.
            let wanted = if small {
                SMALL_WINDOW_SIZE
            } else {
                commands::prefs::read_editor_window_size(app).unwrap_or(FIRST_RUN_SIZE)
            };
            let (_, (width, height)) =
                window_frame::place(None, wanted, &screens(app), EDITOR_MIN_SIZE);
            builder.inner_size(width, height)
        }
    };
    build_with_app_chrome(settings::with_boot(builder, app, label), position)?;
    Ok(())
}

/// The builder set to `frame` fitted to today's screens: its size, its place
/// where the system lets an app choose, maximized or full screen as it was.
#[cfg(desktop)]
fn as_left<'a>(
    app: &tauri::AppHandle,
    label: &str,
    builder: WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>,
    frame: window_frame::Kept,
) -> WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    let opening = window_frame::reopen(frame, &screens(app), EDITOR_MIN_SIZE);
    let position = opening.position.filter(|_| window_place_known());
    commands::prefs::seed_bounds(
        label,
        window_frame::Kept {
            position,
            mode: window_frame::Mode::Normal,
            ..opening
        },
    );
    let builder = builder
        .inner_size(opening.size.0, opening.size.1)
        .maximized(opening.mode == window_frame::Mode::Maximized)
        .fullscreen(opening.mode == window_frame::Mode::Fullscreen);
    match position {
        Some((x, y)) => builder.position(x, y),
        None => builder,
    }
}

/// A window's size before any has closed, fitted to the screen as it opens.
/// The first window's (tauri.conf.json) is held to it by a test.
#[cfg(desktop)]
const FIRST_RUN_SIZE: (f64, f64) = (1200.0, 800.0);

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
    build_window(app, &new_window_label(), None)
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
        let frame = commands::prefs::read_editor_frame(app);
        let _ = build_window_as_left(app, &new_window_label(), frame);
    } else {
        queue_windows_to_open(app, windows);
    }
}

/// Builds the window tauri.conf.json declares with `"create": false`: Tauri
/// builds config windows before setup, and this one needs the settings store
/// and the remembered frame - the first restored window's, else the last
/// closed window's.
pub(crate) fn build_main_window(
    app: &tauri::App,
    #[cfg(desktop)] opens: Option<&crate::launch::LaunchOpens>,
) -> tauri::Result<()> {
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
    #[cfg(desktop)]
    let builder = {
        let app = app.handle();
        let restored = match opens {
            Some(crate::launch::LaunchOpens::Windows(windows)) => {
                windows.first().and_then(|window| window.frame)
            }
            _ => None,
        };
        let frame = restored
            .or_else(|| commands::prefs::read_editor_frame(app))
            .unwrap_or(window_frame::Kept {
                size: (config.width, config.height),
                position: None,
                mode: window_frame::Mode::Normal,
            });
        as_left(app, "main", builder, frame)
    };
    #[cfg(target_os = "linux")]
    let builder = builder.visible(false);
    let window = settings::with_boot(builder, app.handle(), "main").build()?;
    // As every other window built with the app's chrome.
    #[cfg(target_os = "macos")]
    draw_at_full_frame_rate(&window);
    #[cfg(target_os = "linux")]
    {
        end_web_process_with_window(&window);
        show_with_gtk_frame(&window)?;
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    let _ = window;
    Ok(())
}

#[cfg(all(test, desktop))]
mod min_size_tests {
    #[test]
    fn the_first_window_has_every_window_s_first_and_least_size() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let window = &conf["app"]["windows"][0];
        assert_eq!(window["minWidth"].as_f64(), Some(super::EDITOR_MIN_SIZE.0));
        assert_eq!(window["minHeight"].as_f64(), Some(super::EDITOR_MIN_SIZE.1));
        assert_eq!(window["width"].as_f64(), Some(super::FIRST_RUN_SIZE.0));
        assert_eq!(window["height"].as_f64(), Some(super::FIRST_RUN_SIZE.1));
    }
}
