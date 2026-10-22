//! `plugins/state.json`: the switch for every plugin, and per plugin
//! whether it is on, the permissions the user granted it and, for one
//! loaded from a folder in developer mode, that folder.
//!
//! Only the app's own Settings writes it (Settings › Plugins and the
//! permission dialog, src/plugins/); a plugin can't reach these commands.

use super::{plugins_root, require_id};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Mutex;

/// One write at a time: two windows turning plugins on at once would
/// otherwise each write the file from what it read before the other.
static WRITING: Mutex<()> = Mutex::new(());

fn on() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginsState {
    /// Settings › Plugins › Plugins: off stops every plugin at once.
    #[serde(default = "on")]
    pub all_on: bool,
    #[serde(default)]
    pub plugins: BTreeMap<String, PluginEntry>,
}

impl Default for PluginsState {
    fn default() -> Self {
        Self {
            all_on: true,
            plugins: BTreeMap::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    #[serde(default)]
    pub enabled: bool,
    /// Permissions as the manifest names them: "workspace.read",
    /// "network:api.zotero.org".
    #[serde(default)]
    pub granted: Vec<String>,
    /// A plugin loaded from a folder in developer mode: that folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dev_path: Option<String>,
    /// Installed from the catalog as CatVinci's own (catalog.rs): Settings
    /// marks it Official. Never set by the window.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub official: bool,
}

impl PluginsState {
    /// Whether `id` is on and was granted `permission` - what every
    /// privileged call checks first.
    pub fn allows(&self, id: &str, permission: &str) -> bool {
        self.all_on
            && self
                .plugins
                .get(id)
                .is_some_and(|p| p.enabled && p.granted.iter().any(|g| g == permission))
    }

    /// Whether `id` is on at all.
    pub fn runs(&self, id: &str) -> bool {
        self.all_on && self.plugins.get(id).is_some_and(|p| p.enabled)
    }
}

/// The state on disk; the default (every plugin off, the switch on) when
/// there is none yet or it can't be read.
pub fn read(app: &tauri::AppHandle) -> PluginsState {
    plugins_root(app)
        .ok()
        .and_then(|root| std::fs::read(root.join("state.json")).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// Reads the state, changes it and writes it back, as one step.
pub fn update<T>(
    app: &tauri::AppHandle,
    change: impl FnOnce(&mut PluginsState) -> T,
) -> Result<T, String> {
    let _guard = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let mut state = read(app);
    let out = change(&mut state);
    let root = plugins_root(app)?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
    crate::atomic::write_sync(&root.join("state.json"), json).map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
pub fn plugins_state(app: tauri::AppHandle) -> PluginsState {
    read(&app)
}

/// Settings › Plugins › Plugins, the switch for all of them.
#[tauri::command]
pub fn plugins_set_all(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    update(&app, |state| state.all_on = on)
}

/// Turns a plugin on or off with the permissions the user granted it -
/// Settings' switch and the permission dialog. A developer-mode folder is
/// kept.
#[tauri::command]
pub fn plugin_set(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
    granted: Vec<String>,
) -> Result<(), String> {
    require_id(&id)?;
    update(&app, |state| {
        let entry = state.plugins.entry(id).or_default();
        entry.enabled = enabled;
        entry.granted = granted;
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(all_on: bool, enabled: bool, granted: &[&str]) -> PluginsState {
        let mut plugins = BTreeMap::new();
        plugins.insert(
            "a.b".to_string(),
            PluginEntry {
                enabled,
                granted: granted.iter().map(|g| g.to_string()).collect(),
                dev_path: None,
                official: false,
            },
        );
        PluginsState { all_on, plugins }
    }

    #[test]
    fn a_call_is_allowed_only_on_a_running_plugin_with_the_grant() {
        assert!(state(true, true, &["workspace.read"]).allows("a.b", "workspace.read"));
        assert!(!state(true, true, &["workspace.read"]).allows("a.b", "workspace.write"));
        assert!(!state(true, false, &["workspace.read"]).allows("a.b", "workspace.read"));
        assert!(!state(false, true, &["workspace.read"]).allows("a.b", "workspace.read"));
        assert!(!state(true, true, &["workspace.read"]).allows("c.d", "workspace.read"));
    }

    #[test]
    fn a_missing_or_partial_file_reads_as_everything_off() {
        let empty: PluginsState = serde_json::from_str("{}").unwrap();
        assert_eq!(empty, PluginsState::default());
        assert!(empty.all_on);
        let partial: PluginsState =
            serde_json::from_str(r#"{"plugins":{"a.b":{"enabled":true}}}"#).unwrap();
        assert!(partial.runs("a.b"));
        assert!(!partial.allows("a.b", "workspace.read"));
    }
}
