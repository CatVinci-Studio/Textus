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
pub struct DraftSnapshot {
    #[serde(rename = "tabId")]
    tab_id: String,
    path: Option<String>,
    content: String,
}

#[tauri::command]
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
pub async fn clear_all_drafts(app: AppHandle) -> Result<(), String> {
    for dir in [drafts_dir(&app)?, workspace_dir(&app)?] {
        match fs::remove_dir_all(dir).await {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

/// Mirrors platform/ipc.ts. Draft proposals are validated again by the editor
/// against the live revision; this store never writes a document.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    schema_version: u32,
    document_id: String,
    #[serde(default)]
    tab_id: Option<String>,
    document_path: Option<String>,
    updated_at: u64,
    status: String,
    draft: serde_json::Value,
}

const MAX_WORKSPACE_BYTES: u64 = 8 * 1024 * 1024;
static WORKSPACES_CLAIMED: AtomicBool = AtomicBool::new(false);

fn workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("workspace-drafts"))
        .map_err(|e| e.to_string())
}

fn validate_workspace(snapshot: &WorkspaceSnapshot) -> Result<(), String> {
    if snapshot.schema_version != 1
        || !valid_component(&snapshot.document_id)
        || !matches!(
            snapshot.status.as_str(),
            "running" | "review" | "interrupted"
        )
        || snapshot.draft.get("documentId").and_then(|s| s.as_str())
            != Some(snapshot.document_id.as_str())
        || snapshot
            .draft
            .get("baseMarkdown")
            .and_then(|s| s.as_str())
            .is_none()
        || snapshot
            .draft
            .get("operations")
            .and_then(|s| s.as_array())
            .is_none()
    {
        return Err("invalid workspace snapshot".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn save_workspace_snapshot(
    app: AppHandle,
    snapshot: WorkspaceSnapshot,
) -> Result<(), String> {
    validate_workspace(&snapshot)?;
    let bytes = serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_WORKSPACE_BYTES {
        return Err("workspace snapshot too large".into());
    }
    let dir = workspace_dir(&app)?;
    fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    crate::atomic::write(&dir.join(format!("{}.json", snapshot.document_id)), bytes)
        .await
        .map_err(|e| e.to_string())
}

async fn read_workspace(path: PathBuf) -> Option<WorkspaceSnapshot> {
    if fs::metadata(&path).await.ok()?.len() > MAX_WORKSPACE_BYTES {
        return None;
    }
    let raw = fs::read(path).await.ok()?;
    let snapshot: WorkspaceSnapshot = serde_json::from_slice(&raw).ok()?;
    validate_workspace(&snapshot).ok()?;
    Some(snapshot)
}

#[tauri::command]
pub async fn load_workspace_snapshot(
    app: AppHandle,
    document_id: String,
) -> Result<Option<WorkspaceSnapshot>, String> {
    if !valid_component(&document_id) {
        return Err("invalid document id".into());
    }
    Ok(read_workspace(workspace_dir(&app)?.join(format!("{document_id}.json"))).await)
}

#[tauri::command]
pub async fn clear_workspace_snapshot(app: AppHandle, document_id: String) -> Result<(), String> {
    if !valid_component(&document_id) {
        return Err("invalid document id".into());
    }
    match fs::remove_file(workspace_dir(&app)?.join(format!("{document_id}.json"))).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn take_workspace_snapshots(
    app: AppHandle,
    window: tauri::Window,
) -> Result<Vec<WorkspaceSnapshot>, String> {
    if window.label() != "main" || WORKSPACES_CLAIMED.swap(true, Ordering::SeqCst) {
        return Ok(vec![]);
    }
    let mut entries = match fs::read_dir(workspace_dir(&app)?).await {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    let mut recovered = vec![];
    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        if entry.path().extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Some(mut snapshot) = read_workspace(entry.path()).await {
            if snapshot.status == "running" {
                snapshot.status = "interrupted".into();
            }
            recovered.push(snapshot);
        }
    }
    Ok(recovered)
}

#[cfg(test)]
mod workspace_tests {
    use super::*;
    #[test]
    fn validates_schema_identity_and_safe_paths() {
        let mut snapshot = WorkspaceSnapshot {
            schema_version: 1,
            document_id: "doc-1".into(),
            tab_id: None,
            document_path: None,
            updated_at: 0,
            status: "running".into(),
            draft: serde_json::json!({"documentId":"doc-1", "baseMarkdown":"", "operations":[]}),
        };
        assert!(validate_workspace(&snapshot).is_ok());
        snapshot.schema_version = 2;
        assert!(validate_workspace(&snapshot).is_err());
        snapshot.schema_version = 1;
        snapshot.document_id = "../escape".into();
        assert!(validate_workspace(&snapshot).is_err());
    }
}
