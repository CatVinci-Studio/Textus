//! Whether a Textus window is in front, open behind others, or none is open,
//! for `textus.app.state`. Moving from one window to another is a blur then
//! a focus; the state is read once both have landed.

use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Rust -> every window: the state changed. Payload: AppState.
pub const EVENT: &str = "app-state";
const SETTLE_MS: u64 = 100;

#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum AppState {
    /// A Textus window has the focus.
    Active,
    /// Windows are open, none focused.
    Inactive,
    /// No window is open: background mode, or macOS with every window closed.
    Background,
}

/// A window of the user's: not one Textus keeps out of sight.
pub fn is_user_window(label: &str) -> bool {
    use crate::commands::chat_window::{is_editor_window, CHAT_LABEL_PREFIX};
    is_editor_window(label) || label.starts_with(CHAT_LABEL_PREFIX)
}

/// The state, from each user window's (open, focused).
pub fn state_of(windows: impl IntoIterator<Item = bool>) -> AppState {
    let mut open = false;
    for focused in windows {
        if focused {
            return AppState::Active;
        }
        open = true;
    }
    if open {
        AppState::Inactive
    } else {
        AppState::Background
    }
}

#[derive(Default)]
pub struct LastState(Mutex<Option<AppState>>);

pub fn current(app: &tauri::AppHandle) -> AppState {
    state_of(
        app.webview_windows()
            .into_iter()
            .filter(|(label, w)| is_user_window(label) && w.is_visible().unwrap_or(true))
            .map(|(_, w)| w.is_focused().unwrap_or(false)),
    )
}

/// A window gained or lost focus, opened or closed: tells the windows once
/// the state has settled, if it changed.
pub fn changed(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(SETTLE_MS)).await;
        let now = current(&app);
        let Some(last) = app.try_state::<LastState>() else {
            return;
        };
        let before = last
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .replace(now);
        if before == Some(now) {
            return;
        }
        if now == AppState::Active {
            super::notify::activated(&app);
        }
        for label in app.webview_windows().into_keys() {
            let _ = app.emit_to(tauri::EventTarget::webview_window(&label), EVENT, now);
        }
    });
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn app_state(app: tauri::AppHandle) -> AppState {
    current(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_with_a_focused_window_inactive_with_others_background_with_none() {
        assert_eq!(state_of([false, true]), AppState::Active);
        assert_eq!(state_of([false, false]), AppState::Inactive);
        assert_eq!(state_of([]), AppState::Background);
    }

    #[test]
    fn the_hidden_windows_are_not_the_users() {
        assert!(is_user_window("main"));
        assert!(is_user_window("window-3"));
        assert!(!is_user_window(crate::tab_drag::DRAG_PILL_LABEL));
        assert!(!is_user_window("pdf-export-4"));
        assert!(!is_user_window(crate::schedule::HOST_LABEL));
    }
}
