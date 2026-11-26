use super::{builder, Group};
use tauri_specta::collect_commands;

pub(super) fn group() -> Group {
    (
        // Plugins' scheduled jobs, notifications, background runs, app state.
        "schedule.ts",
        builder().commands(collect_commands![
            crate::schedule::schedule_set,
            crate::schedule::schedule_clear,
            crate::schedule::schedule_list,
            crate::schedule::host::schedule_take_runs,
            crate::schedule::host::background_host_idle,
            crate::schedule::notify::notify_show,
            crate::schedule::notify::notify_take_open,
            crate::schedule::app_state::app_state,
        ]),
    )
}
