//! Paste as Plain Text's text. On macOS a page that reads the clipboard
//! (navigator.clipboard) is shown a "Paste" callout to click first; here the
//! plain text is read from the pasteboard instead.

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
