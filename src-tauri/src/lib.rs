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
mod dialogs;
mod errors;
mod excerpt;
// Checks src/platform/bindings/; desktop builds hold every command it lists.
#[cfg(desktop)]
mod agents;
mod app_dirs;
#[cfg(all(test, desktop))]
mod bindings;
mod commands;
mod conventions;
mod distribution;
#[cfg(desktop)]
mod drag_modifiers;
#[cfg(desktop)]
mod export_formats;
mod ext_stats;
mod extract;
mod frontmatter;
mod ids;
mod json_file;
#[cfg(desktop)]
mod mcp;
mod media;
mod memory_level;
#[cfg(desktop)]
mod menu;
mod net;
mod plugins;
mod schedule;
mod settings;
mod spawn;
#[cfg(desktop)]
mod tab_drag;
#[cfg(target_os = "macos")]
mod trackpad;
mod walk;
#[cfg(any(windows, test))]
mod webview_memory;
#[cfg(desktop)]
mod window_frame;
mod window_guard;
#[cfg(target_os = "macos")]
mod window_notes;
#[cfg(desktop)]
mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::State;
// Android: no files are handed to its one window (launch.rs).
#[cfg(any(desktop, target_os = "ios"))]
use tauri::{Emitter, Manager};

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
mod locks;
#[cfg(desktop)]
mod open_route;
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
        .manage(commands::fs::watch::TreeWatches::default())
        .plugin(tauri_plugin_deep_link::init())
        .on_window_event(|window, event| {
            let app = window.app_handle();
            #[cfg(windows)]
            webview_memory::follow_minimized(window, event);
            // Windows switched dark or light: "system" windows take its colour.
            #[cfg(windows)]
            if matches!(event, tauri::WindowEvent::ThemeChanged(_)) {
                settings::apply_window_backgrounds(app);
            }
            if matches!(event, tauri::WindowEvent::Focused(true)) {
                editor_windows::note_focused(window.label());
            }
            if matches!(
                event,
                tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Destroyed
            ) {
                schedule::app_state::changed(app);
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let no_other_windows = app.windows().keys().all(|label| label == window.label());
                if let Some(state) = app.try_state::<SessionTabsState>() {
                    // The last editor window keeps its documents in the session file.
                    commands::session::forget_window(app, window.label(), &state);
                }
                if let Some(state) = app.try_state::<OpenChatWindows>() {
                    commands::chat_window::forget_chat_window(app, window.label(), &state);
                }
                #[cfg(desktop)]
                commands::floating_window::close_owned_by(app, window.label());
                #[cfg(desktop)]
                agents::stop_for_window(app, window.label());
                #[cfg(desktop)]
                cli::app::window_gone(app, window.label());
                #[cfg(desktop)]
                commands::fs::watch::window_gone(app, window.label());
                #[cfg(desktop)]
                launch::window_gone(window.label());
                // File > Quit closes every window so dirty editors can cancel; macOS would
                // otherwise stay alive windowless, so exit once the final window is gone.
                if no_other_windows && commands::session::app_quitting() {
                    commands::update::exit_app(app);
                }
            }
            #[cfg(desktop)]
            if crate::windows::is_editor_window(window.label()) {
                remember_editor_frame(app, window, event);
            }
        })
}

/// An editor window's normal bounds as they change, and on Close, while they can
/// still be read, its frame for the next launch: in the UI state, and in the
/// session for the window that comes back with these documents. Quit keeps
/// both before it closes the windows.
#[cfg(desktop)]
fn remember_editor_frame(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    event: &tauri::WindowEvent,
) {
    match event {
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            commands::prefs::note_bounds(window);
        }
        tauri::WindowEvent::CloseRequested { .. } if !commands::session::app_quitting() => {
            let frame = commands::prefs::closing_frame(window);
            commands::prefs::remember_editor_window(app, frame);
            if let Some(state) = app.try_state::<SessionTabsState>() {
                commands::session::keep_frame(app, window.label(), frame, &state);
            }
        }
        tauri::WindowEvent::Destroyed => commands::prefs::forget_bounds(window.label()),
        _ => {}
    }
}

/// The desktop half of startup, run from the shared setup in `run` once the
/// main window exists.
#[cfg(desktop)]
fn desktop_setup(
    app: &mut tauri::App,
    opens: Option<launch::LaunchOpens>,
) -> Result<(), Box<dyn std::error::Error>> {
    commands::update::record_panics(app.handle());
    #[cfg(target_os = "linux")]
    crate::editor_windows::detect_wayland();
    #[cfg(target_os = "macos")]
    crate::editor_windows::watch_fullscreen(app.handle());
    #[cfg(target_os = "macos")]
    crate::trackpad::watch_trackpad(app.handle());
    #[cfg(target_os = "macos")]
    crate::commands::traffic_lights::watch(app.handle());
    // Plugins' jobs and notifications: before the links, one of which may be
    // a notification's click that started Textus.
    schedule::start(app.handle());
    // textus:// links for plugins.
    plugins::uri::listen(app.handle());
    // What the launch opens (launch_opens, decided before the main window).
    launch::queue_launch(app.handle(), opens);

    commands::cli::try_silent_install();
    cli::app::start(app.handle());
    // Secrets an older build left in the settings go to the key store.
    mcp::secrets::seal_saved(app.handle());

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

/// The portable build keeps the webview's data beside it too: WebView2
/// takes this over the folder Tauri names. Called first thing in main.
pub fn prepare_portable() {
    #[cfg(windows)]
    if let Some(root) = distribution::portable_root() {
        // SAFETY: the first statement of main on Windows, single-threaded.
        unsafe { std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", root.join("webview")) };
    }
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
            .windows()
            .keys()
            .any(|label| crate::windows::is_editor_window(label));
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
            |ctx, request, responder| {
                plugins::scheme::handle(ctx.app_handle(), ctx.webview_label(), request, responder)
            },
        )
        .manage(plugins::uri::PendingUris::default())
        .manage(plugins::ai_tools::PluginAiTools::default())
        .manage(plugins::metadata::MetadataIndex::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingOpenPaths(Mutex::new(Vec::new())));
    // Document access outside the app's own folder.
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_textus_files::init());
    #[cfg(desktop)]
    let builder = desktop_builder(builder);
    builder
        .setup(|app| {
            // Before any window: every window's boot script is made from it.
            settings::init(app.handle());
            // Where the AI's file changes and revisions are kept, known at once.
            crate::ai::kept_proposals::know_app_data(app.handle());
            if let Some(data) = crate::ai::kept_proposals::app_data_dir() {
                tauri::async_runtime::spawn_blocking(move || {
                    crate::ai::file_changes::forget_old_records(&data)
                });
            }
            // AI skills only where there is Textus AI: never on iOS.
            #[cfg(not(target_os = "ios"))]
            tauri::async_runtime::spawn(plugins::moved_skills::install_moved_skills(
                app.handle().clone(),
            ));
            plugins::document_types::refresh(app.handle());
            memory_level::watch(app.handle().clone());
            // Windows/Linux pass an associated file as argv; macOS parks its
            // launch files in LAUNCH_OPENED. With none, last session's documents
            // (also what an update relaunch relies on). Decided before the main
            // window, whose boot snapshot says whether it has any coming.
            #[cfg(desktop)]
            let opens = launch::launch_opens(app.handle());
            #[cfg(desktop)]
            crate::editor_windows::build_main_window(app, opens.as_ref())?;
            #[cfg(not(desktop))]
            crate::editor_windows::build_main_window(app)?;
            #[cfg(desktop)]
            desktop_setup(app, opens)?;
            Ok(())
        })
        .invoke_handler(invoke_handler::handler())
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            // Flush whatever is still waiting on its debounce.
            if let tauri::RunEvent::Exit = event {
                // Quit from outside the menu (the Dock, logging out) closes no window first.
                #[cfg(desktop)]
                if !commands::session::app_quitting() {
                    commands::prefs::remember_open_windows(app_handle);
                }
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
