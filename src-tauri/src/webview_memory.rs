//! Windows: a minimized window's WebView2 is asked to use less memory, so
//! it trims what it can; back on screen, it is asked for the usual again.

/// Follows `window` being minimized or restored.
pub(crate) fn follow_minimized(window: &tauri::Window, event: &tauri::WindowEvent) {
    if !matches!(
        event,
        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(true)
    ) {
        return;
    }
    use tauri::Manager;
    let Some(webview) = window.app_handle().get_webview_window(window.label()) else {
        return;
    };
    let low = window.is_minimized().unwrap_or(false);
    set_low(&webview, low);
}

fn set_low(window: &tauri::WebviewWindow, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    let _ = window.with_webview(move |webview| {
        // SAFETY: COM calls on the live controller the platform webview
        // hands us, on its own (UI) thread. A runtime too old for
        // ICoreWebView2_19 fails the cast and is left as it is.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            if let Ok(core) = core.cast::<ICoreWebView2_19>() {
                let _ = core.SetMemoryUsageTargetLevel(if low {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                });
            }
        }
    });
}
