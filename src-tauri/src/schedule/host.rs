//! Where a due job's `run` goes: queued here, taken by an editor window's
//! plugins, or with no window open by a hidden window opened for it and
//! closed once it has run them.

use super::jobs::Firing;
use serde::Serialize;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub use super::HOST_LABEL as LABEL;

/// Rust -> an editor window: runs are waiting (`schedule_take_runs`).
pub const RUN_EVENT: &str = "schedule-run";
/// The hidden window is closed this long after it opened, whatever it is
/// doing: each run has 30 s, and a page that never reports back can't stay.
const HOST_LIFETIME: Duration = Duration::from_secs(120);

/// One handler of a plugin's background code to run. Mirrors JobRun in
/// src/plugins/background/schedule.ts.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct JobRun {
    pub plugin: String,
    /// The job's id.
    pub job: String,
    /// The function of the background code that runs.
    pub run: String,
    /// The folder its files are in, if it was granted files.read.
    pub root: Option<String>,
    /// When it was due, Unix milliseconds.
    pub due: f64,
}

#[derive(Default)]
pub struct PendingRuns {
    runs: Mutex<Vec<JobRun>>,
    /// Which hidden window the closing timer is for.
    generation: AtomicU32,
}

pub fn queue(app: &tauri::AppHandle, firing: &Firing) {
    let Some(pending) = app.try_state::<PendingRuns>() else {
        return;
    };
    pending
        .runs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(JobRun {
            plugin: firing.plugin.clone(),
            job: firing.id.clone(),
            run: firing.spec.run.clone().unwrap_or_default(),
            root: firing.root.clone(),
            due: firing.due as f64,
        });
    match crate::menu::focused_editor_window(app) {
        Some(label) => {
            let _ = app.emit_to(tauri::EventTarget::webview_window(&label), RUN_EVENT, ());
        }
        None => open_host(app),
    }
}

/// The hidden window, unless it is already open.
fn open_host(app: &tauri::AppHandle) {
    if app.get_webview_window(LABEL).is_some() {
        return;
    }
    let builder = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?view=background".into()),
    )
    .title(crate::app_identity::APP_NAME)
    .visible(false)
    .focused(false)
    .skip_taskbar(true)
    .inner_size(320.0, 240.0);
    match crate::settings::with_boot(builder, app, LABEL).build() {
        Ok(_window) => {
            #[cfg(target_os = "linux")]
            crate::editor_windows::end_web_process_with_window(&_window);
        }
        Err(err) => {
            eprintln!("schedule: could not open the background window: {err}");
            return;
        }
    }
    let generation = app
        .state::<PendingRuns>()
        .generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(HOST_LIFETIME).await;
        if app.state::<PendingRuns>().generation.load(Ordering::SeqCst) == generation {
            close_host(&app);
        }
    });
}

fn close_host(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}

/// The runs waiting, taken by the window that runs them.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn schedule_take_runs(app: tauri::AppHandle) -> Vec<JobRun> {
    app.try_state::<PendingRuns>()
        .map(|p| std::mem::take(&mut *p.runs.lock().unwrap_or_else(|e| e.into_inner())))
        .unwrap_or_default()
}

/// The hidden window ran everything it took: it closes, unless more came.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn background_host_idle(app: tauri::AppHandle) {
    let waiting = app
        .try_state::<PendingRuns>()
        .is_some_and(|p| !p.runs.lock().unwrap_or_else(|e| e.into_inner()).is_empty());
    if !waiting {
        close_host(&app);
    }
}
