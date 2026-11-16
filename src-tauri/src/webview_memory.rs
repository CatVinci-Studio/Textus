//! Windows: a window left minimized for a while has its WebView2 asked to
//! use less memory, so it trims what it can; back on screen, it is asked for
//! the usual again. Not at once: trimmed, a long document takes a while to
//! come back (its pages are read in again), which a window put away for a
//! moment must not pay.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// How long a window stays minimized before its web view is trimmed: the
/// app's own idle time (src/utils/memory-idle.ts).
#[cfg(windows)]
const TRIM_AFTER: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// The minimized windows, each with which minimizing this is (a later one
/// outdates a trim still waiting) and whether it was trimmed.
#[derive(Default)]
pub(crate) struct Minimized {
    windows: Mutex<BTreeMap<String, (u64, bool)>>,
    turns: AtomicU64,
}

impl Minimized {
    /// `label` was minimized: its turn, or None while it already is (each
    /// resize of a drag would ask again).
    fn put_away(&self, label: &str) -> Option<u64> {
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        if windows.contains_key(label) {
            return None;
        }
        let turn = self.turns.fetch_add(1, Ordering::Relaxed);
        windows.insert(label.to_string(), (turn, false));
        Some(turn)
    }

    /// The wait is over: whether `label` is still minimized from `turn`, and
    /// so trimmed now.
    fn trim_due(&self, label: &str, turn: u64) -> bool {
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        match windows.get_mut(label) {
            Some(entry) if entry.0 == turn => {
                entry.1 = true;
                true
            }
            _ => false,
        }
    }

    /// `label` is back on screen: whether it had been trimmed.
    fn came_back(&self, label: &str) -> bool {
        let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
        windows.remove(label).is_some_and(|(_, trimmed)| trimmed)
    }
}

#[cfg(windows)]
static MINIMIZED: std::sync::LazyLock<Minimized> = std::sync::LazyLock::new(Minimized::default);

/// Follows `window` being minimized or restored.
#[cfg(windows)]
pub(crate) fn follow_minimized(window: &tauri::Window, event: &tauri::WindowEvent) {
    if !matches!(
        event,
        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(true)
    ) {
        return;
    }
    use tauri::Manager;
    let label = window.label().to_string();
    if !window.is_minimized().unwrap_or(false) {
        if MINIMIZED.came_back(&label) {
            if let Some(webview) = window.app_handle().get_webview_window(&label) {
                set_low(&webview, false);
            }
        }
        return;
    }
    let Some(turn) = MINIMIZED.put_away(&label) else {
        return;
    };
    let app = window.app_handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(TRIM_AFTER);
        if !MINIMIZED.trim_due(&label, turn) {
            return;
        }
        if let Some(webview) = app.get_webview_window(&label) {
            set_low(&webview, true);
        }
    });
}

#[cfg(windows)]
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

#[cfg(test)]
mod tests {
    use super::Minimized;

    #[test]
    fn a_window_is_trimmed_only_while_still_minimized_from_the_same_time() {
        let all = Minimized::default();
        let first = all.put_away("main").unwrap();
        assert_eq!(all.put_away("main"), None, "already minimized");
        // Back before the wait was over: never trimmed, nothing to undo.
        assert!(!all.came_back("main"));
        assert!(!all.trim_due("main", first));
        // Minimized again: the first wait ending now trims nothing.
        let second = all.put_away("main").unwrap();
        assert!(!all.trim_due("main", first));
        assert!(all.trim_due("main", second));
        assert!(
            all.came_back("main"),
            "trimmed, so asked for the usual again"
        );
        assert!(!all.came_back("main"));
    }
}
