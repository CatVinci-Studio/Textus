//! What settings change outside the webview: the app and window themes
//! and backgrounds, the boot script a new window starts with, and the
//! settings the backend reads or sets.

use super::*;

/// Loads every store into app state, before any window is built (their boot
/// scripts are made from it).
pub fn init(app: &AppHandle) {
    let config_dir = app.path().app_config_dir().unwrap_or_default();
    let data_dir = app.path().app_data_dir().unwrap_or_default();
    app.manage(Stores::load(&config_dir, &data_dir));
    #[cfg(target_os = "macos")]
    apply_app_theme(app);
}

/// The appearance setting changed: brings the native side in line so what a
/// window shows around its page matches. macOS sets the app's appearance, Linux
/// the windows' backgrounds.
pub(crate) fn theme_changed(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    apply_app_theme(app);
    #[cfg(target_os = "linux")]
    apply_window_backgrounds(app);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = app;
}

/// The appearance AppKit gives the app: Light or Dark when Settings pins one,
/// the system's otherwise. A WKWebView shows a background following the app's
/// appearance until its page paints, so without this a pinned window flashes.
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

/// A settings field as Rust sees it, for the few decisions Rust makes itself
/// (some before any webview exists).
pub fn read_setting(app: &AppHandle, key: &str) -> Option<Value> {
    let stores = app.try_state::<Stores>()?;
    let (settings, _) = stores.settings.snapshot();
    settings.get(key).cloned()
}

/// Changes settings fields on Rust's own initiative and tells every window,
/// as settings_patch does (`from` names no window, so every one applies it).
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

/// Delivers an event to every window, one by one: every event is
/// window-addressed.
pub(crate) fn emit_to_all<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    for label in app.webview_windows().into_keys() {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window(&label),
            event,
            payload.clone(),
        );
    }
}

/// The script every app webview runs first: it publishes `window.__BOOT__` and
/// applies the appearance. Read when the window is built, so the frontend treats
/// it as a first-paint hint and re-reads live values.
pub fn boot_script(app: &AppHandle, label: &str) -> String {
    let Some(stores) = app.try_state::<Stores>() else {
        return String::new();
    };
    let (settings, rev) = stores.settings.snapshot();
    let (ui_state, _) = stores.ui_state.snapshot();
    let theme_css = user_theme_css(app, &settings);
    #[cfg(target_os = "macos")]
    let titlebar_height = crate::editor_windows::native_titlebar_height();
    #[cfg(not(target_os = "macos"))]
    let titlebar_height: Option<f64> = None;
    let boot = json!({
        "settings": settings,
        "rev": rev,
        "uiState": ui_state,
        // No settings.json at launch: the frontend writes its defaults, and what the
        // seed already put there must not pass for the user's choices.
        "newProfile": stores.settings.missing_at_load(),
        "label": label,
        "titlebarHeight": titlebar_height,
    });
    format!(
        "{}\n;window.__textusBoot({boot}, {theme_css});",
        include_str!("../boot.js")
    )
}

/// Above this an imported theme is left to the frontend's async load rather
/// than copied into every boot script.
pub(crate) const MAX_BOOT_THEME_CSS: u64 = 2 * 1024 * 1024;

/// The selected imported theme's stylesheets, as `{light, dark}` JSON (or
/// `null` for a built-in theme).
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
    // The id becomes a path component.
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

/// Adds the boot script to a webview that shows the app, and on Linux builds the
/// window in a pinned appearance's background. Other webviews go without.
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
/// appearance: the page's own `--bg`. On Linux GTK and WebKit otherwise flash
/// their own colours first. "system" is left alone: guessing wrong would flash.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn pinned_background(settings: &Value) -> Option<tauri::window::Color> {
    match settings.get("theme").and_then(Value::as_str) {
        Some("dark") => Some(tauri::window::Color(0x1b, 0x1e, 0x24, 0xff)),
        Some("light") => Some(tauri::window::Color(0xff, 0xff, 0xff, 0xff)),
        _ => None,
    }
}

/// Gives every open app window the background `with_boot` would give it now,
/// so unpainted edges (during a resize) don't keep the old appearance's colour.
#[cfg(target_os = "linux")]
pub(crate) fn apply_window_backgrounds(app: &AppHandle) {
    let Some(stores) = app.try_state::<Stores>() else {
        return;
    };
    let color = pinned_background(&stores.settings.snapshot().0);
    for (label, window) in app.webview_windows() {
        // Only the windows the user sees: not the transparent tab-drag
        // pill, the hidden PDF-export renderers or background host.
        if label == crate::tab_drag::DRAG_PILL_LABEL
            || label == crate::schedule::HOST_LABEL
            || label.starts_with(crate::commands::export::PDF_EXPORT_LABEL_PREFIX)
        {
            continue;
        }
        let _ = window.set_background_color(color);
    }
}
