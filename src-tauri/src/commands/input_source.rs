//! While a plugin takes every key as a command (Vim's normal mode), an
//! input method would turn them into text first. On macOS the window's text
//! input then takes Roman input sources only, as a password field does, and
//! the source the user had comes back after.

#[cfg(target_os = "macos")]
static BEFORE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Roman input sources only in this window (`on`), or all of them again.
/// Nothing where the input method can't be set from here (all but macOS).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn set_roman_input(window: tauri::WebviewWindow, on: bool) {
    #[cfg(target_os = "macos")]
    {
        let _ = window.with_webview(move |webview| {
            use objc2_app_kit::{NSAllRomanInputSourcesLocaleIdentifier, NSView};
            use objc2_foundation::{NSArray, NSString};
            // SAFETY: the WKWebView (an NSView) wry hands us, on the main
            // thread, alive for this call.
            let view: &NSView = unsafe { &*webview.inner().cast() };
            let Some(context) = view.inputContext() else {
                return;
            };
            let mut before = BEFORE.lock().unwrap_or_else(|e| e.into_inner());
            if on {
                if context.allowedInputSourceLocales().is_some() {
                    return;
                }
                *before = context
                    .selectedKeyboardInputSource()
                    .map(|id| id.to_string());
                // SAFETY: a static NSString AppKit defines.
                let roman = unsafe { NSAllRomanInputSourcesLocaleIdentifier };
                context.setAllowedInputSourceLocales(Some(&NSArray::from_slice(&[roman])));
                // The restriction applies once the context is active again.
                context.deactivate();
                context.activate();
            } else {
                if context.allowedInputSourceLocales().is_none() {
                    return;
                }
                context.setAllowedInputSourceLocales(None);
                if let Some(id) = before.take() {
                    context.setSelectedKeyboardInputSource(Some(&NSString::from_str(&id)));
                }
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, on);
    }
}
