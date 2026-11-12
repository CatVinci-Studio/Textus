//! Developer mode: a plugin loaded from its folder, run from there and
//! reloaded when the folder changes.

use super::install::{installed, read_checked_manifest, InstalledPlugin};
use super::require_id;
use super::state::{self, PluginEntry};
use std::path::PathBuf;

/// Load a plugin folder…: the plugin runs from where it is, so changes show on
/// reload. It starts off, like any new plugin - over one already here as
/// well: other code under its id gets none of its permissions or secrets.
#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn plugin_load_dev(app: tauri::AppHandle, path: String) -> Result<InstalledPlugin, String> {
    let dir = PathBuf::from(&path);
    let (head, text) = read_checked_manifest(&dir)?;
    let id = head.id.clone();
    let other_code = state::update(&app, |state| {
        let entry = state.plugins.entry(id.clone()).or_default();
        let other = entry.dev_path.as_deref() != Some(path.as_str());
        if other {
            *entry = PluginEntry {
                dev_path: Some(path.clone()),
                ..PluginEntry::default()
            };
        }
        other
    })?;
    if other_code {
        super::files::forget_secrets(&app, &id)?;
    }
    Ok(installed(head.id, &dir, text, true))
}

/// When a developer's plugin folder last changed (newest file, in ms, ignoring
/// node_modules and .git), so the window reloads it. None for other plugins.
#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn plugin_dev_stamp(app: tauri::AppHandle, id: String) -> Result<Option<f64>, String> {
    require_id(&id)?;
    let state = state::read(&app);
    if let Some(path) = state.plugins.get(&id).and_then(|p| p.dev_path.clone()) {
        return Ok(newest_change(&PathBuf::from(path), 0));
    }
    // A script runs from the scripts folder: a change to one of them
    // reloads it.
    Ok(super::scripts::script_file(&app, &id)
        .and_then(|_| super::scripts::scripts_dir(&app).ok())
        .and_then(|dir| newest_change(&dir, 0)))
}

fn newest_change(dir: &std::path::Path, depth: usize) -> Option<f64> {
    if depth > 6 {
        return None;
    }
    let mut newest: Option<f64> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "node_modules" || name == "dist" {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let here = if meta.is_dir() {
            newest_change(&entry.path(), depth + 1)
        } else {
            meta.modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
        };
        newest = match (newest, here) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
    }
    newest
}
