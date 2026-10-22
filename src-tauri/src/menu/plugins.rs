//! The Plugins menu: the commands the plugins that are on put there, then
//! Manage Plugins….

use super::*;

/// Whether the bar has a Plugins menu: in a development build, and in a
/// release built with TEXTUS_PLUGINS set - 1.2 ships the plugin system
/// without plugins to install. src/plugins/availability.ts decides the
/// frontend's entries (Settings, the in-window menu) the same way.
pub(crate) const PLUGINS_SHOWN: bool =
    cfg!(debug_assertions) || option_env!("TEXTUS_PLUGINS").is_some();

/// Plugins menu ids carry the command to run: "plugin-command:<command>",
/// a command a plugin added to the menu (src/plugins/manager.ts).
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
}

/// The Plugins submenu and the commands the frontend last put in it, kept
/// so a rebuild of the bar (a new language) fills it again.
#[derive(Default)]
pub(crate) struct PluginMenu {
    pub(crate) submenu: Mutex<Option<Submenu<tauri::Wry>>>,
    items: Mutex<Vec<PluginMenuItem>>,
}

/// Refill the Plugins submenu: the commands plugins put there, then Manage
/// Plugins…. On the main thread, as rebuild_recent_menu.
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
        for entry in &items {
            if let Ok(item) = MenuItemBuilder::with_id(
                format!("{PLUGIN_COMMAND_PREFIX}{}", entry.command),
                menu_text(&entry.label),
            )
            .build(&app)
            {
                let _ = submenu.append(&item);
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

/// The commands the plugins that are on put in the Plugins menu (the
/// frontend's, src/plugins/usePluginMenu.ts), refilled when they change.
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
