//! App entry: window creation and the Tauri builder. The same crate builds the
//! desktop and iOS apps; everything about OS windows is `#[cfg(desktop)]`.

mod ai;
mod app_identity;
mod atomic;
mod auth;
#[cfg(desktop)]
mod background;
#[cfg(desktop)]
pub mod cli;
// Checks src/platform/bindings/; desktop builds hold every command it lists.
#[cfg(desktop)]
mod agents;
#[cfg(all(test, desktop))]
mod bindings;
mod commands;
mod conventions;
mod distribution;
mod ext_stats;
mod extract;
#[cfg(desktop)]
mod mcp;
#[cfg(desktop)]
mod menu;
mod net;
mod plugins;
mod schedule;
mod settings;
#[cfg(desktop)]
mod tab_drag;
mod walk;
#[cfg(windows)]
mod webview_memory;
mod window_frame;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

#[cfg(desktop)]
use commands::chat_window::{OpenChatWindows, PendingChatHandoffs};
#[cfg(desktop)]
use commands::session::SessionTabsState;
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
mod invoke_handler;

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
        .manage(PendingChatHandoffs(Mutex::new(HashMap::new())))
        .manage(OpenChatWindows(Mutex::new(Vec::new())))
        .manage(background::BackgroundStatus::default())
        .manage(background::tray::TrayPlugins::default())
        .manage(mcp::McpHub::default())
        .manage(agents::Agents::default())
        .manage(cli::app::CliBridge::default())
        .plugin(tauri_plugin_deep_link::init())
        .on_window_event(|window, event| {
            let app = window.app_handle();
            #[cfg(windows)]
            webview_memory::follow_minimized(window, event);
            if matches!(
                event,
                tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Destroyed
            ) {
                schedule::app_state::changed(app);
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let no_other_windows = app
                    .webview_windows()
                    .keys()
                    .all(|label| label == window.label());
                if let Some(state) = app.try_state::<SessionTabsState>() {
                    // The last editor window keeps its documents in the session file.
                    commands::session::forget_window(app, window.label(), &state);
                }
                if let Some(state) = app.try_state::<OpenChatWindows>() {
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
    // Plugins' jobs and notifications: before the links, one of which may be
    // a notification's click that started Textus.
    schedule::start(app.handle());
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
    cli::app::start(app.handle());

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
        .manage(plugins::ai_tools::PluginAiTools::default())
        .manage(plugins::metadata::MetadataIndex::default())
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
        .invoke_handler(invoke_handler::handler())
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // Flush whatever is still waiting on its debounce.
            if let tauri::RunEvent::Exit = event {
                settings::flush_all(app_handle);
                #[cfg(desktop)]
                agents::stop_all(app_handle);
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
                open_urls(app_handle, urls);
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let _ = event;
        });
}
