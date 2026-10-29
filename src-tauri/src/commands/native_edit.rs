//! The Edit menu's actions sent as the system's own items send them: to the
//! first responder, the field, frame or page with the caret. On macOS the
//! menu's Paste goes this way, as a page that reads the clipboard is shown a
//! "Paste" callout to click first; Undo, Redo and Select All go this way
//! wherever the editor isn't the one with the keyboard.

use serde::Deserialize;

#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(test, derive(specta::Type))]
pub enum NativeEdit {
    Paste,
    Undo,
    Redo,
    SelectAll,
}

/// Sends `action` to whatever has the keyboard. False where the page acts
/// itself (everywhere but macOS).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn edit_natively(window: tauri::WebviewWindow, action: NativeEdit) -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2::sel;
        use objc2_app_kit::NSApplication;
        use objc2_foundation::MainThreadMarker;
        let selector = match action {
            NativeEdit::Paste => sel!(paste:),
            NativeEdit::Undo => sel!(undo:),
            NativeEdit::Redo => sel!(redo:),
            NativeEdit::SelectAll => sel!(selectAll:),
        };
        window
            .run_on_main_thread(move || {
                let Some(mtm) = MainThreadMarker::new() else {
                    return;
                };
                // SAFETY: each takes the sender; nil targets the first responder.
                unsafe {
                    NSApplication::sharedApplication(mtm).sendAction_to_from(selector, None, None);
                }
            })
            .is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, action);
        false
    }
}
