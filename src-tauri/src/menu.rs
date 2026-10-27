//! The native menu bar: construction, the id -> frontend-event dispatch, and
//! File > Open Recent. Windows and Linux hide it and draw the menu in HTML
//! with the same ids, so renaming an id here means renaming it there.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
    Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Wry};

use crate::app_identity;
use crate::commands;

mod state;
pub(crate) use state::*;
mod recent;
pub(crate) use recent::*;
mod build;
pub(crate) use build::*;
#[cfg(target_os = "macos")]
mod dock;
mod plugins;
pub use plugins::set_plugin_menu;
pub(crate) use plugins::*;

const SETTINGS_MENU_ID: &str = "settings";
const NEW_FILE_ID: &str = "new-file";
const OPEN_FILE_ID: &str = "open-file";
const OPEN_FOLDER_ID: &str = "open-folder";
const CLOSE_FOLDER_ID: &str = "close-folder";
const SAVE_FILE_ID: &str = "save-file";
const SAVE_FILE_AS_ID: &str = "save-file-as";
const RECENT_CLEAR_ID: &str = "recent-clear";
/// Menu ids of File > Open Recent entries carry their path: "recent:<path>".
const RECENT_PREFIX: &str = "recent:";
/// Open Recent's folders, listed above its files, carry theirs the same way.
const RECENT_FOLDER_PREFIX: &str = "recent-folder:";
const EXPORT_PDF_ID: &str = "export-pdf";
const EXPORT_HTML_ID: &str = "export-html";
/// Pandoc-backed File > Export ids carry the writer name. Keep the formats
/// in step with the frontend's PANDOC_FORMATS.
const EXPORT_PANDOC_PREFIX: &str = "export-pandoc:";
const QUIT_ID: &str = "quit";
const CLOSE_TAB_ID: &str = "close-tab";
const CLOSE_WINDOW_ID: &str = "close-window";
const TOGGLE_SOURCE_MODE_ID: &str = "toggle-source-mode";
const TOGGLE_TYPEWRITER_MODE_ID: &str = "toggle-typewriter-mode";
const TRACK_CHANGES_ID: &str = "track-changes";
const TOGGLE_SIDEBAR_ID: &str = "toggle-sidebar";
const TOGGLE_AGENT_PANEL_ID: &str = "toggle-agent-panel";
/// Textus AI's master switch, flipped by the focused window, which owns the
/// setting. Not in the View menu, but the iPhone's app-drawn menu runs it.
const TOGGLE_TEXTUS_AI_ID: &str = "toggle-textus-ai";
const TOGGLE_SPLIT_VIEW_ID: &str = "toggle-split-view";
const TOGGLE_ZEN_MODE_ID: &str = "toggle-zen-mode";
/// View > Read Only: the document on screen can't be changed.
const TOGGLE_READ_ONLY_ID: &str = "toggle-read-only";
/// Two documents at once, side by side or one above the other.
const SPLIT_RIGHT_ID: &str = "split-right";
/// Everything the menus do, found by typing.
const COMMAND_PALETTE_ID: &str = "command-palette";
const SPLIT_DOWN_ID: &str = "split-down";
const CLOSE_SPLIT_ID: &str = "close-split";
const ZOOM_IN_ID: &str = "zoom-in";
const ZOOM_OUT_ID: &str = "zoom-out";
const ZOOM_RESET_ID: &str = "zoom-reset";
const FIND_REPLACE_ID: &str = "find-replace";
/// Edit > Copy as Plain Text and Paste as Plain Text: the words without the
/// Markdown marks Copy's plain text carries, and the clipboard's text as is.
const COPY_AS_PLAIN_TEXT_ID: &str = "copy-as-plain-text";
const PASTE_AS_PLAIN_TEXT_ID: &str = "paste-as-plain-text";
/// Edit > Select All on macOS, in place of the predefined item, whose
/// selectAll: with no text field focused selected the whole window.
#[cfg(target_os = "macos")]
const SELECT_ALL_ID: &str = "select-all";
const NEW_WINDOW_ID: &str = "new-window";
/// Help menu ids carry the bundled doc they open: "help-doc:<doc>".
const HELP_DOC_PREFIX: &str = "help-doc:";
/// Help > Join the Community, in the UI's language (the focused window knows it).
const COMMUNITY_ID: &str = "help-community";
/// Help > Video Tutorials, opened the same way as Join the Community.
const TUTORIALS_ID: &str = "help-tutorials";
/// Format menu ids carry the block kind to insert: "insert-block:<kind>".
const INSERT_BLOCK_PREFIX: &str = "insert-block:";

/// Emit a menu event only to the focused window. `emit_to`, not `emit` on a
/// window handle: that one looks scoped but broadcasts to every window.
fn emit_to_focused(app: &tauri::AppHandle, event: &str) {
    emit_to_focused_payload(app, event, ());
}

fn emit_to_focused_payload<S: serde::Serialize + Clone>(
    app: &tauri::AppHandle,
    event: &str,
    payload: S,
) {
    if let Some(label) = focused_editor_window(app) {
        let _ = app.emit_to(EventTarget::webview_window(&label), event, payload);
    }
}

/// The editor window a menu command or OS open goes to. A focused detached
/// chat resolves to its editor; failing that, any editor window. An item run
/// from inside a window names it, since its webview focus may not register.
pub(crate) fn focused_editor_window(app: &tauri::AppHandle) -> Option<String> {
    let windows = app.webview_windows();
    let focused = MENU_ORIGIN
        .with(|origin| origin.borrow().clone())
        .filter(|label| windows.contains_key(label))
        .or_else(|| {
            windows
                .iter()
                .find(|(_, w)| w.is_focused().unwrap_or(false))
                .map(|(label, _)| label.clone())
        });

    match focused {
        Some(label) if crate::commands::chat_window::is_editor_window(&label) => Some(label),
        Some(label) => app
            .try_state::<crate::commands::chat_window::OpenChatWindows>()
            .and_then(|open| crate::commands::chat_window::editor_for_chat(&label, &open)),
        None => None,
    }
    .or_else(|| {
        windows
            .keys()
            .find(|label| crate::commands::chat_window::is_editor_window(label))
            .cloned()
    })
}

/// `emit_to_focused`, or with no window open, a fresh window that runs it once
/// mounted. Not run now: a panel with no window attached itself to a closed one.
fn emit_or_open_window(app: &tauri::AppHandle, event: &'static str) {
    if focused_editor_window(app).is_some() {
        emit_to_focused(app, event);
    } else {
        *crate::PENDING_MENU_EVENT.lock().unwrap() = Some(event);
        let _ = crate::open_new_window(app);
    }
}

/// The macOS menu bar in the UI's language, rebuilt only when the labels
/// change. Elsewhere it does nothing. Async with a main-thread hop, as menus
/// are only built there.
#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn set_menu_labels(app: AppHandle, labels: HashMap<String, String>) {
    #[cfg(target_os = "macos")]
    {
        let Some(state) = app.try_state::<MenuLabels>() else {
            return;
        };
        {
            let mut current = state.0.lock().unwrap();
            if *current == labels {
                return;
            }
            *current = labels.clone();
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = set_menu(&handle, &labels);
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, labels);
}

/// The View menu's check marks, keyed by menu id, sent by the front window on
/// change and focus. macOS only; elsewhere the app-drawn menu draws them.
#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn set_menu_checks(app: AppHandle, checks: HashMap<String, bool>) {
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(state) = handle.try_state::<ViewChecks>() else {
                return;
            };
            let mut guard = state.0.lock().unwrap();
            for item in &guard.items {
                if let Some(&on) = checks.get(item.id().as_ref()) {
                    let _ = item.set_checked(on);
                }
            }
            guard.checked = checks;
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, checks);
}

/// The Format menu's heading keys, keyed by menu id, following Settings ›
/// Shortcuts so a rebound key doesn't keep firing. macOS only: on Windows a
/// native key would fire twice beside the frontend's.
#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn set_menu_accelerators(app: AppHandle, accelerators: HashMap<String, String>) {
    #[cfg(target_os = "macos")]
    {
        let Some(state) = app.try_state::<MenuAccelerators>() else {
            return;
        };
        {
            let mut current = state.0.lock().unwrap();
            if *current == accelerators {
                return;
            }
            *current = accelerators;
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let labels = handle.state::<MenuLabels>().0.lock().unwrap().clone();
            let _ = set_menu(&handle, &labels);
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, accelerators);
}

/// Runs a menu id exactly as clicking that native item would; the way in for
/// the app-drawn menu. Unknown ids do nothing. Async because creating or
/// closing windows from the calling webview's IPC callback freezes Windows.
#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn trigger_menu_item(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String) {
    MENU_ORIGIN.with(|origin| *origin.borrow_mut() = Some(window.label().to_string()));
    dispatch(&app, &id);
    MENU_ORIGIN.with(|origin| *origin.borrow_mut() = None);
}

thread_local! {
    /// The window whose app-drawn menu or shortcut is being dispatched, set only
    /// for one `trigger_menu_item` call on its thread.
    static MENU_ORIGIN: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// The recent-file list behind File > Open Recent, for the app-drawn menu.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn list_recent_files(app: tauri::AppHandle) -> Vec<String> {
    commands::recents::read_recent_files(&app)
}

/// The recent folders, listed above the files there.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn list_recent_folders(app: tauri::AppHandle) -> Vec<String> {
    commands::recents::read_recent_folders(&app)
}

/// Quit: every window is asked to close, so each unsaved document gets its
/// prompt, and the app exits once the last one is gone.
pub(crate) fn quit(app_handle: &tauri::AppHandle) {
    // Capture every editor before destruction order can progressively
    // shrink the session. A cancelled dirty-window prompt resets this
    // through cancel_session_quit.
    commands::session::begin_app_quit(
        app_handle,
        &app_handle.state::<commands::session::SessionTabsState>(),
    );
    // close() (not destroy()) so each frontend gets its close-requested
    // prompt.
    let windows = app_handle.webview_windows();
    if windows.is_empty() {
        // No window open (macOS, or background mode): nothing to close,
        // nothing to ask.
        app_handle.exit(0);
    }
    for (_, window) in windows {
        let _ = window.close();
    }
}

/// Opens `path` in the focused window's sidebar; with no window open, a fresh
/// window does once it has mounted.
fn open_folder_in_sidebar(app_handle: &tauri::AppHandle, path: &str) {
    if focused_editor_window(app_handle).is_some() {
        emit_to_focused_payload(app_handle, "menu-open-recent-folder", path);
    } else {
        *crate::PENDING_OPEN_FOLDER.lock().unwrap() = Some(path.to_string());
        let _ = crate::open_new_window(app_handle);
    }
}

/// What a menu id does, for native clicks, the app-drawn menu and the tray alike.
fn dispatch(app_handle: &tauri::AppHandle, id: &str) {
    if id == SETTINGS_MENU_ID {
        emit_or_open_window(app_handle, "menu-open-settings");
    } else if let Some(item) = id.strip_prefix(crate::background::tray::MENU_PREFIX) {
        crate::background::tray::on_menu(app_handle, item);
    } else if id == NEW_FILE_ID {
        // Honors the same Settings choice as opening files: a new tab in the
        // focused window in tab mode, a fresh window otherwise (or when
        // there's no window at all).
        if app_handle.webview_windows().is_empty()
            || commands::prefs::read_new_document_mode(app_handle) != "tab"
        {
            let _ = crate::open_new_window(app_handle);
        } else {
            emit_to_focused(app_handle, "menu-new-file");
        }
    } else if let Some(command) = id.strip_prefix(PLUGIN_COMMAND_PREFIX) {
        emit_to_focused_payload(app_handle, "menu-plugin-command", command.to_string());
    } else if id == MANAGE_PLUGINS_ID {
        emit_or_open_window(app_handle, "menu-manage-plugins");
    } else if id == OPEN_FILE_ID {
        emit_or_open_window(app_handle, "menu-open-file");
    } else if id == OPEN_FOLDER_ID {
        emit_or_open_window(app_handle, "menu-open-folder");
    } else if id == CLOSE_FOLDER_ID {
        emit_to_focused(app_handle, "menu-close-folder");
    } else if id == SAVE_FILE_ID {
        emit_to_focused(app_handle, "menu-save-file");
    } else if id == SAVE_FILE_AS_ID {
        emit_to_focused(app_handle, "menu-save-file-as");
    } else if id == RECENT_CLEAR_ID {
        commands::recents::clear_recent_files(app_handle);
    } else if let Some(path) = id.strip_prefix(RECENT_FOLDER_PREFIX) {
        open_folder_in_sidebar(app_handle, path);
    } else if let Some(path) = id.strip_prefix(RECENT_PREFIX) {
        // The focused window decides: a fresh, untouched one takes the file itself;
        // any other sends it back through open_paths. With no window, it queues.
        if focused_editor_window(app_handle).is_some() {
            emit_to_focused_payload(app_handle, "menu-open-recent", path);
        } else {
            crate::queue_paths_to_open(app_handle, vec![path.to_string()]);
        }
    } else if id == EXPORT_PDF_ID {
        emit_to_focused(app_handle, "menu-export-pdf");
    } else if id == EXPORT_HTML_ID {
        emit_to_focused(app_handle, "menu-export-html");
    } else if let Some(format) = id.strip_prefix(EXPORT_PANDOC_PREFIX) {
        emit_to_focused_payload(app_handle, "menu-export-pandoc", format);
    } else if id == QUIT_ID {
        quit(app_handle);
    } else if let Some(kind) = id.strip_prefix(INSERT_BLOCK_PREFIX) {
        emit_to_focused_payload(app_handle, "menu-insert-block", kind);
    } else if id == TOGGLE_SOURCE_MODE_ID {
        emit_to_focused(app_handle, "menu-toggle-source-mode");
    } else if id == TOGGLE_TYPEWRITER_MODE_ID {
        emit_to_focused(app_handle, "menu-toggle-typewriter-mode");
    } else if id == TRACK_CHANGES_ID {
        emit_to_focused(app_handle, "menu-track-changes");
    } else if id == TOGGLE_SIDEBAR_ID {
        emit_to_focused(app_handle, "menu-toggle-sidebar");
    } else if id == TOGGLE_AGENT_PANEL_ID {
        emit_to_focused(app_handle, "menu-toggle-agent-panel");
    } else if id == TOGGLE_TEXTUS_AI_ID {
        emit_to_focused(app_handle, "menu-toggle-textus-ai");
    } else if id == TOGGLE_SPLIT_VIEW_ID {
        emit_to_focused(app_handle, "menu-toggle-split-view");
    } else if id == TOGGLE_ZEN_MODE_ID {
        emit_to_focused(app_handle, "menu-toggle-zen-mode");
    } else if id == TOGGLE_READ_ONLY_ID {
        emit_to_focused(app_handle, "menu-toggle-read-only");
    } else if id == COMMAND_PALETTE_ID {
        emit_to_focused(app_handle, "menu-command-palette");
    } else if id == SPLIT_RIGHT_ID {
        emit_to_focused(app_handle, "menu-split-right");
    } else if id == SPLIT_DOWN_ID {
        emit_to_focused(app_handle, "menu-split-down");
    } else if id == CLOSE_SPLIT_ID {
        emit_to_focused(app_handle, "menu-close-split");
    } else if id == COPY_AS_PLAIN_TEXT_ID {
        emit_to_focused(app_handle, "menu-copy-as-plain-text");
    } else if id == PASTE_AS_PLAIN_TEXT_ID {
        emit_to_focused(app_handle, "menu-paste-as-plain-text");
    } else if cfg!(target_os = "macos") && id == "select-all" {
        emit_to_focused(app_handle, "menu-select-all");
    } else if id == FIND_REPLACE_ID {
        emit_to_focused(app_handle, "menu-find-replace");
    } else if id == ZOOM_IN_ID {
        emit_to_focused(app_handle, "menu-zoom-in");
    } else if id == ZOOM_OUT_ID {
        emit_to_focused(app_handle, "menu-zoom-out");
    } else if id == ZOOM_RESET_ID {
        emit_to_focused(app_handle, "menu-zoom-reset");
    } else if id == CLOSE_TAB_ID {
        emit_to_focused(app_handle, "menu-close-tab");
    } else if id == CLOSE_WINDOW_ID {
        // close() (not destroy()) so the frontend's dirty-tab prompt still
        // runs, same as the red traffic-light button.
        if let Some((_, window)) = app_handle
            .webview_windows()
            .iter()
            .find(|(_, w)| w.is_focused().unwrap_or(false))
        {
            let _ = window.close();
        }
    } else if id == NEW_WINDOW_ID {
        let _ = crate::open_new_window(app_handle);
    } else if id == COMMUNITY_ID {
        // A window knows the UI's language; with none open (macOS keeps
        // running after the last one closes), the site picks it.
        if let Some(label) = focused_editor_window(app_handle) {
            let _ = app_handle.emit_to(
                EventTarget::webview_window(&label),
                "menu-open-community",
                (),
            );
        } else {
            let _ = commands::links::open_community(app_handle, None);
        }
    } else if id == TUTORIALS_ID {
        if let Some(label) = focused_editor_window(app_handle) {
            let _ = app_handle.emit_to(
                EventTarget::webview_window(&label),
                "menu-open-tutorials",
                (),
            );
        } else {
            let _ = commands::links::open_tutorials(app_handle, None, None);
        }
    } else if let Some(doc) = id.strip_prefix(HELP_DOC_PREFIX) {
        // A help doc opens as a tab in the focused window; with none, a fresh
        // window drains the pending doc on mount.
        if let Some(label) = focused_editor_window(app_handle) {
            let _ = app_handle.emit_to(EventTarget::webview_window(&label), "menu-open-help", doc);
        } else {
            *crate::PENDING_SHOW_HELP.lock().unwrap() = Some(doc.to_string());
            let _ = crate::open_new_window(app_handle);
        }
    }
}

#[cfg(test)]
mod tests;
