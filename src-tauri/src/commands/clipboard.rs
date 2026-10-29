//! The menus' Paste and Paste as Plain Text. On macOS a page that reads the
//! clipboard (navigator.clipboard) is shown a "Paste" callout to click
//! first; here the paste goes through the native paste: action, as Cmd+V
//! does, and the plain text is read from the pasteboard. Undo and Redo in a
//! text field go through the native actions too.

/// Pastes into the focused webview as Cmd+V does. False where the page
/// reads the clipboard itself (everywhere but macOS).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn paste_natively(window: tauri::WebviewWindow) -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2::sel;
        use objc2_app_kit::NSApplication;
        use objc2_foundation::MainThreadMarker;
        window
            .run_on_main_thread(|| {
                let Some(mtm) = MainThreadMarker::new() else {
                    return;
                };
                // SAFETY: paste: takes the sender; nil targets the first
                // responder, the webview with the caret.
                unsafe {
                    NSApplication::sharedApplication(mtm).sendAction_to_from(
                        sel!(paste:),
                        None,
                        None,
                    );
                }
            })
            .is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        false
    }
}

/// Undoes or redoes in the focused webview's text field or frame, as the
/// predefined Edit items did. False where the page does it itself (everywhere
/// but macOS).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn undo_natively(window: tauri::WebviewWindow, redo: bool) -> bool {
    #[cfg(target_os = "macos")]
    {
        window
            .run_on_main_thread(move || send_to_first_responder(redo))
            .is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, redo);
        false
    }
}

/// undo: or redo: to the first responder, on the main thread.
#[cfg(target_os = "macos")]
pub(crate) fn send_to_first_responder(redo: bool) {
    use objc2::sel;
    use objc2_app_kit::NSApplication;
    use objc2_foundation::MainThreadMarker;
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let action = if redo { sel!(redo:) } else { sel!(undo:) };
    // SAFETY: both take the sender; nil targets the first responder.
    unsafe {
        NSApplication::sharedApplication(mtm).sendAction_to_from(action, None, None);
    }
}

/// The clipboard's plain text, read without the webview's paste callout.
/// None where the page reads it itself (everywhere but macOS).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn clipboard_text() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        // SAFETY: a static NSString the framework defines.
        let string_type = unsafe { NSPasteboardTypeString };
        Some(
            NSPasteboard::generalPasteboard()
                .stringForType(string_type)
                .map(|text| text.to_string())
                .unwrap_or_default(),
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}
