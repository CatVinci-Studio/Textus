//! What a running plugin may reach, each checked against `state.json`:
//!
//! - its own files (`plugin_file`) - always;
//! - the file a custom editor of it was opened on (`plugin_read_resource`)
//!   - always, the window vouching that it is that file;
//! - the open folder (`plugin_fs_*`) - with `files.read` /
//!   `files.write`, and only inside the folder the window names, never
//!   the app's own data;
//! - the network (`plugin_http`) - only the hosts it was granted, HTTPS
//!   (plain HTTP to this computer only), no cookies, a size limit;
//! - its storage (`plugin_storage_*`) - its own, with a quota.
//!
//! Bytes go back as raw IPC responses, not JSON arrays: a PDF is megabytes.

use super::state::{self, PluginsState};
use super::{plugins_root, require_id};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::ipc::Response;
use tauri::Manager;

/// The most a read hands over at once.
const MAX_READ_BYTES: u64 = 256 * 1024 * 1024;
/// The most a response from the network may be.
const MAX_HTTP_BYTES: usize = 32 * 1024 * 1024;

pub(super) fn refused(id: &str, permission: &str) -> String {
    format!("{id} was not granted {permission}.")
}

fn running(state: &PluginsState, id: &str) -> Result<(), String> {
    require_id(id)?;
    if state.runs(id) {
        Ok(())
    } else {
        Err(format!("{id} is turned off."))
    }
}

/// `path` resolved inside `root`: no `..`, and after following links in
/// the part that exists, still under `root`. The part that doesn't exist
/// yet (a file about to be written) is kept as named.
pub(super) fn inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("{}: {e}", root.display()))?;
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("A path with \"..\" is refused.".to_string());
    }
    let mut existing = path.clone();
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    while !existing.exists() {
        match existing.file_name() {
            Some(name) => missing.push(name.to_os_string()),
            None => break,
        }
        if !existing.pop() {
            break;
        }
    }
    let mut resolved = std::fs::canonicalize(&existing).map_err(|e| e.to_string())?;
    for name in missing.into_iter().rev() {
        resolved.push(name);
    }
    if resolved.starts_with(&root) {
        Ok(resolved)
    } else {
        Err(format!("{} is outside the folder.", path.display()))
    }
}

/// The app's own folders, which no plugin reads or writes through the
/// workspace calls - other plugins' storage, settings, keys.
pub(super) fn require_not_app_data(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let own = [app.path().app_data_dir(), app.path().app_config_dir()];
    for dir in own.into_iter().flatten() {
        let dir = std::fs::canonicalize(&dir).unwrap_or(dir);
        if path.starts_with(&dir) {
            return Err("The app's own files are not part of the folder.".to_string());
        }
    }
    Ok(())
}

/// Where a plugin's own files are: its developer folder or `plugins/<id>/`.
pub(super) fn plugin_home(
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
        return Err("The file is too big to open here.".to_string());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// One of the plugin's own files - its code, a stylesheet, an icon. Read
/// even while it is off, so Settings can show its icon.
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

/// The file a custom editor was opened on: the window opened it in the
/// plugin's tab because the user opened that file.
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
    if !state::read(&app).allows(&id, "files.read") {
        return Err(refused(&id, "files.read"));
    }
    let path = inside(Path::new(&root), Path::new(&path))?;
    require_not_app_data(&app, &path)?;
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
    let dir = inside(Path::new(&root), Path::new(&path))?;
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
        out.push(FsEntry {
            name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified_ms: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64),
        });
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
    if !state::read(&app).allows(&id, "files.write") {
        return Err(refused(&id, "files.write"));
    }
    let path = inside(Path::new(&root), Path::new(&path))?;
    require_not_app_data(&app, &path)?;
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
    let from = inside(root, Path::new(&from))?;
    let to = inside(root, Path::new(&to))?;
    require_not_app_data(&app, &from)?;
    require_not_app_data(&app, &to)?;
    if to.exists() {
        return Err(format!("{} is already there.", to.display()));
    }
    if let Some(parent) = to.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::rename(&from, &to)
        .await
        .map_err(|e| e.to_string())
}

/// Moves a file or folder in the folder to the system Trash - never a
/// delete the user can't undo.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_trash(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
) -> Result<(), String> {
    if !state::read(&app).allows(&id, "files.write") {
        return Err(refused(&id, "files.write"));
    }
    let path = inside(Path::new(&root), Path::new(&path))?;
    require_not_app_data(&app, &path)?;
    if std::fs::canonicalize(&root).is_ok_and(|r| r == path) {
        return Err("The folder itself can't be moved to the Trash.".into());
    }
    // The trash crate is desktop-only (Cargo.toml); the iPhone has no Trash
    // to move a file to.
    #[cfg(desktop)]
    return tauri::async_runtime::spawn_blocking(move || {
        trash::delete(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(desktop))]
    Err(format!(
        "{} can't be moved to the Trash here.",
        path.display()
    ))
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
    if !state::read(&app).allows(&id, "files.write") {
        return Err(refused(&id, "files.write"));
    }
    let path = inside(Path::new(&root), Path::new(&path))?;
    require_not_app_data(&app, &path)?;
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

/// Whether the plugin may fetch `url`: a granted host, over HTTPS - or over
/// plain HTTP to this computer (Zotero's local API).
fn url_allowed(granted: &[String], url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let scheme_ok = match url.scheme() {
        "https" => true,
        "http" => is_this_computer(host),
        _ => false,
    };
    scheme_ok && host_allowed(granted, host, url.port_or_known_default())
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    url: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    /// Text, or base64 with `body_base64`.
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    body_base64: bool,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    /// The body, base64.
    body: String,
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_http(
    app: tauri::AppHandle,
    id: String,
    request: HttpRequest,
) -> Result<HttpResponse, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let state = state::read(&app);
    running(&state, &id)?;
    let granted = state
        .plugins
        .get(&id)
        .map(|p| p.granted.clone())
        .unwrap_or_default();
    let url = reqwest::Url::parse(&request.url).map_err(|e| e.to_string())?;
    if !url_allowed(&granted, &url) {
        return Err(refused(
            &id,
            &format!("network:{}", url.host_str().unwrap_or("")),
        ));
    }
    // A redirect must stay within what was granted too.
    let redirect_grants = granted.clone();
    let client = crate::net::client(Duration::from_secs(10), Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() > 5 || !url_allowed(&redirect_grants, attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(
        request
            .method
            .as_deref()
            .unwrap_or("GET")
            .to_ascii_uppercase()
            .as_bytes(),
    )
    .map_err(|e| e.to_string())?;
    let mut builder = client.request(method, url);
    for (name, value) in &request.headers {
        // The plugin is not the user's browser: no cookies of theirs.
        if name.eq_ignore_ascii_case("cookie") {
            continue;
        }
        builder = builder.header(name, value);
    }
    if let Some(body) = request.body {
        builder = builder.body(if request.body_base64 {
            STANDARD.decode(body).map_err(|e| e.to_string())?
        } else {
            body.into_bytes()
        });
    }
    let response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter(|(name, _)| name.as_str() != "set-cookie")
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
        .collect();
    let body = crate::net::read_limited(response, MAX_HTTP_BYTES)
        .await?
        .ok_or_else(|| "The response is too big.".to_string())?;
    Ok(HttpResponse {
        status,
        headers,
        body: STANDARD.encode(body),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grants(list: &[&str]) -> Vec<String> {
        list.iter().map(|g| g.to_string()).collect()
    }

    #[test]
    fn a_path_must_stay_in_the_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("notes");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/a.md"), "a").unwrap();
        assert!(inside(&root, Path::new("sub/a.md")).is_ok());
        assert!(inside(&root, &root.join("Daily/2026-10-21.md")).is_ok());
        assert!(inside(&root, Path::new("../secret")).is_err());
        assert!(inside(&root, &tmp.path().join("elsewhere.md")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_folder_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("notes");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(tmp.path().join("secret.txt"), "s").unwrap();
        std::os::unix::fs::symlink(tmp.path(), root.join("out")).unwrap();
        assert!(inside(&root, Path::new("out/secret.txt")).is_err());
    }

    #[test]
    fn hosts_match_their_grants() {
        let g = grants(&[
            "network:api.zotero.org",
            "network:*.wikipedia.org",
            "network:localhost:23119",
        ]);
        assert!(host_allowed(&g, "api.zotero.org", Some(443)));
        assert!(host_allowed(&g, "en.wikipedia.org", Some(443)));
        assert!(host_allowed(&g, "wikipedia.org", Some(443)));
        assert!(!host_allowed(&g, "evil-wikipedia.org", Some(443)));
        assert!(host_allowed(&g, "localhost", Some(23119)));
        assert!(!host_allowed(&g, "localhost", Some(8080)));
        assert!(!host_allowed(&g, "example.com", Some(443)));
        assert!(host_allowed(
            &grants(&["network:*"]),
            "example.com",
            Some(443)
        ));
    }

    #[test]
    fn plain_http_only_to_this_computer() {
        let g = grants(&["network:*"]);
        let ok = |u: &str| url_allowed(&g, &reqwest::Url::parse(u).unwrap());
        assert!(ok("https://example.com/x"));
        assert!(!ok("http://example.com/x"));
        assert!(ok("http://localhost:23119/api"));
        assert!(ok("http://127.0.0.1:23119/api"));
        assert!(!ok("file:///etc/passwd"));
    }
}
