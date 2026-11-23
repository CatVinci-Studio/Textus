//! What settings change outside the webview: the app and window themes
//! and backgrounds, the boot script a new window starts with, and the
//! settings the backend reads or sets.

use super::*;
use crate::app_dirs::AppDirs;
use aicompat::http::Route;

/// Loads every store into app state, before any window is built (their boot
/// scripts are made from it).
pub fn init(app: &AppHandle) {
    let config_dir = app.path().own_config_dir().unwrap_or_default();
    let data_dir = app.path().own_data_dir().unwrap_or_default();
    let stores = Stores::load(&config_dir, &data_dir);
    proxy_changed(&stores.settings.snapshot().0);
    app.manage(stores);
    #[cfg(target_os = "macos")]
    apply_app_theme(app);
}

/// The settings fields the proxy is made from: each is patched on its own as
/// the user types, and a name or password must reach a proxy that asks for
/// them as surely as the address does.
const PROXY_KEYS: [&str; 5] = [
    "proxyType",
    "proxyHost",
    "proxyPort",
    "proxyUsername",
    "proxyPassword",
];

/// Whether `patch` changes any field the proxy is made from.
pub(crate) fn proxy_keys_changed(patch: &Map<String, Value>) -> bool {
    PROXY_KEYS.iter().any(|key| patch.contains_key(*key))
}

/// The settings' proxy, for every request the app makes: read here, at
/// launch and on each change, so a request made before any window (a
/// scheduled job in background mode) goes through it too. Unless set, or
/// set to direct, requests follow the system's proxy; an unreadable one
/// follows the system too.
pub(crate) fn proxy_changed(settings: &Value) {
    let text = |key: &str| {
        settings
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let (mut kind, host, port) = (text("proxyType"), text("proxyHost"), text("proxyPort"));
    // The names a SOCKS5 proxy is asked for are looked up at the proxy
    // (socks5h): on an intranet this computer's own DNS can't resolve an
    // address elsewhere, which fails before the proxy is ever reached.
    if kind == "socks5" {
        kind = "socks5h".to_string();
    }
    // A password is kept as typed: spaces may be part of it.
    let pass = settings
        .get("proxyPassword")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let user = text("proxyUsername");
    // "socks5h", the mapped kind, is a manual proxy like the rest: its
    // names are looked up at the proxy.
    let manual = matches!(kind.as_str(), "http" | "https" | "socks5h");
    let route = if kind == "direct" {
        Route::Direct
    } else if !manual || host.is_empty() {
        // "system", and "none", which before 1.4.5 was the default.
        Route::System
    } else {
        // The address as pasted: a whole URL ("http://host:port", what a
        // proxy app shows) is taken as is. Prefixing another scheme onto it
        // produced "http://http://...", whose host "http" then failed to
        // resolve - a name error that read like the site was gone.
        let mut url = if host.contains("://") {
            // socks5:// pasted keeps its scheme, mapped to socks5h.
            if let Some(inner) = host.strip_prefix("socks5://") {
                format!("socks5h://{inner}")
            } else {
                host.clone()
            }
        } else {
            format!("{kind}://{host}")
        };
        if !port.is_empty() && !host.contains("://") {
            url.push_str(&format!(":{port}"));
        }
        // The proxy's credentials, when it asks for a name and password
        // (the frontend's proxyUsername/proxyPassword): encoded into the
        // URL's userinfo, which reqwest decodes for Basic auth. Url encodes
        // @, : and spaces but leaves %, so that one is encoded first.
        if !user.is_empty() {
            if let Ok(mut parsed) = reqwest::Url::parse(&url) {
                let escaped = |s: &str| s.replace('%', "%25");
                let _ = parsed.set_username(&escaped(&user));
                let _ = parsed.set_password((!pass.is_empty()).then(|| escaped(&pass)).as_deref());
                url = parsed.to_string();
            }
        }
        Route::Via(url)
    };
    if aicompat::http::set_route(route).is_err() {
        // A setting that can't be parsed (a typo) must not pass for one in
        // use: say so, then follow the system's proxy.
        eprintln!("textus: proxy setting left out, requests follow the system's: the address didn't parse");
        let _ = aicompat::http::set_route(Route::System);
    }
}

/// The appearance setting changed: brings the native side in line so what a
/// window shows around its page matches. macOS sets the app's appearance, Linux
/// and Windows the windows' backgrounds.
pub(crate) fn theme_changed(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    apply_app_theme(app);
    #[cfg(any(target_os = "linux", windows))]
    apply_window_backgrounds(app);
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
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
/// An on/off setting Rust reads, or its default from
/// src/prefs/backend-defaults.json, which the frontend's defaults take too.
pub fn read_flag(app: &AppHandle, key: &str) -> bool {
    flag(read_setting(app, key), key)
}

/// `stored` as on/off, or `key`'s default when unset (a build from before it).
pub(crate) fn flag(stored: Option<Value>, key: &str) -> bool {
    stored
        .and_then(|v| v.as_bool())
        .unwrap_or_else(|| flag_default(key))
}

pub(crate) fn flag_default(key: &str) -> bool {
    static DEFAULTS: std::sync::LazyLock<Map<String, Value>> = std::sync::LazyLock::new(|| {
        serde_json::from_str(include_str!("../../../src/prefs/backend-defaults.json"))
            .expect("backend-defaults.json")
    });
    DEFAULTS
        .get(key)
        .and_then(Value::as_bool)
        .expect("a flag Rust reads is in backend-defaults.json")
}

pub fn read_setting(app: &AppHandle, key: &str) -> Option<Value> {
    let stores = app.try_state::<Stores>()?;
    let (settings, _) = stores.settings.snapshot();
    settings.get(key).cloned()
}

/// Changes settings fields on Rust's own initiative and tells every window,
/// as settings_patch does (`from` names no window, so every one applies it).
#[cfg(not(target_os = "ios"))]
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
    for label in app.windows().into_keys() {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window(&label),
            event,
            payload.clone(),
        );
    }
}

/// The script every app webview runs first: it publishes `window.__BOOT__` (its
/// shape is `Boot` in src/storage/boot.ts) and applies the appearance. Read when
/// the window is built, so the frontend treats it as a first-paint hint and
/// re-reads live values.
pub fn boot_script(app: &AppHandle, label: &str) -> String {
    let Some(stores) = app.try_state::<Stores>() else {
        return String::new();
    };
    let (settings, rev) = stores.settings.snapshot();
    let (ui_state, _) = stores.ui_state.snapshot();
    let theme_css = user_theme_css(app, &settings);
    let boot = json!({
        "settings": settings,
        "rev": rev,
        "uiState": ui_state,
        // No settings.json at launch: the frontend writes its defaults, and what the
        // seed already put there must not pass for the user's choices.
        "newProfile": stores.settings.missing_at_load(),
        "label": label,
        // Built without its shadow (editor_windows.rs): the page draws the edge.
        "windows10": windows_10(),
        // Something to open as it starts: its first frame is held back (startup-restore.ts).
        "restoring": crate::launch::window_restores(app, label),
        "detachedTab": detached_tab(app, label),
        // The theme's page colour, for index.html's first paint.
        "background": window_background(&settings, &ui_state, system_dark())
            .map(|tauri::window::Color(r, g, b, _)| format!("#{r:02x}{g:02x}{b:02x}")),
        // The settings' values the boot script turns into the page's look:
        // the frontend's own tables, one file.
        "tables": serde_json::from_str::<Value>(include_str!(
            "../../../src/prefs/appearance-tables.json"
        ))
        .unwrap_or(Value::Null),
    });
    format!(
        "{}\n;window.__textusBoot({boot}, {theme_css});",
        include_str!("../boot.js")
    )
}

#[cfg(desktop)]
fn detached_tab(app: &AppHandle, label: &str) -> Value {
    json!(crate::tab_drag::boot_detached_tab(app, label))
}

#[cfg(not(desktop))]
fn detached_tab(_app: &AppHandle, _label: &str) -> Value {
    Value::Null
}

#[cfg(windows)]
fn windows_10() -> bool {
    crate::commands::system_info::is_windows_10()
}

#[cfg(not(windows))]
fn windows_10() -> bool {
    false
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
    let Ok(config_dir) = app.path().own_config_dir() else {
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

/// Adds the boot script and the navigation guard to a webview that shows the
/// app, and on Linux and Windows builds the window in the appearance's
/// background. Other webviews go without.
pub fn with_boot<'a, R: tauri::Runtime, M: Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
    app: &AppHandle,
    label: &str,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    let builder =
        crate::window_guard::guard(builder.initialization_script(boot_script(app, label)));
    #[cfg(any(target_os = "linux", windows))]
    let builder = match app.try_state::<Stores>().and_then(|stores| {
        window_background(
            &stores.settings.snapshot().0,
            &stores.ui_state.snapshot().0,
            system_dark(),
        )
    }) {
        Some(color) => builder.background_color(color),
        None => builder,
    };
    builder
}

/// The colour a window shows before its page has painted: the page's own
/// background, `--ui-bg`, for the theme and appearance. Linux GTK and
/// Windows' WebView2 otherwise show white first: at launch, and on Windows
/// again whenever the window is maximized or comes back. "system" follows
/// `system_dark`, left alone where that is unknown: guessing wrong would flash.
pub(crate) fn window_background(
    settings: &Value,
    ui_state: &Value,
    system_dark: Option<bool>,
) -> Option<tauri::window::Color> {
    let dark = match settings.get("theme").map(Value::as_str) {
        Some(Some("dark")) => true,
        Some(Some("light")) => false,
        Some(Some("system")) | None => system_dark?,
        _ => return None,
    };
    let theme = settings
        .get("themeId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    Some(
        builtin_background(theme, dark)
            .or_else(|| imported_background(theme, ui_state, dark))
            .unwrap_or(if dark {
                tauri::window::Color(0x1c, 0x1c, 0x1e, 0xff)
            } else {
                tauri::window::Color(0xff, 0xff, 0xff, 0xff)
            }),
    )
}

/// A built-in theme's page colour, from its own stylesheet.
fn builtin_background(theme: &str, dark: bool) -> Option<tauri::window::Color> {
    const CSS: &str = include_str!("../../../src/theme/content-themes.css");
    if theme.is_empty() || !theme.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    let rule = if dark {
        format!(":root[data-theme=\"dark\"][data-content-theme=\"{theme}\"] {{")
    } else {
        format!("\n[data-content-theme=\"{theme}\"] {{")
    };
    css_color(declared(CSS, &rule, "--doc-bg:")?)
}

/// An imported theme's, from the chrome the frontend last derived for it
/// (ui-state's `themeChrome`, which the boot script paints the first frame
/// with), when that was for this theme in this appearance.
fn imported_background(theme: &str, ui_state: &Value, dark: bool) -> Option<tauri::window::Color> {
    let chrome = ui_state.get("themeChrome")?;
    if chrome.get("id")?.as_str()? != theme || chrome.get("dark")?.as_bool()? != dark {
        return None;
    }
    let css = chrome.get("css")?.as_str()?;
    css_color(
        declared(css, ":root {", "--ui-bg:")?
            .trim_end_matches("!important")
            .trim(),
    )
}

/// The value `property` has in the first rule that starts with `rule`.
fn declared<'a>(css: &'a str, rule: &str, property: &str) -> Option<&'a str> {
    let body = &css[css.find(rule)? + rule.len()..];
    let body = &body[..body.find('}')?];
    let value = &body[body.find(property)? + property.len()..];
    Some(value.split(';').next()?.trim())
}

/// `#rgb`, `#rrggbb` or `rgb(r, g, b)` as an opaque colour; None for anything else.
fn css_color(value: &str) -> Option<tauri::window::Color> {
    let channels: Vec<u8> = if let Some(hex) = value.strip_prefix('#') {
        let wide = match hex.len() {
            3 => hex.chars().flat_map(|c| [c, c]).collect(),
            6 => hex.to_string(),
            _ => return None,
        };
        (0..3)
            .map(|i| u8::from_str_radix(&wide[i * 2..i * 2 + 2], 16).ok())
            .collect::<Option<_>>()?
    } else {
        value
            .strip_prefix("rgb(")?
            .strip_suffix(')')?
            .split(',')
            .map(|n| n.trim().parse().ok())
            .collect::<Option<_>>()?
    };
    match channels[..] {
        [r, g, b] => Some(tauri::window::Color(r, g, b, 0xff)),
        _ => None,
    }
}

/// Whether the system is in dark mode, where it can be read before a window
/// exists: Windows' own setting for apps.
#[cfg(windows)]
pub(crate) fn system_dark() -> Option<bool> {
    let key = windows_registry::CURRENT_USER
        .open(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .ok()?;
    Some(key.get_u32("AppsUseLightTheme").ok()? == 0)
}

#[cfg(not(windows))]
pub(crate) fn system_dark() -> Option<bool> {
    None
}

/// Gives every open app window the background `with_boot` would give it now,
/// so unpainted edges (during a resize) don't keep the old appearance's colour.
#[cfg(any(target_os = "linux", windows))]
pub(crate) fn apply_window_backgrounds(app: &AppHandle) {
    let Some(stores) = app.try_state::<Stores>() else {
        return;
    };
    let color = window_background(
        &stores.settings.snapshot().0,
        &stores.ui_state.snapshot().0,
        system_dark(),
    );
    // The webview's own colour too, which WebView2 shows on maximize: the
    // window's alone left a theme changed since launch flashing the old one.
    for (label, window) in app.webview_windows() {
        // Only the windows the user sees: not the transparent tab-drag
        // pill, the hidden PDF-export renderers or background host.
        use crate::windows::WindowKind;
        if matches!(
            WindowKind::of(&label),
            Some(WindowKind::DragPill | WindowKind::BackgroundHost | WindowKind::PdfExport)
        ) {
            continue;
        }
        let _ = window.set_background_color(color);
    }
}
