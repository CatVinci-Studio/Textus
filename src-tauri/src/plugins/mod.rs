//! Plugins (docs/design/plugins.md): which are installed, which are on and
//! what each was granted, and the calls a plugin's code makes that need
//! more than the window - its own files, the open folder, the network, its
//! storage.
//!
//! A plugin's code never calls these itself: it runs in a sandboxed frame
//! with no access to Tauri, and asks the app window (src/plugins/broker.ts),
//! which checks the call and makes it here. The checks are made again here
//! all the same - the grant from `state.json`, the path inside the folder it
//! was given - so a mistake in the window can't hand a plugin more than the
//! user granted.
//!
//! On disk, in the app's data folder:
//!
//!   plugins/state.json           every plugin's switch and grants, and the
//!                                switch for all of them
//!   plugins/<id>/                an installed plugin's files
//!   plugin-data/<id>/storage.json  what an older plugin kept, no longer read
//!
//! What a plugin keeps now is store.rs's: `<config>/textus/plugins/<id>/`
//! and a project's `.textus/plugins/<id>/`. Official plugins are installed
//! from the catalog (catalog.rs) like any other. A plugin loaded from a
//! folder in developer mode stays where it is: `state.json` names its path.

pub mod access;
pub mod ai_tools;
pub mod catalog;
pub mod files;
pub mod install;
pub mod metadata;
pub mod moved_skills;
pub mod read_tool;
pub mod state;
pub mod store;
pub mod workspace;

/// The app's invoke handler with every plugin command (the shared ones,
/// desktop and iOS) in front of the commands lib.rs lists: the plugin
/// API's commands stay beside the code that answers them.
#[macro_export]
macro_rules! with_plugin_commands {
    ($($rest:tt)*) => {
        tauri::generate_handler![
            $crate::plugins::state::plugins_state,
            $crate::plugins::state::plugins_set_all,
            $crate::plugins::state::plugin_set,
            $crate::plugins::install::plugins_installed,
            $crate::plugins::install::plugin_install,
            $crate::plugins::install::plugin_install_files,
            $crate::plugins::catalog::plugin_catalog,
            $crate::plugins::catalog::plugin_catalog_cached,
            $crate::plugins::catalog::skill_catalog,
            $crate::plugins::catalog::skill_install_catalog,
            $crate::plugins::access::plugin_fs_rename,
            $crate::plugins::access::plugin_fs_trash,
            $crate::plugins::access::plugin_fs_mkdir,
            $crate::plugins::files::plugin_fs_stat,
            $crate::plugins::files::plugin_fs_create,
            $crate::plugins::files::plugin_fs_read_versioned,
            $crate::plugins::files::plugin_fs_write_if,
            $crate::plugins::files::plugin_secret_get,
            $crate::plugins::files::plugin_secret_set,
            $crate::plugins::metadata::plugin_metadata_all,
            $crate::plugins::metadata::plugin_metadata_get,
            $crate::plugins::catalog::plugin_install_catalog,
            $crate::plugins::install::plugin_load_dev,
            $crate::plugins::install::plugin_uninstall,
            $crate::plugins::access::plugin_file,
            $crate::plugins::access::plugin_read_resource,
            $crate::plugins::access::plugin_fs_read,
            $crate::plugins::access::plugin_fs_list,
            $crate::plugins::workspace::plugin_fs_documents,
            $crate::plugins::workspace::plugin_fs_search,
            $crate::plugins::access::plugin_fs_write,
            $crate::plugins::access::plugin_http,
            $crate::plugins::install::plugin_dev_stamp,
            $crate::plugins::ai_tools::plugin_ai_tools_set,
            $crate::plugins::ai_tools::plugin_ai_tool_result,
            $crate::plugins::store::plugin_store_get,
            $crate::plugins::store::plugin_store_set,
            $crate::plugins::store::plugin_store_keys,
            $crate::plugins::store::plugin_store_read,
            $crate::plugins::store::plugin_store_write,
            $crate::plugins::store::plugin_store_files,
            $crate::plugins::store::plugin_store_delete,
            $crate::plugins::store::plugin_store_usage,
            $crate::plugins::store::plugin_store_clear,
            $($rest)*
        ]
    };
}

use std::path::PathBuf;
use tauri::Manager;

/// The manifest's file name in a plugin's folder.
pub const MANIFEST: &str = "textus-plugin.json";

/// `plugins/` in the app's data folder.
fn plugins_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins"))
}

/// `plugin-data/<id>/` in the app's data folder.
fn data_dir(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    require_id(id)?;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugin-data")
        .join(id))
}

/// A plugin id is `publisher.name`, lowercase letters, digits and dashes:
/// safe as a folder name on every system, never `..` or a separator.
pub fn require_id(id: &str) -> Result<(), String> {
    let valid = |part: &str| {
        !part.is_empty()
            && part.len() <= 64
            && part
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            && !part.starts_with('-')
    };
    match id.split_once('.') {
        Some((publisher, name)) if valid(publisher) && valid(name) => Ok(()),
        _ => Err(format!("\"{id}\" is not a plugin id (publisher.name).")),
    }
}

#[cfg(test)]
mod tests {
    use super::require_id;

    #[test]
    fn an_id_is_publisher_dot_name() {
        assert!(require_id("catvinci.pdf-viewer").is_ok());
        assert!(require_id("a1.b2").is_ok());
        for bad in [
            "pdf",
            "Catvinci.pdf",
            "catvinci.",
            ".pdf",
            "catvinci.pdf.viewer",
            "../x.y",
            "a.b/c",
            "a.-b",
        ] {
            assert!(require_id(bad).is_err(), "{bad}");
        }
    }
}
