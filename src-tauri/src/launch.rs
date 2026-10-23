//! Files the app is asked to open - at launch, from another instance,
//! from the OS - held until a window is ready for them - and the other
//! things a window picks up once it has mounted.

use super::*;

/// Files handed to the app from the OS (Finder "Open With", double-click on
/// an associated .md) queue up here; each window's frontend drains exactly
/// one on mount via `take_pending_open_path`. Queue-then-drain instead of an
/// event because the open request usually arrives before any webview has
/// mounted its listeners - an emit would vanish into the void.
pub(crate) struct PendingOpenPaths(pub(crate) Mutex<Vec<String>>);

/// Whether any window's frontend has mounted (= called
/// take_pending_open_path at least once). Before that, the config-defined
/// initial window will drain the queue itself; after it, an OS open request
/// needs a fresh window per file.
pub(crate) static UI_READY: AtomicBool = AtomicBool::new(false);

/// macOS: the files a Finder open launched the app with. AppKit hands them
/// over (RunEvent::Opened) before setup has run - between will- and
/// didFinishLaunching - when there are no settings yet to say tab or
/// window. Routed then, two files opened a second window without a boot
/// script (unstyled, with the language picker), and a file that was also in
/// the last session opened in two tabs. They wait here instead, and
/// desktop_setup opens them the way Windows and Linux open argv paths.
/// `None` once setup has taken them: later opens are routed at once.
#[cfg(target_os = "macos")]
pub(crate) static LAUNCH_OPENED: Mutex<Option<Vec<String>>> = Mutex::new(Some(Vec::new()));

/// Park paths for the next window to drain (see take_pending_open_path(s),
/// which the frontend calls as it mounts).
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
        // Already running: hand the whole batch to ONE live window as tabs
        // instead of spawning a window per path. The focused window, not
        // whichever one webview_windows() happens to yield first (it's a
        // HashMap - the order is arbitrary), so the file lands where the
        // user is looking. Nothing is queued on this path: the receiving
        // window opens the paths straight from the event, and a leftover
        // queue entry would be opened a second time by the next window to
        // mount.
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
        // Still launching, or no window alive to receive them: park the whole
        // batch for the window that mounts next - the initial one, or the
        // fresh one opened here - which drains all of it as its own tabs.
        queue_pending(app, paths);
        if ui_ready {
            let _ = open_new_window(app);
        }
        return;
    }

    // "window" mode (default): unchanged - one queued file rides the initial
    // window while the app is still launching; everything else gets a
    // window of its own, which drains one path when its frontend mounts.
    let count = paths.len();
    queue_pending(app, paths);
    let extra_windows = if ui_ready { count } else { count - 1 };
    for _ in 0..extra_windows {
        let _ = open_new_window(app);
    }
}

/// iOS: one webview, no windows to open. Before it has mounted, the paths are
/// parked for it to drain (take_pending_open_path(s)); after, they are handed
/// straight over as tabs - the same event desktop's tab mode uses.
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

/// The files named on a command line: every argument after the program
/// name that isn't a flag. `textus notes.md` from a shell passes a path
/// relative to that shell's directory - which, for a second launch handed
/// over by single-instance, is not this process's own - while everything
/// downstream (tabs, recents, session) wants it absolute. Desktop launchers
/// already pass absolute paths, which `join` leaves as they are.
#[cfg(desktop)]
pub(crate) fn paths_from_argv(
    args: impl IntoIterator<Item = String>,
    cwd: &std::path::Path,
) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| cwd.join(&a).to_string_lossy().into_owned())
        .collect()
}

/// A Help menu doc clicked while no window could receive the event: the
/// fresh window spawned for it drains this on mount, same queue-then-drain
/// reasoning as PendingOpenPaths (an emit would fire before the new webview
/// mounts its listeners). The docs themselves are bundled in the frontend
/// (src/help/), so the doc id is all Rust needs to carry.
#[cfg(desktop)]
pub(crate) static PENDING_SHOW_HELP: Mutex<Option<String>> = Mutex::new(None);

#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_show_help() -> Option<String> {
    PENDING_SHOW_HELP.lock().unwrap().take()
}

/// A menu command that needs a window (Settings…, Open…), chosen while none
/// was open - macOS keeps running after its last window closes: the fresh
/// window opened for it runs it once mounted. Holds the menu event that
/// window would otherwise have been sent. Same queue-then-drain as
/// PENDING_SHOW_HELP.
#[cfg(desktop)]
pub(crate) static PENDING_MENU_EVENT: Mutex<Option<&'static str>> = Mutex::new(None);

#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_menu_event() -> Option<&'static str> {
    PENDING_MENU_EVENT.lock().unwrap().take()
}

/// A folder from File > Open Recent chosen while no window was open: the
/// fresh window opened for it takes it into its sidebar once mounted. Same
/// queue-then-drain as PENDING_MENU_EVENT, with the folder's path.
#[cfg(desktop)]
pub(crate) static PENDING_OPEN_FOLDER: Mutex<Option<String>> = Mutex::new(None);

#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_open_folder() -> Option<String> {
    PENDING_OPEN_FOLDER.lock().unwrap().take()
}

/// File > Open Recent from a window that keeps what it holds (menu.rs, then
/// useFileOpening.ts's openRecentFile): the file opens the way a file
/// manager's open does - a window of its own, or a tab per the setting.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn open_paths(app: tauri::AppHandle, paths: Vec<String>) {
    queue_paths_to_open(&app, paths);
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

/// Tab-mode counterpart to take_pending_open_path: drains the whole queue at
/// once so a single window can open every pending path as its own tab,
/// instead of one window claiming just the first path off the front.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_open_paths(pending: State<PendingOpenPaths>) -> Vec<String> {
    UI_READY.store(true, Ordering::Relaxed);
    let mut paths = pending.0.lock().unwrap();
    std::mem::take(&mut *paths)
}
