//! Plugins' system notifications, and their click: Textus comes up with the
//! file the notification names open at its line. Each system has its own
//! backend; where a click can't come back (an unbundled macOS build, a Linux
//! notification server without actions) the next time Textus becomes active
//! within a minute stands in for it.

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
use linux as backend;
#[cfg(target_os = "macos")]
use macos as backend;
#[cfg(windows)]
use windows as backend;

use super::jobs::{NotificationOpen, NotificationSpec};
use crate::plugins::state;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Rust -> an editor window: a notification was clicked; take what to open
/// with `notify_take_open`.
pub const OPEN_EVENT: &str = "notification-open";

/// How many clicked-to-be targets are kept, and for how long: a click can
/// come after Textus restarted (Windows starts it for one).
const KEPT: usize = 50;
const KEPT_MS: i64 = 7 * 24 * 3_600_000;
/// How long "the next activation" stands in for a click that can't come.
const FALLBACK_MS: i64 = 60_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Target {
    id: String,
    open: NotificationOpen,
    shown: i64,
}

/// What clicks open, and the open waiting for a window.
#[derive(Default)]
pub struct Notifications {
    targets: Mutex<Option<VecDeque<Target>>>,
    pending: Mutex<Option<NotificationOpen>>,
    fallback: Mutex<Option<(NotificationOpen, i64)>>,
}

fn targets_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    Some(
        app.path()
            .app_data_dir()
            .ok()?
            .join("plugins")
            .join("notification-clicks.json"),
    )
}

/// The targets, read from disk the first time.
fn with_targets<T>(app: &tauri::AppHandle, f: impl FnOnce(&mut VecDeque<Target>) -> T) -> T {
    let state = app.state::<Notifications>();
    let mut targets = state.targets.lock().unwrap_or_else(|e| e.into_inner());
    let list = targets.get_or_insert_with(|| {
        targets_file(app)
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    });
    f(list)
}

fn save_targets(app: &tauri::AppHandle, list: &VecDeque<Target>) {
    let Some(path) = targets_file(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_vec(list) {
        let _ = crate::atomic::write_sync(&path, json);
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// An id no one can guess, so a textus:// link from a web page can't name one.
fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// The file a notification opens, made absolute inside `root`: a plugin
/// names a file of the folder it was granted, nothing else.
fn resolve(open: &NotificationOpen, root: Option<&str>) -> Result<NotificationOpen, String> {
    let root = root.ok_or("A notification opens a file of the open folder; none is open.")?;
    let path = crate::plugins::access::inside(Path::new(root), Path::new(&open.path))?;
    Ok(NotificationOpen {
        path: path.to_string_lossy().into_owned(),
        line: open.line,
    })
}

/// Shows a plugin's notification. Rust checks the grants again: notifications,
/// and files.read for a file to open.
pub fn show(
    app: &tauri::AppHandle,
    plugin: &str,
    spec: &NotificationSpec,
    root: Option<&str>,
) -> Result<(), String> {
    let plugins = state::read(app);
    if !plugins.allows(plugin, "notifications") {
        return Err(crate::plugins::access::refused(plugin, "notifications"));
    }
    let open = match &spec.open {
        Some(_) if !plugins.allows(plugin, "files.read") => {
            return Err(crate::plugins::access::refused(plugin, "files.read"));
        }
        Some(open) => Some(resolve(open, root)?),
        None => None,
    };
    let id = new_id();
    if let Some(open) = &open {
        let now = now_ms();
        with_targets(app, |list| {
            list.retain(|t| now - t.shown < KEPT_MS);
            list.push_back(Target {
                id: id.clone(),
                open: open.clone(),
                shown: now,
            });
            while list.len() > KEPT {
                list.pop_front();
            }
            save_targets(app, list);
        });
    }
    let clicks_return = backend::show(app, &id, spec.title.trim(), &spec.body)?;
    if let (false, Some(open)) = (clicks_return, open) {
        *app.state::<Notifications>()
            .fallback
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some((open, now_ms()));
    }
    Ok(())
}

/// A notification of ours was clicked.
pub fn clicked(app: &tauri::AppHandle, id: &str) {
    let open = with_targets(app, |list| {
        list.iter().find(|t| t.id == id).map(|t| t.open.clone())
    });
    if let Some(open) = open {
        open_target(app, open);
    } else {
        crate::editor_windows::reopen_without_windows(app);
    }
}

/// Textus came to the front: a click that couldn't come back, shortly after.
pub fn activated(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<Notifications>() else {
        return;
    };
    let waiting = state
        .fallback
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
    if let Some((open, shown)) = waiting {
        if now_ms() - shown < FALLBACK_MS {
            open_target(app, open);
        }
    }
}

/// Brings Textus up with `open` waiting for a window: the front editor
/// window is told, or one opens and takes it as it mounts.
fn open_target(app: &tauri::AppHandle, open: NotificationOpen) {
    *app.state::<Notifications>()
        .pending
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(open);
    let window = crate::menu::focused_editor_window(app).and_then(|l| app.get_webview_window(&l));
    match window {
        Some(window) => {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit_to(
                tauri::EventTarget::webview_window(window.label()),
                OPEN_EVENT,
                (),
            );
        }
        None => crate::editor_windows::reopen_without_windows(app),
    }
}

/// Sets the backend up: the click handler, where the system needs one first.
pub fn install(app: &tauri::AppHandle) {
    backend::install(app);
}

/// `textus.notify.show`, from a window's plugin host or a background run.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn notify_show(
    app: tauri::AppHandle,
    id: String,
    notification: NotificationSpec,
    root: Option<String>,
) -> Result<(), String> {
    show(&app, &id, &notification, root.as_deref())
}

/// The file a clicked notification opens, taken by the window that shows it.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn notify_take_open(app: tauri::AppHandle) -> Option<NotificationOpen> {
    app.try_state::<Notifications>()?
        .pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_long_and_never_repeat() {
        let a = new_id();
        let b = new_id();
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }

    #[test]
    fn a_notification_opens_only_a_file_of_its_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("today.md"), "").unwrap();
        let root = dir.path().to_str().unwrap();
        let open = |path: &str| NotificationOpen {
            path: path.to_string(),
            line: Some(3),
        };
        let inside = resolve(&open("today.md"), Some(root)).unwrap();
        assert!(inside.path.ends_with("today.md"));
        assert_eq!(inside.line, Some(3));
        assert!(resolve(&open("../elsewhere.md"), Some(root)).is_err());
        assert!(resolve(&open("/etc/hosts"), Some(root)).is_err());
        assert!(resolve(&open("today.md"), None).is_err());
    }
}
