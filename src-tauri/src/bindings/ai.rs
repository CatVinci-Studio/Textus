use super::{builder, Group};
use tauri_specta::collect_commands;

pub(super) fn group() -> Group {
    (
        "ai.ts",
        builder()
            .commands(collect_commands![
                crate::ai::client::ai_complete,
                crate::ai::client::ai_grammar_check,
                crate::ai::catalog::ai_can_think_deeper,
                crate::ai::client::fetch_agent_models,
                crate::ai::web::web_search_status,
                crate::ai::next_message::suggest_next_message,
                crate::ai::doc_title::suggest_doc_title,
            ])
            // Commands reading their inputs as one struct can't be generated; their
            // input types are.
            .typ::<crate::ai::client::CompletionRequest>()
            .typ::<crate::ai::client::GrammarRequest>()
            .constant("TEXTUS_AI_OFF", crate::ai::TEXTUS_AI_OFF)
            .constant("PROVIDER_CATALOG", crate::ai::catalog::PROVIDER_CATALOG),
    )
}
