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
