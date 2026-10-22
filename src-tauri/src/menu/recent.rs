//! The Open Recent submenu: recent files and folders, shown short.

use super::*;

/// How a recent folder reads in the submenu: its path ending in a
/// separator, which sets it apart from the files below it in any language.
pub(crate) fn folder_menu_text(path: &str) -> String {
    let sep = if path.contains('\\') && !path.contains('/') {
        '\\'
    } else {
        '/'
    };
    let shown = abbreviate_home(path);
    menu_text(&format!("{}{sep}", shown.trim_end_matches(['/', '\\'])))
}

pub(crate) fn abbreviate_home(path: &str) -> String {
    // Windows has no HOME; without USERPROFILE every recent file there shows
    // its full C:\Users\... prefix and the submenu is unreadable.
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok();
    if let Some(home) = home {
        if let Some(rest) = path.strip_prefix(&home) {
            return format!("~{rest}");
        }
    }
    path.to_string()
}

/// Refill the Open Recent submenu from the persisted lists, most recent
/// first: the folders, then the files. Menus may only be mutated on the
/// main thread, and the caller may be a command on any thread - hence the
/// hop.
pub(crate) fn rebuild_recent_menu(app: &tauri::AppHandle) {
    let folders = commands::recents::read_recent_folders(app);
    let list = commands::recents::read_recent_files(app);
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(state) = app.try_state::<RecentMenu>() else {
            return;
        };
        let guard = state.0.lock().unwrap();
        let Some(submenu) = guard.as_ref() else {
            return;
        };
        let labels = app
            .try_state::<MenuLabels>()
            .map(|state| state.0.lock().unwrap().clone())
            .unwrap_or_default();
        if let Ok(items) = submenu.items() {
            for item in items {
                let _ = submenu.remove(&item);
            }
        }
        if list.is_empty() && folders.is_empty() {
            if let Ok(item) = MenuItemBuilder::with_id(
                "recent-none",
                label(&labels, "recent-none", "No Recent Files"),
            )
            .enabled(false)
            .build(&app)
            {
                let _ = submenu.append(&item);
            }
            return;
        }
        for path in &folders {
            if let Ok(item) = MenuItemBuilder::with_id(
                format!("{RECENT_FOLDER_PREFIX}{path}"),
                folder_menu_text(path),
            )
            .build(&app)
            {
                let _ = submenu.append(&item);
            }
        }
        if !folders.is_empty() && !list.is_empty() {
            if let Ok(sep) = PredefinedMenuItem::separator(&app) {
                let _ = submenu.append(&sep);
            }
        }
        for path in &list {
            if let Ok(item) = MenuItemBuilder::with_id(
                format!("{RECENT_PREFIX}{path}"),
                menu_text(&abbreviate_home(path)),
            )
            .build(&app)
            {
                let _ = submenu.append(&item);
            }
        }
        if let Ok(sep) = PredefinedMenuItem::separator(&app) {
            let _ = submenu.append(&sep);
        }
        if let Ok(item) = MenuItemBuilder::with_id(
            RECENT_CLEAR_ID,
            label(&labels, RECENT_CLEAR_ID, "Clear Menu"),
        )
        .build(&app)
        {
            let _ = submenu.append(&item);
        }
    });
}
