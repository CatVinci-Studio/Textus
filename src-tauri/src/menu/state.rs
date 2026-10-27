//! What the menu bar keeps between rebuilds: labels, View checks,
//! accelerators, the recent submenu.

use super::*;

/// Handle to the File > Open Recent submenu, so its entries can be rebuilt alone.
pub(crate) struct RecentMenu(pub(crate) Mutex<Option<Submenu<tauri::Wry>>>);

/// The labels the menu is built with, keyed by menu id, or "menu:<name>" and
/// "predefined:<name>" for what has none. Empty (all English) until the frontend sends them.
#[derive(Default)]
pub(crate) struct MenuLabels(pub(crate) Mutex<HashMap<String, String>>);

/// The View menu's on/off items and their states as the frontend last sent
/// them, kept so a rebuild starts from them.
#[derive(Default)]
pub(crate) struct ViewChecks(pub(crate) Mutex<ViewCheckState>);

/// The Format menu's heading keys as the frontend last sent them, kept for
/// every rebuild. Empty off macOS.
#[derive(Default)]
pub(crate) struct MenuAccelerators(pub(crate) Mutex<HashMap<String, String>>);

#[derive(Default)]
pub(crate) struct ViewCheckState {
    pub(crate) checked: HashMap<String, bool>,
    pub(crate) items: Vec<CheckMenuItem<Wry>>,
}

/// What `build` makes: the bar, its Open Recent submenu (built empty) and
/// the View menu's on/off items.
pub(crate) struct BuiltMenu {
    pub(crate) menu: Menu<Wry>,
    pub(crate) open_recent: Submenu<Wry>,
    /// None where the bar has no Plugins menu (PLUGINS_SHOWN).
    pub(crate) plugins: Option<Submenu<Wry>>,
    pub(crate) check_items: Vec<CheckMenuItem<Wry>>,
}

/// The label for `key`, or `english` when none was sent, as menu text (a lone
/// `&` is doubled, since muda reads it as a mnemonic).
pub(crate) fn label(labels: &HashMap<String, String>, key: &str, english: &str) -> String {
    menu_text(labels.get(key).map_or(english, String::as_str))
}

/// `text` with every `&` doubled, so the menu shows it as written.
pub(crate) fn menu_text(text: &str) -> String {
    text.replace('&', "&&")
}
