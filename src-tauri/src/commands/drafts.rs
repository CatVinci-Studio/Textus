//! Best-effort autosave of unsaved content, one snapshot per dirty tab, so it
//! survives a crash. Snapshots are cleared once content is safe, so anything
//! found at launch is unresolved.

use crate::app_dirs::AppDirs;
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
        .own_data_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join(crate::settings::dir_name("drafts")))
}

#[derive(Serialize, Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct DraftSnapshot {
    #[serde(rename = "tabId")]
    tab_id: String,
    path: Option<String>,
    content: String,
    /// The file's time when its edits began: a restored draft whose file has
    /// changed since asks before it is saved over it.
    #[serde(rename = "diskMtime", default)]
    disk_mtime: Option<f64>,
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn save_draft_snapshot(
    app: AppHandle,
    tab_id: String,
    path: Option<String>,
    content: String,
    disk_mtime: Option<f64>,
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
        disk_mtime,
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

/// Takes every pending draft, so at most one window claims each: each is
/// moved aside into `restoring/` (kept until the window says they are
/// back, finish_draft_restore), and one a crash left there last time comes
/// back too. One that can't be read goes to `unreadable/`, never deleted.
/// Only the `main` window's first call gets anything (see DRAFTS_CLAIMED);
/// on a phone, every page's.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn take_draft_snapshots(
    app: AppHandle,
    window: tauri::Window,
) -> Result<Vec<DraftSnapshot>, String> {
    // A phone has one window, and a new page there (Android recreating its
    // activity) has lost the tabs those drafts belong to: offered again.
    let claimed = cfg!(desktop) && DRAFTS_CLAIMED.swap(true, Ordering::SeqCst);
    if window.label() != "main" || claimed {
        return Ok(Vec::new());
    }
    let dir = drafts_dir(&app)?;
    let restoring = dir.join(RESTORING);
    let mut snapshots = Vec::new();
    for (from, aside) in [(restoring.clone(), false), (dir.clone(), true)] {
        let mut reader = match fs::read_dir(&from).await {
            Ok(r) => r,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(e.to_string()),
        };
        while let Some(entry) = reader.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let parsed = fs::read_to_string(&path)
                .await
                .ok()
                .and_then(|raw| serde_json::from_str::<DraftSnapshot>(&raw).ok());
            let Some(name) = path.file_name() else {
                continue;
            };
            match parsed {
                Some(snapshot) => {
                    snapshots.push(snapshot);
                    if aside {
                        fs::create_dir_all(&restoring)
                            .await
                            .map_err(|e| e.to_string())?;
                        let _ = fs::rename(&path, restoring.join(name)).await;
                    }
                }
                // Cut off by a crash, or another version's: kept apart.
                None => {
                    let unreadable = dir.join("unreadable");
                    fs::create_dir_all(&unreadable)
                        .await
                        .map_err(|e| e.to_string())?;
                    let _ = fs::rename(&path, unreadable.join(name)).await;
                }
            }
        }
    }
    Ok(snapshots)
}

/// A removal that found nothing there is done all the same.
fn gone(removed: std::io::Result<()>) -> Result<(), String> {
    match removed {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// Where taken drafts wait until their window has them again.
const RESTORING: &str = "restoring";

/// Whether take_draft_snapshots still has drafts to give: read as the main
/// window is built, before it can ask.
#[cfg(desktop)]
pub(crate) fn drafts_waiting(app: &AppHandle) -> bool {
    if DRAFTS_CLAIMED.load(Ordering::SeqCst) {
        return false;
    }
    let Ok(dir) = drafts_dir(app) else {
        return true;
    };
    [dir.join(RESTORING), dir].iter().any(|dir| has_json(dir))
}

#[cfg(desktop)]
fn has_json(dir: &std::path::Path) -> bool {
    std::fs::read_dir(dir).is_ok_and(|entries| {
        entries
            .flatten()
            .any(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
    })
}

/// The taken drafts are back in their window, each kept again under its
/// new tab: the copies set aside go.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn finish_draft_restore(app: AppHandle) -> Result<(), String> {
    gone(fs::remove_dir_all(drafts_dir(&app)?.join(RESTORING)).await)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn clear_draft_snapshot(app: AppHandle, tab_id: String) -> Result<(), String> {
    if !valid_component(&tab_id) {
        return Err("invalid tab id".to_string());
    }
    gone(fs::remove_file(drafts_dir(&app)?.join(format!("{tab_id}.json"))).await)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn clear_all_drafts(app: AppHandle) -> Result<(), String> {
    gone(fs::remove_dir_all(drafts_dir(&app)?).await)
}

/// The page's tabs as it last wrote them down, for as long as the process
/// lives: Android makes the page anew without a reload (a font or display
/// size changed), its own storage empty. Kept here, where only the app's own
/// page can ask - not on the Android bridge, which every frame of the page
/// sees, a web page opened in the app too.
static PAGE_TABS: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn keep_page_tabs(text: String) {
    *PAGE_TABS.lock().unwrap_or_else(|e| e.into_inner()) = text;
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn kept_page_tabs() -> String {
    PAGE_TABS.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

#[cfg(all(test, desktop))]
mod tests {
    use super::has_json;

    #[test]
    fn a_folder_with_a_draft_has_one_waiting() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!has_json(dir.path()));
        assert!(!has_json(&dir.path().join("restoring")));
        std::fs::write(dir.path().join("notes.txt"), "").unwrap();
        assert!(!has_json(dir.path()));
        std::fs::write(dir.path().join("tab-1.json"), "{}").unwrap();
        assert!(has_json(dir.path()));
    }
}
