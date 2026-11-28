//! What a running plugin may reach, each checked against `state.json`: its own
//! files, the file its custom editor opened, the open folder (with `files.*`),
//! granted network hosts (http.rs), and its own storage. Bytes go back as raw IPC responses.

use super::state::{self, PluginsState};
use super::{plugins_root, require_id};
use crate::app_dirs::AppDirs;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::ipc::Response;
use tauri::Manager;

/// The most a read hands over at once.
pub(super) const MAX_READ_BYTES: u64 = 256 * 1024 * 1024;
pub(crate) fn refused(id: &str, permission: &str) -> String {
    format!("{id} was not granted {permission}.")
}

pub(super) fn running(state: &PluginsState, id: &str) -> Result<(), String> {
    require_id(id)?;
    if state.runs(id) {
        Ok(())
    } else {
        Err(format!("{id} is turned off."))
    }
}

/// The app's own folders (other plugins' storage, settings, keys), which no
/// plugin reaches through the workspace calls.
/// `path` for plugin `id` to use with `permission`: granted, inside `root`
/// and none of the app's own data.
pub(super) fn granted_path(
    app: &tauri::AppHandle,
    id: &str,
    permission: &str,
    root: &str,
    path: &str,
) -> Result<PathBuf, String> {
    let path = folder_path(&state::read(app), id, permission, root, path)?;
    require_not_app_data(app, &path)?;
    Ok(path)
}

/// [`granted_path`] but for the app's own data: granted, in the folder,
/// nothing hidden but what every plugin reads and the hidden files this
/// one was granted by name (`hidden:<path>`), those only to read.
pub(super) fn folder_path(
    state: &PluginsState,
    id: &str,
    permission: &str,
    root: &str,
    path: &str,
) -> Result<PathBuf, String> {
    if !state.allows(id, permission) {
        return Err(refused(id, permission));
    }
    let open_hidden = |rel: &str| {
        paths::read_only_hidden("", rel)
            || (paths::hidden_file_path(rel) && state.allows(id, &format!("hidden:{rel}")))
    };
    let path = if permission == "files.read" && open_hidden(&paths::relative(root, path)) {
        let resolved = inside(Path::new(root), Path::new(path))?;
        // A link there leads to what plugins may read anyway, never to
        // another hidden file (.env).
        let base = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
        let rel = resolved.strip_prefix(&base).unwrap_or(&resolved);
        if open_hidden(&rel.to_string_lossy().replace('\\', "/")) {
            resolved
        } else {
            plugin_path(Path::new(root), &resolved, id)?
        }
    } else {
        plugin_path(Path::new(root), Path::new(path), id)?
    };
    Ok(path)
}

/// A folder a plugin reads: it holds `files.read` (the app's own AI tools
/// ask as `textus`, which no plugin is), the folder is there, and it is
/// not one of the app's own.
pub(super) fn checked_root(app: &tauri::AppHandle, id: &str, root: &str) -> Result<(), String> {
    if id != super::app_tools::APP && !state::read(app).allows(id, "files.read") {
        return Err(refused(id, "files.read"));
    }
    if root.is_empty() || !Path::new(root).is_dir() {
        return Err(crate::errors::error("noFolder"));
    }
    require_not_app_data(app, Path::new(root))
}

pub(super) fn require_not_app_data(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let own = [app.path().own_data_dir(), app.path().own_config_dir()];
    for dir in own.into_iter().flatten() {
        let dir = std::fs::canonicalize(&dir).unwrap_or(dir);
        if path.starts_with(&dir) {
            return Err("The app's own files are not part of the folder.".to_string());
        }
    }
    Ok(())
}

/// Where a plugin's own files are: its developer folder or `plugins/<id>/`.
pub(crate) fn plugin_home(
    app: &tauri::AppHandle,
    state: &PluginsState,
    id: &str,
) -> Result<PathBuf, String> {
    require_id(id)?;
    if let Some(path) = state.plugins.get(id).and_then(|p| p.dev_path.clone()) {
        return Ok(PathBuf::from(path));
    }
    let installed = plugins_root(app)?.join(id);
    if !installed.is_dir() && super::scripts::script_file(app, id).is_some() {
        return super::scripts::scripts_dir(app);
    }
    Ok(installed)
}

pub(super) async fn read_bytes(path: PathBuf) -> Result<Response, String> {
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| e.to_string())?;
    if meta.len() > MAX_READ_BYTES {
        return Err(crate::errors::error("fileTooBig"));
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// One of the plugin's own files. Read even while it is off, so Settings can
/// show its icon.
#[tauri::command]
pub async fn plugin_file(
    app: tauri::AppHandle,
    id: String,
    rel: String,
) -> Result<Response, String> {
    let state = state::read(&app);
    let home = plugin_home(&app, &state, &id)?;
    let path = inside(&home, Path::new(&rel))?;
    read_bytes(path).await
}

/// The file a custom editor was opened on, which the user chose to open.
#[tauri::command]
pub async fn plugin_read_resource(
    app: tauri::AppHandle,
    id: String,
    path: String,
) -> Result<Response, String> {
    running(&state::read(&app), &id)?;
    let path = PathBuf::from(path);
    require_not_app_data(
        &app,
        &std::fs::canonicalize(&path).map_err(|e| e.to_string())?,
    )?;
    read_bytes(path).await
}

#[tauri::command]
pub async fn plugin_fs_read(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
) -> Result<Response, String> {
    let path = granted_path(&app, &id, "files.read", &root, &path)?;
    read_bytes(path).await
}

/// One entry of a folder listing.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified_ms: Option<f64>,
}

impl FsEntry {
    pub(crate) fn of(name: String, path: &Path, meta: &std::fs::Metadata) -> Self {
        FsEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified_ms: crate::walk::modified_ms(meta),
        }
    }
}

/// A folder's entries, hidden ones left out.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_list(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
) -> Result<Vec<FsEntry>, String> {
    if !state::read(&app).allows(&id, "files.read") {
        return Err(refused(&id, "files.read"));
    }
    let dir = plugin_path(Path::new(&root), Path::new(&path), &id)?;
    require_not_app_data(&app, &dir)?;
    let mut reader = tokio::fs::read_dir(&dir).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(entry) = reader.next_entry().await.map_err(|e| e.to_string())? {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = entry.metadata().await else {
            continue;
        };
        out.push(FsEntry::of(name, &entry.path(), &meta));
    }
    out.sort_by_key(|e| e.name.to_lowercase());
    Ok(out)
}

/// Writes a file in the folder, making the folders it is in. `contents` is
/// text, or base64 with `base64`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_write(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
    contents: String,
    base64: Option<bool>,
) -> Result<(), String> {
    let path = granted_path(&app, &id, "files.write", &root, &path)?;
    let bytes = if base64.unwrap_or(false) {
        use base64::{engine::general_purpose::STANDARD, Engine};
        STANDARD.decode(contents).map_err(|e| e.to_string())?
    } else {
        contents.into_bytes()
    };
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    crate::atomic::write(&path, bytes)
        .await
        .map_err(|e| e.to_string())
}

/// Renames or moves a file or folder within the folder. Refuses to put it
/// over something that is there.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_rename(
    app: tauri::AppHandle,
    id: String,
    root: String,
    from: String,
    to: String,
) -> Result<(), String> {
    if !state::read(&app).allows(&id, "files.write") {
        return Err(refused(&id, "files.write"));
    }
    let root = Path::new(&root);
    let from = plugin_path(root, Path::new(&from), &id)?;
    let to = plugin_path(root, Path::new(&to), &id)?;
    require_not_app_data(&app, &from)?;
    require_not_app_data(&app, &to)?;
    // A change of case only is the same file on macOS and Windows.
    let case_only = to.to_string_lossy().to_lowercase() == from.to_string_lossy().to_lowercase()
        && crate::atomic::same_file(&from, &to);
    if to.exists() && !case_only {
        return Err(format!("{} is already there.", to.display()));
    }
    if let Some(parent) = to.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::task::spawn_blocking(move || crate::atomic::move_entry(&from, &to))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// `path` as plugin `id` may move it to the Trash: granted `files.write`,
/// inside `root` and not `root` itself or a folder holding it.
pub(super) fn trash_path(
    state: &PluginsState,
    id: &str,
    root: &str,
    path: &str,
) -> Result<PathBuf, String> {
    let path = folder_path(state, id, "files.write", root, path)?;
    crate::atomic::may_trash(&path, Some(Path::new(root)))?;
    Ok(path)
}

/// Moves a file or folder in the folder to the system Trash - never a
/// delete the user can't undo. Refused with `noTrash` where there is none.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_trash(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
) -> Result<(), String> {
    let path = plugin_fs_trash_path(app, id, root.clone(), path).await?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::atomic::user_file_to_trash(Path::new(&path), Some(Path::new(&root)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The checks of [`plugin_fs_trash`] alone, and the file they allow: iOS
/// moves it to Recently Deleted through the native plugin, as the sidebar does.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_trash_path(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
) -> Result<String, String> {
    let path = trash_path(&state::read(&app), &id, &root, &path)?;
    require_not_app_data(&app, &path)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Makes a folder (and the folders it is in) in the folder.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_mkdir(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
) -> Result<(), String> {
    let path = granted_path(&app, &id, "files.write", &root, &path)?;
    tokio::fs::create_dir_all(&path)
        .await
        .map_err(|e| e.to_string())
}

/// Whether a `network:` grant covers `host` (and `port`): the host itself,
/// `host:port`, `*.domain` for its subdomains, or `*` for any.
fn host_allowed(granted: &[String], host: &str, port: Option<u16>) -> bool {
    let host = host.to_ascii_lowercase();
    granted
        .iter()
        .filter_map(|g| g.strip_prefix("network:"))
        .any(|rule| {
            let rule = rule.to_ascii_lowercase();
            if rule == "*" {
                return true;
            }
            let (rule_host, rule_port) = match rule.rsplit_once(':') {
                Some((h, p)) => (h.to_string(), p.parse::<u16>().ok()),
                None => (rule.clone(), None),
            };
            if rule_port.is_some() && rule_port != port {
                return false;
            }
            match rule_host.strip_prefix("*.") {
                Some(domain) => host == domain || host.ends_with(&format!(".{domain}")),
                None => host == rule_host,
            }
        })
}

fn is_this_computer(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1")
}

/// Whether the plugin may fetch `url`: a granted host over HTTPS; plain HTTP
/// to this computer (Zotero's local API), or anywhere for a plugin granted
/// `network:*`. That grant is for an address the user types, and a NAS or a
/// home server is often plain HTTP; a plugin naming its hosts names services
/// that have HTTPS.
pub(super) fn url_allowed(granted: &[String], url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let scheme_ok = match url.scheme() {
        "https" => true,
        "http" => is_this_computer(host) || granted.iter().any(|g| g == "network:*"),
        _ => false,
    };
    scheme_ok && host_allowed(granted, host, url.port_or_known_default())
}

/// Whether a redirect to `next` would drop to plain HTTP after HTTPS: what
/// was sent encrypted, a password among it, must not go on in the clear.
pub(super) fn downgrades(previous: &[reqwest::Url], next: &reqwest::Url) -> bool {
    next.scheme() == "http" && previous.iter().any(|u| u.scheme() == "https")
}

pub(crate) mod paths;
pub(crate) use paths::{hidden_part, in_folder, inside, not_plugin_file, plugin_path};

#[cfg(test)]
mod tests;
