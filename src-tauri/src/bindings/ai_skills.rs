use super::{builder, Group};
use tauri_specta::collect_commands;

pub(super) fn group() -> Group {
    (
        "ai-skills.ts",
        builder().commands(collect_commands![
            crate::ai::workspace::import_agent_skill,
            crate::ai::workspace::list_skills,
            crate::ai::workspace::customize_builtin_skill,
            crate::ai::workspace::reset_builtin_skill,
            crate::ai::workspace::set_skill_modes,
            crate::ai::workspace::set_skill_off,
            crate::ai::workspace::save_written_skill,
            crate::ai::workspace::delete_global_skill,
        ]),
    )
}
