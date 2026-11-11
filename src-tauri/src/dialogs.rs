//! Native dialogs, each owned by the window that asked for it.

/// A native file dialog owned by the window that asked for it. Unowned, a
/// Windows dialog can open behind the app, and a macOS sheet can land on a hidden window.
pub(crate) fn window_file_dialog(
    window: &tauri::WebviewWindow,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    use tauri_plugin_dialog::DialogExt;
    let dialog = window.dialog().file();
    // set_parent is desktop-only API; iOS presents the picker modally over
    // its single window anyway.
    #[cfg(desktop)]
    let dialog = dialog.set_parent(window);
    dialog
}

/// A file picked with `filters` (a name and its extensions each); None
/// when the user cancels.
pub(crate) async fn pick_file(
    window: tauri::WebviewWindow,
    filters: Vec<(String, Vec<String>)>,
) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        filters
            .iter()
            .fold(window_file_dialog(&window), |dialog, (name, exts)| {
                let exts: Vec<&str> = exts.iter().map(String::as_str).collect();
                dialog.add_filter(name, &exts)
            })
            .blocking_pick_file()
            .map(|p| p.to_string())
    })
    .await
    .ok()
    .flatten()
}

/// Where to save, as `name` (in `dir` when it is a folder), with the one
/// `filter` and `ext` added to a name typed without one.
pub(crate) async fn save_file(
    window: tauri::WebviewWindow,
    name: String,
    dir: Option<String>,
    filter: (String, String),
) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (filter_name, ext) = filter;
        let dialog = window_file_dialog(&window);
        let dialog = match dir.filter(|d| std::path::Path::new(d).is_dir()) {
            Some(dir) => dialog.set_directory(dir),
            None => dialog,
        };
        dialog
            .set_file_name(name)
            .add_filter(&filter_name, &[ext.as_str()])
            .blocking_save_file()
            .map(|p| crate::commands::fs::with_default_extension(p.to_string(), &ext))
    })
    .await
    .ok()
    .flatten()
}
