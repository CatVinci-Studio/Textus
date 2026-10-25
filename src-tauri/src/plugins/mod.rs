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
pub mod install;
pub mod state;
pub mod store;
pub mod workspace;

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
