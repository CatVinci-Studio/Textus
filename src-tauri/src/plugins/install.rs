//! Installing a plugin from a folder or a `.textusplugin` zip, listing and
//! uninstalling. A manifest is checked in full
//! (`manifest::check`) before a plugin is put in place or loaded; listing
//! reads only its id and version, so Settings can still show what is wrong.

use super::state;
use super::{data_dir, plugins_root, require_id, MANIFEST};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};

/// A package bigger than this, unpacked, is refused.
pub(super) const MAX_PACKAGE_BYTES: u64 = 200 * 1024 * 1024;

/// One installed plugin, as Settings › Plugins lists it.
#[derive(Serialize, Clone, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub id: String,
    /// Where its files are.
    pub dir: String,
    /// `textus-plugin.json` as written.
    pub manifest: String,
    /// Loaded from a folder in developer mode, not copied in.
    pub dev: bool,
}

#[derive(Deserialize)]
pub(super) struct ManifestId {
    pub(super) id: String,
    version: String,
}

/// A folder's manifest, with its id checked: enough to list it.
fn read_manifest(dir: &Path) -> Result<(ManifestId, String), String> {
    let text = std::fs::read_to_string(dir.join(MANIFEST))
        .map_err(|_| format!("No {MANIFEST} in {}.", dir.display()))?;
    let head: ManifestId = serde_json::from_str(&text).map_err(|e| format!("{MANIFEST}: {e}"))?;
    require_id(&head.id)?;
    if head.version.trim().is_empty() {
        return Err(format!("{MANIFEST}: no version."));
    }
    Ok((head, text))
}

/// A folder's manifest, checked in full: what installing or loading needs.
pub(super) fn read_checked_manifest(dir: &Path) -> Result<(ManifestId, String), String> {
    let (head, text) = read_manifest(dir)?;
    super::manifest::check(&text).map_err(|e| format!("{MANIFEST}: {e}"))?;
    Ok((head, text))
}

/// The programs a manifest's agents run: `contributes.agents`, as written.
fn agent_commands(manifest: &str) -> String {
    serde_json::from_str::<serde_json::Value>(manifest)
        .ok()
        .and_then(|m| m.pointer("/contributes/agents").map(|a| a.to_string()))
        .unwrap_or_default()
}

pub(super) fn installed(id: String, dir: &Path, manifest: String, dev: bool) -> InstalledPlugin {
    InstalledPlugin {
        id,
        dir: dir.to_string_lossy().to_string(),
        manifest,
        dev,
    }
}

/// Every installed plugin: `plugins/` and the developer folders in
/// `state.json`. Unreadable manifests are left out; a developer folder wins.
#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn plugins_installed(app: tauri::AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    let mut out: Vec<InstalledPlugin> = Vec::new();
    for (id, entry) in state::read(&app).plugins {
        if let Some(path) = entry.dev_path {
            // Checked again each time: its author may have changed it.
            if let Ok((head, text)) = read_checked_manifest(Path::new(&path)) {
                if head.id == id {
                    out.push(installed(id, Path::new(&path), text, true));
                }
            }
        }
    }
    let root = plugins_root(&app)?;
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.flatten() {
            let dir = entry.path();
            let Some(name) = dir.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !dir.is_dir() || require_id(name).is_err() || out.iter().any(|p| p.id == name) {
                continue;
            }
            if let Ok((head, text)) = read_manifest(&dir) {
                if head.id == name {
                    out.push(installed(head.id, &dir, text, false));
                }
            }
        }
    }
    for script in super::scripts::scripts(&app) {
        if !out.iter().any(|p| p.id == script.id) {
            out.push(script);
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Copies a plugin folder or unpacks a `.textusplugin` into `plugins/<id>/`,
/// replacing an earlier version. Its switch and grants are left as they were.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_install(
    app: tauri::AppHandle,
    path: String,
) -> Result<InstalledPlugin, String> {
    tauri::async_runtime::spawn_blocking(move || install_sync(&app, Path::new(&path), Origin::File))
        .await
        .map_err(|e| e.to_string())?
}

/// Where a package came from: the catalog's is the plugin it says it is.
#[derive(Clone, Copy, PartialEq)]
pub(super) enum Origin {
    File,
    Catalog,
}

pub(super) fn install_sync(
    app: &tauri::AppHandle,
    source: &Path,
    origin: Origin,
) -> Result<InstalledPlugin, String> {
    let root = plugins_root(app)?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    // Unpacked beside where it goes, then renamed into place, so a failed install
    // leaves the earlier version.
    let staging = root.join(format!(
        ".installing-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let result = (|| {
        if source.is_dir() {
            copy_dir(source, &staging, &mut 0)?;
        } else {
            unzip(source, &staging)?;
        }
        // A zip may hold the plugin's folder rather than its files.
        let dir = plugin_dir_in(&staging)?;
        let (head, text) = read_checked_manifest(&dir)?;
        let target = root.join(&head.id);
        let agents_before = read_manifest(&target)
            .ok()
            .map(|(_, old)| agent_commands(&old));
        swap_in(&dir, &target, &staging.with_extension("old"))?;
        // New programs to run are asked for again, an update or not.
        let agents_changed = agents_before.is_some_and(|before| before != agent_commands(&text));
        // Installed now, so no longer a developer folder, and not Official until the
        // catalog says so. A file is code from anywhere under the same id:
        // off, asked again for what it may do, and given no secret kept for
        // the code before it.
        let from_file = origin == Origin::File;
        let had = state::update(app, |state| {
            state.plugins.get_mut(&head.id).map(|entry| {
                if from_file {
                    entry.enabled = false;
                    entry.granted.clear();
                } else if agents_changed {
                    entry.granted.retain(|g| g != "agents");
                }
                entry.dev_path = None;
                entry.official = false;
            })
        })?;
        if from_file && had.is_some() {
            super::files::forget_secrets(app, &head.id)?;
        }
        Ok(installed(head.id, &target, text, false))
    })();
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    result
}

/// Puts `new` at `target`: the version there is moved aside first and put back
/// if the move in fails, so an update never leaves no version at all.
fn swap_in(new: &Path, target: &Path, aside: &Path) -> Result<(), String> {
    let had = target.exists();
    if had {
        std::fs::rename(target, aside).map_err(|e| e.to_string())?;
    }
    if let Err(e) = std::fs::rename(new, target) {
        if had {
            let _ = std::fs::rename(aside, target);
        }
        return Err(e.to_string());
    }
    if had {
        let _ = std::fs::remove_dir_all(aside);
    }
    Ok(())
}

/// A plugin's files as text, by path in the plugin, as Textus AI writes them.
#[derive(Deserialize, Debug)]
#[cfg_attr(test, derive(specta::Type))]
pub struct PluginFile {
    pub path: String,
    pub text: String,
}

/// The most a plugin made in the conversation may hold, all files together.
const MAX_WRITTEN_BYTES: usize = 2 * 1024 * 1024;

/// Writes `files` into a folder of their own, then installs it as a package
/// is installed, replacing an earlier draft of the same plugin.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_install_files(
    app: tauri::AppHandle,
    files: Vec<PluginFile>,
) -> Result<InstalledPlugin, String> {
    tauri::async_runtime::spawn_blocking(move || install_files_sync(&app, &files))
        .await
        .map_err(|e| e.to_string())?
}

/// Whether `path` is a plain relative path inside the plugin: no root, no
/// `..`, no drive, nothing hidden.
fn plain_relative(path: &str) -> bool {
    let p = Path::new(path);
    !path.is_empty()
        && !path.contains('\\')
        && p.components().all(|c| match c {
            std::path::Component::Normal(name) => !name.to_string_lossy().starts_with('.'),
            _ => false,
        })
}

/// A plugin written in the conversation is the user's own: its id is `local.…`,
/// so it never replaces anyone else's plugin.
fn written_id(manifest: &str) -> Result<String, String> {
    let id = serde_json::from_str::<serde_json::Value>(manifest)
        .ok()
        .and_then(|m| m["id"].as_str().map(str::to_string))
        .ok_or_else(|| format!("{MANIFEST} has no id."))?;
    if !id.starts_with("local.") {
        return Err(format!(
            "A plugin written in the conversation needs an id starting with local. - {id} is someone else's."
        ));
    }
    Ok(id)
}

pub(super) fn install_files_sync(
    app: &tauri::AppHandle,
    files: &[PluginFile],
) -> Result<InstalledPlugin, String> {
    let total: usize = files.iter().map(|f| f.text.len()).sum();
    if total > MAX_WRITTEN_BYTES {
        return Err(crate::errors::error("pluginTooBig"));
    }
    let Some(manifest) = files.iter().find(|f| f.path == MANIFEST) else {
        return Err(crate::errors::error("pluginNoManifest"));
    };
    written_id(&manifest.text)?;
    let root = plugins_root(app)?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let folder = root.join(format!(
        ".written-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let result = (|| {
        for file in files {
            if !plain_relative(&file.path) {
                return Err(crate::errors::error("pluginBadPackage"));
            }
            let target = folder.join(&file.path);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&target, &file.text).map_err(|e| e.to_string())?;
        }
        install_sync(app, &folder, Origin::File)
    })();
    if folder.exists() {
        let _ = std::fs::remove_dir_all(&folder);
    }
    result
}

/// The folder holding the manifest: `dir` itself, or its one subfolder.
fn plugin_dir_in(dir: &Path) -> Result<PathBuf, String> {
    if dir.join(MANIFEST).is_file() {
        return Ok(dir.to_path_buf());
    }
    let subdirs: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    match subdirs.as_slice() {
        [only] if only.join(MANIFEST).is_file() => Ok(only.clone()),
        _ => Err(crate::errors::error("pluginNoManifest")),
    }
}

fn copy_dir(from: &Path, to: &Path, total: &mut u64) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let name = entry.file_name();
        // A developer's checkout: its git folder and installed packages
        // aren't the plugin.
        if name == ".git" || name == "node_modules" {
            continue;
        }
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let target = to.join(&name);
        if file_type.is_dir() {
            copy_dir(&entry.path(), &target, total)?;
        } else if file_type.is_file() {
            *total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            if *total > MAX_PACKAGE_BYTES {
                return Err(crate::errors::error("pluginTooBig"));
            }
            std::fs::copy(entry.path(), target).map_err(|e| e.to_string())?;
        }
        // Symbolic links are left out: one could point anywhere.
    }
    Ok(())
}

fn unzip(file: &Path, to: &Path) -> Result<(), String> {
    let reader = std::fs::File::open(file).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|_| "Not a plugin package (.textusplugin).".to_string())?;
    let mut total = 0u64;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // A name with `..` or an absolute path would land outside `to`.
        let Some(rel) = entry.enclosed_name() else {
            return Err(crate::errors::error("pluginBadPackage"));
        };
        // The folder Finder's Compress adds beside the plugin's own.
        if rel.components().any(|c| c.as_os_str() == "__MACOSX") {
            continue;
        }
        let target = to.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut bytes = Vec::new();
        (&mut entry)
            .take(MAX_PACKAGE_BYTES + 1 - total)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        total += bytes.len() as u64;
        if total > MAX_PACKAGE_BYTES {
            return Err(crate::errors::error("pluginTooBig"));
        }
        std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Removes a plugin: its entry, its storage and, unless loaded from a
/// developer's folder, its files.
#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn plugin_uninstall(app: tauri::AppHandle, id: String) -> Result<(), String> {
    require_id(&id)?;
    state::update(&app, |state| {
        state.plugins.remove(&id);
    })?;
    #[cfg(desktop)]
    crate::schedule::forget_plugin(&app, &id);
    let target = plugins_root(&app)?.join(&id);
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    // Its data may be the user's: to the Trash.
    crate::atomic::to_trash(&data_dir(&app, &id)?)?;
    super::store::forget_global(&app, &id)?;
    // A script's file goes to the Trash, or it would be found again.
    if let Some(file) = super::scripts::script_file(&app, &id) {
        crate::atomic::to_trash(&file)?;
    }
    super::files::forget_secrets(&app, &id)
}

/// The picker for Install from file… (`.textusplugin`s or zips, several at
/// once) or, with `folder`, Load a plugin folder….
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_pick_package(
    window: tauri::WebviewWindow,
    folder: bool,
    filter_name: String,
) -> Option<Vec<String>> {
    use crate::dialogs::window_file_dialog;
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = window_file_dialog(&window);
        if folder {
            dialog.blocking_pick_folder().map(|p| vec![p.to_string()])
        } else {
            dialog
                .add_filter(&filter_name, &["textusplugin", "zip"])
                .blocking_pick_files()
                .map(|ps| ps.iter().map(|p| p.to_string()).collect())
        }
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests;
