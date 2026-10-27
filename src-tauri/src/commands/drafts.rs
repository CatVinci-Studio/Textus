//! Best-effort autosave of unsaved content, one snapshot per dirty tab, so it
//! survives a crash. Snapshots are cleared once content is safe, so anything
//! found at launch is unresolved.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};
use tokio::fs;

/// Tab ids become a path component, so only ASCII letters, digits and '-' pass.
fn valid_component(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn drafts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("drafts"))
}

#[derive(Serialize, Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct DraftSnapshot {
    #[serde(rename = "tabId")]
    tab_id: String,
    path: Option<String>,
    content: String,
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn save_draft_snapshot(
    app: AppHandle,
    tab_id: String,
    path: Option<String>,
    content: String,
) -> Result<(), String> {
    if !valid_component(&tab_id) {
        return Err("invalid tab id".to_string());
    }
    let dir = drafts_dir(&app)?;
    fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let json = serde_json::to_vec(&DraftSnapshot {
        tab_id: tab_id.clone(),
        path,
        content,
    })
    .map_err(|e| e.to_string())?;
    crate::atomic::write(&dir.join(format!("{tab_id}.json")), json)
        .await
        .map_err(|e| e.to_string())
}

/// Whether the drafts pool has already been offered to a window this run.
/// Recovery is a launch-time question: later, every snapshot belongs to a live
/// tab, and a new window would duplicate it.
static DRAFTS_CLAIMED: AtomicBool = AtomicBool::new(false);

/// Takes every pending draft, removing its file, so at most one window claims
/// each. Only the `main` window's first call gets anything (see DRAFTS_CLAIMED).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn take_draft_snapshots(
    app: AppHandle,
    window: tauri::Window,
) -> Result<Vec<DraftSnapshot>, String> {
    if window.label() != "main" || DRAFTS_CLAIMED.swap(true, Ordering::SeqCst) {
        return Ok(Vec::new());
    }
    let dir = drafts_dir(&app)?;
    let mut reader = match fs::read_dir(&dir).await {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut snapshots = Vec::new();
    while let Some(entry) = reader.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // A snapshot that fails to parse (cut off by a crash) is dropped.
        if let Ok(raw) = fs::read_to_string(&path).await {
            if let Ok(snapshot) = serde_json::from_str::<DraftSnapshot>(&raw) {
                snapshots.push(snapshot);
            }
        }
        let _ = fs::remove_file(&path).await;
    }
    Ok(snapshots)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn clear_draft_snapshot(app: AppHandle, tab_id: String) -> Result<(), String> {
    if !valid_component(&tab_id) {
        return Err("invalid tab id".to_string());
    }
    match fs::remove_file(drafts_dir(&app)?.join(format!("{tab_id}.json"))).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn clear_all_drafts(app: AppHandle) -> Result<(), String> {
    match fs::remove_dir_all(drafts_dir(&app)?).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
