use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// One window as the next launch brings it back: its documents' paths, how
/// its islands were laid out (the frontend's own shape, by path), and the
/// folder it had open. Untitled tabs are not kept.
#[derive(Serialize, Deserialize, Clone, Default, PartialEq, Debug)]
#[cfg_attr(test, derive(specta::Type))]
pub struct WindowSession {
    pub paths: Vec<String>,
    #[serde(default)]
    pub layout: Option<serde_json::Value>,
    #[serde(default)]
    pub folder: Option<String>,
}

impl WindowSession {
    pub fn of_paths(paths: Vec<String>) -> Self {
        Self {
            paths,
            ..Self::default()
        }
    }
}

/// Every window's session, written to disk window by window. Closing the
/// last editor window leaves the file alone, so the next launch brings it
/// back.
pub struct SessionTabsState(pub Mutex<HashMap<String, WindowSession>>);

/// Set while File > Quit is closing every window, so their Destroyed events
/// don't shrink the snapshot taken at the start.
static APP_QUITTING: AtomicBool = AtomicBool::new(false);

fn session_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(crate::settings::file_name("session")))
}

/// The last session's windows.
pub fn read_session_windows(app: &AppHandle) -> Vec<WindowSession> {
    let Some(path) = session_file(app) else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    // One no version wrote: kept aside, not lost under the next write.
    if !readable_session(&raw) {
        crate::json_file::move_aside(&path);
        return Vec::new();
    }
    parse_session(&raw)
}

/// Whether `raw` is a session file some version wrote.
fn readable_session(raw: &str) -> bool {
    serde_json::from_str::<Vec<WindowSession>>(raw).is_ok()
        || serde_json::from_str::<Vec<Vec<String>>>(raw).is_ok()
        || serde_json::from_str::<Vec<String>>(raw).is_ok()
}

/// The file as each version wrote it: windows' sessions; up to 1.3.12 each
/// window's paths; up to 1.3.0-beta.6 one flat list, each path a window.
fn parse_session(raw: &str) -> Vec<WindowSession> {
    let windows = if let Ok(windows) = serde_json::from_str::<Vec<WindowSession>>(raw) {
        windows
    } else if let Ok(windows) = serde_json::from_str::<Vec<Vec<String>>>(raw) {
        windows.into_iter().map(WindowSession::of_paths).collect()
    } else {
        serde_json::from_str::<Vec<String>>(raw)
            .map(|paths| {
                paths
                    .into_iter()
                    .map(|p| WindowSession::of_paths(vec![p]))
                    .collect()
            })
            .unwrap_or_default()
    };
    windows.into_iter().filter(kept).collect()
}

/// A window worth bringing back: one with documents or a folder.
fn kept(window: &WindowSession) -> bool {
    !window.paths.is_empty() || window.folder.is_some()
}

fn write_session(app: &AppHandle, windows: &[WindowSession]) {
    let Some(path) = session_file(app) else {
        return;
    };
    let _ = crate::json_file::save(&path, windows);
}

/// Every window's session, the main window first, each path in one window
/// only; windows left with nothing are dropped.
fn merge_windows(map: &HashMap<String, WindowSession>) -> Vec<WindowSession> {
    let mut labels: Vec<&String> = map.keys().collect();
    labels.sort_by_key(|label| (label.as_str() != "main", label.as_str()));
    let mut seen = HashSet::new();
    labels
        .into_iter()
        .map(|label| {
            let window = &map[label];
            WindowSession {
                paths: window
                    .paths
                    .iter()
                    .filter(|path| seen.insert((*path).clone()))
                    .cloned()
                    .collect(),
                ..window.clone()
            }
        })
        .filter(kept)
        .collect()
}

/// This window's session as it last told it: what a reloaded page comes
/// back to (its folder, its islands), where a first start takes what it was
/// opened with.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn window_session_current(
    window: tauri::Window,
    state: tauri::State<SessionTabsState>,
) -> Option<WindowSession> {
    state.0.lock().unwrap().get(window.label()).cloned()
}

/// This window's session as it now stands.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn update_window_session(
    app: AppHandle,
    window: tauri::Window,
    session: WindowSession,
    state: tauri::State<SessionTabsState>,
) {
    let merged = {
        let mut map = state.0.lock().unwrap();
        if map.get(window.label()) == Some(&session) {
            return;
        }
        map.insert(window.label().to_string(), session);
        merge_windows(&map)
    };
    write_session(&app, &merged);
}

/// Captures the complete session before File > Quit starts closing windows.
pub fn begin_app_quit(app: &AppHandle, state: &SessionTabsState) {
    APP_QUITTING.store(true, Ordering::SeqCst);
    if let Some(windows) = quit_snapshot(&state.0.lock().unwrap()) {
        write_session(app, &windows);
    }
}

/// What File > Quit writes before it closes the windows. `None` with no editor
/// window open (macOS): the file already holds the last window's session.
fn quit_snapshot(map: &HashMap<String, WindowSession>) -> Option<Vec<WindowSession>> {
    (!map.is_empty()).then(|| merge_windows(map))
}

pub fn app_quitting() -> bool {
    APP_QUITTING.load(Ordering::SeqCst)
}

/// A dirty-window prompt cancelled File > Quit after other windows closed:
/// resume ordinary bookkeeping and persist only the windows still alive.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn cancel_session_quit(app: AppHandle, state: tauri::State<SessionTabsState>) {
    APP_QUITTING.store(false, Ordering::SeqCst);
    #[cfg(desktop)]
    super::update::cancel_relaunch();
    let windows = merge_windows(&state.0.lock().unwrap());
    write_session(&app, &windows);
}

/// Removes a destroyed editor from the live map and returns the session
/// that should replace the disk snapshot. `None` keeps the snapshot: the
/// window never reported, the app is quitting, or this was the last editor
/// window.
fn remove_window(
    map: &mut HashMap<String, WindowSession>,
    label: &str,
    app_quitting: bool,
) -> Option<Vec<WindowSession>> {
    map.remove(label)?;
    if app_quitting || map.is_empty() {
        None
    } else {
        Some(merge_windows(map))
    }
}

pub fn forget_window(app: &AppHandle, label: &str, state: &SessionTabsState) {
    let merged = {
        let mut map = state.0.lock().unwrap();
        remove_window(&mut map, label, APP_QUITTING.load(Ordering::SeqCst))
    };
    if let Some(windows) = merged {
        write_session(app, &windows);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn windows(entries: &[(&str, &[&str])]) -> HashMap<String, WindowSession> {
        entries
            .iter()
            .map(|(label, paths)| {
                (
                    (*label).to_string(),
                    WindowSession::of_paths(paths.iter().map(|p| (*p).to_string()).collect()),
                )
            })
            .collect()
    }

    fn of(paths: &[&str]) -> WindowSession {
        WindowSession::of_paths(paths.iter().map(|p| (*p).to_string()).collect())
    }

    #[test]
    fn closing_the_last_window_keeps_its_session_for_the_next_launch() {
        // Windows/Linux exit with it; macOS keeps running windowless. Either
        // way the documents it had open are what comes back.
        let mut map = windows(&[("main", &["one.md"])]);
        assert_eq!(remove_window(&mut map, "main", false), None);
        assert!(map.is_empty());
    }

    #[test]
    fn quitting_from_the_menu_bar_with_no_window_keeps_the_last_session() {
        assert_eq!(quit_snapshot(&HashMap::new()), None);
        assert_eq!(
            quit_snapshot(&windows(&[("main", &["one.md"]), ("window-1", &[])])),
            Some(vec![of(&["one.md"])])
        );
    }

    #[test]
    fn closing_one_of_multiple_windows_persists_the_remainder() {
        let mut map = windows(&[("main", &["one.md"]), ("window-1", &["two.md"])]);
        assert_eq!(
            remove_window(&mut map, "main", false),
            Some(vec![of(&["two.md"])])
        );
    }

    #[test]
    fn app_quit_never_shrinks_the_captured_snapshot() {
        let mut map = windows(&[("main", &["one.md"]), ("window-1", &["two.md"])]);
        assert_eq!(remove_window(&mut map, "main", true), None);
        assert_eq!(remove_window(&mut map, "window-1", true), None);
    }

    #[test]
    fn each_window_keeps_its_own_documents_layout_and_folder() {
        let mut map = windows(&[("window-2", &["three.md", "one.md"])]);
        let main = WindowSession {
            paths: vec!["one.md".into(), "two.md".into()],
            layout: Some(serde_json::json!({"direction": "row"})),
            folder: Some("/notes".into()),
        };
        map.insert("main".into(), main.clone());
        assert_eq!(merge_windows(&map), vec![main, of(&["three.md"])]);
    }

    #[test]
    fn every_earlier_session_file_still_opens() {
        assert_eq!(
            parse_session(r#"["a.md","b.md"]"#),
            vec![of(&["a.md"]), of(&["b.md"])]
        );
        assert_eq!(
            parse_session(r#"[["a.md","b.md"],[]]"#),
            vec![of(&["a.md", "b.md"])]
        );
        assert_eq!(
            parse_session(r#"[{"paths":[],"folder":"/n"},{"paths":[]}]"#),
            vec![WindowSession {
                folder: Some("/n".into()),
                ..WindowSession::default()
            }]
        );
        assert!(parse_session("nonsense").is_empty());
    }

    #[test]
    fn only_a_file_no_version_wrote_is_set_aside() {
        for written in [
            r#"["a.md"]"#,
            r#"[["a.md"]]"#,
            r#"[{"paths":["a.md"]}]"#,
            "[]",
        ] {
            assert!(readable_session(written), "{written}");
        }
        assert!(!readable_session(r#"[{"paths":["a.md"]"#));
    }

    #[test]
    fn unrelated_window_does_not_rewrite_the_session() {
        let mut map = windows(&[("main", &["one.md"])]);
        assert_eq!(remove_window(&mut map, "chat-main", false), None);
        assert_eq!(map.len(), 1);
    }
}
