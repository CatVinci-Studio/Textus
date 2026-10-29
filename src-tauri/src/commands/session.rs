use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Every window's open on-disk tab paths, written to disk window by window so
/// a relaunch brings each window back with its tabs; untitled tabs are dropped. Closing the last
/// editor window leaves the file alone, so the next launch brings those back.
pub struct SessionTabsState(pub Mutex<HashMap<String, Vec<String>>>);

/// Set while File > Quit is closing every window, so their Destroyed events
/// don't shrink the snapshot taken at the start.
static APP_QUITTING: AtomicBool = AtomicBool::new(false);

fn session_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("session.json"))
}

/// The last session's windows, each its documents' paths.
pub fn read_session_windows(app: &AppHandle) -> Vec<Vec<String>> {
    let Some(path) = session_file(app) else {
        return Vec::new();
    };
    fs::read_to_string(path)
        .ok()
        .map(|raw| parse_session(&raw))
        .unwrap_or_default()
}

/// Up to 1.3.0-beta.6 the file was one flat list, each path a window.
fn parse_session(raw: &str) -> Vec<Vec<String>> {
    if let Ok(windows) = serde_json::from_str::<Vec<Vec<String>>>(raw) {
        return windows.into_iter().filter(|w| !w.is_empty()).collect();
    }
    serde_json::from_str::<Vec<String>>(raw)
        .map(|paths| paths.into_iter().map(|p| vec![p]).collect())
        .unwrap_or_default()
}

fn write_session_paths(app: &AppHandle, paths: &[Vec<String>]) {
    let Some(path) = session_file(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(paths) {
        let _ = crate::atomic::write_sync(&path, json);
    }
}

/// Every window's paths, the main window first, each path in one window
/// only; windows left with none are dropped.
fn merge_paths(map: &HashMap<String, Vec<String>>) -> Vec<Vec<String>> {
    let mut labels: Vec<&String> = map.keys().collect();
    labels.sort_by_key(|label| (label.as_str() != "main", label.as_str()));
    let mut seen = HashSet::new();
    labels
        .into_iter()
        .map(|label| {
            map[label]
                .iter()
                .filter(|path| seen.insert((*path).clone()))
                .cloned()
                .collect::<Vec<_>>()
        })
        .filter(|window| !window.is_empty())
        .collect()
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn update_session_paths(
    app: AppHandle,
    window: tauri::Window,
    paths: Vec<String>,
    state: tauri::State<SessionTabsState>,
) {
    let merged = {
        let mut map = state.0.lock().unwrap();
        map.insert(window.label().to_string(), paths);
        merge_paths(&map)
    };
    write_session_paths(&app, &merged);
}

/// Captures the complete session before File > Quit starts closing windows.
pub fn begin_app_quit(app: &AppHandle, state: &SessionTabsState) {
    APP_QUITTING.store(true, Ordering::SeqCst);
    if let Some(paths) = quit_snapshot(&state.0.lock().unwrap()) {
        write_session_paths(app, &paths);
    }
}

/// What File > Quit writes before it closes the windows. `None` with no editor
/// window open (macOS): the file already holds the last window's documents.
fn quit_snapshot(map: &HashMap<String, Vec<String>>) -> Option<Vec<Vec<String>>> {
    (!map.is_empty()).then(|| merge_paths(map))
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
    let paths = merge_paths(&state.0.lock().unwrap());
    write_session_paths(&app, &paths);
}

/// Removes a destroyed editor from the live map and returns the paths that
/// should replace the disk snapshot. `None` keeps the snapshot: the window never
/// reported, the app is quitting, or this was the last editor window.
fn remove_window_paths(
    map: &mut HashMap<String, Vec<String>>,
    label: &str,
    app_quitting: bool,
) -> Option<Vec<Vec<String>>> {
    map.remove(label)?;
    if app_quitting || map.is_empty() {
        None
    } else {
        Some(merge_paths(map))
    }
}

pub fn forget_window(app: &AppHandle, label: &str, state: &SessionTabsState) {
    let merged = {
        let mut map = state.0.lock().unwrap();
        remove_window_paths(&mut map, label, APP_QUITTING.load(Ordering::SeqCst))
    };
    if let Some(paths) = merged {
        write_session_paths(app, &paths);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(entries: &[(&str, &[&str])]) -> HashMap<String, Vec<String>> {
        entries
            .iter()
            .map(|(label, paths)| {
                (
                    (*label).to_string(),
                    paths.iter().map(|path| (*path).to_string()).collect(),
                )
            })
            .collect()
    }

    #[test]
    fn closing_the_last_window_keeps_its_session_for_the_next_launch() {
        // Windows/Linux exit with it; macOS keeps running windowless. Either
        // way the documents it had open are what comes back.
        let mut map = paths(&[("main", &["one.md"])]);

        assert_eq!(remove_window_paths(&mut map, "main", false), None);
        assert!(map.is_empty());
    }

    #[test]
    fn quitting_from_the_menu_bar_with_no_window_keeps_the_last_session() {
        // macOS: the last window was closed earlier, then Quit with none
        // open. The snapshot on disk is that window's; nothing replaces it.
        assert_eq!(quit_snapshot(&HashMap::new()), None);
        assert_eq!(
            quit_snapshot(&paths(&[("main", &["one.md"]), ("window-1", &[])])),
            Some(vec![vec!["one.md".to_string()]])
        );
    }

    #[test]
    fn closing_one_of_multiple_windows_persists_the_remainder() {
        let mut map = paths(&[("main", &["one.md"]), ("window-1", &["two.md"])]);

        assert_eq!(
            remove_window_paths(&mut map, "main", false),
            Some(vec![vec!["two.md".to_string()]])
        );
    }

    #[test]
    fn app_quit_never_shrinks_the_captured_snapshot() {
        let mut map = paths(&[("main", &["one.md"]), ("window-1", &["two.md"])]);

        assert_eq!(remove_window_paths(&mut map, "main", true), None);
        assert_eq!(remove_window_paths(&mut map, "window-1", true), None);
    }

    #[test]
    fn each_window_keeps_its_own_documents() {
        let map = paths(&[
            ("window-2", &["three.md", "one.md"]),
            ("main", &["one.md", "two.md"]),
        ]);
        assert_eq!(
            merge_paths(&map),
            vec![
                vec!["one.md".to_string(), "two.md".to_string()],
                vec!["three.md".to_string()],
            ]
        );
    }

    #[test]
    fn an_earlier_flat_session_opens_a_window_per_document() {
        let windows = |raw| parse_session(raw);
        assert_eq!(
            windows(r#"["a.md","b.md"]"#),
            vec![vec!["a.md".to_string()], vec!["b.md".to_string()]]
        );
        assert_eq!(
            windows(r#"[["a.md","b.md"],[]]"#),
            vec![vec!["a.md".to_string(), "b.md".to_string()]]
        );
        assert!(windows("nonsense").is_empty());
    }

    #[test]
    fn unrelated_window_does_not_rewrite_the_session() {
        let mut map = paths(&[("main", &["one.md"])]);

        assert_eq!(remove_window_paths(&mut map, "chat-main", false), None);
        assert_eq!(map.len(), 1);
    }
}
