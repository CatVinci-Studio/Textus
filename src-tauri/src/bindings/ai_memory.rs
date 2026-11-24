use super::{builder, Group};
use tauri_specta::collect_commands;

pub(super) fn group() -> Group {
    (
        "ai-memory.ts",
        builder()
            .commands(collect_commands![
                crate::ai::memory::memory_pass,
                crate::ai::memory::ai_offer_skill,
                crate::ai::project::library_use,
                crate::ai::memory::memory_undo,
                crate::ai::memory::memory_move,
                crate::ai::memory::memory_restore,
                crate::ai::memory::save_offered_skill,
                crate::ai::memory::memory_delete,
                crate::ai::memory::memory_remember,
                crate::ai::memory::revision_choices_read,
                crate::ai::memory::revision_choices_write,
            ])
            // memory_pass reads its inputs as one struct, as above.
            .typ::<crate::ai::memory::PassRequest>(),
    )
}
