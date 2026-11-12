//! The native menu bar: construction, the id -> frontend-event dispatch, and
//! File > Open Recent. Its items are src/registry/menu/menu.json, which
//! Windows and Linux draw in HTML from the same table.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
    Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Wry};

use crate::commands;

mod state;
pub(crate) use state::*;
mod recent;
pub(crate) use recent::*;
mod build;
pub(crate) mod table;
pub(crate) use build::*;
#[cfg(target_os = "macos")]
mod dock;
mod plugins;
pub use plugins::set_plugin_menu;
pub(crate) use plugins::*;

/// Menu ids of File > Open Recent entries carry their path: "recent:<path>".
const RECENT_PREFIX: &str = "recent:";
/// Open Recent's folders, listed above its files, carry theirs the same way.
const RECENT_FOLDER_PREFIX: &str = "recent-folder:";
const RECENT_CLEAR_ID: &str = "recent-clear";
/// File > Export's pandoc ids carry the writer name.
const EXPORT_PANDOC_PREFIX: &str = "export-pandoc:";
/// Format menu ids carry the block kind to insert: "insert-block:<kind>".
const INSERT_BLOCK_PREFIX: &str = "insert-block:";
/// Format > Highlight, Strikethrough and Inline Code carry the mark to toggle.
const TOGGLE_MARK_PREFIX: &str = "toggle-mark:";
/// Help menu ids carry the bundled doc they open: "help-doc:<doc>".
const HELP_DOC_PREFIX: &str = "help-doc:";
/// Textus AI's master switch, flipped by the focused window, which owns the
/// setting. In no menu of the bar; the iPhone's app-drawn menu runs it.
const TOGGLE_TEXTUS_AI_ID: &str = "toggle-textus-ai";

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
    let windows = app.windows();
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
        Some(label) if crate::windows::is_editor_window(&label) => Some(label),
        Some(label) => app
            .try_state::<crate::commands::chat_window::OpenChatWindows>()
            .and_then(|open| crate::commands::chat_window::editor_for_chat(&label, &open)),
        None => None,
    }
    .or_else(|| {
        windows
            .keys()
            .find(|label| crate::windows::is_editor_window(label))
            .cloned()
    })
}

/// Item `id` run in the focused window, or with no window open, in a fresh
/// window once mounted. Not run now: a panel with no window attached itself to a closed one.
fn emit_or_open_window(app: &tauri::AppHandle, id: &'static str) {
    if focused_editor_window(app).is_some() {
        emit_to_focused(app, &format!("menu-{id}"));
    } else {
        *crate::PENDING_MENU_EVENT.lock().unwrap() = Some(id);
        let _ = crate::editor_windows::open_new_window(app);
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
    commands::recents::still_there(commands::recents::read_recent_files(&app))
}

/// The recent folders, listed above the files there.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn list_recent_folders(app: tauri::AppHandle) -> Vec<String> {
    commands::recents::still_there(commands::recents::read_recent_folders(&app))
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
    let windows = app_handle.windows();
    if windows.is_empty() {
        // No window open (macOS, or background mode): nothing to close,
        // nothing to ask.
        commands::update::exit_app(app_handle);
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
        let _ = crate::editor_windows::open_new_window(app_handle);
    }
}

/// What a menu id does, for native clicks, the app-drawn menu and the tray alike.
/// Most run in the focused window as "menu-<id>"; those below need more.
fn dispatch(app_handle: &tauri::AppHandle, id: &str) {
    let with_payload = [
        (PLUGIN_COMMAND_PREFIX, "menu-plugin-command"),
        (EXPORT_PANDOC_PREFIX, "menu-export-pandoc"),
        (INSERT_BLOCK_PREFIX, "menu-insert-block"),
        (TOGGLE_MARK_PREFIX, "menu-toggle-mark"),
    ];
    if let Some(item) = id.strip_prefix(crate::background::tray::MENU_PREFIX) {
        crate::background::tray::on_menu(app_handle, item);
    } else if let Some((payload, event)) = with_payload
        .iter()
        .find_map(|(prefix, event)| id.strip_prefix(prefix).map(|rest| (rest, *event)))
    {
        emit_to_focused_payload(app_handle, event, payload.to_string());
    } else if id == "new-file" {
        // New Tab, as a browser's: a tab in the focused window whatever
        // Settings says files open in; a window when there is none.
        if focused_editor_window(app_handle).is_some() {
            emit_to_focused(app_handle, "menu-new-file");
        } else {
            let _ = crate::editor_windows::open_new_window(app_handle);
        }
    } else if id == MANAGE_PLUGINS_ID {
        emit_or_open_window(app_handle, MANAGE_PLUGINS_ID);
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
    } else if id == "quit" {
        quit(app_handle);
    } else if id == "close-window" {
        // close() (not destroy()) so the frontend's dirty-tab prompt still
        // runs, same as the red traffic-light button.
        if let Some((_, window)) = app_handle
            .windows()
            .iter()
            .find(|(_, w)| w.is_focused().unwrap_or(false))
        {
            let _ = window.close();
        }
    } else if id == "new-window" {
        let _ = crate::editor_windows::open_new_window(app_handle);
    } else if id == "help-community" || id == "help-tutorials" {
        // A window knows the UI's language; with none open (macOS keeps
        // running after the last one closes), the site picks it.
        if focused_editor_window(app_handle).is_some() {
            emit_to_focused(app_handle, &format!("menu-{id}"));
        } else if id == "help-community" {
            let _ = commands::links::open_community(app_handle, None);
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
            let _ = crate::editor_windows::open_new_window(app_handle);
        }
    } else if id == TOGGLE_TEXTUS_AI_ID {
        emit_to_focused(app_handle, "menu-toggle-textus-ai");
    } else if let Some(item) = table::find_item(id).or_else(|| table::find_own(id)) {
        let id = item
            .id
            .as_deref()
            .or(item.predefined.as_deref())
            .unwrap_or_default();
        if item.or_open {
            emit_or_open_window(app_handle, id);
        } else {
            emit_to_focused(app_handle, &format!("menu-{id}"));
        }
    }
}

#[cfg(test)]
mod tests;
