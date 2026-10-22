//! What settings change outside the webview: every window told to
//! reload, the app and window themes and backgrounds, the boot script a
//! new window starts with, and the settings the backend reads or sets.

use super::*;

/// After an import replaced settings, UI state and histories underneath
/// every window: each window adopts the whole settings object and reloads
/// both histories, and the native appearance follows the imported theme.
pub fn broadcast_reload(app: &AppHandle) {
    let Some(stores) = app.try_state::<Stores>() else {
        return;
    };
    let (value, rev) = stores.settings.snapshot();
    theme_changed(app);
    emit_to_all(
        app,
        "settings-changed",
        SettingsChanged {
            rev,
            patch: value.as_object().cloned().unwrap_or_default(),
            from: String::new(),
        },
    );
    for kind in [HistoryKind::Chat, HistoryKind::Clipboard] {
        emit_to_all(
            app,
            "history-changed",
            HistoryChanged {
                kind,
                op: HistoryOp::Reload,
                from: String::new(),
            },
        );
    }
}

/// Loads every store into app state. Called first thing in setup(), before
/// any window is built - the windows' boot scripts are made from it.
pub fn init(app: &AppHandle) {
    let config_dir = app.path().app_config_dir().unwrap_or_default();
    let data_dir = app.path().app_data_dir().unwrap_or_default();
    app.manage(Stores::load(&config_dir, &data_dir));
    #[cfg(target_os = "macos")]
    apply_app_theme(app);
}

/// The appearance setting changed, or first arrived with the legacy import:
/// brings the native side in line with it, so what a window shows before
/// (and around) its page matches the page. macOS sets the app's appearance
/// (`apply_app_theme`), Linux the open windows' background colour
/// (`apply_window_backgrounds`); Windows and iOS need nothing.
pub(crate) fn theme_changed(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    apply_app_theme(app);
    #[cfg(target_os = "linux")]
    apply_window_backgrounds(app);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = app;
}

/// The appearance AppKit gives the app - Light or Dark when Settings pins
/// one, the system's otherwise. Set here before any window is built, and
/// again whenever the setting changes.
///
/// It decides a new window's first frames: until its page has painted
/// (some 125 ms), a WKWebView shows a background that follows the app's
/// appearance, not the page. So with Textus pinned to Dark on a light Mac,
/// every window opened white for a moment however early the boot script
/// put the theme on the document. It also gives scrollbars, context menus,
/// open/save panels and the page's prefers-color-scheme the same appearance
/// as the app. App-wide on macOS (tao sets NSApp.appearance); left alone
/// on the other platforms.
#[cfg(target_os = "macos")]
pub(crate) fn apply_app_theme(app: &AppHandle) {
    let Some(stores) = app.try_state::<Stores>() else {
        return;
    };
    let (settings, _) = stores.settings.snapshot();
    app.set_theme(app_theme(&settings));
}

/// The pinned appearance in `settings`, if any.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn app_theme(settings: &Value) -> Option<tauri::Theme> {
    match settings.get("theme").and_then(Value::as_str) {
        Some("dark") => Some(tauri::Theme::Dark),
        Some("light") => Some(tauri::Theme::Light),
        _ => None,
    }
}

/// Writes whatever is still waiting on its debounce. From the exit event.
pub fn flush_all(app: &AppHandle) {
    if let Some(stores) = app.try_state::<Stores>() {
        stores.flush_all();
    }
}

/// A settings field as Rust sees it, for the few decisions made in Rust
/// before any webview exists (window vs tab, session restore), for the
/// writing conventions profile (`writingConventions`, ai::conventions) and
/// for the built-in skills turned off.
pub fn read_setting(app: &AppHandle, key: &str) -> Option<Value> {
    let stores = app.try_state::<Stores>()?;
    let (settings, _) = stores.settings.snapshot();
    settings.get(key).cloned()
}

/// Changes settings fields on Rust's own initiative - a command that owns a
/// setting's logic, like turning a built-in skill off - and tells every
/// window, the way settings_patch does for a window's change (`from` names
/// no window, so every one applies it).
pub fn patch_from_backend(app: &AppHandle, patch: Map<String, Value>) -> Option<u64> {
    let stores = app.try_state::<Stores>()?;
    let rev = stores.patch_settings(&patch);
    emit_to_all(
        app,
        "settings-changed",
        SettingsChanged {
            rev,
            patch,
            from: String::new(),
        },
    );
    Some(rev)
}

/// Delivers an event to every window. Each one individually: every event in
/// this app is window-addressed (see src/utils/tauri-events.ts), and the
/// frontend only listens for events sent to its own label.
pub(crate) fn emit_to_all<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    for label in app.webview_windows().into_keys() {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window(&label),
            event,
            payload.clone(),
        );
    }
}

// ---------------------------------------------------------------------------
// Boot snapshot
// ---------------------------------------------------------------------------

/// The script every app webview runs before the page's own: it publishes
/// `window.__BOOT__` and applies the appearance settings to the document
/// (src-tauri/src/boot.js does the applying). Read when the window is BUILT,
/// so a page reload replays an old snapshot - the frontend treats it as a
/// first-paint hint and re-reads the live values once mounted.
pub fn boot_script(app: &AppHandle, label: &str) -> String {
    let Some(stores) = app.try_state::<Stores>() else {
        return String::new();
    };
    let (settings, rev) = stores.settings.snapshot();
    let (ui_state, _) = stores.ui_state.snapshot();
    let theme_css = user_theme_css(app, &settings);
    #[cfg(target_os = "macos")]
    let titlebar_height = crate::native_titlebar_height();
    #[cfg(not(target_os = "macos"))]
    let titlebar_height: Option<f64> = None;
    let boot = json!({
        "settings": settings,
        "rev": rev,
        "uiState": ui_state,
        "legacyImport": stores.legacy_import_pending(),
        "label": label,
        "titlebarHeight": titlebar_height,
    });
    format!(
        "{}\n;window.__textusBoot({boot}, {theme_css});",
        include_str!("../boot.js")
    )
}

/// Above this an imported theme (fonts inlined as data URLs can make them
/// big) is left to the frontend's own async load rather than copied into
/// every window's boot script.
pub(crate) const MAX_BOOT_THEME_CSS: u64 = 2 * 1024 * 1024;

/// The selected imported theme's stylesheets, as `{light, dark}` JSON (or
/// `null` for a built-in theme), read from where commands/themes.rs saves
/// them.
pub(crate) fn user_theme_css(app: &AppHandle, settings: &Value) -> Value {
    let Some(id) = settings.get("themeId").and_then(Value::as_str) else {
        return Value::Null;
    };
    let Some(theme) = settings
        .get("userThemes")
        .and_then(Value::as_array)
        .and_then(|themes| {
            themes
                .iter()
                .find(|t| t.get("id").and_then(Value::as_str) == Some(id))
        })
    else {
        return Value::Null;
    };
    // Same rule as commands/themes.rs: the id becomes a path component.
    let safe = !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let Ok(config_dir) = app.path().app_config_dir() else {
        return Value::Null;
    };
    if !safe {
        return Value::Null;
    }
    let dir = config_dir.join("themes").join(id);
    let read = |name: &str| -> Option<String> {
        let path = dir.join(name);
        let size = std::fs::metadata(&path).ok()?.len();
        (size <= MAX_BOOT_THEME_CSS)
            .then(|| std::fs::read_to_string(&path).ok())
            .flatten()
    };
    let Some(light) = read("light.css") else {
        return Value::Null;
    };
    let has_dark = theme
        .get("hasDark")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let dark = if has_dark { read("dark.css") } else { None };
    json!({ "light": light, "dark": dark })
}

/// Adds the boot script to a webview that shows the app (editor windows,
/// the detached chat, the iOS webview), and on Linux builds the window in a
/// pinned appearance's background (`pinned_background`). The PDF-export and
/// tab-drag windows load other pages and go without either.
pub fn with_boot<'a, R: tauri::Runtime, M: Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
    app: &AppHandle,
    label: &str,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    let builder = builder.initialization_script(boot_script(app, label));
    #[cfg(target_os = "linux")]
    let builder = match app
        .try_state::<Stores>()
        .and_then(|stores| pinned_background(&stores.settings.snapshot().0))
    {
        Some(color) => builder.background_color(color),
        None => builder,
    };
    builder
}

/// The colour a window shows before its page has painted, for a pinned
/// appearance: the page's own background (ui/base.css's `--bg`, and what
/// index.html paints before any stylesheet loads).
///
/// On Linux the GTK window and the WebKit view start in their own colours -
/// the GTK theme's window background, then white - until the page's first
/// paint, so a window pinned to Dark opened with a white frame however early
/// the boot script put the theme on the document (measured on a release
/// build: GTK grey, one white frame, then the page). Built with this, the
/// window is the page's colour from its first frame. "system" is left alone:
/// what WebKitGTK resolves it to depends on GTK settings and the desktop's
/// colour-scheme preference, and guessing wrong would flash the other way.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn pinned_background(settings: &Value) -> Option<tauri::window::Color> {
    match settings.get("theme").and_then(Value::as_str) {
        Some("dark") => Some(tauri::window::Color(0x1b, 0x1e, 0x24, 0xff)),
        Some("light") => Some(tauri::window::Color(0xff, 0xff, 0xff, 0xff)),
        _ => None,
    }
}

/// Gives every open app window the background `with_boot` would give it now:
/// after the appearance changes (or first arrives, with the legacy import),
/// a window keeps showing its native background wherever the page hasn't
/// painted yet - the edges of a resize - which would otherwise stay the old
/// appearance's colour until the window is reopened.
#[cfg(target_os = "linux")]
pub(crate) fn apply_window_backgrounds(app: &AppHandle) {
    let Some(stores) = app.try_state::<Stores>() else {
        return;
    };
    let color = pinned_background(&stores.settings.snapshot().0);
    for (label, window) in app.webview_windows() {
        // Only the windows with_boot builds: not the transparent tab-drag
        // pill, nor the hidden PDF-export renderers.
        if label == crate::tab_drag::DRAG_PILL_LABEL
            || label.starts_with(crate::commands::export::PDF_EXPORT_LABEL_PREFIX)
        {
            continue;
        }
        let _ = window.set_background_color(color);
    }
}
