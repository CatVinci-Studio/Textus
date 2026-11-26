use super::{builder, Group};
use tauri_specta::collect_commands;

pub(super) fn group() -> Group {
    (
        "auth.ts",
        builder().commands(collect_commands![
            crate::auth::openai_codex::codex_login,
            crate::auth::openai_codex::codex_auth_status,
            crate::auth::openai_codex::codex_logout,
            crate::auth::claude::claude_login,
            crate::auth::claude::claude_auth_status,
            crate::auth::claude::claude_logout,
            crate::auth::keys::set_provider_api_key,
            crate::auth::keys::provider_api_key_status,
            crate::auth::keys::clear_provider_api_key,
            crate::auth::custom_endpoint::set_custom_endpoint,
            crate::auth::custom_endpoint::custom_endpoints_status,
            crate::auth::custom_endpoint::clear_custom_endpoint,
            crate::auth::custom_endpoint::fetch_custom_models,
        ]),
    )
}
