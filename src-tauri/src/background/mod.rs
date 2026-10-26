//! Background mode: with it on, closing the last window leaves Textus running
//! with a tray icon. Off by default; desktop only. A windowless process keeps
//! no webview, timer or watcher, and the tray exists only while the setting is on.

pub mod tray;

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub const ENABLED_SETTING: &str = "runInBackground";

/// Rust -> every window: the tray changed. Payload: Status.
pub const STATUS_EVENT: &str = "background-status";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Os {
    Mac,
    Windows,
    Linux,
}

impl Os {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

/// Whether Tauri's request to exit is turned down. A codeless request (last
/// window destroyed) keeps the process on macOS or in background mode; every
/// exit with a code goes ahead, so a lingering process never holds an update up.
pub fn keeps_running(exit_code: Option<i32>, os: Os, background_on: bool) -> bool {
    exit_code.is_none() && (os == Os::Mac || background_on)
}

/// Whether background mode just turned off leaves the process with nothing
/// to do: no window, and not macOS, which keeps running windowless anyway.
pub fn ends_when_turned_off(os: Os, windows_open: bool) -> bool {
    os != Os::Mac && !windows_open
}

pub fn enabled(app: &AppHandle) -> bool {
    crate::settings::read_setting(app, ENABLED_SETTING)
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// The tray, for Settings.
#[derive(Clone, Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// "off", "on", or "unavailable" (Linux without an AppIndicator
    /// library: the process still stays).
    pub tray: &'static str,
}

pub struct BackgroundStatus(pub Mutex<Status>);

impl Default for BackgroundStatus {
    fn default() -> Self {
        BackgroundStatus(Mutex::new(Status { tray: "off" }))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Change {
    /// Startup, with background mode on.
    Startup,
    /// The setting, from Settings.
    Settings,
    /// The UI language: the tray menu's labels.
    Language,
}

/// Brings the tray in line with Settings and tells every window how that went.
/// The tray is built and dropped on the main thread (AppKit's and GTK's rule).
pub fn apply(app: &AppHandle, change: Change) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let on = enabled(&handle);
        if change == Change::Language && handle.tray_by_id(tray::ID).is_none() {
            return;
        }
        let tray = tray::sync(&handle, on);
        update(&handle, |status| status.tray = tray);
        if !on
            && change == Change::Settings
            && ends_when_turned_off(Os::current(), !handle.webview_windows().is_empty())
        {
            handle.exit(0);
        }
    });
}

fn update(app: &AppHandle, change: impl FnOnce(&mut Status)) {
    let Some(state) = app.try_state::<BackgroundStatus>() else {
        return;
    };
    let status = {
        let mut status = state.0.lock().unwrap();
        change(&mut status);
        status.clone()
    };
    for label in app.webview_windows().into_keys() {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window(&label),
            STATUS_EVENT,
            status.clone(),
        );
    }
}

/// The tray now, for Settings as it opens.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn background_status(state: tauri::State<BackgroundStatus>) -> Status {
    state.0.lock().unwrap().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_the_last_window_keeps_the_process_on_macos_or_in_background_mode() {
        // Tauri's request after the last window is destroyed has no code.
        assert!(keeps_running(None, Os::Mac, false));
        assert!(keeps_running(None, Os::Mac, true));
        assert!(keeps_running(None, Os::Windows, true));
        assert!(keeps_running(None, Os::Linux, true));
        assert!(!keeps_running(None, Os::Windows, false));
        assert!(!keeps_running(None, Os::Linux, false));
    }

    #[test]
    fn quitting_and_the_updaters_restart_always_exit() {
        // app.exit(0) after File › Quit or the tray's Quit, and Tauri's
        // restart exit code, go ahead with background mode on or off.
        for os in [Os::Mac, Os::Windows, Os::Linux] {
            for background in [false, true] {
                assert!(!keeps_running(Some(0), os, background));
                assert!(!keeps_running(
                    Some(tauri::RESTART_EXIT_CODE),
                    os,
                    background
                ));
            }
        }
    }

    #[test]
    fn turning_background_mode_off_ends_a_windowless_process_except_on_macos() {
        assert!(ends_when_turned_off(Os::Windows, false));
        assert!(ends_when_turned_off(Os::Linux, false));
        assert!(!ends_when_turned_off(Os::Mac, false));
        for os in [Os::Mac, Os::Windows, Os::Linux] {
            assert!(!ends_when_turned_off(os, true));
        }
    }
}
