//! Editor windows: built with the platform's chrome, numbered, opened
//! and reopened, and what each platform needs of them (Wayland, the
//! macOS title bar and full screen).

use super::*;

/// Each new window is a fresh, independent instance of the whole SPA (its
/// own React tree, own in-memory document state) - just like opening a new
/// browser tab to the same URL. Labels only need to be unique per window.
#[cfg(desktop)]
pub(crate) static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

#[cfg(desktop)]
pub(crate) fn next_window_id() -> u32 {
    WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed)
}

/// Places a window, gives it this app's chrome, and builds it. Shared by
/// editor windows and the detached chat window so the platform cfgs live in
/// exactly one place - the two used to carry byte-identical copies of them.
///
/// The chrome is the same idea on both platforms - ONE top row, drawn by the
/// app (app/App.tsx's `.window-bar`) - but the platforms reach it from
/// opposite directions:
///
/// - macOS has a style for exactly this: an overlay title bar keeps the
///   window's native behaviour while letting the traffic lights float over
///   our own row.
/// - Windows and Linux have no equivalent, so the only way to stop stacking a
///   native title bar AND a native menu bar AND our row is to drop the native
///   frame entirely and draw the caption ourselves (src/app/WindowControls.tsx).
///   On Windows tao keeps WS_SIZEBOX on undecorated windows and hit-tests the
///   border in its own WM_NCHITTEST, so edge resizing, Aero snap and
///   Win+Arrow all still work; on Linux tao hit-tests an undecorated window's
///   edges itself and starts a GTK resize drag (X11 and Wayland alike). Only
///   the painted frame is gone. Linux kept its frame until users reported the
///   result: a title bar, an English-only GTK menu bar (it is built once, in
///   English - the app-drawn menu is the localized one) and our row with the
///   document title, three strips deep.
///
/// The one window that never comes through here is the one tauri.conf.json
/// declares; `decorations: false` is set for it in tauri.windows.conf.json
/// and tauri.linux.conf.json, which Tauri merges over the base config on
/// those targets only.
#[cfg(desktop)]
pub(crate) fn build_with_app_chrome(
    builder: WebviewWindowBuilder<'_, tauri::Wry, tauri::AppHandle>,
    position: Option<(f64, f64)>,
) -> tauri::Result<tauri::WebviewWindow> {
    let mut builder = builder;
    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }
    // macOS-only API - the other platforms don't compile these methods at all.
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
    Ok(window)
}

/// Linux: a window's web process ends with the window. WebKitGTK left it
/// running after the window was destroyed - a closed window's page, some
/// 150 MB, still there minutes later, and not reused by the next window,
/// which got a process of its own. Without background mode the app exits
/// with its last window, so it went unnoticed; in background mode the app
/// stays, and so did that memory (docs/dev/lifecycle.md has the numbers).
/// Textus opens no related views (window.open), so each window's
/// WebKitWebView has a process to itself and ending it touches no other.
#[cfg(target_os = "linux")]
pub(crate) fn end_web_process_with_window(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| {
        use gtk::prelude::WidgetExt;
        use webkit2gtk::WebViewExt;
        webview
            .inner()
            .connect_destroy(|view| view.terminate_web_process());
    });
}

/// The height of a native title bar, in points: what the traffic lights are
/// centred in, under the overlay title bar as much as in a plain one. 28 up
/// to macOS 15, 32 from macOS 26 - where the lights came out 2pt below the
/// title of our 28px row. The boot script hands it to the frontend
/// (`--native-titlebar-height`, app/window-bar.css), which lines the row's
/// contents up with the lights.
///
/// Asked of AppKit rather than keyed off the OS version, and moving our row
/// rather than the lights: Tauri's `traffic_light_position` did nothing on
/// macOS 26 (AppKit lays the title bar out again once the window shows).
///
/// AppKit wants the main thread. The main window is built there, in setup,
/// so the answer is cached before any window built off it (the detached
/// chat, from an async command) needs one; until then, None - the
/// stylesheet's 28px.
#[cfg(target_os = "macos")]
pub(crate) fn native_titlebar_height() -> Option<f64> {
    use objc2_app_kit::{NSWindow, NSWindowStyleMask};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    static HEIGHT: std::sync::OnceLock<f64> = std::sync::OnceLock::new();
    if let Some(height) = HEIGHT.get() {
        return Some(*height);
    }
    let mtm = objc2::MainThreadMarker::new()?;
    let content = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(100.0, 100.0));
    let style = NSWindowStyleMask::Titled
        | NSWindowStyleMask::Closable
        | NSWindowStyleMask::Miniaturizable
        | NSWindowStyleMask::Resizable;
    let frame = NSWindow::frameRectForContentRect_styleMask(content, style, mtm);
    Some(*HEIGHT.get_or_init(|| frame.size.height - content.size.height))
}

/// Tells a window's page when macOS has taken it into full screen and
/// when it starts taking it out (`window-fullscreen`, true or false), for
/// the sidebar's button to take the traffic lights' corner while they are
/// gone (app/useFullscreenMark.ts). AppKit's own notifications: guessing
/// from the window's size, and asking `is_fullscreen` once a resize had
/// settled, got the answer of a window still on its way out - the button
/// stayed in the corner, under the lights. Into full screen once it is
/// there (the lights are gone by then), out of it as it starts (they come
/// back at the end), so the two never overlap.
///
/// Main thread only (AppKit), once: the observers last as long as the app.
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
            for (label, webview) in app.webview_windows() {
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

/// Whether this process talks to a Wayland compositor rather than X11 (or
/// XWayland). Wayland has no client-side window positions and no
/// always-on-top, which the detached chat relies on elsewhere.
///
/// Answered once, by `detect_wayland` on the main thread at startup: GDK
/// panics when touched from any other thread, and the chat window is built
/// from an async command - asking GDK there killed the command, so the
/// detached chat never opened.
#[cfg(target_os = "linux")]
pub(crate) fn is_wayland() -> bool {
    WAYLAND.get().copied().unwrap_or_else(|| {
        // Not detected yet (it always is by the time a window opens): the
        // environment says the same thing in every normal setup.
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

/// Takes the native menu BAR off a window without detaching its menu.
///
/// Windows and Linux, and the cfg here has to keep matching
/// `appDrawsWindowFrame` in src/platform/window-chrome.ts - that flag is what
/// decides whether the frontend draws the menu button this hides the menu
/// behind (macOS has the system menu bar and ignores this entirely).
///
/// Hiding rather than removing: on Windows `hide_menu` only unsets the menu
/// bar (muda's `SetMenu(hwnd, null)`) and leaves muda's window subclass in
/// place, which keeps the menu's accelerators firing - Tauri translates them
/// through a message hook that doesn't care whether the bar is visible.
/// `remove_menu` would take the accelerators with it. GTK is different: it
/// only activates the accelerator of a menu item that is drawable, so on
/// Linux a hidden bar's accelerators are dead, and the frontend handles
/// those keys itself (`ownsMenuAccelerators` in window-chrome.ts).
#[cfg(desktop)]
pub(crate) fn hide_native_menu_bar(window: &tauri::WebviewWindow) {
    #[cfg(any(windows, target_os = "linux"))]
    let _ = window.hide_menu();
    #[cfg(not(any(windows, target_os = "linux")))]
    let _ = window;
}

#[cfg(desktop)]
pub(crate) fn build_window(
    app: &tauri::AppHandle,
    label: &str,
    position: Option<(f64, f64)>,
) -> tauri::Result<()> {
    // A window more opens where the system puts it, no bigger than the
    // main screen (window_frame.rs).
    let (_, (width, height)) = window_frame::place(
        None,
        commands::prefs::read_editor_window_size(app).unwrap_or((800.0, 600.0)),
        &screens(app),
        EDITOR_MIN_SIZE,
    );
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(app_identity::APP_NAME)
        .inner_size(width, height)
        .min_inner_size(EDITOR_MIN_SIZE.0, EDITOR_MIN_SIZE.1);
    build_with_app_chrome(settings::with_boot(builder, app, label), position)?;
    Ok(())
}

/// Below this the app-drawn window bar's menu button, centred title and
/// caption buttons run into each other. Keep in step with the minWidth/
/// minHeight of the config window in tauri*.conf.json.
#[cfg(desktop)]
pub(crate) const EDITOR_MIN_SIZE: (f64, f64) = (480.0, 320.0);

/// The screens' work areas in logical px, the main screen first
/// (window_frame.rs).
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

/// The Dock icon clicked while the app shows no window, Open Textus in the
/// tray, or Textus launched again while it runs in the background: a
/// minimised or hidden editor window comes back (AppKit leaves that to the
/// app when no window is visible), or else the app opens as a launch
/// would: with the documents the last window had open, when Settings
/// restores the session, and with a blank window otherwise. So closing the
/// last window and coming back gives the same documents as quitting and
/// launching again.
#[cfg(desktop)]
pub(crate) fn reopen_without_windows(app: &tauri::AppHandle) {
    let existing = app
        .webview_windows()
        .into_iter()
        .find(|(label, _)| commands::chat_window::is_editor_window(label))
        .map(|(_, window)| window);
    if let Some(window) = existing {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let paths = if commands::prefs::read_restore_session_on_startup(app) {
        commands::session::read_session_paths(app)
    } else {
        Vec::new()
    };
    if paths.is_empty() {
        let _ = open_new_window(app);
    } else {
        queue_paths_to_open(app, paths);
    }
}

/// Builds the window tauri.conf.json declares. It is declared with
/// `"create": false` (in every platform override with a `windows` array
/// too - Tauri merges those over the base config by replacing the array
/// whole) because Tauri builds config windows BEFORE setup runs, and this
/// one needs two things that only exist after: the settings store, for its
/// boot script, and the remembered editor size. Everything else - size
/// limits, title bar style, decorations - still comes from the config.
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
    #[cfg(desktop)]
    // Where the last window closed, if that is still on a screen, else
    // centred on the main one; no bigger than its screen (#356).
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
    #[cfg(target_os = "linux")]
    end_web_process_with_window(&window);
    #[cfg(not(target_os = "linux"))]
    let _ = window;
    Ok(())
}
