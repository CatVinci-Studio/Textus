//! The tray icon of background mode: the notification area on Windows, the
//! StatusNotifier/AppIndicator tray on Linux, the menu bar on macOS. Built
//! when the setting turns on, dropped when it turns off; never there
//! otherwise.
//!
//! Its menu: New Quick Note, Open Textus, Open Quick Notes Folder,
//! Settings…, Quit Textus. A left click opens a quick note on Windows; on
//! macOS it opens the menu, as menu bar items do, and on Linux the
//! AppIndicator protocol has no click of its own, so it opens the menu too.
//!
//! The icons are src-tauri/icons/tray/, made from the app icon by
//! scripts/make-tray-icons.sh.

use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};

/// The tray's id. There is only ever one.
pub const ID: &str = "textus";

/// Menu ids, "tray:<item>". Clicks reach menu.rs's dispatch like the menu
/// bar's do (Tauri sends tray menu clicks to the app's menu handler), which
/// hands them to `on_menu`.
pub const MENU_PREFIX: &str = "tray:";
const NEW_QUICK_NOTE: &str = "new-quick-note";
const OPEN_APP: &str = "open";
const OPEN_FOLDER: &str = "open-quick-notes-folder";
const SETTINGS: &str = "settings";
const QUIT: &str = "quit";

/// The menu's labels in one language. Rust's own, not sent by a window:
/// the tray is up at login before any window has been. Each is the same
/// string as in src/i18n/locales/ (a test holds them to it).
struct Labels {
    new_quick_note: &'static str,
    open_app: &'static str,
    open_folder: &'static str,
    settings: &'static str,
    quit: &'static str,
}

fn labels(language: &str) -> Labels {
    let (new_quick_note, open_app, open_folder, settings, quit) = match language {
        "zh" => (
            "新建速记",
            "打开 Textus",
            "打开速记文件夹",
            "设置…",
            "退出 Textus",
        ),
        "zh-Hant" => (
            "新增速記",
            "打開 Textus",
            "打開速記檔案夾",
            "設定…",
            "結束 Textus",
        ),
        "ja" => (
            "新規クイックメモ",
            "Textus を開く",
            "クイックメモのフォルダを開く",
            "設定…",
            "Textusを終了",
        ),
        "ko" => (
            "새 빠른 메모",
            "Textus 열기",
            "빠른 메모 폴더 열기",
            "설정…",
            "Textus 종료",
        ),
        "es" => (
            "Nueva nota rápida",
            "Abrir Textus",
            "Abrir carpeta de notas rápidas",
            "Ajustes…",
            "Salir de Textus",
        ),
        "fr" => (
            "Nouvelle note rapide",
            "Ouvrir Textus",
            "Ouvrir le dossier des notes rapides",
            "Réglages…",
            "Quitter Textus",
        ),
        "de" => (
            "Neue Schnellnotiz",
            "Textus öffnen",
            "Schnellnotiz-Ordner öffnen",
            "Einstellungen…",
            "Textus beenden",
        ),
        "ru" => (
            "Новая быстрая заметка",
            "Открыть Textus",
            "Открыть папку быстрых заметок",
            "Настройки…",
            "Завершить Textus",
        ),
        "pt" => (
            "Nova nota rápida",
            "Abrir o Textus",
            "Abrir pasta de notas rápidas",
            "Ajustes…",
            "Encerrar Textus",
        ),
        _ => (
            "New Quick Note",
            "Open Textus",
            "Open Quick Notes Folder",
            "Settings…",
            "Quit Textus",
        ),
    };
    Labels {
        new_quick_note,
        open_app,
        open_folder,
        settings,
        quit,
    }
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let language = crate::settings::read_setting(app, "language")
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    let l = labels(&language);
    let item = |id: &str, text: &str| {
        // muda reads a lone `&` as a mnemonic marker (menu.rs's menu_text).
        MenuItemBuilder::with_id(format!("{MENU_PREFIX}{id}"), text.replace('&', "&&")).build(app)
    };
    MenuBuilder::new(app)
        .item(&item(NEW_QUICK_NOTE, l.new_quick_note)?)
        .item(&item(OPEN_APP, l.open_app)?)
        .item(&item(OPEN_FOLDER, l.open_folder)?)
        .separator()
        .item(&item(SETTINGS, l.settings)?)
        .separator()
        .item(&item(QUIT, l.quit)?)
        .build()
}

/// A tray menu click, from menu.rs's dispatch (`item` without the prefix).
pub fn on_menu(app: &AppHandle, item: &str) {
    match item {
        NEW_QUICK_NOTE => crate::commands::quick_note::window::open_soon(app),
        OPEN_APP => crate::reopen_without_windows(app),
        OPEN_FOLDER => {
            if let Err(err) = crate::commands::quick_note::open_folder(app) {
                eprintln!("quick notes: could not open the folder: {err}");
            }
        }
        SETTINGS => {
            // The window it opens in may be behind other apps' or
            // minimised: the tray is clicked from anywhere.
            if let Some(window) = crate::menu::focused_editor_window(app)
                .and_then(|label| app.get_webview_window(&label))
            {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            crate::menu::open_settings(app);
        }
        QUIT => crate::menu::quit(app),
        _ => {}
    }
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

/// The bitmap at the size the notification area draws its icons at on
/// this display (16 px at 100%, 24 at 150%...), so Windows doesn't scale
/// one up or down into a blur.
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

/// Whether a tray can be shown here. Linux needs libayatana-appindicator
/// or libappindicator, loaded when the first tray is built - and tray-icon
/// panics when neither is installed, so it is asked first, by the same
/// names libappindicator-sys loads. Asked anew each time: a library
/// installed since counts.
pub fn available() -> bool {
    #[cfg(target_os = "linux")]
    {
        ["libayatana-appindicator3.so.1", "libappindicator3.so.1"]
            .iter()
            // SAFETY: loading a system library runs its initialisers,
            // which is what tray-icon does with it next anyway.
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
    // Windows: a left click is a quick note, the right click the menu. On
    // Linux this does nothing (the indicator only has its menu).
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
                crate::commands::quick_note::window::open_soon(tray.app_handle());
            }
        });
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `key: "text"` (or `` `text` `` with ${APP_NAME}) in a locale file,
    /// as the UI would show it.
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
            for (label, key) in [
                (l.new_quick_note, "menuNewQuickNote"),
                (l.open_app, "trayOpenTextus"),
                (l.open_folder, "menuOpenQuickNotesFolder"),
                (l.settings, "menuSettings"),
                (l.quit, "menuQuit"),
            ] {
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
