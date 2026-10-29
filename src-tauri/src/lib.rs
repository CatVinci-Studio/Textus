//! App entry: window creation and the Tauri builder. The same crate builds the
//! desktop and iOS apps; everything about OS windows is `#[cfg(desktop)]`.

mod ai;
mod app_identity;
mod atomic;
mod auth;
#[cfg(desktop)]
mod background;
// Checks src/platform/bindings/; desktop builds hold every command it lists.
#[cfg(all(test, desktop))]
mod bindings;
mod commands;
mod distribution;
mod extract;
#[cfg(desktop)]
mod mcp;
#[cfg(desktop)]
mod menu;
mod net;
mod plugins;
mod settings;
#[cfg(desktop)]
mod tab_drag;
mod walk;
mod window_frame;

use ai::agent::ai_agent_message;
use ai::cancel::ai_cancel;
use ai::client::{ai_complete, ai_grammar_check, fetch_agent_models, set_ai_proxy};
use auth::claude::{claude_auth_status, claude_login, claude_logout};
use auth::custom_endpoint::{
    clear_custom_endpoint, custom_endpoint_status, fetch_custom_models, set_custom_endpoint,
    test_custom_endpoint,
};
use auth::keys::{clear_provider_api_key, provider_api_key_status, set_provider_api_key};
use auth::openai_codex::{codex_auth_status, codex_login, codex_logout};
use commands::attachment::pick_attachment_file;
use commands::drafts::{
    clear_all_drafts, clear_draft_snapshot, save_draft_snapshot, take_draft_snapshots,
};
use commands::export::export_save_dialog;
use commands::fs::{
    file_mtime_ms, list_dir, migrate_draft_images, open_css_file_dialog, open_file_dialog,
    open_image_file_dialog, read_binary_file_base64, read_text_file, save_file_dialog,
    save_pasted_image, write_text_file,
};
use commands::image_host::upload_image;
use commands::theme_gallery::{theme_gallery_catalog, theme_gallery_css, theme_gallery_preview};
use commands::themes::{delete_theme, load_theme_css, save_theme_css};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[cfg(desktop)]
use commands::cli::{cli_command_status, install_cli_command};
#[cfg(desktop)]
use commands::export::{
    detect_pandoc, export_pdf_native, export_via_pandoc, open_pandoc_install_page, reveal_in_dir,
};
#[cfg(desktop)]
use commands::session::{cancel_session_quit, update_session_paths, SessionTabsState};
#[cfg(desktop)]
use std::collections::HashMap;
#[cfg(desktop)]
use std::sync::atomic::AtomicU32;
#[cfg(desktop)]
use tab_drag::{DragTrackers, PendingDetachedTabs};
#[cfg(desktop)]
use tauri::{EventTarget, WebviewUrl, WebviewWindowBuilder};

mod launch;
pub(crate) use launch::*;
pub(crate) mod editor_windows;

/// Everything the builder needs on desktop only: the updater, window/tab/session
/// state, window lifecycle, and startup's argv, session restore and menu bar.
#[cfg(desktop)]
fn desktop_builder(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(PendingDetachedTabs(Mutex::new(HashMap::new())))
        .manage(DragTrackers::default())
        .manage(SessionTabsState(Mutex::new(HashMap::new())))
        .manage(commands::chat_window::PendingChatHandoffs(Mutex::new(
            HashMap::new(),
        )))
        .manage(commands::chat_window::OpenChatWindows(Mutex::new(
            Vec::new(),
        )))
        .manage(background::BackgroundStatus::default())
        .manage(background::tray::TrayPlugins::default())
        .manage(mcp::McpHub::default())
        .manage(plugins::ai_tools::PluginAiTools::default())
        .manage(plugins::metadata::MetadataIndex::default())
        .plugin(tauri_plugin_deep_link::init())
        .on_window_event(|window, event| {
            let app = window.app_handle();
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let no_other_windows = app
                    .webview_windows()
                    .keys()
                    .all(|label| label == window.label());
                if let Some(state) = app.try_state::<SessionTabsState>() {
                    // The last editor window keeps its documents in the session file.
                    commands::session::forget_window(app, window.label(), &state);
                }
                if let Some(state) = app.try_state::<commands::chat_window::OpenChatWindows>() {
                    commands::chat_window::forget_chat_window(app, window.label(), &state);
                }
                // File > Quit closes every window so dirty editors can cancel; macOS would
                // otherwise stay alive windowless, so exit once the final window is gone.
                if no_other_windows && commands::session::app_quitting() {
                    app.exit(0);
                }
            }
            // Remember a window's size and place on Close, since after Destroyed they can
            // no longer be read.
            if matches!(event, tauri::WindowEvent::CloseRequested { .. })
                && commands::chat_window::is_editor_window(window.label())
            {
                commands::prefs::remember_editor_window(app, window);
            }
        })
}

/// The desktop half of startup, run from the shared setup in `run` once the
/// main window exists.
#[cfg(desktop)]
fn desktop_setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "linux")]
    crate::editor_windows::detect_wayland();
    #[cfg(target_os = "macos")]
    crate::editor_windows::watch_fullscreen(app.handle());
    // textus:// links for plugins.
    plugins::uri::listen(app.handle());
    // Windows/Linux pass an associated file as argv; macOS parks its launch files
    // in LAUNCH_OPENED. With none, restore last session's documents (also what an
    // update relaunch relies on).
    #[allow(unused_mut)]
    let mut arg_paths = paths_from_argv(
        std::env::args(),
        &std::env::current_dir().unwrap_or_default(),
    );
    #[cfg(target_os = "macos")]
    arg_paths.extend(LAUNCH_OPENED.lock().unwrap().take().unwrap_or_default());
    if !arg_paths.is_empty() {
        queue_paths_to_open(app.handle(), arg_paths);
    } else if commands::prefs::read_restore_session_on_startup(app.handle()) {
        queue_windows_to_open(
            app.handle(),
            commands::session::read_session_windows(app.handle()),
        );
    }

    commands::cli::try_silent_install();

    menu::install(app)?;

    // The menu bar was set by install() after build_with_app_chrome could hide
    // it, so hide it on every existing window now.
    for (_, window) in app.webview_windows() {
        crate::editor_windows::hide_native_menu_bar(&window);
    }

    // Background mode costs one settings read while off.
    if background::enabled(app.handle()) {
        background::apply(app.handle(), background::Change::Startup);
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Windows and Linux would start a new process per opened file. Must be the
    // first plugin: a second launch hands over its argv and exits. Release builds
    // only, so a dev build can run beside an installed Textus.
    #[cfg(all(any(windows, target_os = "linux"), not(debug_assertions)))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        let paths = paths_from_argv(argv, std::path::Path::new(&cwd));
        let editor_open = app
            .webview_windows()
            .keys()
            .any(|label| commands::chat_window::is_editor_window(label));
        if paths.is_empty() && !editor_open {
            // Launched again while running in the background with no
            // window: the same documents a fresh launch would restore.
            crate::editor_windows::reopen_without_windows(app);
        } else if paths.is_empty() {
            // Launched again from the app menu or dock: a fresh window.
            let _ = crate::editor_windows::open_new_window(app);
        } else {
            queue_paths_to_open(app, paths);
        }
    }));
    let builder = builder
        .register_asynchronous_uri_scheme_protocol(
            plugins::scheme::SCHEME,
            |ctx, request, responder| plugins::scheme::handle(ctx.app_handle(), request, responder),
        )
        .manage(plugins::uri::PendingUris::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingOpenPaths(Mutex::new(Vec::new())));
    // Document access outside the app's own folder.
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_textus_files::init());
    #[cfg(desktop)]
    let builder = desktop_builder(builder);
    builder
        .setup(|app| {
            // Before any window: every window's boot script is made from it.
            settings::init(app.handle());
            tauri::async_runtime::spawn(plugins::moved_skills::install_moved_skills(
                app.handle().clone(),
            ));
            crate::editor_windows::build_main_window(app)?;
            #[cfg(desktop)]
            desktop_setup(app)?;
            Ok(())
        })
        // One handler list for both targets: commands gated #[cfg(desktop)] are not
        // registered on iOS, where the frontend never calls them.
        .invoke_handler(crate::with_plugin_commands![
            // Shared: desktop and iOS.
            take_pending_window_paths,
            take_pending_open_paths,
            settings::settings_get,
            settings::settings_patch,
            settings::settings_fill_defaults,
            settings::ui_state_get,
            settings::ui_state_patch,
            settings::history_list,
            settings::history_upsert,
            settings::history_remove,
            settings::history_clear,
            settings::chat_history_get,
            settings::chat_history_archived,
            settings::chat_history_search,
            settings::chat_history_move_document,
            commands::recents::add_recent_file,
            open_file_dialog,
            open_css_file_dialog,
            open_image_file_dialog,
            save_file_dialog,
            list_dir,
            commands::folder::index_folder,
            read_text_file,
            commands::word_import::open_word_document,
            file_mtime_ms,
            read_binary_file_base64,
            write_text_file,
            save_pasted_image,
            commands::vault::resolve_vault_image,
            commands::vault::resolve_vault_note,
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
            fetch_agent_models,
            set_ai_proxy,
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
            crate::ai::conventions::writing_conventions_options,
            crate::ai::conventions::writing_conventions_effective,
            crate::ai::conventions::conventions_check_document,
            crate::ai::conventions::measure_text,
            crate::ai::workspace::ensure_global_agent_md,
            crate::ai::workspace::import_agent_skill,
            crate::ai::workspace::list_skills,
            crate::ai::workspace::customize_builtin_skill,
            crate::ai::workspace::reset_builtin_skill,
            crate::ai::workspace::set_skill_modes,
            crate::ai::workspace::save_written_skill,
            crate::ai::builtin::builtin_skills_attribution,
            crate::ai::project::list_project_files,
            crate::ai::project::read_project_file,
            crate::ai::project::ensure_project_file,
            crate::ai::project::pick_text_files,
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
            crate::ai::memory::revision_choices_read,
            crate::ai::memory::revision_choices_write,
            crate::ai::kept_proposals::kept_proposals_read,
            crate::ai::kept_proposals::kept_proposals_write,
            pick_attachment_file,
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
            clear_draft_snapshot,
            clear_all_drafts,
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
            commands::chat_window::detach_chat_window,
            #[cfg(desktop)]
            commands::chat_window::take_chat_handoff,
            #[cfg(desktop)]
            commands::chat_window::close_chat_window,
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
            commands::chat_window::focus_chat_window,
            #[cfg(desktop)]
            commands::chat_window::current_chat_window,
            #[cfg(desktop)]
            commands::clipboard::paste_natively,
            #[cfg(desktop)]
            commands::clipboard::clipboard_text,
            commands::input_source::set_roman_input,
            commands::system_info::system_info,
            #[cfg(desktop)]
            background::background_status,
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
            #[cfg(desktop)]
            export_pdf_native,
            commands::links::open_community_page,
            commands::links::open_about_link,
            commands::links::open_web_link,
            commands::links::open_tutorials_page,
            #[cfg(desktop)]
            open_pandoc_install_page,
            #[cfg(desktop)]
            reveal_in_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // Flush whatever is still waiting on its debounce.
            if let tauri::RunEvent::Exit = event {
                settings::flush_all(app_handle);
            }
            // Closing the last window leaves the app running on macOS, and elsewhere in
            // background mode. Tauri's codeless request after the last window is turned
            // down per `keeps_running`; exits with a code go ahead.
            #[cfg(desktop)]
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &event {
                if background::keeps_running(
                    *code,
                    background::Os::current(),
                    background::enabled(app_handle),
                ) {
                    api.prevent_exit();
                }
            }
            // macOS: the Dock icon clicked (or the app opened again from
            // Finder) while it shows no window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                crate::editor_windows::reopen_without_windows(app_handle);
            }
            // Finder "Open With" arrives as an Apple open-documents event (never argv);
            // iOS delivers "Open in Textus" the same way.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                // iOS hands over a security-scoped URL, kept as a URL so the textus-files
                // plugin can open its scope.
                #[cfg(target_os = "ios")]
                let paths: Vec<String> = urls
                    .iter()
                    .filter(|url| url.scheme() == "file")
                    .map(|url| url.to_string())
                    .collect();
                #[cfg(not(target_os = "ios"))]
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|p| p.to_string_lossy().to_string())
                    .collect();
                // Still launching: setup opens them (LAUNCH_OPENED).
                #[cfg(target_os = "macos")]
                let paths = match LAUNCH_OPENED.lock().unwrap().as_mut() {
                    Some(early) => {
                        early.extend(paths);
                        Vec::new()
                    }
                    None => paths,
                };
                queue_paths_to_open(app_handle, paths);
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let _ = event;
        });
}
