//! What the menu bar keeps between rebuilds: its labels in the app's
//! language, the View checks, the accelerators, the recent submenu.

use super::*;

/// Handle to the File > Open Recent submenu, kept so add_recent_file can
/// rebuild its entries at runtime without touching the rest of the menu.
pub(crate) struct RecentMenu(pub(crate) Mutex<Option<Submenu<tauri::Wry>>>);

/// The labels the menu is built with, keyed by menu id - or, for what has
/// no id of ours, "menu:<name>" for a submenu and "predefined:<name>" for
/// an item muda makes (the keys `nativeMenuLabels` in
/// src/app/menu/app-menu-model.ts sends). Empty until the frontend sends them,
/// which leaves every label English.
#[derive(Default)]
pub(crate) struct MenuLabels(pub(crate) Mutex<HashMap<String, String>>);

/// The View menu's on/off items and whether each is on, keyed by menu id:
/// the states the frontend last sent (`set_menu_checks`), kept so a rebuild
/// for a new language starts from them, and the items they are shown on.
#[derive(Default)]
pub(crate) struct ViewChecks(pub(crate) Mutex<ViewCheckState>);

/// The Format menu's heading keys, keyed by menu id, as the frontend last
/// sent them (`set_menu_accelerators`) - Settings › Shortcuts' bindings,
/// kept so every rebuild of the bar carries them. Empty off macOS.
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

/// The label for `key`, or `english` when none was sent - as menu text:
/// muda reads a lone `&` as a mnemonic marker and drops it ("Find & Replace…"
/// showed as "Find  Replace…"), so a literal one is doubled.
pub(crate) fn label(labels: &HashMap<String, String>, key: &str, english: &str) -> String {
    menu_text(labels.get(key).map_or(english, String::as_str))
}

/// `text` with every `&` doubled, so the menu shows it as written.
pub(crate) fn menu_text(text: &str) -> String {
    text.replace('&', "&&")
}
