//! Every command the frontend can invoke, plugin commands first. One list
//! for both targets: commands gated #[cfg(desktop)] are not registered on
//! iOS, where the frontend never calls them.

use super::*;
use ai::client::{ai_complete, ai_grammar_check, fetch_agent_models};
use ai::{agent::ai_agent_message, cancel::ai_cancel};
use auth::claude::{claude_auth_status, claude_login, claude_logout};
use auth::custom_endpoint::{
    clear_custom_endpoint, custom_endpoint_status, fetch_custom_models, set_custom_endpoint,
    test_custom_endpoint,
};
use auth::keys::{clear_provider_api_key, provider_api_key_status, set_provider_api_key};
use auth::openai_codex::{codex_auth_status, codex_login, codex_logout};
use commands::attachment::pick_attachment_files;
#[cfg(desktop)]
use commands::cli::{cli_command_status, install_cli_command};
use commands::drafts::{
    clear_all_drafts, clear_draft_snapshot, finish_draft_restore, save_draft_snapshot,
    take_draft_snapshots,
};
use commands::export::export_save_dialog;
#[cfg(desktop)]
use commands::export::{
    detect_pandoc, export_pdf_native, export_via_pandoc, open_pandoc_install_page, reveal_in_dir,
};
use commands::fs::{
    file_mtime_ms, list_dir, migrate_draft_images, open_css_file_dialog, open_file_dialog,
    open_image_file_dialog, open_settings_file_dialog, read_binary_file_base64, read_text_file,
    save_file_dialog, save_pasted_image, save_settings_file_dialog, write_text_file,
};
use commands::image_host::upload_image;
#[cfg(desktop)]
use commands::linked_file::open_linked_file;
#[cfg(desktop)]
use commands::session::{cancel_session_quit, update_session_paths};
use commands::theme_gallery::{theme_gallery_catalog, theme_gallery_css, theme_gallery_preview};
use commands::themes::{delete_theme, load_theme_css, save_theme_css};

pub(crate) fn handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    crate::with_plugin_commands![
        // Shared: desktop and iOS.
        take_pending_window_paths,
        settings::settings_get,
        settings::settings_patch,
        settings::settings_fill_defaults,
        settings::ui_state_get,
        settings::ui_state_patch,
        settings::history_list,
        settings::history_upsert,
        settings::history_remove,
        settings::ai_records_export,
        settings::ai_records_import,
        settings::history_clear,
        settings::chat_history_get,
        settings::chat_history_archived,
        settings::chat_history_search,
        settings::chat_history_move_document,
        commands::recents::add_recent_file,
        open_file_dialog,
        open_css_file_dialog,
        open_settings_file_dialog,
        save_settings_file_dialog,
        open_image_file_dialog,
        save_file_dialog,
        list_dir,
        commands::folder::index_folder,
        commands::folder::search_folder_text,
        commands::folder::folder_documents,
        read_text_file,
        commands::word_import::open_word_document,
        file_mtime_ms,
        read_binary_file_base64,
        write_text_file,
        save_pasted_image,
        commands::vault::resolve_vault_image,
        commands::vault::resolve_note_link,
        commands::link_root::document_link_root,
        conventions::folder_conventions,
        upload_image,
        migrate_draft_images,
        save_theme_css,
        load_theme_css,
        delete_theme,
        theme_gallery_catalog,
        theme_gallery_css,
        theme_gallery_preview,
        codex_login,
        codex_auth_status,
        codex_logout,
        claude_login,
        claude_auth_status,
        claude_logout,
        ai_complete,
        ai_grammar_check,
        ai_agent_message,
        ai_cancel,
        crate::ai::paper::ai_paper_run,
        crate::ai::paper::status::ai_paper_save_outline,
        crate::ai::paper::drafting::ai_paper_draft,
        crate::ai::paper::figures::ai_paper_figures_drawn,
        crate::ai::paper::status::ai_paper_status,
        fetch_agent_models,
        crate::ai::catalog::list_providers,
        crate::ai::catalog::ai_can_think_deeper,
        crate::ai::images::list_image_providers,
        crate::ai::images::ai_generated_image,
        crate::ai::images::ai_discard_generated_image,
        crate::ai::images::ai_retry_generated_image,
        crate::ai::images::ai_generated_image_prompt,
        crate::ai::images::ai_redraw_generated_image,
        crate::ai::web::web_search_status,
        crate::ai::workspace::load_agent_workspace,
        crate::ai::conventions::measure_text,
        crate::ai::workspace::ensure_global_agent_md,
        crate::ai::workspace::import_agent_skill,
        crate::ai::workspace::list_skills,
        crate::ai::workspace::delete_global_skill,
        crate::ai::workspace::customize_builtin_skill,
        crate::ai::workspace::reset_builtin_skill,
        crate::ai::workspace::set_skill_modes,
        crate::ai::workspace::set_skill_off,
        crate::ai::workspace::save_written_skill,
        crate::ai::project::list_project_files,
        crate::ai::project::read_project_file,
        crate::ai::file_changes::ai_file_changes,
        crate::ai::file_changes::ai_set_file_changes,
        crate::ai::project::ensure_project_file,
        crate::ai::project::pick_text_files,
        crate::ai::project::import_references_picked,
        crate::ai::project::learn_style,
        crate::ai::project::library_use,
        crate::ai::memory::memory_undo,
        crate::ai::memory::memory_move,
        crate::ai::memory::memory_delete,
        crate::ai::memory::memory_remember,
        crate::ai::memory::memory_pass,
        crate::ai::memory::memory_restore,
        crate::ai::memory::save_offered_skill,
        crate::ai::memory::ai_offer_skill,
        crate::ai::next_message::suggest_next_message,
        crate::ai::doc_title::suggest_doc_title,
        crate::ai::memory::revision_choices_read,
        crate::ai::memory::revision_choices_write,
        crate::ai::kept_proposals::kept_proposals_read,
        crate::ai::kept_proposals::kept_proposals_write,
        pick_attachment_files,
        set_provider_api_key,
        provider_api_key_status,
        clear_provider_api_key,
        set_custom_endpoint,
        custom_endpoint_status,
        clear_custom_endpoint,
        fetch_custom_models,
        test_custom_endpoint,
        export_save_dialog,
        save_draft_snapshot,
        take_draft_snapshots,
        finish_draft_restore,
        clear_draft_snapshot,
        clear_all_drafts,
        commands::undo_files::undo_file_save,
        commands::undo_files::undo_file_load,
        commands::undo_files::undo_file_move,
        commands::own_notes::own_notes_read,
        commands::own_notes::own_notes_write,
        distribution::app_distribution,
        #[cfg(desktop)]
        background::tray::set_tray_plugin_items,
        #[cfg(desktop)]
        background::tray::take_pending_plugin_command,
        #[cfg(desktop)]
        mcp::mcp_status,
        #[cfg(desktop)]
        mcp::mcp_restart,
        #[cfg(desktop)]
        mcp::mcp_try,
        // iOS only: rename and delete in the document list.
        #[cfg(mobile)]
        commands::documents::rename_entry,
        #[cfg(mobile)]
        commands::documents::delete_entry,
        // Desktop only: menus, windows, tab drag, detached chat, session restore, the
        // terminal command, export, folder pickers and file-manager reveals.
        #[cfg(desktop)]
        take_pending_show_help,
        #[cfg(desktop)]
        take_pending_menu_event,
        #[cfg(desktop)]
        take_pending_open_folder,
        #[cfg(desktop)]
        commands::folder::pick_open_folder,
        #[cfg(desktop)]
        plugins::install::plugin_pick_package,
        #[cfg(desktop)]
        plugins::scripts::plugin_open_scripts_dir,
        #[cfg(desktop)]
        crate::agents::agent_start,
        #[cfg(desktop)]
        crate::agents::agent_send,
        #[cfg(desktop)]
        crate::agents::agent_stop,
        #[cfg(desktop)]
        menu::set_plugin_menu,
        #[cfg(desktop)]
        commands::tree_ops::tree_create_document,
        #[cfg(desktop)]
        commands::tree_ops::tree_create_folder,
        #[cfg(desktop)]
        commands::tree_ops::tree_move_entry,
        #[cfg(desktop)]
        commands::tree_ops::tree_rename_entry,
        #[cfg(desktop)]
        commands::tree_ops::tree_trash_entry,
        #[cfg(desktop)]
        commands::recents::add_recent_folder,
        #[cfg(desktop)]
        commands::recents::remove_recent,
        #[cfg(desktop)]
        menu::list_recent_folders,
        #[cfg(desktop)]
        open_paths,
        #[cfg(desktop)]
        open_path_in_new_window,
        #[cfg(desktop)]
        menu::trigger_menu_item,
        #[cfg(desktop)]
        menu::list_recent_files,
        #[cfg(desktop)]
        menu::set_menu_labels,
        #[cfg(desktop)]
        menu::set_menu_checks,
        #[cfg(desktop)]
        menu::set_menu_accelerators,
        #[cfg(desktop)]
        tab_drag::take_detached_tab,
        #[cfg(desktop)]
        tab_drag::move_tab_to_new_window,
        #[cfg(desktop)]
        tab_drag::list_window_bounds,
        #[cfg(desktop)]
        tab_drag::start_window_drag_tracking,
        #[cfg(desktop)]
        tab_drag::start_floating_tab_drag,
        #[cfg(desktop)]
        commands::floating_window::floating_desktop_supported,
        #[cfg(desktop)]
        commands::floating_window::open_floating_window,
        #[cfg(desktop)]
        commands::floating_window::close_floating_window,
        #[cfg(desktop)]
        commands::floating_window::resize_floating_window,
        #[cfg(desktop)]
        commands::floating_window::floating_window_position,
        #[cfg(desktop)]
        commands::floating_window::show_floating_owner,
        #[cfg(desktop)]
        commands::chat_window::detach_chat_window,
        #[cfg(desktop)]
        commands::chat_window::take_chat_handoff,
        #[cfg(desktop)]
        #[cfg(desktop)]
        commands::web_page::web_page_show,
        #[cfg(desktop)]
        commands::web_page::web_page_hide,
        #[cfg(desktop)]
        commands::web_page::web_page_close,
        #[cfg(desktop)]
        commands::web_page::web_page_navigate,
        #[cfg(desktop)]
        commands::web_page::web_page_reload,
        #[cfg(desktop)]
        #[cfg(desktop)]
        commands::chat_window::current_chat_window,
        #[cfg(desktop)]
        commands::native_edit::edit_natively,
        #[cfg(desktop)]
        commands::clipboard::clipboard_text,
        commands::input_source::set_roman_input,
        commands::system_info::system_info,
        commands::fonts::system_font_families,
        commands::system_info::send_problem_report,
        #[cfg(desktop)]
        background::background_status,
        #[cfg(desktop)]
        schedule::schedule_set,
        #[cfg(desktop)]
        schedule::schedule_clear,
        #[cfg(desktop)]
        schedule::schedule_list,
        #[cfg(desktop)]
        schedule::host::schedule_take_runs,
        #[cfg(desktop)]
        schedule::host::background_host_idle,
        #[cfg(desktop)]
        schedule::notify::notify_show,
        #[cfg(desktop)]
        schedule::notify::notify_take_open,
        #[cfg(desktop)]
        schedule::app_state::app_state,
        #[cfg(desktop)]
        update_session_paths,
        #[cfg(desktop)]
        cancel_session_quit,
        #[cfg(desktop)]
        crate::ai::workspace::pick_workspace_root,
        #[cfg(desktop)]
        crate::ai::workspace::open_global_agent_dir,
        #[cfg(desktop)]
        cli_command_status,
        #[cfg(desktop)]
        install_cli_command,
        #[cfg(desktop)]
        cli::app::cli_listening,
        #[cfg(desktop)]
        cli::app::cli_respond,
        #[cfg(desktop)]
        commands::fs::move_picture_to_trash,
        #[cfg(desktop)]
        commands::default_editor::default_editor_status,
        #[cfg(desktop)]
        commands::default_editor::set_default_editor,
        #[cfg(desktop)]
        commands::update::check_for_update,
        #[cfg(desktop)]
        commands::update::release_instance,
        #[cfg(desktop)]
        detect_pandoc,
        #[cfg(desktop)]
        export_via_pandoc,
        commands::export::check_pandoc_args,
        #[cfg(desktop)]
        export_pdf_native,
        commands::links::open_community_page,
        commands::links::open_about_link,
        commands::links::open_web_link,
        commands::links::open_tutorials_page,
        commands::web_asset::web_asset,
        #[cfg(desktop)]
        open_pandoc_install_page,
        #[cfg(desktop)]
        reveal_in_dir,
        #[cfg(desktop)]
        open_linked_file,
    ]
}
