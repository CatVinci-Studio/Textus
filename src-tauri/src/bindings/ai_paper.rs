use super::{builder, Group};
use tauri_specta::collect_commands;

pub(super) fn group() -> Group {
    (
        // Research mode's writing agent (ai::paper).
        "ai-paper.ts",
        builder()
            .commands(collect_commands![
                crate::ai::paper::ai_paper_run,
                crate::ai::paper::status::ai_paper_save_outline,
                crate::ai::paper::drafting::ai_paper_draft,
                crate::ai::paper::figures::ai_paper_figures_drawn,
                crate::ai::paper::status::ai_paper_status
            ])
            .typ::<crate::ai::paper::Outline>(),
    )
}
