//! Files the app is asked to open, held until a window is ready, and the other
//! things a window picks up once it has mounted.

use super::*;

/// Files handed to the app from the OS queue here; each window drains one on
/// mount. A queue, not an event: the request usually arrives before any listener.
pub(crate) struct PendingOpenPaths(pub(crate) Mutex<Vec<String>>);

/// Whether any window's frontend has mounted. Before that the initial window
/// drains the queue; after it, an OS open needs a fresh window per file.
pub(crate) static UI_READY: AtomicBool = AtomicBool::new(false);

/// macOS: the files a Finder open launched the app with. AppKit hands them over
/// before setup, when there are no settings yet, so they wait here for setup.
/// `None` once setup has taken them: later opens are routed at once.
#[cfg(target_os = "macos")]
pub(crate) static LAUNCH_OPENED: Mutex<Option<Vec<String>>> = Mutex::new(Some(Vec::new()));

/// Park paths for the next window to drain as it mounts.
pub(crate) fn queue_pending(app: &tauri::AppHandle, paths: Vec<String>) {
    app.state::<PendingOpenPaths>()
        .0
        .lock()
        .unwrap()
        .extend(paths);
}

#[cfg(desktop)]
pub(crate) fn queue_paths_to_open(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    let ui_ready = UI_READY.load(Ordering::Relaxed);

    if commands::prefs::read_new_document_mode(app) == "tab" {
        // Already running: hand the whole batch to the focused window as tabs.
        // Nothing is queued here, or the next window to mount would open them again.
        let target = if ui_ready {
            menu::focused_editor_window(app)
        } else {
            None
        };
        if let Some(label) = target {
            let _ = app.emit_to(
                EventTarget::webview_window(&label),
                "open-paths-as-tabs",
                paths,
            );
            // The open came from outside (a file manager, a second launch),
            // so the window it landed in is probably behind something.
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            return;
        }
        // Still launching, or no window alive: park the whole batch for the window
        // that mounts next.
        queue_pending(app, paths);
        if ui_ready {
            let _ = open_new_window(app);
        }
        return;
    }

    // "window" mode (default): one queued file rides the initial window while
    // launching; everything else gets a window of its own.
    let count = paths.len();
    queue_pending(app, paths);
    let extra_windows = if ui_ready { count } else { count - 1 };
    for _ in 0..extra_windows {
        let _ = open_new_window(app);
    }
}

/// iOS: one webview. Before it mounts, the paths are parked; after, they are
/// handed over as tabs.
#[cfg(mobile)]
pub(crate) fn queue_paths_to_open(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if UI_READY.load(Ordering::Relaxed) {
        let _ = app.emit("open-paths-as-tabs", paths);
    } else {
        queue_pending(app, paths);
    }
}

/// The files named on a command line: every non-flag argument after the
/// program name, made absolute against the caller's `cwd` (a second launch's
/// directory is not ours).
#[cfg(desktop)]
pub(crate) fn paths_from_argv(
    args: impl IntoIterator<Item = String>,
    cwd: &std::path::Path,
) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-') && !crate::plugins::uri::is_textus_uri(a))
        .map(|a| cwd.join(&a).to_string_lossy().into_owned())
        .collect()
}

/// A Help menu doc clicked while no window could receive the event: the fresh
/// window spawned for it drains this on mount.
#[cfg(desktop)]
pub(crate) static PENDING_SHOW_HELP: Mutex<Option<String>> = Mutex::new(None);

#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_show_help() -> Option<String> {
    PENDING_SHOW_HELP.lock().unwrap().take()
}

/// A menu command that needs a window, chosen while none was open (macOS): the
/// fresh window opened for it runs it once mounted.
#[cfg(desktop)]
pub(crate) static PENDING_MENU_EVENT: Mutex<Option<&'static str>> = Mutex::new(None);

#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_menu_event() -> Option<&'static str> {
    PENDING_MENU_EVENT.lock().unwrap().take()
}

/// A folder from File > Open Recent chosen while no window was open: the fresh
/// window takes it into its sidebar once mounted.
#[cfg(desktop)]
pub(crate) static PENDING_OPEN_FOLDER: Mutex<Option<String>> = Mutex::new(None);

#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_open_folder() -> Option<String> {
    PENDING_OPEN_FOLDER.lock().unwrap().take()
}

/// File > Open Recent from a window that keeps what it holds: the file opens as
/// a file manager's open does.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn open_paths(app: tauri::AppHandle, paths: Vec<String>) {
    queue_paths_to_open(&app, paths);
}

/// ⌘/Ctrl-click in the sidebar's file tree: the file in a window of its own,
/// whatever the tab setting.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn open_path_in_new_window(app: tauri::AppHandle, path: String) {
    queue_pending(&app, vec![path]);
    let _ = open_new_window(&app);
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_open_path(pending: State<PendingOpenPaths>) -> Option<String> {
    UI_READY.store(true, Ordering::Relaxed);
    let mut paths = pending.0.lock().unwrap();
    if paths.is_empty() {
        None
    } else {
        Some(paths.remove(0))
    }
}

/// Tab-mode counterpart to take_pending_open_path: drains the whole queue so
/// one window opens every path as a tab.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_open_paths(pending: State<PendingOpenPaths>) -> Vec<String> {
    UI_READY.store(true, Ordering::Relaxed);
    let mut paths = pending.0.lock().unwrap();
    std::mem::take(&mut *paths)
}
