//! Best-effort autosave for unsaved content: the frontend periodically
//! snapshots each dirty tab here (one file per tab, latest state only, no
//! history) so an untitled draft or an unsaved edit survives a crash or a
//! forced quit. Snapshots are meant to be short-lived - cleared the moment
//! the frontend confirms the content is no longer at risk (saved, the tab
//! closed cleanly, or the user explicitly discarded it) - so the drafts
//! folder is normally empty; anything found here at the next launch is, by
//! construction, content that was never resolved.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};
use tokio::fs;

/// Tab ids are frontend-generated UUIDs (crypto.randomUUID()), but this
/// becomes a path component, so only ASCII letters, digits and '-' pass.
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
///
/// Recovery is a LAUNCH-time question - "what did the last run leave behind
/// that was never resolved" - but the drain is per-window, and a window can
/// be created at any time. Once the app is up, every snapshot on disk belongs
/// to a live, dirty tab in some window, so a window opened later (New Window)
/// would "recover" documents that are still open and unsaved elsewhere -
/// duplicating them, and deleting the snapshot that was protecting the
/// original. The destructive drain alone doesn't prevent this: the first
/// window commonly starts with an empty pool and the snapshot only appears
/// once the user types.
static DRAFTS_CLAIMED: AtomicBool = AtomicBool::new(false);

/// Reads every pending draft and removes its file in the same pass - a
/// destructive "take", same pattern as lib.rs's PendingOpenPaths, so at most
/// one window claims a given recovered document even if several windows are
/// restoring a session at once.
///
/// Answers with nothing outside the config-defined main window, or after
/// that window's first call: see DRAFTS_CLAIMED. Restricting the claim to
/// `main` also closes a startup race where a newly spawned file window could
/// mount first, drain a live tab's snapshot, and show that tab beside the file
/// it was created to open.
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
        // A snapshot that fails to parse (partial write cut off by a crash
        // mid-save, for instance) is simply dropped rather than surfaced -
        // there's no sensible content to recover from it anyway.
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
