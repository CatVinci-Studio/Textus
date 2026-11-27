//! settings.json changed by another program (a hand edit, a tool that sets
//! up Textus's AI, a synced folder): the fields it changed are taken into
//! the live settings and every window hears them, as a window's own change
//! is heard. Without this the next save of ours wrote the file whole again,
//! over what was changed.

use super::*;
use notify::{EventKind, RecursiveMode, Watcher};
use std::sync::mpsc;

/// A save is often a few events (a temporary file, a rename): one look
/// after they stop.
const SETTLE: Duration = Duration::from_millis(300);

/// Watches the settings file's folder for the file changing, from launch for
/// the app's life. Its own writes change nothing it doesn't already have.
pub fn watch(app: &AppHandle) {
    let stores = app.state::<Stores>();
    let store = Arc::clone(&stores.settings);
    let (Some(dir), Some(name)) = (
        store.path.parent().map(Path::to_path_buf),
        store.path.file_name().map(|n| n.to_os_string()),
    ) else {
        return;
    };
    let (tx, rx) = mpsc::channel::<()>();
    let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        if event
            .paths
            .iter()
            .any(|p| p.file_name() == Some(name.as_os_str()))
        {
            let _ = tx.send(());
        }
    });
    let Ok(mut watcher) = watcher else { return };
    if watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let _watcher = watcher;
        while rx.recv().is_ok() {
            while rx.recv_timeout(SETTLE).is_ok() {}
            let Some((patch, rev)) = store.take_outside_changes() else {
                continue;
            };
            let stores = app.state::<Stores>();
            settings_took(&app, &stores, &patch);
            emit_to_all(
                &app,
                "settings-changed",
                SettingsChanged {
                    rev,
                    patch,
                    from: "settings.json".to_string(),
                },
            );
        }
    });
}
