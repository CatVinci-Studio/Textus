//! The TypeScript side of the backend commands, generated from their Rust
//! signatures: src/platform/bindings/*.ts, one file per group of
//! src/platform/ipc-*.ts. A command listed here carries
//! `#[cfg_attr(test, specta::specta)]`, and the types it takes and returns
//! `#[cfg_attr(test, derive(specta::Type))]` - test-only, so a shipped
//! build never compiles specta.
//!
//! `bindings_are_current` fails when a checked-in file is not what these
//! signatures generate; `npm run bindings` (TEXTUS_WRITE_BINDINGS=1)
//! writes them again. Not listed: the commands reading their inputs as one
//! struct (commands/args.rs) and ai_agent_message, whose inputs and stream
//! are exported as types instead, and the iOS-only ones
//! (commands/documents.rs), which a desktop test build doesn't compile.
//! aicompat's types (AgentTurn and what it holds) derive specta::Type
//! behind its `specta` feature, which only the dev-dependency turns on.
//!
//! The settings, histories and conversations are opaque JSON
//! (serde_json::Value) to Rust, and `rev`/counts are u64/usize; specta
//! refuses 64-bit integers by default, since JSON.parse rounds past 2^53.
//! None of these come near that, so they are exported as `number`.

use specta_typescript::Typescript;
use std::path::PathBuf;
use tauri_specta::{collect_commands, Builder, ErrorHandlingMode};

const HEADER: &str = "// Generated from the Rust commands by src-tauri/src/bindings.rs - do not\n\
// edit. `npm run bindings` writes it again; `cargo test` fails while it\n\
// is out of date.\n";

/// One generated file: its name under src/platform/bindings/ and its
/// commands.
fn groups() -> Vec<(&'static str, Builder<tauri::Wry>)> {
    vec![
        (
            "files.ts",
            builder().commands(collect_commands![
                crate::commands::fs::open_file_dialog,
                crate::commands::fs::open_css_file_dialog,
                crate::commands::fs::open_image_file_dialog,
                crate::commands::fs::save_file_dialog,
                crate::commands::fs::list_dir,
                crate::commands::fs::file_mtime_ms,
                crate::commands::fs::read_text_file,
                crate::commands::fs::read_binary_file_base64,
                crate::commands::fs::write_text_file,
                crate::commands::fs::save_pasted_image,
                crate::commands::fs::migrate_draft_images,
                crate::commands::fs::move_picture_to_trash,
                crate::commands::folder::index_folder,
                crate::commands::folder::pick_open_folder,
                crate::commands::tree_ops::tree_create_document,
                crate::commands::tree_ops::tree_create_folder,
                crate::commands::tree_ops::tree_move_entry,
                crate::commands::tree_ops::tree_rename_entry,
                crate::commands::tree_ops::tree_trash_entry,
                crate::commands::vault::resolve_vault_image,
                crate::commands::vault::resolve_vault_note,
                crate::commands::word_import::open_word_document,
                crate::commands::image_host::upload_image,
                crate::commands::session::update_session_paths,
                crate::commands::session::cancel_session_quit,
                crate::commands::recents::add_recent_file,
                crate::commands::recents::add_recent_folder,
                crate::commands::drafts::save_draft_snapshot,
                crate::commands::drafts::take_draft_snapshots,
                crate::commands::drafts::clear_draft_snapshot,
                crate::commands::drafts::clear_all_drafts,
                crate::settings::settings_get,
                crate::settings::settings_patch,
                crate::settings::settings_fill_defaults,
                crate::settings::ui_state_get,
                crate::settings::ui_state_patch,
                crate::settings::history_list,
                crate::settings::history_upsert,
                crate::settings::history_remove,
                crate::settings::history_clear,
                crate::settings::chat_history_get,
                crate::settings::chat_history_archived,
                crate::settings::chat_history_move_document,
            ]),
        ),
        (
            "app.ts",
            builder().commands(collect_commands![
                crate::launch::take_pending_open_path,
                crate::launch::take_pending_open_paths,
                crate::launch::take_pending_show_help,
                crate::launch::take_pending_menu_event,
                crate::launch::take_pending_open_folder,
                crate::launch::open_paths,
                crate::launch::open_path_in_new_window,
                crate::tab_drag::take_detached_tab,
                crate::tab_drag::list_window_bounds,
                crate::tab_drag::start_window_drag_tracking,
                crate::tab_drag::start_floating_tab_drag,
                crate::commands::chat_window::take_chat_handoff,
                crate::commands::chat_window::close_chat_window,
                crate::commands::chat_window::focus_chat_window,
                crate::commands::chat_window::current_chat_window,
                crate::menu::trigger_menu_item,
                crate::menu::list_recent_files,
                crate::menu::list_recent_folders,
                crate::menu::set_menu_labels,
                crate::menu::set_menu_checks,
                crate::menu::set_menu_accelerators,
                crate::commands::links::open_community_page,
                crate::commands::links::open_about_link,
                crate::commands::links::open_web_link,
                crate::commands::links::open_tutorials_page,
                crate::commands::export::export_save_dialog,
                crate::commands::export::detect_pandoc,
                crate::commands::export::export_via_pandoc,
                crate::commands::export::export_pdf_native,
                crate::commands::export::open_pandoc_install_page,
                crate::commands::export::reveal_in_dir,
                crate::commands::themes::save_theme_css,
                crate::commands::themes::load_theme_css,
                crate::commands::themes::delete_theme,
                crate::commands::theme_gallery::theme_gallery_catalog,
                crate::commands::theme_gallery::theme_gallery_css,
                crate::commands::theme_gallery::theme_gallery_preview,
                crate::commands::cli::cli_command_status,
                crate::commands::cli::install_cli_command,
                crate::background::background_status,
                crate::commands::default_editor::default_editor_status,
                crate::commands::default_editor::set_default_editor,
                crate::distribution::app_distribution,
                crate::commands::update::check_for_update::<tauri::Wry>,
                crate::commands::update::release_instance::<tauri::Wry>,
            ]),
        ),
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
                crate::auth::custom_endpoint::custom_endpoint_status,
                crate::auth::custom_endpoint::clear_custom_endpoint,
                crate::auth::custom_endpoint::fetch_custom_models,
                crate::auth::custom_endpoint::test_custom_endpoint,
            ]),
        ),
        (
            "plugins.ts",
            builder().commands(collect_commands![
                crate::plugins::state::plugins_state,
                crate::plugins::state::plugins_set_all,
                crate::plugins::state::plugin_set,
                crate::plugins::install::plugins_installed,
                crate::plugins::install::plugin_install,
                crate::plugins::install::plugin_load_dev,
                crate::plugins::install::plugin_uninstall,
                crate::plugins::install::plugin_pick_package,
                crate::plugins::catalog::plugin_catalog,
                crate::plugins::catalog::plugin_install_catalog,
                crate::plugins::access::plugin_fs_list,
                crate::plugins::access::plugin_fs_write,
                crate::plugins::access::plugin_fs_rename,
                crate::plugins::access::plugin_fs_trash,
                crate::plugins::access::plugin_fs_mkdir,
                crate::plugins::access::plugin_http,
                crate::plugins::access::plugin_storage_get,
                crate::plugins::access::plugin_storage_set,
                crate::menu::set_plugin_menu,
                crate::background::tray::set_tray_plugin_items,
                crate::background::tray::take_pending_plugin_command,
                crate::mcp::mcp_status,
                crate::mcp::mcp_restart,
                crate::mcp::mcp_try,
            ]),
        ),
        // The AI commands, in a file per concern (a generated file is held
        // to the same 600 lines as any other): providers and the requests
        // that take one struct, the agent's stream and what it shows, the
        // project, its memory, and the writing conventions.
        (
            "ai.ts",
            builder()
                .commands(collect_commands![
                    crate::ai::catalog::list_providers,
                    crate::ai::catalog::ai_can_think_deeper,
                    crate::ai::client::fetch_agent_models,
                    crate::ai::client::set_ai_proxy,
                    crate::ai::web::web_search_status,
                    crate::ai::next_message::suggest_next_message,
                ])
                // The commands reading their inputs as one struct
                // (commands/args.rs) can't be generated; their inputs are,
                // and ipc.ts types each call's argument object with them.
                .typ::<crate::ai::client::CompletionRequest>()
                .typ::<crate::ai::client::GrammarRequest>(),
        ),
        (
            "ai-agent.ts",
            builder()
                .commands(collect_commands![
                    crate::ai::cancel::ai_cancel,
                    crate::commands::attachment::pick_attachment_file,
                    crate::ai::images::list_image_providers,
                    crate::ai::images::ai_generated_image,
                    crate::ai::images::ai_retry_generated_image,
                    crate::ai::images::ai_discard_generated_image,
                ])
                // ai_agent_message takes more parameters than specta's
                // function traits go to (ten), so it is not generated
                // either: what its Channel streams is, AgentTurn with it,
                // and the thinking level it takes.
                .typ::<crate::ai::agent::StreamEvent>()
                .typ::<aicompat::capabilities::ThinkingLevel>(),
        ),
        (
            "ai-project.ts",
            builder().commands(collect_commands![
                crate::ai::workspace::load_agent_workspace,
                crate::ai::workspace::pick_workspace_root,
                crate::ai::workspace::open_global_agent_dir,
                crate::ai::workspace::ensure_global_agent_md,
                crate::ai::workspace::import_agent_skill,
                crate::ai::workspace::list_skills,
                crate::ai::workspace::customize_builtin_skill,
                crate::ai::workspace::reset_builtin_skill,
                crate::ai::workspace::set_builtin_skill_enabled,
                crate::ai::project::list_project_files,
                crate::ai::project::read_project_file,
                crate::ai::project::ensure_project_file,
                crate::ai::project::pick_text_files,
                crate::ai::project::learn_style,
            ]),
        ),
        (
            "ai-memory.ts",
            builder()
                .commands(collect_commands![
                    crate::ai::project::library_use,
                    crate::ai::memory::memory_undo,
                    crate::ai::memory::memory_move,
                    crate::ai::memory::memory_restore,
                    crate::ai::memory::memory_delete,
                    crate::ai::memory::memory_remember,
                    crate::ai::memory::revision_choices_read,
                    crate::ai::memory::revision_choices_write,
                ])
                // memory_pass reads its inputs as one struct, as above.
                .typ::<crate::ai::memory::PassRequest>(),
        ),
        (
            "ai-conventions.ts",
            builder().commands(collect_commands![
                crate::ai::conventions::writing_conventions_options,
                crate::ai::conventions::writing_conventions_effective,
                crate::ai::conventions::conventions_check_document,
                crate::ai::conventions::measure_text,
            ]),
        ),
    ]
}

fn builder() -> Builder<tauri::Wry> {
    Builder::new()
        // ipc-call.ts turns a rejection into an IpcError, as for every
        // other command.
        .error_handling(ErrorHandlingMode::Throw)
        // The accessors are the commands' own names, so the name the
        // frontend passes is checked against this list by tsc.
        .function_casing(tauri_specta::Casing::SnakeCase)
        .dangerously_cast_bigints_to_number()
}

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/platform/bindings")
}

/// What `builder` generates for one group, with our header.
fn generate(builder: &Builder<tauri::Wry>) -> String {
    let scratch = tempfile::NamedTempFile::new().expect("a scratch file");
    builder
        .export(Typescript::default().header(HEADER), scratch.path())
        .expect("bindings export");
    std::fs::read_to_string(scratch.path()).expect("the exported bindings")
}

#[test]
fn bindings_are_current() {
    let write = std::env::var_os("TEXTUS_WRITE_BINDINGS").is_some();
    let mut stale = Vec::new();
    for (name, builder) in groups() {
        let path = dir().join(name);
        let generated = generate(&builder);
        if std::fs::read_to_string(&path).ok().as_deref() == Some(generated.as_str()) {
            continue;
        }
        if write {
            std::fs::write(&path, generated).expect("write bindings");
        } else {
            stale.push(name);
        }
    }
    assert!(
        stale.is_empty(),
        "src/platform/bindings/{stale:?} out of date with the Rust commands: run `npm run bindings`"
    );
}
