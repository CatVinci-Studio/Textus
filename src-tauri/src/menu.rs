//! The native menu bar: construction (install), the id -> frontend-event
//! dispatch, and the mutable File > Open Recent submenu. Menu ids that carry
//! a payload do it in the id string ("recent:<path>", "recent-folder:<path>",
//! "export-pandoc:<fmt>", "help-doc:<doc>", "insert-block:<kind>"); the
//! frontend listener for each
//! menu-* event lives in app/menu-bridge.ts.
//!
//! On Windows and Linux the bar built here is never seen - it is hidden with
//! the window frame (kept on Windows for its accelerators; on Linux GTK stops
//! firing them, and the frontend handles those keys), and the menu the user
//! opens is drawn in HTML (src/app/app-menu-model.ts, which lists the same
//! ids) and comes back through `trigger_menu_item`. Renaming an id here
//! means renaming it there.
//!
//! The labels below are English. On macOS, where this menu is the one the
//! user sees, the frontend sends them in the UI's language once a window
//! is up (`set_menu_labels`) and the bar is rebuilt with them.

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
/// Menu ids of pandoc-backed File > Export entries carry the pandoc writer
/// name: "export-pandoc:<format>". The format list must stay in step with
/// the frontend's PANDOC_FORMATS (export/exporters.ts).
const EXPORT_PANDOC_PREFIX: &str = "export-pandoc:";
const QUIT_ID: &str = "quit";
const CLOSE_TAB_ID: &str = "close-tab";
/// File > Reopen Closed Tab: the focused window opens the document it
/// closed last (app/close-flow.ts).
const REOPEN_CLOSED_TAB_ID: &str = "reopen-closed-tab";
const CLOSE_WINDOW_ID: &str = "close-window";
const TOGGLE_SOURCE_MODE_ID: &str = "toggle-source-mode";
const TOGGLE_TYPEWRITER_MODE_ID: &str = "toggle-typewriter-mode";
const TOGGLE_SIDEBAR_ID: &str = "toggle-sidebar";
const TOGGLE_AGENT_PANEL_ID: &str = "toggle-agent-panel";
/// Textus AI's master switch (`textusAi` in settings.json), flipped by the
/// focused window, which owns the setting and says so aloud. Not in the
/// View menu - the window bar's button and Settings carry it - but the
/// iPhone's app-drawn menu runs it through here (run_menu_item).
const TOGGLE_TEXTUS_AI_ID: &str = "toggle-textus-ai";
const TOGGLE_SPLIT_VIEW_ID: &str = "toggle-split-view";
const TOGGLE_ZEN_MODE_ID: &str = "toggle-zen-mode";
const ZOOM_IN_ID: &str = "zoom-in";
const ZOOM_OUT_ID: &str = "zoom-out";
const ZOOM_RESET_ID: &str = "zoom-reset";
const FIND_REPLACE_ID: &str = "find-replace";
/// Edit > Copy as Plain Text and Paste as Plain Text: the words without the
/// Markdown marks Copy's plain text carries, and the clipboard's text
/// pasted as it is (src/editor/useEditorClipboard.ts).
const COPY_AS_PLAIN_TEXT_ID: &str = "copy-as-plain-text";
const PASTE_AS_PLAIN_TEXT_ID: &str = "paste-as-plain-text";
/// Edit items macOS gets as the app's own, in place of the predefined ones:
/// undo: and redo: reach WebKit's history, never the editor's, and
/// selectAll: with no field focused takes the whole window. Each runs in the
/// focused window as "menu-<id>": (id, English label, accelerator).
const MAC_EDIT_ITEMS: [(&str, &str, &str); 3] = [
    ("undo", "Undo", "CmdOrCtrl+Z"),
    ("redo", "Redo", "CmdOrCtrl+Shift+Z"),
    ("select-all", "Select All", "CmdOrCtrl+A"),
];
const NEW_WINDOW_ID: &str = "new-window";
/// Help menu ids carry the bundled doc they open: "help-doc:<doc>", where
/// <doc> is the frontend's HelpDoc id ("markdown" | "agent" | "welcome").
/// "welcome" additionally re-arms the coach-mark tour on the frontend side
/// (see menu-bridge.ts's menu-open-help handler) - this string slot doesn't need
/// to change for that, it's just a payload value like any other doc id.
const HELP_DOC_PREFIX: &str = "help-doc:";
/// Help > Join the Community: the website's community page, in the UI's
/// language (the focused window opens it, knowing the language).
const COMMUNITY_ID: &str = "help-community";
/// Help > Video Tutorials: the website's tutorials page, in the UI's
/// language - the same way round as Join the Community.
const TUTORIALS_ID: &str = "help-tutorials";
/// Format menu ids carry the block kind to insert: "insert-block:<kind>",
/// where <kind> is one of h1..h6, bullet-list, ordered-list, blockquote,
/// code-block, table - matching the frontend's INSERT_BLOCK_EVENT handler.
const INSERT_BLOCK_PREFIX: &str = "insert-block:";

/// Emit a menu event only to the focused window - each window is an
/// independent document, so broadcast semantics would e.g. save every
/// window's document at once. Deliberately `emit_to` (scoped to one
/// webview), not `emit` on a `Window`/`WebviewWindow` handle - the latter
/// looks scoped but actually broadcasts to every window app-wide, same as
/// calling `emit` on the `AppHandle` itself (both go through the same
/// manager-wide `Emitter::emit`; only `emit_to`/`emit_filter` actually
/// target a specific webview).
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

/// The editor window a window-addressed message should go to - menu commands
/// here, and lib.rs's OS-open handling, which has the same "which of several
/// windows means *this* one" question.
///
/// "Focused window" alone is not enough once a detached chat window exists:
/// the chat holds focus for as long as the user is typing in it, but it has
/// no document and subscribes to none of these events, so Save/Open/Export/
/// Find would all quietly do nothing. A focused chat is resolved back to the
/// editor it belongs to; failing that, any editor window is a better target
/// than none.
///
/// An item run from inside a window (`trigger_menu_item`) names that window
/// itself: on Windows and Linux a window whose focus is inside its webview
/// may say it has none, so Settings opened from a second window showed up
/// in the first.
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

/// `emit_to_focused` for a command that needs a window to happen in - with
/// none open (macOS keeps running after its last window closes), a fresh
/// window opens and runs it once it has mounted (PENDING_MENU_EVENT). Not
/// done here and now without a window: an open panel with no window to
/// own it attached itself as a sheet to a closed window, which came back
/// empty and stayed on screen.
fn emit_or_open_window(app: &tauri::AppHandle, event: &'static str) {
    if focused_editor_window(app).is_some() {
        emit_to_focused(app, event);
    } else {
        *crate::PENDING_MENU_EVENT.lock().unwrap() = Some(event);
        let _ = crate::open_new_window(app);
    }
}

/// The menu bar in the UI's language: `labels` as `MenuLabels` keys them,
/// from the frontend's string table. Only macOS shows this menu - Windows
/// and Linux draw their own in HTML (app-menu-model.ts) and keep the native
/// one hidden for its accelerators, which rebuilding it would only put at
/// risk - so elsewhere this does nothing. Every window sends its labels as
/// it opens; the bar is rebuilt only when one has changed (the language),
/// with the same ids and accelerators as before. `command(async)` and a hop
/// to the main thread, as menus are only built there.
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

/// The View menu's check marks (Sidebar, AI Panel, Source Code Mode, Split
/// View, Typewriter Mode, Zen Mode), keyed by menu id - from the front
/// window, which sends its state on every change and as it gains focus.
/// The items are named by what they show, never "Toggle ...", and the mark
/// is AppKit's own. Only macOS shows this menu; elsewhere the app-drawn menu
/// draws the same marks (app/AppMenu.tsx) and this does nothing.
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

/// The Format menu's heading keys (Ctrl/Cmd+1..6 unless rebound), keyed by
/// menu id - mirrors `nativeMenuAccelerators` in src/app/app-menu-model.ts.
/// They follow Settings › Shortcuts, unlike a fixed accelerator: a level
/// rebound or cleared there must not keep a native key that goes on
/// firing. The frontend handles the keys itself and stops them, so the
/// bar's key only acts where the page doesn't (no window, say). Only macOS
/// shows this menu; on Windows a native key would fire twice beside the
/// frontend's, so elsewhere this does nothing.
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

/// Runs a menu id exactly as clicking that item in the native menu would.
///
/// The way in for the app-drawn menu on Windows (src/app/AppMenu.tsx): there
/// the native menu bar is hidden and the menu is redrawn in HTML, so its
/// items have no native click to dispatch - they send their id here instead.
/// The ids are the contract between the two, and `dispatch` below is the one
/// implementation both entry points run, so an HTML item can never drift
/// into doing something different from its native twin.
///
/// Ids the HTML menu invents (there is no such native item) are simply not
/// matched by `dispatch` and do nothing, so a typo fails quietly rather than
/// firing the wrong command.
///
/// `command(async)`, like detach_chat_window, and for the same reason: half
/// of what dispatch does is create or close windows, and on Windows doing
/// that from inside the calling webview's own IPC callback - which a plain
/// `command` runs on the main thread - is the re-entrancy that freezes the
/// whole app.
#[tauri::command(async)]
#[cfg_attr(test, specta::specta)]
pub fn trigger_menu_item(app: tauri::AppHandle, window: tauri::WebviewWindow, id: String) {
    MENU_ORIGIN.with(|origin| *origin.borrow_mut() = Some(window.label().to_string()));
    dispatch(&app, &id);
    MENU_ORIGIN.with(|origin| *origin.borrow_mut() = None);
}

thread_local! {
    /// The window whose app-drawn menu or shortcut is being dispatched, for
    /// `focused_editor_window` - set only for the length of one
    /// `trigger_menu_item` call, on the thread running it.
    static MENU_ORIGIN: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// The recent-file list behind File > Open Recent, for the app-drawn menu -
/// the native submenu is filled by `rebuild_recent_menu`, which the HTML one
/// can't read.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn list_recent_files(app: tauri::AppHandle) -> Vec<String> {
    commands::recents::read_recent_files(&app)
}

/// The recent folders, listed above the files there - same reason.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn list_recent_folders(app: tauri::AppHandle) -> Vec<String> {
    commands::recents::read_recent_folders(&app)
}

/// Quit, from the menu bar (⌘Q, File › Quit) or the tray: every window is
/// asked to close, so each unsaved document gets its prompt, and the app
/// exits once the last one is gone (lib.rs's Destroyed handler) - with an
/// exit code, which background mode never holds back (background/mod.rs's
/// keeps_running).
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

/// Opens `path` in the focused window's sidebar, as File > Open Folder…
/// does (a recent folder); with no window open, a
/// fresh window does once it has mounted.
fn open_folder_in_sidebar(app_handle: &tauri::AppHandle, path: &str) {
    if focused_editor_window(app_handle).is_some() {
        emit_to_focused_payload(app_handle, "menu-open-recent-folder", path);
    } else {
        *crate::PENDING_OPEN_FOLDER.lock().unwrap() = Some(path.to_string());
        let _ = crate::open_new_window(app_handle);
    }
}

/// What a menu id does. Reached from a native menu click (`on_menu_event`
/// above), from the app-drawn menu's `trigger_menu_item` and from the
/// tray's menu (Tauri sends its clicks to the same handler), so every entry
/// point stays one behaviour.
fn dispatch(app_handle: &tauri::AppHandle, id: &str) {
    if id == SETTINGS_MENU_ID {
        emit_or_open_window(app_handle, "menu-open-settings");
    } else if let Some(item) = id.strip_prefix(crate::background::tray::MENU_PREFIX) {
        crate::background::tray::on_menu(app_handle, item);
    } else if id == NEW_FILE_ID {
        // New Tab, as a browser's: a tab in the focused window whatever
        // Settings says files open in; a window when there is none.
        if focused_editor_window(app_handle).is_some() {
            emit_to_focused(app_handle, "menu-new-file");
        } else {
            let _ = crate::open_new_window(app_handle);
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
        // The focused window decides (useFileOpening.ts's openRecentFile): a
        // fresh, untouched one takes the file itself, as File > Open does,
        // instead of a second window opening beside it; any other sends it
        // back through open_paths. With no window to ask, it goes through
        // the same queue as Finder/CLI opens.
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
    } else if id == COPY_AS_PLAIN_TEXT_ID {
        emit_to_focused(app_handle, "menu-copy-as-plain-text");
    } else if id == PASTE_AS_PLAIN_TEXT_ID {
        emit_to_focused(app_handle, "menu-paste-as-plain-text");
    } else if cfg!(target_os = "macos") && MAC_EDIT_ITEMS.iter().any(|(item, ..)| *item == id) {
        emit_to_focused(app_handle, &format!("menu-{id}"));
    } else if id == FIND_REPLACE_ID {
        emit_to_focused(app_handle, "menu-find-replace");
    } else if id == ZOOM_IN_ID {
        emit_to_focused(app_handle, "menu-zoom-in");
    } else if id == ZOOM_OUT_ID {
        emit_to_focused(app_handle, "menu-zoom-out");
    } else if id == ZOOM_RESET_ID {
        emit_to_focused(app_handle, "menu-zoom-reset");
    } else if id == REOPEN_CLOSED_TAB_ID {
        emit_to_focused(app_handle, "menu-reopen-closed-tab");
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
        // A help doc opens as a tab in the focused window; with no window to
        // receive it (macOS keeps the app running after its last window
        // closes), spawn one that drains the pending doc on mount.
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
