//! Files the app is asked to open, held until a window is ready, and the other
//! things a window picks up once it has mounted.

use super::*;
use crate::commands::session::WindowSession;

/// Files handed to the app from the OS queue here, in the windows they open
/// in; each window drains one on mount. A queue, not an event: the request
/// usually arrives before any listener.
pub(crate) struct PendingOpenPaths(pub(crate) Mutex<Vec<WindowSession>>);

/// Whether any window's frontend has mounted. Before that the initial window
/// drains the queue; after it, an OS open needs a fresh window per file.
pub(crate) static UI_READY: AtomicBool = AtomicBool::new(false);

/// macOS: the files a Finder open launched the app with. AppKit hands them over
/// before setup, when there are no settings yet, so they wait here for setup.
/// `None` once setup has taken them: later opens are routed at once.
#[cfg(target_os = "macos")]
pub(crate) static LAUNCH_OPENED: Mutex<Option<Vec<String>>> = Mutex::new(Some(Vec::new()));

/// What a launch opens in its first window: files handed over (argv, or
/// Finder's before setup), else the last session's windows when kept.
#[cfg(desktop)]
pub(crate) enum LaunchOpens {
    Paths(Vec<String>),
    Windows(Vec<WindowSession>),
}

/// Set as the launch decides what it opens, before the first window is built:
/// that window's boot snapshot is made before the queue is filled.
#[cfg(desktop)]
static OPENING_AT_LAUNCH: AtomicBool = AtomicBool::new(false);

#[cfg(desktop)]
pub(crate) fn launch_opens(app: &tauri::AppHandle) -> Option<LaunchOpens> {
    #[allow(unused_mut)]
    let mut paths = paths_from_argv(
        std::env::args(),
        &std::env::current_dir().unwrap_or_default(),
    );
    #[cfg(target_os = "macos")]
    paths.extend(
        crate::locks::locked(&LAUNCH_OPENED)
            .take()
            .unwrap_or_default(),
    );
    let opens = if !paths.is_empty() {
        Some(LaunchOpens::Paths(paths))
    } else if crate::commands::prefs::read_restore_session_on_startup(app) {
        let windows = crate::commands::session::read_session_windows(app);
        (!windows.is_empty()).then_some(LaunchOpens::Windows(windows))
    } else {
        None
    };
    OPENING_AT_LAUNCH.store(opens.is_some(), Ordering::Relaxed);
    opens
}

#[cfg(desktop)]
pub(crate) fn queue_launch(app: &tauri::AppHandle, opens: Option<LaunchOpens>) {
    match opens {
        Some(LaunchOpens::Paths(paths)) => queue_paths_to_open(app, paths),
        Some(LaunchOpens::Windows(windows)) => queue_windows_to_open(app, windows),
        None => {}
    }
}

/// Whether the window being built may have something to open as it starts,
/// for its boot snapshot: the page then holds its first frame back rather
/// than showing a blank document or the start page that something replaces.
/// Wrong only towards yes, which costs a moment of empty sheet.
#[cfg(desktop)]
pub(crate) fn window_restores(app: &tauri::AppHandle, label: &str) -> bool {
    let queued = !crate::locks::locked(&app.state::<PendingOpenPaths>().0).is_empty();
    let launching = OPENING_AT_LAUNCH.load(Ordering::Relaxed) && !UI_READY.load(Ordering::Relaxed);
    let detached = app
        .try_state::<crate::tab_drag::PendingDetachedTabs>()
        .is_some_and(|pending| crate::locks::locked(&pending.0).contains_key(label));
    let own = PENDING_SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .any(|(window, _)| window == label);
    let help = crate::locks::locked(&PENDING_SHOW_HELP).is_some();
    let drafts = label == "main" && crate::commands::drafts::drafts_waiting(app);
    queued || own || launching || detached || help || drafts
}

/// A phone's one page always has its last documents to look for.
#[cfg(not(desktop))]
pub(crate) fn window_restores(_app: &tauri::AppHandle, _label: &str) -> bool {
    true
}

/// Park paths for the next window to drain as it mounts.
#[cfg(desktop)]
pub(crate) fn queue_pending(app: &tauri::AppHandle, paths: Vec<String>) {
    crate::locks::locked(&app.state::<PendingOpenPaths>().0).extend(
        paths
            .into_iter()
            .map(|path| WindowSession::of_paths(vec![path])),
    );
}

/// The last session's windows, each with its documents as tabs: a window
/// a tab was dragged out into comes back as its own window.
#[cfg(desktop)]
pub(crate) fn queue_windows_to_open(app: &tauri::AppHandle, windows: Vec<WindowSession>) {
    if windows.is_empty() {
        return;
    }
    let mut windows = windows.into_iter();
    // Launching: the first window, built already where this one was, drains the queue.
    if !UI_READY.load(Ordering::Relaxed) {
        app.state::<PendingOpenPaths>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .extend(windows.next());
    }
    // Each other one in a window of its own, where it was.
    for session in windows {
        let label = crate::editor_windows::new_window_label();
        let frame = session.frame;
        PENDING_SESSIONS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((label.clone(), session));
        if crate::editor_windows::build_window_as_left(app, &label, frame).is_err() {
            take_for(&PENDING_SESSIONS, &label);
        }
    }
}

/// The session each window opened for one was built for, by the window's label.
#[cfg(desktop)]
static PENDING_SESSIONS: Mutex<Vec<(String, WindowSession)>> = Mutex::new(Vec::new());

/// A window destroyed: a session its page never took goes with it.
#[cfg(desktop)]
pub(crate) fn window_gone(label: &str) {
    take_for(&PENDING_SESSIONS, label);
}

/// A folder handed over (dropped on the Dock icon, Open With in Finder)
/// opens as a window's folder, as Open Folder does; the rest as documents.
#[cfg(desktop)]
fn split_folders(paths: Vec<String>) -> (Vec<String>, Vec<String>) {
    paths
        .into_iter()
        .partition(|path| !std::path::Path::new(path).is_dir())
}

#[cfg(desktop)]
pub(crate) fn queue_paths_to_open(app: &tauri::AppHandle, paths: Vec<String>) {
    let (paths, folders) = split_folders(paths);
    if !folders.is_empty() {
        if UI_READY.load(Ordering::Relaxed) {
            for folder in &folders {
                open_folder_window(app, folder);
            }
        } else {
            // Launching: the first window takes the first folder, with the
            // documents beside it; each other folder gets a window.
            let mut windows: Vec<WindowSession> = folders
                .into_iter()
                .map(|folder| WindowSession {
                    folder: Some(folder),
                    ..WindowSession::default()
                })
                .collect();
            windows[0].paths = paths;
            return queue_windows_to_open(app, windows);
        }
    }
    if paths.is_empty() {
        return;
    }
    let ui_ready = UI_READY.load(Ordering::Relaxed);
    // Documents open as tabs, always. Already running: hand the whole batch
    // to the window that has them or whose folder holds them (open_route),
    // else the focused one. Nothing is queued then, or the next window to
    // mount would open them again.
    let target = if ui_ready {
        let focused = menu::focused_editor_window(app);
        let windows = app
            .state::<crate::commands::session::SessionTabsState>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let live: std::collections::HashMap<_, _> = windows
            .into_iter()
            .filter(|(label, _)| {
                crate::windows::is_editor_window(label) && app.get_window(label).is_some()
            })
            .collect();
        crate::open_route::window_for(&live, &paths, focused.as_deref()).or(focused)
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
        if let Some(window) = app.get_window(&label) {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        return;
    }
    // No window yet (launching) or none left (macOS): the app opens as it
    // would anyway, its last session back, with these in it.
    let pending_empty = crate::locks::locked(&app.state::<PendingOpenPaths>().0).is_empty();
    if pending_empty
        && (!ui_ready || crate::editor_windows::last_editor(app).is_none())
        && crate::commands::prefs::read_restore_session_on_startup(app)
    {
        let saved = crate::commands::session::read_session_windows(app);
        if !saved.is_empty() {
            return queue_windows_to_open(
                app,
                crate::commands::session::with_documents(saved, paths),
            );
        }
    }
    // Still launching, or no window alive: park the whole batch, as one
    // window's tabs, for the window that mounts next.
    app.state::<PendingOpenPaths>()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(WindowSession::of_paths(paths));
    if ui_ready {
        let _ = crate::editor_windows::open_new_window(app);
    }
}

/// iOS: one webview. Before it mounts, the paths are parked; after, they are
/// handed over as tabs. Android hands no files over this way.
#[cfg(target_os = "ios")]
pub(crate) fn queue_paths_to_open(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if UI_READY.load(Ordering::Relaxed) {
        let _ = app.emit("open-paths-as-tabs", paths);
    } else {
        // One batch: the one webview takes one, as its tabs.
        app.state::<PendingOpenPaths>()
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(WindowSession::of_paths(paths));
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
    crate::locks::locked(&PENDING_SHOW_HELP).take()
}

/// A menu command that needs a window, chosen while none was open (macOS): the
/// fresh window opened for it runs it once mounted.
#[cfg(desktop)]
pub(crate) static PENDING_MENU_EVENT: Mutex<Option<&'static str>> = Mutex::new(None);

#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_menu_event() -> Option<&'static str> {
    crate::locks::locked(&PENDING_MENU_EVENT).take()
}

/// The folder each new window was opened for (a recent folder with no
/// window open, or ⌘/Ctrl-clicked), by the window's label: that window takes
/// it into its sidebar once mounted, and no other - two opened one after the
/// other each get their own.
#[cfg(desktop)]
static PENDING_OPEN_FOLDERS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// What was kept for the window `label`, once.
#[cfg(desktop)]
fn take_for<T>(pending: &Mutex<Vec<(String, T)>>, label: &str) -> Option<T> {
    let mut pending = pending.lock().unwrap_or_else(|e| e.into_inner());
    let at = pending.iter().position(|(window, _)| window == label)?;
    Some(pending.remove(at).1)
}

#[cfg(desktop)]
fn take_folder_for(label: &str) -> Option<String> {
    take_for(&PENDING_OPEN_FOLDERS, label)
}

#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_open_folder(window: tauri::Window) -> Option<String> {
    take_folder_for(window.label())
}

/// A new window with `path` as its folder.
#[cfg(desktop)]
pub(crate) fn open_folder_window(app: &tauri::AppHandle, path: &str) {
    let label = crate::editor_windows::new_window_label();
    PENDING_OPEN_FOLDERS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push((label.clone(), path.to_string()));
    // No window came of it: its folder isn't left for one that didn't ask.
    if crate::editor_windows::build_window(app, &label, None).is_err() {
        take_folder_for(&label);
    }
}

/// File > Open Recent from a window that keeps what it holds: the file opens as
/// a file manager's open does.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) async fn open_paths(app: tauri::AppHandle, paths: Vec<String>) {
    queue_paths_to_open(&app, paths);
}

/// ⌘/Ctrl-click in the sidebar's file tree: the file in a window of its own.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) async fn open_path_in_new_window(app: tauri::AppHandle, path: String) {
    queue_pending(&app, vec![path]);
    let _ = crate::editor_windows::open_new_window(&app);
}

/// ⌘/Ctrl-click on a recent folder: the folder in a window of its own, this
/// window's workspace left as it is.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) async fn open_folder_in_new_window(app: tauri::AppHandle, path: String) {
    open_folder_window(&app, &path);
}

/// What the window mounting now opens: a session's window (its documents,
/// islands and folder), or files the system handed over.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub(crate) fn take_pending_window(
    window: tauri::Window,
    pending: State<PendingOpenPaths>,
) -> Option<WindowSession> {
    UI_READY.store(true, Ordering::Relaxed);
    #[cfg(desktop)]
    if let Some(session) = take_for(&PENDING_SESSIONS, window.label()) {
        return Some(session);
    }
    #[cfg(not(desktop))]
    let _ = window;
    let mut windows = crate::locks::locked(&pending.0);
    (!windows.is_empty()).then(|| windows.remove(0))
}

/// Files the system asked to open: Finder's "Open With" on macOS (never
/// argv) and "Open in Textus" on iOS.
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub(crate) fn open_urls(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    // iOS hands over a security-scoped URL, kept as a URL so the textus-files
    // plugin can open its scope.
    #[cfg(target_os = "ios")]
    let paths: Vec<String> = urls
        .iter()
        .filter(|url| url.scheme() == "file")
        .map(|url| url.to_string())
        .collect();
    #[cfg(not(target_os = "ios"))]
    let paths: Vec<String> = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    // Still launching: setup opens them (LAUNCH_OPENED).
    #[cfg(target_os = "macos")]
    let paths = match crate::locks::locked(&LAUNCH_OPENED).as_mut() {
        Some(early) => {
            early.extend(paths);
            Vec::new()
        }
        None => paths,
    };
    queue_paths_to_open(app, paths);
}

#[cfg(all(test, desktop))]
mod folder_tests {
    use super::*;

    #[test]
    fn a_folder_handed_over_opens_as_a_folder_not_a_document() {
        let dir = std::env::temp_dir().join("textus-split-folders");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.md");
        std::fs::write(&file, "x").unwrap();
        let (dir, file) = (
            dir.to_string_lossy().into_owned(),
            file.to_string_lossy().into_owned(),
        );
        let (files, folders) = split_folders(vec![file.clone(), dir.clone()]);
        assert_eq!(files, vec![file]);
        assert_eq!(folders, vec![dir]);
    }

    #[test]
    fn each_new_window_takes_the_folder_opened_for_it_once() {
        let keep = |label: &str, path: &str| {
            PENDING_OPEN_FOLDERS
                .lock()
                .unwrap()
                .push((label.to_string(), path.to_string()))
        };
        // Two folders opened one after the other, the second window up first.
        keep("window-t1", "/a");
        keep("window-t2", "/b");
        assert_eq!(take_folder_for("window-t2").as_deref(), Some("/b"));
        assert_eq!(take_folder_for("window-other"), None);
        assert_eq!(take_folder_for("window-t1").as_deref(), Some("/a"));
        assert_eq!(take_folder_for("window-t1"), None);
    }

    #[test]
    fn each_restored_window_takes_the_session_built_for_it() {
        let keep = |label: &str, path: &str| {
            crate::locks::locked(&PENDING_SESSIONS).push((
                label.to_string(),
                WindowSession::of_paths(vec![path.into()]),
            ))
        };
        keep("window-s1", "/a.md");
        keep("window-s2", "/b.md");
        // Mounted out of order, each still gets its own documents.
        let b = take_for(&PENDING_SESSIONS, "window-s2").unwrap();
        assert_eq!(b.paths, ["/b.md"]);
        assert_eq!(
            take_for(&PENDING_SESSIONS, "window-s1").unwrap().paths,
            ["/a.md"]
        );
        assert!(take_for(&PENDING_SESSIONS, "window-s1").is_none());
        // A window destroyed before its page took its session: none kept.
        keep("window-s3", "/c.md");
        window_gone("window-s3");
        assert!(!PENDING_SESSIONS
            .lock()
            .unwrap()
            .iter()
            .any(|(label, _)| label == "window-s3"));
    }
}
