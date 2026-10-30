//! Plugins' scheduled jobs, notifications and background runs. Rust keeps the
//! jobs (`plugins/schedule.json`) and one timer for the soonest; a due job
//! shows its notification from here and hands its `run` to a window's plugins,
//! or to a hidden one opened for it when no window is open. Desktop only.

/// The hidden window that runs plugins' background code when no window is
/// open. Outside the desktop gate: iOS builds name it too, as not an editor.
pub const HOST_LABEL: &str = "background-host";

#[cfg(desktop)]
pub mod app_state;
#[cfg(desktop)]
pub mod host;
#[cfg(desktop)]
pub mod jobs;
#[cfg(desktop)]
pub mod notify;
#[cfg(desktop)]
pub mod trigger;

#[cfg(desktop)]
pub use desktop::*;

#[cfg(desktop)]
mod desktop {
    use super::jobs::{Firing, JobSpec, ScheduledJob, Store};
    use super::{host, notify};
    use crate::plugins::access::refused;
    use crate::plugins::state::{self, PluginsState};
    use std::sync::Mutex;
    use std::time::Duration;
    use tauri::Manager;

    /// The longest the timer sleeps: tokio's clock stops while the computer
    /// sleeps, so the wall clock is looked at again at least this often.
    const LONGEST_SLEEP: Duration = Duration::from_secs(60);

    #[derive(Default)]
    pub struct Scheduler {
        store: Mutex<Store>,
        wake: tokio::sync::Notify,
    }

    fn file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
        Some(
            app.path()
                .app_data_dir()
                .ok()?
                .join("plugins")
                .join("schedule.json"),
        )
    }

    fn load(app: &tauri::AppHandle) -> Store {
        file(app)
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    fn save(app: &tauri::AppHandle, store: &Store) {
        let Some(path) = file(app) else {
            return;
        };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_vec_pretty(store) {
            if let Err(err) = crate::atomic::write_sync(&path, json) {
                eprintln!("schedule: could not save the jobs: {err}");
            }
        }
    }

    fn now_ms() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    /// Changes the jobs, saves them and has the timer look again.
    fn change<T>(app: &tauri::AppHandle, f: impl FnOnce(&mut Store) -> T) -> T {
        let scheduler = app.state::<Scheduler>();
        let out = {
            let mut store = scheduler.store.lock().unwrap_or_else(|e| e.into_inner());
            let out = f(&mut store);
            save(app, &store);
            out
        };
        scheduler.wake.notify_one();
        out
    }

    /// Reads the jobs and starts the timer; jobs missed while Textus wasn't
    /// running come due on its first look.
    pub fn start(app: &tauri::AppHandle) {
        app.manage(Scheduler {
            store: Mutex::new(load(app)),
            wake: tokio::sync::Notify::new(),
        });
        app.manage(host::PendingRuns::default());
        app.manage(notify::Notifications::default());
        app.manage(app_state::LastState::default());
        notify::install(app);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                fire_due(&app);
                let wait = {
                    let plugins = state::read(&app);
                    let scheduler = app.state::<Scheduler>();
                    let store = scheduler.store.lock().unwrap_or_else(|e| e.into_inner());
                    store
                        .earliest(|p| plugins.runs(p))
                        .map(|due| Duration::from_millis((due - now_ms()).max(0) as u64))
                };
                let scheduler = app.state::<Scheduler>();
                match wait {
                    Some(wait) => {
                        tokio::select! {
                            _ = tokio::time::sleep(wait.min(LONGEST_SLEEP)) => {}
                            _ = scheduler.wake.notified() => {}
                        }
                    }
                    None => scheduler.wake.notified().await,
                }
            }
        });
    }

    use super::app_state;

    /// Plugins were switched on or off: paused jobs may run again.
    pub fn rearm(app: &tauri::AppHandle) {
        if let Some(scheduler) = app.try_state::<Scheduler>() {
            scheduler.wake.notify_one();
        }
    }

    /// A plugin uninstalled: its jobs go.
    pub fn forget_plugin(app: &tauri::AppHandle, plugin: &str) {
        if app.try_state::<Scheduler>().is_some() {
            change(app, |store| store.drop_plugin(plugin));
        }
    }

    fn fire_due(app: &tauri::AppHandle) {
        let plugins = state::read(app);
        let firings = {
            let scheduler = app.state::<Scheduler>();
            let mut store = scheduler.store.lock().unwrap_or_else(|e| e.into_inner());
            let before = store.clone();
            let firings = store.take_due(now_ms(), |p| plugins.runs(p), &chrono::Local);
            if *store != before {
                save(app, &store);
            }
            firings
        };
        for firing in firings {
            fire(app, &plugins, firing);
        }
    }

    fn fire(app: &tauri::AppHandle, plugins: &PluginsState, firing: Firing) {
        if let Some(n) = &firing.spec.notify {
            if let Err(err) = notify::show(app, &firing.plugin, n, firing.root.as_deref()) {
                eprintln!("schedule: {} {}: {err}", firing.plugin, firing.id);
            }
        }
        if firing.spec.run.is_some() && plugins.allows(&firing.plugin, "background") {
            host::queue(app, &firing);
        }
    }

    /// What a job needs granted, beyond the plugin being on.
    fn require_grants(
        plugins: &PluginsState,
        id: &str,
        spec: &JobSpec,
        root: Option<&str>,
    ) -> Result<(), String> {
        if !plugins.runs(id) {
            return Err(format!("{id} is turned off."));
        }
        let mut needs = Vec::new();
        if let Some(n) = &spec.notify {
            needs.push("notifications");
            if n.open.is_some() {
                if root.is_none() {
                    return Err(
                        "A notification opens a file of the open folder; none is open.".into(),
                    );
                }
                needs.push("files.read");
            }
        }
        if spec.run.is_some() {
            needs.push("background");
        }
        match needs.into_iter().find(|p| !plugins.allows(id, p)) {
            Some(missing) => Err(refused(id, missing)),
            None => Ok(()),
        }
    }

    /// `textus.schedule.set`: adds or replaces one of the plugin's jobs.
    /// `root`, the folder open in the window, is kept only with files.read.
    #[tauri::command]
    #[cfg_attr(test, specta::specta)]
    pub fn schedule_set(
        app: tauri::AppHandle,
        id: String,
        job_id: String,
        job: JobSpec,
        root: Option<String>,
    ) -> Result<ScheduledJob, String> {
        let plugins = state::read(&app);
        let root = root.filter(|_| plugins.allows(&id, "files.read"));
        require_grants(&plugins, &id, &job, root.as_deref())?;
        change(&app, |store| {
            store.set(&id, &job_id, job, root, now_ms(), &chrono::Local)
        })
    }

    #[tauri::command]
    #[cfg_attr(test, specta::specta)]
    pub fn schedule_clear(app: tauri::AppHandle, id: String, job_id: String) -> bool {
        change(&app, |store| store.clear(&id, &job_id))
    }

    /// A plugin's jobs, for the plugin and for its page in Settings.
    #[tauri::command]
    #[cfg_attr(test, specta::specta)]
    pub fn schedule_list(app: tauri::AppHandle, id: String) -> Vec<ScheduledJob> {
        app.state::<Scheduler>()
            .store
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .list(&id)
    }

    #[cfg(test)]
    mod tests {
        use super::super::jobs::{NotificationOpen, NotificationSpec};
        use super::*;
        use crate::plugins::state::PluginEntry;

        fn plugins(granted: &[&str]) -> PluginsState {
            let mut state = PluginsState::default();
            state.plugins.insert(
                "a.b".into(),
                PluginEntry {
                    enabled: true,
                    granted: granted.iter().map(|g| g.to_string()).collect(),
                    ..Default::default()
                },
            );
            state
        }

        fn spec(open: bool, run: bool) -> JobSpec {
            JobSpec {
                daily: Some("09:00".into()),
                notify: Some(NotificationSpec {
                    title: "t".into(),
                    body: String::new(),
                    open: open.then(|| NotificationOpen {
                        path: "a.md".into(),
                        line: None,
                    }),
                }),
                run: run.then(|| "tick".into()),
                ..Default::default()
            }
        }

        #[test]
        fn a_job_needs_notifications_to_notify_and_background_to_run() {
            assert!(require_grants(&plugins(&[]), "a.b", &spec(false, false), None).is_err());
            assert!(require_grants(
                &plugins(&["notifications"]),
                "a.b",
                &spec(false, false),
                None
            )
            .is_ok());
            let err = require_grants(
                &plugins(&["notifications"]),
                "a.b",
                &spec(false, true),
                None,
            )
            .unwrap_err();
            assert!(err.contains("background"), "{err}");
            assert!(require_grants(
                &plugins(&["notifications", "background"]),
                "a.b",
                &spec(false, true),
                None
            )
            .is_ok());
        }

        #[test]
        fn a_notification_that_opens_a_file_needs_files_read_and_a_folder() {
            let grants = plugins(&["notifications"]);
            assert!(require_grants(&grants, "a.b", &spec(true, false), Some("/n")).is_err());
            let grants = plugins(&["notifications", "files.read"]);
            assert!(require_grants(&grants, "a.b", &spec(true, false), None).is_err());
            assert!(require_grants(&grants, "a.b", &spec(true, false), Some("/n")).is_ok());
        }

        #[test]
        fn a_plugin_turned_off_schedules_nothing() {
            let mut grants = plugins(&["notifications"]);
            grants.all_on = false;
            assert!(require_grants(&grants, "a.b", &spec(false, false), None).is_err());
        }
    }
}
