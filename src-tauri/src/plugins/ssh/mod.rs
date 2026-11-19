//! `textus.ssh` for plugins (permission `ssh`, desktop): a folder on a server
//! read and written over SFTP, through the user's own ssh. A plugin reaches a
//! host only once the user said yes to that plugin and host; its links close
//! when it stops. Paths are the server's, absolute.

mod hosts;
pub(crate) mod link;

use super::{plugins_root, require_id};
use link::Link;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Response;

/// Refused until the user says yes to the plugin reaching the host.
pub const NOT_ALLOWED: &str = "plugin-ssh-not-allowed";
/// The most a read hands over at once.
const MAX_READ: u64 = 64 * 1024 * 1024;

static LINKS: Mutex<Option<HashMap<u32, Arc<Link>>>> = Mutex::new(None);
static NEXT: AtomicU32 = AtomicU32::new(1);

/// The hosts each plugin may reach, as the user allowed.
#[derive(Serialize, Deserialize, Default)]
struct Allowed {
    plugins: BTreeMap<String, BTreeSet<String>>,
}

fn allowed_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(plugins_root(app)?.join("ssh.json"))
}

fn allowed(app: &tauri::AppHandle) -> Allowed {
    allowed_file(app)
        .ok()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn granted(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    require_id(id)?;
    if super::state::read(app).allows(id, "ssh") {
        Ok(())
    } else {
        Err(super::access::refused(id, "ssh"))
    }
}

/// The plugin's own link `session`.
fn link(id: &str, session: u32) -> Result<Arc<Link>, String> {
    LINKS
        .lock()
        .ok()
        .and_then(|links| links.as_ref()?.get(&session).cloned())
        .filter(|l| l.plugin == id)
        .ok_or_else(|| "The connection was closed.".to_string())
}

/// A server path as given: absolute, whole.
fn remote(path: &str) -> Result<String, String> {
    if !path.starts_with('/') || path.contains('\0') {
        return Err(format!("{path} isn't a path on the server."));
    }
    Ok(path.to_string())
}

/// An SFTP failure in words.
fn said(err: impl std::fmt::Display) -> String {
    err.to_string()
}

/// One entry of a folder on the server.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct RemoteEntry {
    pub name: String,
    pub folder: bool,
}

/// The hosts named in the user's `~/.ssh/config`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_ssh_hosts(app: tauri::AppHandle, id: String) -> Result<Vec<String>, String> {
    granted(&app, &id)?;
    let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) else {
        return Ok(vec![]);
    };
    let ssh = std::path::PathBuf::from(home).join(".ssh");
    Ok(hosts::hosts_in(&ssh.join("config"), &ssh))
}

/// The user's yes to `id` reaching `host`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_ssh_allow(app: tauri::AppHandle, id: String, host: String) -> Result<(), String> {
    granted(&app, &id)?;
    if !link::valid_host(&host) {
        return Err(format!("{host} isn't a host name."));
    }
    let mut all = allowed(&app);
    all.plugins.entry(id).or_default().insert(host);
    crate::json_file::save_pretty(&allowed_file(&app)?, &all).map_err(|e| e.to_string())
}

/// A link to `host`; refused with NOT_ALLOWED until the user said yes.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_ssh_connect(
    app: tauri::AppHandle,
    id: String,
    host: String,
) -> Result<u32, String> {
    granted(&app, &id)?;
    if !cfg!(desktop) {
        return Err("SSH is on the desktop only.".into());
    }
    if !allowed(&app)
        .plugins
        .get(&id)
        .is_some_and(|h| h.contains(&host))
    {
        return Err(NOT_ALLOWED.into());
    }
    connect(&id, &host, None).await
}

async fn connect(id: &str, host: &str, config: Option<&Path>) -> Result<u32, String> {
    let link = link::open(id, host, config).await?;
    let session = NEXT.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut links) = LINKS.lock() {
        links
            .get_or_insert_with(HashMap::new)
            .insert(session, Arc::new(link));
    }
    Ok(session)
}

/// The folder the link starts in: the user's home there.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_ssh_home(id: String, session: u32) -> Result<String, String> {
    link(&id, session)?
        .sftp
        .canonicalize(".")
        .await
        .map_err(said)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_ssh_list(
    id: String,
    session: u32,
    path: String,
) -> Result<Vec<RemoteEntry>, String> {
    let link = link(&id, session)?;
    let dir = link.sftp.read_dir(remote(&path)?).await.map_err(said)?;
    Ok(dir
        .filter(|e| {
            let name = e.file_name();
            name != "." && name != ".." && !name.contains('/')
        })
        .map(|e| RemoteEntry {
            folder: e.file_type().is_dir(),
            name: e.file_name(),
        })
        .collect())
}

/// A file's bytes, as a raw response (no generated binding: `call`).
#[tauri::command]
pub async fn plugin_ssh_read(id: String, session: u32, path: String) -> Result<Response, String> {
    let link = link(&id, session)?;
    let path = remote(&path)?;
    let size = link
        .sftp
        .metadata(path.clone())
        .await
        .map_err(said)?
        .size
        .unwrap_or(0);
    if size > MAX_READ {
        return Err(format!("{path} is too big to open."));
    }
    Ok(Response::new(link.sftp.read(path).await.map_err(said)?))
}

/// Writes a file whole; base64 for bytes.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_ssh_write(
    id: String,
    session: u32,
    path: String,
    contents: String,
    base64: bool,
) -> Result<(), String> {
    use base64::Engine;
    let link = link(&id, session)?;
    let data = if base64 {
        base64::engine::general_purpose::STANDARD
            .decode(contents)
            .map_err(|e| e.to_string())?
    } else {
        contents.into_bytes()
    };
    link.sftp.write(remote(&path)?, &data).await.map_err(said)
}

/// A new empty file or folder; a name taken is refused.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_ssh_create(
    id: String,
    session: u32,
    path: String,
    folder: bool,
) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    let link = link(&id, session)?;
    let path = remote(&path)?;
    if link.sftp.try_exists(path.clone()).await.map_err(said)? {
        return Err(format!("{path} already exists."));
    }
    if folder {
        return link.sftp.create_dir(path).await.map_err(said);
    }
    let flags = OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE;
    link.sftp.open_with_flags(path, flags).await.map_err(said)?;
    Ok(())
}

/// Moves or renames; a name taken is refused.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_ssh_rename(
    id: String,
    session: u32,
    from: String,
    to: String,
) -> Result<(), String> {
    let link = link(&id, session)?;
    let to = remote(&to)?;
    if link.sftp.try_exists(to.clone()).await.map_err(said)? {
        return Err(format!("{to} already exists."));
    }
    link.sftp.rename(remote(&from)?, to).await.map_err(said)
}

/// Deletes a file, or an empty folder, for good.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_ssh_remove(id: String, session: u32, path: String) -> Result<(), String> {
    let link = link(&id, session)?;
    let path = remote(&path)?;
    let meta = link.sftp.metadata(path.clone()).await.map_err(said)?;
    if meta.is_dir() {
        link.sftp.remove_dir(path).await.map_err(said)
    } else {
        link.sftp.remove_file(path).await.map_err(said)
    }
}

/// Closes one link, or (no session) every link of the plugin.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_ssh_close(id: String, session: Option<u32>) -> Result<(), String> {
    let gone: Vec<Arc<Link>> = LINKS
        .lock()
        .map(|mut links| {
            let Some(map) = links.as_mut() else {
                return vec![];
            };
            let keys: Vec<u32> = map
                .iter()
                .filter(|(k, l)| l.plugin == id && session.is_none_or(|s| s == **k))
                .map(|(k, _)| *k)
                .collect();
            keys.iter().filter_map(|k| map.remove(k)).collect()
        })
        .unwrap_or_default();
    for link in gone {
        link.close().await;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
