//! The Plugins menu: the enabled plugins' commands, then Manage Plugins….

use super::*;

/// Whether the bar has a Plugins menu.
pub(crate) const PLUGINS_SHOWN: bool = true;

/// Plugins menu ids carry the command to run: "plugin-command:<command>".
pub(crate) const PLUGIN_COMMAND_PREFIX: &str = "plugin-command:";
/// Plugins > Manage Plugins…: Settings, at its Plugins page.
pub(crate) const MANAGE_PLUGINS_ID: &str = "manage-plugins";
/// The Plugins menu's line while no plugin adds anything to it.
const NO_PLUGIN_COMMANDS_ID: &str = "plugin-commands-none";

/// One command in the Plugins menu, as the frontend sends it.
#[derive(serde::Deserialize, Clone, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct PluginMenuItem {
    command: String,
    label: String,
    /// The plugin's name: two or more of its commands go in a submenu of it.
    #[serde(default)]
    group: Option<String>,
}

/// The items by plugin, in name order: a plugin's name and its commands.
fn by_plugin(items: &[PluginMenuItem]) -> Vec<(String, Vec<&PluginMenuItem>)> {
    let mut groups: Vec<(String, Vec<&PluginMenuItem>)> = Vec::new();
    for item in items {
        let key = item.group.clone().unwrap_or_else(|| item.label.clone());
        match groups.iter_mut().find(|(name, _)| *name == key) {
            Some((_, list)) => list.push(item),
            None => groups.push((key, vec![item])),
        }
    }
    groups.sort_by_key(|group| group.0.to_lowercase());
    groups
}

/// The Plugins submenu and the commands the frontend last put in it, kept so a
/// rebuild (a new language) fills it again.
#[derive(Default)]
pub(crate) struct PluginMenu {
    pub(crate) submenu: Mutex<Option<Submenu<tauri::Wry>>>,
    items: Mutex<Vec<PluginMenuItem>>,
}

/// Refill the Plugins submenu, on the main thread.
pub(crate) fn rebuild_plugin_menu(app: &tauri::AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(state) = app.try_state::<PluginMenu>() else {
            return;
        };
        let guard = state.submenu.lock().unwrap();
        let Some(submenu) = guard.as_ref() else {
            return;
        };
        let items = state.items.lock().unwrap().clone();
        let labels = app
            .try_state::<MenuLabels>()
            .map(|state| state.0.lock().unwrap().clone())
            .unwrap_or_default();
        if let Ok(old) = submenu.items() {
            for item in old {
                let _ = submenu.remove(&item);
            }
        }
        if items.is_empty() {
            if let Ok(item) = MenuItemBuilder::with_id(
                NO_PLUGIN_COMMANDS_ID,
                label(&labels, NO_PLUGIN_COMMANDS_ID, "No Plugin Commands"),
            )
            .enabled(false)
            .build(&app)
            {
                let _ = submenu.append(&item);
            }
        }
        let command = |entry: &PluginMenuItem| {
            MenuItemBuilder::with_id(
                format!("{PLUGIN_COMMAND_PREFIX}{}", entry.command),
                menu_text(&entry.label),
            )
            .build(&app)
        };
        for (name, entries) in by_plugin(&items) {
            if entries.len() == 1 {
                if let Ok(item) = command(entries[0]) {
                    let _ = submenu.append(&item);
                }
                continue;
            }
            let mut inner = SubmenuBuilder::new(&app, menu_text(&name));
            for entry in entries {
                if let Ok(item) = command(entry) {
                    inner = inner.item(&item);
                }
            }
            if let Ok(inner) = inner.build() {
                let _ = submenu.append(&inner);
            }
        }
        if let Ok(sep) = PredefinedMenuItem::separator(&app) {
            let _ = submenu.append(&sep);
        }
        if let Ok(item) = MenuItemBuilder::with_id(
            MANAGE_PLUGINS_ID,
            label(&labels, MANAGE_PLUGINS_ID, "Manage Plugins…"),
        )
        .build(&app)
        {
            let _ = submenu.append(&item);
        }
    });
}

/// The commands the enabled plugins put in the Plugins menu, refilled when they
/// change.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn set_plugin_menu(app: AppHandle, items: Vec<PluginMenuItem>) {
    let Some(state) = app.try_state::<PluginMenu>() else {
        return;
    };
    {
        let mut current = state.items.lock().unwrap();
        if *current == items {
            return;
        }
        *current = items;
    }
    rebuild_plugin_menu(&app);
}
