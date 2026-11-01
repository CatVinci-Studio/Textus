//! Generates the TypeScript bindings from commands marked
//! `#[cfg_attr(test, specta::specta)]` and types marked
//! `#[cfg_attr(test, derive(specta::Type))]`; u64 counts are exported as `number`.

use specta_typescript::Typescript;
use std::path::PathBuf;
use tauri_specta::{collect_commands, Builder, ErrorHandlingMode};

const HEADER: &str = "// Generated from the Rust commands by src-tauri/src/bindings.rs - do not\n\
// edit. `npm run bindings` writes it again; `cargo test` fails while it\n\
// is out of date.\n";

/// One generated file: its name and its commands.
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
                crate::commands::own_notes::own_notes_read,
                crate::commands::own_notes::own_notes_write,
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
                crate::settings::chat_history_search,
                crate::settings::chat_history_move_document,
            ]),
        ),
        (
            "app.ts",
            builder().commands(collect_commands![
                crate::launch::take_pending_window_paths,
                crate::launch::take_pending_open_paths,
                crate::launch::take_pending_show_help,
                crate::launch::take_pending_menu_event,
                crate::launch::take_pending_open_folder,
                crate::launch::open_paths,
                crate::launch::open_path_in_new_window,
                crate::tab_drag::take_detached_tab,
                crate::tab_drag::move_tab_to_new_window,
                crate::tab_drag::list_window_bounds,
                crate::tab_drag::start_window_drag_tracking,
                crate::tab_drag::start_floating_tab_drag,
                crate::commands::chat_window::take_chat_handoff,
                crate::commands::chat_window::close_chat_window,
                crate::commands::web_page::web_page_show,
                crate::commands::web_page::web_page_hide,
                crate::commands::web_page::web_page_close,
                crate::commands::web_page::web_page_navigate,
                crate::commands::web_page::web_page_reload,
                crate::commands::chat_window::focus_chat_window,
                crate::commands::chat_window::current_chat_window,
                crate::commands::native_edit::edit_natively,
                crate::commands::clipboard::clipboard_text,
                crate::commands::input_source::set_roman_input,
                crate::commands::system_info::system_info,
                crate::commands::system_info::send_problem_report,
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
                crate::plugins::uri::plugin_take_uris,
                crate::plugins::export::plugin_export,
                crate::plugins::state::plugins_set_all,
                crate::plugins::state::plugin_set,
                crate::plugins::install::plugins_installed,
                crate::plugins::install::plugin_install,
                crate::plugins::install::plugin_install_files,
                crate::plugins::install::plugin_load_dev,
                crate::plugins::install::plugin_uninstall,
                crate::plugins::install::plugin_pick_package,
                crate::plugins::scripts::plugin_open_scripts_dir,
                crate::plugins::catalog::plugin_catalog,
                crate::plugins::catalog::plugin_catalog_cached,
                crate::plugins::catalog::plugin_catalog_readme,
                crate::plugins::catalog::plugin_catalog_icon,
                crate::plugins::catalog::skill_catalog,
                crate::plugins::catalog::skill_install_catalog,
                crate::plugins::catalog::plugin_install_catalog,
                crate::plugins::install::plugin_dev_stamp,
                crate::plugins::ai_tools::plugin_ai_tools_set,
                crate::plugins::ai_tools::plugin_ai_tool_result,
                crate::menu::set_plugin_menu,
                crate::background::tray::set_tray_plugin_items,
                crate::background::tray::take_pending_plugin_command,
                crate::mcp::mcp_status,
                crate::mcp::mcp_restart,
                crate::mcp::mcp_try,
            ]),
        ),
        (
            // What a running plugin reaches through the window.
            "plugin-access.ts",
            builder().commands(collect_commands![
                crate::plugins::access::plugin_fs_list,
                crate::plugins::workspace::plugin_fs_documents,
                crate::plugins::workspace::plugin_fs_search,
                crate::plugins::access::plugin_fs_write,
                crate::plugins::access::plugin_fs_rename,
                crate::plugins::access::plugin_fs_trash,
                crate::plugins::access::plugin_fs_mkdir,
                crate::plugins::files::plugin_fs_stat,
                crate::plugins::files::plugin_fs_create,
                crate::plugins::files::plugin_fs_read_versioned,
                crate::plugins::files::plugin_fs_write_if,
                crate::plugins::files::plugin_secret_get,
                crate::plugins::files::plugin_secret_set,
                crate::plugins::metadata::plugin_metadata_all,
                crate::plugins::metadata::plugin_metadata_get,
                crate::plugins::access::plugin_http,
                crate::plugins::store::plugin_store_get,
                crate::plugins::store::plugin_store_set,
                crate::plugins::store::plugin_store_keys,
                crate::plugins::store::plugin_store_read,
                crate::plugins::store::plugin_store_write,
                crate::plugins::store::plugin_store_files,
                crate::plugins::store::plugin_store_delete,
                crate::plugins::store::plugin_store_usage,
                crate::plugins::store::plugin_store_clear,
            ]),
        ),
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
        ),
        // The AI commands, a file per concern (generated files are held to the same
        // 600-line limit).
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
                // Commands reading their inputs as one struct can't be generated; their
                // input types are.
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
                    crate::ai::images::ai_generated_image_prompt,
                    crate::ai::images::ai_redraw_generated_image,
                    crate::ai::images::ai_discard_generated_image,
                    crate::ai::kept_proposals::kept_proposals_read,
                    crate::ai::kept_proposals::kept_proposals_write,
                ])
                // ai_agent_message takes more parameters than specta supports (ten), so
                // only the types it streams and takes are exported.
                .typ::<crate::ai::agent::StreamEvent>()
                .typ::<aicompat::capabilities::ThinkingLevel>(),
        ),
        (
            // The long-form paper agent (ai::paper): not used by the frontend yet.
            "ai-paper.ts",
            builder()
                .commands(collect_commands![
                    crate::ai::paper::ai_paper_run,
                    crate::ai::paper::ai_paper_save_outline,
                    crate::ai::paper::ai_paper_draft,
                    crate::ai::paper::ai_paper_status
                ])
                .typ::<crate::ai::paper::Dossier>()
                .typ::<crate::ai::paper::Outline>(),
        ),
        (
            "ai-project.ts",
            builder().commands(collect_commands![
                crate::ai::workspace::load_agent_workspace,
                crate::ai::workspace::pick_workspace_root,
                crate::ai::workspace::open_global_agent_dir,
                crate::ai::workspace::ensure_global_agent_md,
                crate::ai::project::list_project_files,
                crate::ai::project::read_project_file,
                crate::ai::project::ensure_project_file,
                crate::ai::project::pick_text_files,
                crate::ai::project::import_references_picked,
                crate::ai::project::learn_style,
            ]),
        ),
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
                    crate::ai::memory::save_offered_skill,
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
        .error_handling(ErrorHandlingMode::Throw)
        // The accessors are the commands' own names, so tsc checks the names the
        // frontend passes.
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
