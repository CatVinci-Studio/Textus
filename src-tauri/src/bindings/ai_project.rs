use super::{builder, Group};
use tauri_specta::collect_commands;

pub(super) fn group() -> Group {
    (
        "ai-project.ts",
        builder().commands(collect_commands![
            crate::ai::file_changes::ai_file_changes,
            crate::ai::file_changes::ai_set_file_changes,
            crate::ai::project::ensure_project_file,
            crate::ai::project::import_references_picked,
            crate::ai::project::learn_style,
            crate::ai::project::list_project_files,
            crate::ai::project::pick_text_files,
            crate::ai::project::read_project_file,
            crate::ai::workspace::ensure_global_agent_md,
            crate::ai::workspace::load_agent_workspace,
            crate::ai::workspace::open_global_agent_dir,
        ]),
    )
}
