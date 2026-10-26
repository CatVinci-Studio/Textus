//! The tray icon of background mode, built when the setting turns on and
//! dropped when it turns off. Its menu: Open Textus, plugin commands, Quit.

use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

/// The tray's id. There is only ever one.
pub const ID: &str = "textus";

/// Menu ids, "tray:<item>". Tauri sends tray menu clicks to the app's menu
/// handler, which hands them to `on_menu`.
pub const MENU_PREFIX: &str = "tray:";
const OPEN_APP: &str = "open";
const QUIT: &str = "quit";
/// "tray:plugin:<command>": a plugin's command.
const PLUGIN: &str = "plugin:";

/// One plugin command in the menu, as the window sends it.
#[derive(serde::Deserialize, Clone, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct TrayPluginItem {
    command: String,
    label: String,
}

/// The plugin commands the menu lists, and one asked for while no window was
/// open, run by the window that opens for it.
#[derive(Default)]
pub struct TrayPlugins {
    items: Mutex<Vec<TrayPluginItem>>,
    pending: Mutex<Option<String>>,
}

/// The menu's labels, owned by Rust since the tray can be up before any window.
/// Each matches the locale files (a test holds them to it).
struct Labels {
    open_app: &'static str,
    quit: &'static str,
}

fn labels(language: &str) -> Labels {
    let (open_app, quit) = match language {
        "zh" => ("打开 Textus", "退出 Textus"),
        "zh-Hant" => ("打開 Textus", "結束 Textus"),
        "ja" => ("Textus を開く", "Textusを終了"),
        "ko" => ("Textus 열기", "Textus 종료"),
        "es" => ("Abrir Textus", "Salir de Textus"),
        "fr" => ("Ouvrir Textus", "Quitter Textus"),
        "de" => ("Textus öffnen", "Textus beenden"),
        "ru" => ("Открыть Textus", "Завершить Textus"),
        "pt" => ("Abrir o Textus", "Encerrar Textus"),
        _ => ("Open Textus", "Quit Textus"),
    };
    Labels { open_app, quit }
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let language = crate::settings::read_setting(app, "language")
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    let l = labels(&language);
    let item = |id: &str, text: &str| {
        // muda reads a lone `&` as a mnemonic marker.
        MenuItemBuilder::with_id(format!("{MENU_PREFIX}{id}"), text.replace('&', "&&")).build(app)
    };
    let plugins = app
        .try_state::<TrayPlugins>()
        .map(|s| s.items.lock().unwrap_or_else(|e| e.into_inner()).clone())
        .unwrap_or_default();
    let mut menu = MenuBuilder::new(app).item(&item(OPEN_APP, l.open_app)?);
    if !plugins.is_empty() {
        menu = menu.separator();
        for plugin in &plugins {
            menu = menu.item(&item(
                &format!("{PLUGIN}{}", plugin.command),
                &plugin.label,
            )?);
        }
    }
    menu.separator().item(&item(QUIT, l.quit)?).build()
}

/// A tray menu click (`item` without the prefix).
pub fn on_menu(app: &AppHandle, item: &str) {
    if let Some(command) = item.strip_prefix(PLUGIN) {
        run_plugin_command(app, command);
        return;
    }
    match item {
        OPEN_APP => crate::reopen_without_windows(app),
        QUIT => crate::menu::quit(app),
        _ => {}
    }
}

/// A plugin command from the tray: run by an editor window, brought forward,
/// or with none open, by the one opened for it.
fn run_plugin_command(app: &AppHandle, command: &str) {
    let window = app
        .webview_windows()
        .into_iter()
        .find(|(label, _)| crate::commands::chat_window::is_editor_window(label))
        .map(|(_, window)| window);
    match window {
        Some(window) => {
            crate::reopen_without_windows(app);
            let _ = window.emit_to(
                tauri::EventTarget::webview_window(window.label()),
                "menu-plugin-command",
                command.to_string(),
            );
        }
        None => {
            if let Some(state) = app.try_state::<TrayPlugins>() {
                *state.pending.lock().unwrap_or_else(|e| e.into_inner()) =
                    Some(command.to_string());
            }
            crate::reopen_without_windows(app);
        }
    }
}

/// The plugin commands the menu lists, refilled when the enabled plugins change.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn set_tray_plugin_items(app: AppHandle, items: Vec<TrayPluginItem>) {
    let Some(state) = app.try_state::<TrayPlugins>() else {
        return;
    };
    {
        let mut current = state.items.lock().unwrap_or_else(|e| e.into_inner());
        if *current == items {
            return;
        }
        *current = items;
    }
    if let Some(tray) = app.tray_by_id(ID) {
        if let Ok(menu) = menu(&app) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// The tray command waiting for a window to run it, taken.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn take_pending_plugin_command(app: AppHandle) -> Option<String> {
    app.try_state::<TrayPlugins>()?
        .pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}

/// The icon for this platform.
fn icon() -> Image<'static> {
    #[cfg(target_os = "macos")]
    {
        tauri::include_image!("icons/tray/macos-template.png")
    }
    #[cfg(windows)]
    {
        windows_icon()
    }
    #[cfg(target_os = "linux")]
    {
        tauri::include_image!("icons/tray/linux.png")
    }
}

/// The bitmap at the size the notification area draws on this display, so
/// Windows doesn't scale one into a blur.
#[cfg(windows)]
fn windows_icon() -> Image<'static> {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSMICON};
    let size = unsafe { GetSystemMetrics(SM_CXSMICON) }.max(0) as u32;
    match windows_icon_size(size) {
        16 => tauri::include_image!("icons/tray/windows-16.png"),
        20 => tauri::include_image!("icons/tray/windows-20.png"),
        24 => tauri::include_image!("icons/tray/windows-24.png"),
        32 => tauri::include_image!("icons/tray/windows-32.png"),
        40 => tauri::include_image!("icons/tray/windows-40.png"),
        _ => tauri::include_image!("icons/tray/windows-48.png"),
    }
}

/// The sizes of src-tauri/icons/tray/windows-<n>.png.
const WINDOWS_SIZES: [u32; 6] = [16, 20, 24, 32, 40, 48];

/// The smallest bitmap at least `wanted` pixels wide, or the largest:
/// scaling down blurs less than scaling up.
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_icon_size(wanted: u32) -> u32 {
    WINDOWS_SIZES
        .into_iter()
        .find(|&size| size >= wanted)
        .unwrap_or(WINDOWS_SIZES[WINDOWS_SIZES.len() - 1])
}

/// Whether a tray can be shown here. On Linux tray-icon panics without an
/// AppIndicator library, so it is probed first, anew each time.
pub fn available() -> bool {
    #[cfg(target_os = "linux")]
    {
        ["libayatana-appindicator3.so.1", "libappindicator3.so.1"]
            .iter()
            // SAFETY: loading a system library runs its initialisers, which tray-icon
            // does next anyway.
            .any(|name| unsafe { libloading::Library::new(name) }.is_ok())
    }
    #[cfg(not(target_os = "linux"))]
    true
}

/// Builds, relabels or drops the tray as `on` says, and answers what it
/// is now ("on", "off", "unavailable"). Main thread only.
pub fn sync(app: &AppHandle, on: bool) -> &'static str {
    if !on {
        // Dropped here, on the main thread: gone from the tray at once.
        drop(app.remove_tray_by_id(ID));
        return "off";
    }
    if let Some(tray) = app.tray_by_id(ID) {
        // Already up: the language may have changed.
        if let Ok(menu) = menu(app) {
            let _ = tray.set_menu(Some(menu));
        }
        return "on";
    }
    if !available() {
        return "unavailable";
    }
    match build(app) {
        Ok(()) => "on",
        Err(err) => {
            eprintln!("background: could not build the tray icon: {err}");
            "unavailable"
        }
    }
}

fn build(app: &AppHandle) -> tauri::Result<()> {
    let builder = TrayIconBuilder::with_id(ID)
        .icon(icon())
        .tooltip(crate::app_identity::APP_NAME)
        .menu(&menu(app)?);
    // A template image: macOS paints it in the menu bar's own colour, light
    // or dark.
    #[cfg(target_os = "macos")]
    let builder = builder.icon_as_template(true);
    // Windows: a left click opens Textus, the right click the menu.
    #[cfg(not(target_os = "macos"))]
    let builder = builder
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::reopen_without_windows(tray.app_handle());
            }
        });
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `key: "text"` (or `` `text` `` with ${APP_NAME}) in a locale file, as the UI shows it.
    fn locale_string(source: &str, key: &str) -> String {
        let line = source
            .lines()
            .find(|line| line.trim_start().starts_with(&format!("{key}:")))
            .unwrap_or_else(|| panic!("no {key}"));
        let value = line.split_once(':').unwrap().1.trim();
        let value = value.trim_end_matches(',');
        value[1..value.len() - 1]
            .replace("${APP_NAME}", "Textus")
            .replace("{name}", "Textus")
    }

    #[test]
    fn the_tray_menu_says_what_the_ui_says_in_every_language() {
        let locales = [
            ("en", include_str!("../../../src/i18n/locales/en.ts")),
            ("zh", include_str!("../../../src/i18n/locales/zh.ts")),
            (
                "zh-Hant",
                include_str!("../../../src/i18n/locales/zh-Hant.ts"),
            ),
            ("ja", include_str!("../../../src/i18n/locales/ja.ts")),
            ("ko", include_str!("../../../src/i18n/locales/ko.ts")),
            ("es", include_str!("../../../src/i18n/locales/es.ts")),
            ("fr", include_str!("../../../src/i18n/locales/fr.ts")),
            ("de", include_str!("../../../src/i18n/locales/de.ts")),
            ("ru", include_str!("../../../src/i18n/locales/ru.ts")),
            ("pt", include_str!("../../../src/i18n/locales/pt.ts")),
        ];
        for (language, source) in locales {
            let l = labels(language);
            for (label, key) in [(l.open_app, "trayOpenTextus"), (l.quit, "menuQuit")] {
                assert_eq!(label, locale_string(source, key), "{language} {key}");
            }
        }
    }

    #[test]
    fn an_unknown_language_gets_english() {
        assert_eq!(labels("xx").open_app, "Open Textus");
    }

    #[test]
    fn windows_gets_the_bitmap_its_display_scale_asks_for() {
        assert_eq!(windows_icon_size(16), 16);
        assert_eq!(windows_icon_size(20), 20);
        assert_eq!(windows_icon_size(24), 24);
        // 125% of a 16 px icon, or a size in between: the next one up.
        assert_eq!(windows_icon_size(18), 20);
        assert_eq!(windows_icon_size(0), 16);
        // Beyond 300%: the largest there is.
        assert_eq!(windows_icon_size(64), 48);
    }

    /// A PNG's width and height and whether it has an alpha channel, from
    /// its header.
    fn png_header(name: &str) -> (u32, u32, bool) {
        let path = format!("{}/icons/tray/{name}", env!("CARGO_MANIFEST_DIR"));
        let bytes = std::fs::read(&path).unwrap_or_else(|_| panic!("no {path}"));
        assert_eq!(&bytes[1..4], b"PNG", "{name}");
        let word = |at: usize| u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap());
        // Colour type 6 is RGBA, which a tray icon's transparency needs.
        (word(16), word(20), bytes[25] == 6)
    }

    #[test]
    fn every_tray_icon_is_there_at_its_size_with_transparency() {
        for size in WINDOWS_SIZES {
            assert_eq!(
                png_header(&format!("windows-{size}.png")),
                (size, size, true)
            );
        }
        assert_eq!(png_header("macos-template.png"), (36, 36, true));
        assert_eq!(png_header("linux.png"), (64, 64, true));
    }
}
