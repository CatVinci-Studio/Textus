//! The colour a window shows before its page paints, for the theme and
//! appearance: on Linux and Windows natively, everywhere in index.html.

use super::*;

/// The colour a window shows before its page has painted: the page's own
/// background, `--ui-bg`, for the theme and appearance. Linux GTK and
/// Windows' WebView2 otherwise show white first: at launch, and on Windows
/// again whenever the window is maximized or comes back. "system" follows
/// `system_dark`, left alone where that is unknown: guessing wrong would flash.
pub(crate) fn window_background(
    settings: &Value,
    ui_state: &Value,
    theme_css: &Value,
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
            .or_else(|| imported_background(theme, ui_state, theme_css, dark))
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
/// with), when that was for this theme's stylesheet (`theme_css`, as
/// `user_theme_css` gives it) in this appearance: boot.js checks the same.
fn imported_background(
    theme: &str,
    ui_state: &Value,
    theme_css: &Value,
    dark: bool,
) -> Option<tauri::window::Color> {
    let light = theme_css.get("light").and_then(Value::as_str);
    let source = match theme_css.get("dark").and_then(Value::as_str) {
        Some(dark_css) if dark => dark_css,
        _ => light?,
    };
    let chrome = ui_state.get("themeChrome")?;
    // A JavaScript string's length, as the frontend measured it.
    let length = source.encode_utf16().count() as u64;
    if chrome.get("id")?.as_str()? != theme
        || chrome.get("dark")?.as_bool()? != dark
        || chrome.get("sourceLength")?.as_u64()? != length
    {
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
pub(super) fn declared<'a>(css: &'a str, rule: &str, property: &str) -> Option<&'a str> {
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
    let settings = stores.settings.snapshot().0;
    let color = window_background(
        &settings,
        &stores.ui_state.snapshot().0,
        &user_theme_css(app, &settings),
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
