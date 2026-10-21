//! Installing a plugin from a folder or a `.textusplugin` file (a zip of
//! one), loading a folder in developer mode, listing what is installed and
//! uninstalling.
//!
//! The manifest is read here only for its id and version - enough to know
//! where the plugin goes. The window checks the rest of it
//! (src/plugins/manifest.ts) before anything of the plugin runs.

use super::state::{self, PluginEntry};
use super::{data_dir, plugins_root, require_id, MANIFEST};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};

/// A package bigger than this, unpacked, is refused.
const MAX_PACKAGE_BYTES: u64 = 200 * 1024 * 1024;

/// One installed plugin, as Settings › Plugins lists it.
#[derive(Serialize, Clone, Debug)]
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
struct ManifestId {
    id: String,
    version: String,
}

/// A folder's manifest, with its id checked.
fn read_manifest(dir: &Path) -> Result<(ManifestId, String), String> {
    let text = std::fs::read_to_string(dir.join(MANIFEST))
        .map_err(|_| format!("No {MANIFEST} in {}.", dir.display()))?;
    let head: ManifestId =
        serde_json::from_str(&text).map_err(|e| format!("{MANIFEST}: {e}"))?;
    require_id(&head.id)?;
    if head.version.trim().is_empty() {
        return Err(format!("{MANIFEST}: no version."));
    }
    Ok((head, text))
}

fn installed(id: String, dir: &Path, manifest: String, dev: bool) -> InstalledPlugin {
    InstalledPlugin {
        id,
        dir: dir.to_string_lossy().to_string(),
        manifest,
        dev,
    }
}

/// Every installed plugin: the folders under `plugins/` and the developer
/// folders `state.json` names. One whose manifest can't be read is left
/// out; a developer folder wins over an installed copy of the same id.
#[tauri::command]
pub fn plugins_installed(app: tauri::AppHandle) -> Result<Vec<InstalledPlugin>, String> {
    let mut out: Vec<InstalledPlugin> = Vec::new();
    for (id, entry) in state::read(&app).plugins {
        if let Some(path) = entry.dev_path {
            if let Ok((head, text)) = read_manifest(Path::new(&path)) {
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
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Copies a plugin folder, or unpacks a `.textusplugin`, into
/// `plugins/<id>/`, replacing an earlier version. Its switch and grants are
/// left as they were: a new plugin starts off, and the window asks for the
/// permissions of one that wants more than it was granted.
#[tauri::command]
pub async fn plugin_install(app: tauri::AppHandle, path: String) -> Result<InstalledPlugin, String> {
    tauri::async_runtime::spawn_blocking(move || install_sync(&app, Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

fn install_sync(app: &tauri::AppHandle, source: &Path) -> Result<InstalledPlugin, String> {
    let root = plugins_root(app)?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    // Unpacked beside where it goes, then renamed into place: a failed
    // install leaves the earlier version as it was.
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
        let (head, text) = read_manifest(&dir)?;
        let target = root.join(&head.id);
        if target.exists() {
            std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&dir, &target).map_err(|e| e.to_string())?;
        // Installed now, so no longer loaded from a developer folder.
        state::update(app, |state| {
            if let Some(entry) = state.plugins.get_mut(&head.id) {
                entry.dev_path = None;
            }
        })?;
        Ok(installed(head.id, &target, text, false))
    })();
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
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
        _ => Err(format!("No {MANIFEST} in the package.")),
    }
}

fn copy_dir(from: &Path, to: &Path, total: &mut u64) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
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
                return Err("The plugin is too big.".to_string());
            }
            std::fs::copy(entry.path(), target).map_err(|e| e.to_string())?;
        }
        // Symbolic links are left out: one could point anywhere.
    }
    Ok(())
}

fn unzip(file: &Path, to: &Path) -> Result<(), String> {
    let reader = std::fs::File::open(file).map_err(|e| e.to_string())?;
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|_| "Not a plugin package (.textusplugin).".to_string())?;
    let mut total = 0u64;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // A name with `..` or an absolute path would land outside `to`.
        let Some(rel) = entry.enclosed_name() else {
            return Err("The package names a file outside itself.".to_string());
        };
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
            return Err("The plugin is too big.".to_string());
        }
        std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Settings › Plugins › Load a plugin folder…: the plugin runs from where it
/// is, so a change to its files shows on reload. It starts off, like any
/// new plugin.
#[tauri::command]
pub fn plugin_load_dev(app: tauri::AppHandle, path: String) -> Result<InstalledPlugin, String> {
    let dir = PathBuf::from(&path);
    let (head, text) = read_manifest(&dir)?;
    let id = head.id.clone();
    state::update(&app, |state| {
        state
            .plugins
            .entry(id)
            .or_insert_with(PluginEntry::default)
            .dev_path = Some(path.clone());
    })?;
    Ok(installed(head.id, &dir, text, true))
}

/// Removes a plugin: its entry, its storage and - unless it was loaded from
/// a developer's folder, which is theirs - its files.
#[tauri::command]
pub fn plugin_uninstall(app: tauri::AppHandle, id: String) -> Result<(), String> {
    require_id(&id)?;
    state::update(&app, |state| {
        state.plugins.remove(&id);
    })?;
    let target = plugins_root(&app)?.join(&id);
    if target.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    let data = data_dir(&app, &id)?;
    if data.is_dir() {
        std::fs::remove_dir_all(&data).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The picker for Install from file… (a `.textusplugin`) or, with
/// `folder`, Load a plugin folder….
#[cfg(desktop)]
#[tauri::command]
pub async fn plugin_pick_package(
    window: tauri::WebviewWindow,
    folder: bool,
    filter_name: String,
) -> Option<String> {
    use crate::commands::fs::window_file_dialog;
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = window_file_dialog(&window);
        if folder {
            dialog.blocking_pick_folder().map(|p| p.to_string())
        } else {
            dialog
                .add_filter(&filter_name, &["textusplugin", "zip"])
                .blocking_pick_file()
                .map(|p| p.to_string())
        }
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn manifest(dir: &Path, id: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join(MANIFEST),
            format!(r#"{{"id":"{id}","version":"1.0.0","name":"X"}}"#),
        )
        .unwrap();
    }

    #[test]
    fn a_manifest_needs_a_good_id_and_a_version() {
        let tmp = tempfile::tempdir().unwrap();
        manifest(tmp.path(), "a.b");
        assert_eq!(read_manifest(tmp.path()).unwrap().0.id, "a.b");
        manifest(tmp.path(), "../evil");
        assert!(read_manifest(tmp.path()).is_err());
        std::fs::write(tmp.path().join(MANIFEST), r#"{"id":"a.b","version":" "}"#).unwrap();
        assert!(read_manifest(tmp.path()).is_err());
    }

    #[test]
    fn a_package_may_hold_the_plugin_or_its_folder() {
        let tmp = tempfile::tempdir().unwrap();
        manifest(tmp.path(), "a.b");
        assert_eq!(plugin_dir_in(tmp.path()).unwrap(), tmp.path());
        let outer = tempfile::tempdir().unwrap();
        manifest(&outer.path().join("inner"), "a.b");
        assert_eq!(plugin_dir_in(outer.path()).unwrap(), outer.path().join("inner"));
        let empty = tempfile::tempdir().unwrap();
        assert!(plugin_dir_in(empty.path()).is_err());
    }

    #[test]
    fn a_zip_naming_a_file_outside_itself_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("bad.textusplugin");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&file).unwrap());
        zip.start_file("../escape.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"x").unwrap();
        zip.finish().unwrap();
        let out = tmp.path().join("out");
        assert!(unzip(&file, &out).is_err());
        assert!(!tmp.path().join("escape.txt").exists());
    }

    #[test]
    fn a_zip_unpacks_its_files() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("ok.textusplugin");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&file).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file(MANIFEST, options).unwrap();
        zip.write_all(br#"{"id":"a.b","version":"1.0.0"}"#).unwrap();
        zip.start_file("dist/host.js", options).unwrap();
        zip.write_all(b"1").unwrap();
        zip.finish().unwrap();
        let out = tmp.path().join("out");
        unzip(&file, &out).unwrap();
        assert!(out.join("dist/host.js").is_file());
        assert_eq!(plugin_dir_in(&out).unwrap(), out);
    }
}
