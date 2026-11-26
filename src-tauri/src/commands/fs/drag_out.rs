//! Rows of the file tree dragged out of the window: handed to the system as
//! a real file drag, so a file manager, a mail or any other app takes them.

use super::secrets::{not_a_secret, own_config_dir};
use std::path::{Path, PathBuf};

/// What goes out of `paths`: each one absolute and there, once, never one
/// inside another that goes too (the folder carries it), and only what `may`
/// lets out.
fn outgoing(paths: &[String], may: impl Fn(&Path) -> bool) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for path in paths.iter().map(PathBuf::from) {
        if !path.is_absolute() || path.symlink_metadata().is_err() || !may(&path) {
            continue;
        }
        if out.iter().any(|kept| path.starts_with(kept)) {
            continue;
        }
        out.retain(|kept| !kept.starts_with(&path));
        out.push(path);
    }
    out
}

/// Starts the system's drag of `paths` from this window, as copies (a move
/// would take files from under open tabs with nothing to undo it). Resolves
/// once the drag ends: true when something took it. Nothing starts once the
/// button is already up. Its TypeScript side is `fs.dragOut` in
/// src/platform/ipc-files.ts.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn start_file_drag_out(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    paths: Vec<String>,
) -> Result<bool, String> {
    let config = own_config_dir(&app);
    let items = outgoing(&paths, |path| {
        not_a_secret(&app, &path.to_string_lossy()).is_ok()
            && !config.as_deref().is_some_and(|c| c.starts_with(path))
    });
    if items.is_empty() {
        return Ok(false);
    }
    #[cfg(desktop)]
    {
        native::drag(&app, window, items).await
    }
    #[cfg(not(desktop))]
    {
        let _ = window;
        Ok(false)
    }
}

#[cfg(desktop)]
mod native {
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;

    /// The drag's picture: the app's icon at its smallest.
    const ICON: &[u8] = include_bytes!("../../../icons/32x32.png");

    pub(super) async fn drag(
        app: &tauri::AppHandle,
        window: tauri::WebviewWindow,
        items: Vec<PathBuf>,
    ) -> Result<bool, String> {
        let (tx, rx) = oneshot::channel::<bool>();
        // The drag's end may be told from inside start_drag (Windows) or
        // later (macOS, GTK); either way once.
        let tell = Arc::new(Mutex::new(Some(tx)));
        let told = tell.clone();
        let end = move |dropped: bool| {
            if let Some(tx) = told.lock().unwrap().take() {
                let _ = tx.send(dropped);
            }
        };
        let fail = end.clone();
        app.run_on_main_thread(move || {
            #[cfg(any(target_os = "macos", windows))]
            if !crate::tab_drag::mouse::left_button_down() {
                return fail(false);
            }
            let options = drag::Options {
                mode: drag::DragMode::Copy,
                ..Default::default()
            };
            let image = drag::Image::Raw(ICON.to_vec());
            let done = move |result: drag::DragResult, _: drag::CursorPosition| {
                end(matches!(result, drag::DragResult::Dropped))
            };
            let items = drag::DragItem::Files(items);
            #[cfg(target_os = "linux")]
            let started = match window.gtk_window() {
                Ok(gtk) => drag::start_drag(&gtk, items, image, done, options),
                Err(_) => return fail(false),
            };
            #[cfg(not(target_os = "linux"))]
            let started = drag::start_drag(&window, items, image, done, options);
            if started.is_err() {
                fail(false);
            }
        })
        .map_err(|e| e.to_string())?;
        Ok(rx.await.unwrap_or(false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("textus-drag-out-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("notes/inner")).unwrap();
        std::fs::write(dir.join("notes/a.md"), "a").unwrap();
        std::fs::write(dir.join("notes/inner/b.md"), "b").unwrap();
        std::fs::write(dir.join("c.md"), "c").unwrap();
        dir
    }

    fn strings(paths: &[PathBuf]) -> Vec<String> {
        paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn several_rows_go_out_together_each_once() {
        let dir = scratch("several");
        let (a, c) = (dir.join("notes/a.md"), dir.join("c.md"));
        let out = outgoing(&strings(&[a.clone(), c.clone(), a.clone()]), |_| true);
        assert_eq!(out, vec![a, c]);
    }

    #[test]
    fn a_folder_carries_what_is_inside_it() {
        let dir = scratch("folder");
        let (notes, b) = (dir.join("notes"), dir.join("notes/inner/b.md"));
        let c = dir.join("c.md");
        // The inner row first or last, only the folder goes.
        assert_eq!(
            outgoing(&strings(&[b.clone(), notes.clone(), c.clone()]), |_| true),
            vec![notes.clone(), c.clone()]
        );
        assert_eq!(
            outgoing(&strings(&[notes.clone(), b]), |_| true),
            vec![notes]
        );
    }

    #[test]
    fn nothing_missing_relative_or_held_back_goes() {
        let dir = scratch("held");
        let (a, c) = (dir.join("notes/a.md"), dir.join("c.md"));
        let gone = dir.join("gone.md");
        let paths = [
            strings(&[gone, a.clone(), c.clone()]),
            vec!["notes/a.md".to_string(), String::new()],
        ]
        .concat();
        assert_eq!(outgoing(&paths, |p| p != c.as_path()), vec![a]);
    }
}
