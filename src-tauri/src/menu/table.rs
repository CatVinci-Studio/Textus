//! The menu bar as data: src/registry/menu/menu.json, which the app-drawn
//! menu reads too. Ids, order, keys and English labels live there only.

use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Deserialize)]
pub(crate) struct Table {
    pub(crate) bar: Vec<Menu>,
    texts: Vec<Text>,
}

#[derive(Deserialize)]
pub(crate) struct Menu {
    pub(crate) menu: String,
    pub(crate) en: String,
    pub(crate) items: Vec<Node>,
}

#[derive(Deserialize)]
struct Text {
    key: String,
    en: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub(crate) enum Node {
    Menu(Menu),
    Section {
        section: String,
    },
    Separator {
        #[serde(rename = "sep")]
        _sep: bool,
        on: Vec<String>,
    },
    Item(Item),
    /// "-", a separator everywhere.
    #[allow(dead_code)]
    Line(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Item {
    pub(crate) id: Option<String>,
    /// One of muda's own items (Cut, Hide, Minimize…), by name.
    pub(crate) predefined: Option<String>,
    pub(crate) en: String,
    pub(crate) keys: Option<String>,
    #[serde(default)]
    keys_off: Vec<String>,
    #[serde(default)]
    pub(crate) on: Vec<String>,
    /// On macOS the app's own item, not the predefined one.
    #[serde(default)]
    pub(crate) mac_own: bool,
    #[serde(default)]
    pub(crate) check: bool,
    /// Needs a window: with none open, one is opened to run it.
    #[serde(default)]
    pub(crate) or_open: bool,
}

pub(crate) static TABLE: LazyLock<Table> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../src/registry/menu/menu.json")).expect("menu.json")
});

pub(crate) const PLATFORM: &str = if cfg!(target_os = "macos") {
    "mac"
} else if cfg!(windows) {
    "windows"
} else {
    "linux"
};

/// Whether something limited to `on` exists on this platform.
pub(crate) fn here(on: &[String]) -> bool {
    on.is_empty() || on.iter().any(|p| p == PLATFORM)
}

impl Item {
    /// The key its label is sent under: its id, or "predefined:<name>".
    pub(crate) fn label_key(&self) -> String {
        match (&self.id, &self.predefined) {
            (Some(id), _) => id.clone(),
            (None, Some(name)) => format!("predefined:{name}"),
            (None, None) => String::new(),
        }
    }

    /// Its accelerator as muda reads it ("mod+shift+s" -> "CmdOrCtrl+shift+s"),
    /// unless this platform goes without.
    pub(crate) fn accelerator(&self) -> Option<String> {
        if self.keys_off.iter().any(|p| p == PLATFORM) {
            return None;
        }
        self.keys.as_deref().map(accelerator)
    }
}

/// A stored combo as muda reads it; muda ignores case. `mod`, never Cmd: muda
/// maps a bare CMD to SUPER, the Windows key on Windows.
pub(crate) fn accelerator(combo: &str) -> String {
    combo
        .split('+')
        .map(|part| match part {
            "mod" => "CmdOrCtrl",
            "ctrl" => "Ctrl",
            "alt" => "Alt",
            "shift" => "Shift",
            "meta" => "Super",
            key => key,
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// A text the menus show that is no item of the bar ("recent-none"…), in English.
pub(crate) fn text_en(key: &str) -> &'static str {
    TABLE
        .texts
        .iter()
        .find(|text| text.key == key)
        .map_or("", |text| text.en.as_str())
}

/// Every item of the bar with an id, for dispatch.
pub(crate) fn find_item(id: &str) -> Option<&'static Item> {
    fn walk<'a>(nodes: &'a [Node], id: &str) -> Option<&'a Item> {
        nodes.iter().find_map(|node| match node {
            Node::Menu(menu) => walk(&menu.items, id),
            Node::Item(item) if item.id.as_deref() == Some(id) => Some(item),
            _ => None,
        })
    }
    TABLE.bar.iter().find_map(|menu| walk(&menu.items, id))
}

/// The app's name where the English says `{name}`.
pub(crate) fn named(text: &str) -> String {
    text.replace("{name}", crate::app_identity::APP_NAME)
}

/// A macOS-own item (Undo, Redo, Select All) by the name it runs under.
pub(crate) fn find_own(name: &str) -> Option<&'static Item> {
    if PLATFORM != "mac" {
        return None;
    }
    fn walk<'a>(nodes: &'a [Node], name: &str) -> Option<&'a Item> {
        nodes.iter().find_map(|node| match node {
            Node::Menu(menu) => walk(&menu.items, name),
            Node::Item(item) if item.mac_own && item.predefined.as_deref() == Some(name) => {
                Some(item)
            }
            _ => None,
        })
    }
    TABLE.bar.iter().find_map(|menu| walk(&menu.items, name))
}
