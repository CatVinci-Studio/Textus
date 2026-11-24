use super::{builder, Group};
use tauri_specta::collect_commands;

pub(super) fn group() -> Group {
    (
        "ai-agent.ts",
        builder()
            .commands(collect_commands![
                crate::ai::agent::ai_agent_message,
                crate::ai::cancel::ai_cancel,
                crate::ai::steer::ai_steer,
                crate::commands::attachment::pick_attachment_files,
                crate::commands::attachment::attach_pasted,
                crate::ai::images::list_image_providers,
                crate::ai::images::ai_generated_image,
                crate::ai::images::ai_retry_generated_image,
                crate::ai::images::ai_generated_image_prompt,
                crate::ai::images::ai_redraw_generated_image,
                crate::ai::images::ai_discard_generated_image,
                crate::ai::kept_proposals::kept_proposals_read,
                crate::ai::kept_proposals::kept_proposals_write,
            ])
            // ai_agent_message takes more parameters than specta supports (ten), so
            // only the types it streams and takes are exported.
            .typ::<crate::ai::agent::StreamEvent>()
            .typ::<aicompat::capabilities::ThinkingLevel>()
            .constant("MEMORY_TURN", crate::ai::agent::history::MEMORY_TURN)
            .constant("PAPER_TURN", crate::ai::agent::history::PAPER_TURN),
    )
}
