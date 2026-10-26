use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Recently opened files and folders, backing File > Open Recent. Each list is
/// a JSON array (most recent first) next to prefs.json; Rust owns the lists and the menu.
const MAX_RECENT_FILES: usize = 10;
/// Fewer folders than files: a writer keeps a handful of projects, and they
/// sit above the files in the same submenu.
const MAX_RECENT_FOLDERS: usize = 5;

const FILES_LIST: &str = "recent_files.json";
const FOLDERS_LIST: &str = "recent_folders.json";

fn list_file(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(name))
}

fn read_list(app: &tauri::AppHandle, name: &str) -> Vec<String> {
    let Some(path) = list_file(app, name) else {
        return Vec::new();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_list(app: &tauri::AppHandle, name: &str, list: &[String]) {
    let Some(path) = list_file(app, name) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(list) {
        let _ = crate::atomic::write_sync(&path, json);
    }
}

/// `list` with `path` moved to the front, at most `max` long.
fn push_front(mut list: Vec<String>, path: String, max: usize) -> Vec<String> {
    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(max);
    list
}

pub fn read_recent_files(app: &tauri::AppHandle) -> Vec<String> {
    read_list(app, FILES_LIST)
}

pub fn read_recent_folders(app: &tauri::AppHandle) -> Vec<String> {
    read_list(app, FOLDERS_LIST)
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn add_recent_file(app: tauri::AppHandle, path: String) {
    let list = push_front(read_recent_files(&app), path, MAX_RECENT_FILES);
    write_list(&app, FILES_LIST, &list);
    // The list itself is shared; the File > Open Recent menu mirroring it is
    // desktop only (iOS has no menu bar).
    #[cfg(desktop)]
    crate::menu::rebuild_recent_menu(&app);
}

#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn add_recent_folder(app: tauri::AppHandle, path: String) {
    let list = push_front(read_recent_folders(&app), path, MAX_RECENT_FOLDERS);
    write_list(&app, FOLDERS_LIST, &list);
    crate::menu::rebuild_recent_menu(&app);
}

/// Clear Menu empties both lists: it is one submenu to the user.
#[cfg(desktop)]
pub fn clear_recent_files(app: &tauri::AppHandle) {
    write_list(app, FILES_LIST, &[]);
    write_list(app, FOLDERS_LIST, &[]);
    crate::menu::rebuild_recent_menu(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn reopening_an_entry_moves_it_to_the_top_without_a_duplicate() {
        assert_eq!(
            push_front(list(&["/a", "/b", "/c"]), "/b".into(), 5),
            list(&["/b", "/a", "/c"])
        );
    }

    #[test]
    fn the_oldest_entry_drops_off_at_the_limit() {
        assert_eq!(
            push_front(list(&["/a", "/b"]), "/c".into(), 2),
            list(&["/c", "/a"])
        );
    }
}
