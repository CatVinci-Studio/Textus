//! The native menu bar: construction (install), the id -> frontend-event
//! dispatch, and the mutable File > Open Recent submenu. Menu ids that carry
//! a payload do it in the id string ("recent:<path>", "export-pandoc:<fmt>",
//! "help-doc:<doc>", "insert-block:<kind>"); the frontend listener for each
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

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
    Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Wry};

use crate::app_identity;
use crate::commands;

const SETTINGS_MENU_ID: &str = "settings";
const NEW_FILE_ID: &str = "new-file";
const OPEN_FILE_ID: &str = "open-file";
const SAVE_FILE_ID: &str = "save-file";
const SAVE_FILE_AS_ID: &str = "save-file-as";
const RECENT_CLEAR_ID: &str = "recent-clear";
/// Menu ids of File > Open Recent entries carry their path: "recent:<path>".
const RECENT_PREFIX: &str = "recent:";
const EXPORT_PDF_ID: &str = "export-pdf";
const EXPORT_HTML_ID: &str = "export-html";
/// Menu ids of pandoc-backed File > Export entries carry the pandoc writer
/// name: "export-pandoc:<format>". The format list must stay in step with
/// the frontend's PANDOC_FORMATS (export/exporters.ts).
const EXPORT_PANDOC_PREFIX: &str = "export-pandoc:";
const QUIT_ID: &str = "quit";
const CLOSE_TAB_ID: &str = "close-tab";
const CLOSE_WINDOW_ID: &str = "close-window";
const TOGGLE_SOURCE_MODE_ID: &str = "toggle-source-mode";
const TOGGLE_TYPEWRITER_MODE_ID: &str = "toggle-typewriter-mode";
const TOGGLE_SIDEBAR_ID: &str = "toggle-sidebar";
const TOGGLE_AGENT_PANEL_ID: &str = "toggle-agent-panel";
const TOGGLE_SPLIT_VIEW_ID: &str = "toggle-split-view";
const TOGGLE_ZEN_MODE_ID: &str = "toggle-zen-mode";
const ZOOM_IN_ID: &str = "zoom-in";
const ZOOM_OUT_ID: &str = "zoom-out";
const ZOOM_RESET_ID: &str = "zoom-reset";
const FIND_REPLACE_ID: &str = "find-replace";
const NEW_WINDOW_ID: &str = "new-window";
/// File > New Quick Note and File > Open Quick Notes Folder
/// (commands/quick_note). New Quick Note has no accelerator: its key is the
/// global shortcut, shown in its label instead (nativeMenuLabels in
/// src/app/app-menu-model.ts), which a menu accelerator would fight.
const NEW_QUICK_NOTE_ID: &str = "new-quick-note";
const OPEN_QUICK_NOTES_FOLDER_ID: &str = "open-quick-notes-folder";
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

/// `emit_to_focused_payload` for a command about the document in front:
/// Save As, Export, Format, the View modes, zoom. With the Quick Note in
/// front it is ignored rather than sent to some document behind it - Save
/// As would save a file the user isn't looking at. (Save, Close Tab and
/// Find go to the note itself: `emit_to_quick_note`.)
fn emit_document_command<S: serde::Serialize + Clone>(
    app: &tauri::AppHandle,
    event: &str,
    payload: S,
) {
    if !quick_note_focused(app) {
        emit_to_focused_payload(app, event, payload);
    }
}

/// Whether the Quick Note window has focus.
fn quick_note_focused(app: &tauri::AppHandle) -> bool {
    app.get_webview_window(commands::quick_note::window::LABEL)
        .is_some_and(|w| w.is_focused().unwrap_or(false))
}

/// Save, Close Tab and Find with the Quick Note in front: they act on the
/// note (save and close it; its find bar). Returns whether it took the
/// command.
fn emit_to_quick_note(app: &tauri::AppHandle, event: &str) -> bool {
    if !quick_note_focused(app) {
        return false;
    }
    let _ = app.emit_to(
        EventTarget::webview_window(commands::quick_note::window::LABEL),
        event,
        (),
    );
    true
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
pub(crate) fn focused_editor_window(app: &tauri::AppHandle) -> Option<String> {
    let windows = app.webview_windows();
    let focused = windows
        .iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone());

    match focused {
        Some(label) if crate::commands::chat_window::is_editor_window(&label) => Some(label),
        // The Quick Note belongs to no editor window: any one will do.
        Some(label) if label == commands::quick_note::window::LABEL => None,
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

/// Handle to the File > Open Recent submenu, kept so add_recent_file can
/// rebuild its entries at runtime without touching the rest of the menu.
struct RecentMenu(Mutex<Option<Submenu<tauri::Wry>>>);

/// The labels the menu is built with, keyed by menu id - or, for what has
/// no id of ours, "menu:<name>" for a submenu and "predefined:<name>" for
/// an item muda makes (the keys `nativeMenuLabels` in
/// src/app/app-menu-model.ts sends). Empty until the frontend sends them,
/// which leaves every label English.
#[derive(Default)]
struct MenuLabels(Mutex<HashMap<String, String>>);

/// The View menu's on/off items and whether each is on, keyed by menu id:
/// the states the frontend last sent (`set_menu_checks`), kept so a rebuild
/// for a new language starts from them, and the items they are shown on.
#[derive(Default)]
struct ViewChecks(Mutex<ViewCheckState>);

#[derive(Default)]
struct ViewCheckState {
    checked: HashMap<String, bool>,
    items: Vec<CheckMenuItem<Wry>>,
}

/// What `build` makes: the bar, its Open Recent submenu (built empty) and
/// the View menu's on/off items.
struct BuiltMenu {
    menu: Menu<Wry>,
    open_recent: Submenu<Wry>,
    check_items: Vec<CheckMenuItem<Wry>>,
}

/// The label for `key`, or `english` when none was sent - as menu text:
/// muda reads a lone `&` as a mnemonic marker and drops it ("Find & Replace…"
/// showed as "Find  Replace…"), so a literal one is doubled.
fn label(labels: &HashMap<String, String>, key: &str, english: &str) -> String {
    menu_text(labels.get(key).map_or(english, String::as_str))
}

/// `text` with every `&` doubled, so the menu shows it as written.
fn menu_text(text: &str) -> String {
    text.replace('&', "&&")
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
pub fn trigger_menu_item(app: tauri::AppHandle, id: String) {
    dispatch(&app, &id);
}

/// The recent-file list behind File > Open Recent, for the app-drawn menu -
/// the native submenu is filled by `rebuild_recent_menu`, which the HTML one
/// can't read.
#[tauri::command]
pub fn list_recent_files(app: tauri::AppHandle) -> Vec<String> {
    commands::recents::read_recent_files(&app)
}

fn abbreviate_home(path: &str) -> String {
    // Windows has no HOME; without USERPROFILE every recent file there shows
    // its full C:\Users\... prefix and the submenu is unreadable.
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok();
    if let Some(home) = home {
        if let Some(rest) = path.strip_prefix(&home) {
            return format!("~{rest}");
        }
    }
    path.to_string()
}

/// Replace the Open Recent submenu's entries with `list` (most recent
/// first). Menus may only be mutated on the main thread, and the caller
/// may be a command on any thread - hence the hop.
pub(crate) fn rebuild_recent_menu(app: &tauri::AppHandle, list: Vec<String>) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let Some(state) = app.try_state::<RecentMenu>() else {
            return;
        };
        let guard = state.0.lock().unwrap();
        let Some(submenu) = guard.as_ref() else {
            return;
        };
        let labels = app
            .try_state::<MenuLabels>()
            .map(|state| state.0.lock().unwrap().clone())
            .unwrap_or_default();
        if let Ok(items) = submenu.items() {
            for item in items {
                let _ = submenu.remove(&item);
            }
        }
        if list.is_empty() {
            if let Ok(item) = MenuItemBuilder::with_id(
                "recent-none",
                label(&labels, "recent-none", "No Recent Files"),
            )
            .enabled(false)
            .build(&app)
            {
                let _ = submenu.append(&item);
            }
            return;
        }
        for path in &list {
            if let Ok(item) = MenuItemBuilder::with_id(
                format!("{RECENT_PREFIX}{path}"),
                menu_text(&abbreviate_home(path)),
            )
            .build(&app)
            {
                let _ = submenu.append(&item);
            }
        }
        if let Ok(sep) = PredefinedMenuItem::separator(&app) {
            let _ = submenu.append(&sep);
        }
        if let Ok(item) = MenuItemBuilder::with_id(
            RECENT_CLEAR_ID,
            label(&labels, RECENT_CLEAR_ID, "Clear Menu"),
        )
        .build(&app)
        {
            let _ = submenu.append(&item);
        }
    });
}

/// Build and set the whole menu bar, then register the id -> event dispatch.
/// Called once from setup.
pub(crate) fn install(app: &tauri::App) -> tauri::Result<()> {
    app.manage(MenuLabels::default());
    app.manage(RecentMenu(Mutex::new(None)));
    app.manage(ViewChecks::default());
    set_menu(app.handle(), &HashMap::new())?;
    app.on_menu_event(move |app_handle, event| dispatch(app_handle, event.id().as_ref()));
    Ok(())
}

/// Builds the menu bar with `labels` and makes it the app's, Open Recent
/// filled from the persisted list.
fn set_menu(app: &AppHandle, labels: &HashMap<String, String>) -> tauri::Result<()> {
    let checked = app.state::<ViewChecks>().0.lock().unwrap().checked.clone();
    let built = build(app, labels, &checked)?;
    app.set_menu(built.menu)?;
    *app.state::<RecentMenu>().0.lock().unwrap() = Some(built.open_recent);
    app.state::<ViewChecks>().0.lock().unwrap().items = built.check_items;
    rebuild_recent_menu(app, commands::recents::read_recent_files(app));
    Ok(())
}

/// The whole menu bar, its Open Recent submenu (built empty) and the View
/// menu's on/off items, marked as `checked` has them.
fn build(
    app: &AppHandle,
    labels: &HashMap<String, String>,
    checked: &HashMap<String, bool>,
) -> tauri::Result<BuiltMenu> {
    let l = |key: &str, english: &'static str| label(labels, key, english);
    let name = app_identity::APP_NAME;
    // Accelerators below are written "CmdOrCtrl+X", never "Cmd+X". They read
    // the same on macOS - both parse to ⌘ - but muda maps a bare CMD to
    // SUPER, which on Windows is the WINDOWS key. That silently handed our
    // shortcuts to the OS: Cmd+P became Win+P (the projection panel),
    // Cmd+Shift+S became Win+Shift+S (the screenshot tool), and none of them
    // ever reached the app.
    let settings_item =
        MenuItemBuilder::with_id(SETTINGS_MENU_ID, l(SETTINGS_MENU_ID, "Settings…"))
            .accelerator("CmdOrCtrl+,")
            .build(app)?;

    // Custom Quit instead of the predefined one: quitting must give
    // every window's unsaved document its close-confirmation prompt,
    // so it goes through each window's normal close request rather
    // than exiting the process outright.
    let quit_item = {
        let quit = format!("Quit {name}");
        let builder = MenuItemBuilder::with_id(QUIT_ID, label(labels, QUIT_ID, &quit));
        // Cmd+Q on macOS, Ctrl+Q on Linux - but Windows has no such combo.
        // There the app is closed with Alt+F4, which the OS delivers on its
        // own, and Ctrl+Q means nothing, so claiming it would only take a
        // shortcut Windows users never aim at Quit. The app-drawn menu
        // advertises Alt+F4 instead (src/app/app-menu-model.ts).
        #[cfg(not(windows))]
        let builder = builder.accelerator("CmdOrCtrl+Q");
        builder.build(app)?
    };

    let app_menu = {
        let about = format!("About {name}");
        let builder = SubmenuBuilder::new(app, name)
            .about_with_text(label(labels, "predefined:about", &about), None)
            .separator()
            .item(&settings_item);
        // Hide / Hide Others / Show All are macOS application-menu concepts.
        // muda still renders them elsewhere, so on Windows they were three
        // entries that did nothing when clicked.
        #[cfg(target_os = "macos")]
        let builder = {
            let hide = format!("Hide {name}");
            builder
                .separator()
                .hide_with_text(label(labels, "predefined:hide", &hide))
                .hide_others_with_text(l("predefined:hide-others", "Hide Others"))
                .show_all_with_text(l("predefined:show-all", "Show All"))
        };
        builder.separator().item(&quit_item).build()?
    };

    // Windows draws its menu inside the webview, so New/Open are captured by
    // App.tsx and routed back through dispatch below. Keeping native
    // accelerators there as well risks either losing them while editor focus
    // is active or firing both paths. macOS/Linux keep their visible native
    // menu accelerators.
    let new_file_builder = MenuItemBuilder::with_id(NEW_FILE_ID, l(NEW_FILE_ID, "New File"));
    #[cfg(not(windows))]
    let new_file_builder = new_file_builder.accelerator("CmdOrCtrl+N");
    let new_file_item = new_file_builder.build(app)?;

    let open_file_builder = MenuItemBuilder::with_id(OPEN_FILE_ID, l(OPEN_FILE_ID, "Open…"));
    #[cfg(not(windows))]
    let open_file_builder = open_file_builder.accelerator("CmdOrCtrl+O");
    let open_file_item = open_file_builder.build(app)?;
    // Built empty here; rebuild_recent_menu below fills it from the
    // persisted list and keeps it current as files are opened.
    let open_recent_menu =
        SubmenuBuilder::new(app, l("menu:open-recent", "Open Recent")).build()?;
    let save_file_item = MenuItemBuilder::with_id(SAVE_FILE_ID, l(SAVE_FILE_ID, "Save"))
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_file_as_item =
        MenuItemBuilder::with_id(SAVE_FILE_AS_ID, l(SAVE_FILE_AS_ID, "Save As…"))
            .accelerator("CmdOrCtrl+Shift+S")
            .build(app)?;
    let export_pdf_item = MenuItemBuilder::with_id(EXPORT_PDF_ID, l(EXPORT_PDF_ID, "PDF…"))
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let export_html_item =
        MenuItemBuilder::with_id(EXPORT_HTML_ID, l(EXPORT_HTML_ID, "HTML…")).build(app)?;
    let mut export_menu_builder = SubmenuBuilder::new(app, l("menu:export", "Export"))
        .item(&export_pdf_item)
        .item(&export_html_item)
        .separator();
    // Everything below converts through a user-installed pandoc
    // (commands/export.rs) - same format list Typora offers.
    for (format, label) in [
        ("docx", "Word (.docx)…"),
        ("odt", "OpenDocument (.odt)…"),
        ("rtf", "RTF…"),
        ("epub", "EPUB…"),
        ("latex", "LaTeX…"),
        ("mediawiki", "MediaWiki…"),
        ("rst", "reStructuredText…"),
        ("textile", "Textile…"),
        ("opml", "OPML…"),
    ] {
        let id = format!("{EXPORT_PANDOC_PREFIX}{format}");
        let item = MenuItemBuilder::with_id(&id, l(&id, label)).build(app)?;
        export_menu_builder = export_menu_builder.item(&item);
    }
    let export_menu = export_menu_builder.build()?;

    // Cmd+W closes the current tab (not the window - see
    // CLOSE_WINDOW_ID below, which owns Cmd+Shift+W instead).
    let close_tab_item = MenuItemBuilder::with_id(CLOSE_TAB_ID, l(CLOSE_TAB_ID, "Close Tab"))
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let new_quick_note_item =
        MenuItemBuilder::with_id(NEW_QUICK_NOTE_ID, l(NEW_QUICK_NOTE_ID, "New Quick Note"))
            .build(app)?;
    let open_quick_notes_folder_item = MenuItemBuilder::with_id(
        OPEN_QUICK_NOTES_FOLDER_ID,
        l(OPEN_QUICK_NOTES_FOLDER_ID, "Open Quick Notes Folder"),
    )
    .build(app)?;

    let file_menu = SubmenuBuilder::new(app, l("menu:file", "File"))
        .item(&new_file_item)
        .item(&open_file_item)
        .item(&open_recent_menu)
        .separator()
        .item(&new_quick_note_item)
        .item(&open_quick_notes_folder_item)
        .separator()
        .item(&save_file_item)
        .item(&save_file_as_item)
        .separator()
        .item(&export_menu)
        .separator()
        .item(&close_tab_item)
        .build()?;

    // No fixed accelerator - the combo is user-configurable and
    // handled by the frontend keydown dispatcher (see
    // toggle_source_mode_item's comment below for why).
    let find_replace_item =
        MenuItemBuilder::with_id(FIND_REPLACE_ID, l(FIND_REPLACE_ID, "Find & Replace…"))
            .build(app)?;

    let edit_menu = SubmenuBuilder::new(app, l("menu:edit", "Edit"))
        .undo_with_text(l("predefined:undo", "Undo"))
        .redo_with_text(l("predefined:redo", "Redo"))
        .separator()
        .cut_with_text(l("predefined:cut", "Cut"))
        .copy_with_text(l("predefined:copy", "Copy"))
        .paste_with_text(l("predefined:paste", "Paste"))
        .select_all_with_text(l("predefined:select-all", "Select All"))
        .separator()
        .item(&find_replace_item)
        .build()?;

    let mut format_menu_builder = SubmenuBuilder::new(app, l("menu:format", "Format"));
    for (kind, label) in [
        ("h1", "Heading 1"),
        ("h2", "Heading 2"),
        ("h3", "Heading 3"),
        ("h4", "Heading 4"),
        ("h5", "Heading 5"),
        ("h6", "Heading 6"),
    ] {
        let id = format!("{INSERT_BLOCK_PREFIX}{kind}");
        let item = MenuItemBuilder::with_id(&id, l(&id, label)).build(app)?;
        format_menu_builder = format_menu_builder.item(&item);
    }
    format_menu_builder = format_menu_builder.separator();
    for (kind, label) in [
        ("bullet-list", "Bullet List"),
        ("ordered-list", "Numbered List"),
        ("blockquote", "Blockquote"),
        ("code-block", "Code Block"),
        ("table", "Table"),
    ] {
        let id = format!("{INSERT_BLOCK_PREFIX}{kind}");
        let item = MenuItemBuilder::with_id(&id, l(&id, label)).build(app)?;
        format_menu_builder = format_menu_builder.item(&item);
    }
    let format_menu = format_menu_builder.build()?;

    // No fixed accelerators on these - their shortcuts are
    // user-configurable and handled by the frontend keydown
    // dispatcher (App.tsx), which reads the current bindings from
    // Settings. A native accelerator here would keep firing on the
    // default combo even after the user rebinds it.
    let item = |id: &str, english: &'static str| MenuItemBuilder::with_id(id, l(id, english));
    // The on/off items: named by what they show ("Sidebar", never "Toggle
    // Sidebar"), with the check mark saying whether it is on.
    let check = |id: &str, english: &'static str| {
        CheckMenuItemBuilder::with_id(id, l(id, english))
            .checked(checked.get(id).copied().unwrap_or(false))
            .build(app)
    };
    let toggle_source_mode_item = check(TOGGLE_SOURCE_MODE_ID, "Source Code Mode")?;
    let toggle_typewriter_mode_item = check(TOGGLE_TYPEWRITER_MODE_ID, "Typewriter Mode")?;
    let toggle_sidebar_item = check(TOGGLE_SIDEBAR_ID, "Sidebar")?;
    let toggle_agent_panel_item = check(TOGGLE_AGENT_PANEL_ID, "AI Panel")?;
    let toggle_split_view_item = check(TOGGLE_SPLIT_VIEW_ID, "Split View")?;
    let toggle_zen_mode_item = check(TOGGLE_ZEN_MODE_ID, "Zen Mode")?;

    // Fixed OS-convention accelerators (like Cmd+S / Cmd+W), not
    // user-configurable ones - so unlike the items above they keep
    // native accelerators. Zoom itself is applied by the frontend
    // (app/useZoom.ts), which also handles pinch and mod+wheel.
    let zoom_in_item = item(ZOOM_IN_ID, "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;
    let zoom_out_item = item(ZOOM_OUT_ID, "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;
    let zoom_reset_item = item(ZOOM_RESET_ID, "Actual Size")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;

    let view_menu = {
        let builder = SubmenuBuilder::new(app, l("menu:view", "View"))
            // Panels, then ways of viewing the text, then size.
            .item(&toggle_sidebar_item)
            .item(&toggle_agent_panel_item)
            .separator()
            .item(&toggle_source_mode_item)
            .item(&toggle_split_view_item)
            .item(&toggle_typewriter_mode_item)
            .item(&toggle_zen_mode_item)
            .separator()
            .item(&zoom_in_item)
            .item(&zoom_out_item)
            .item(&zoom_reset_item);
        // Same story as Hide/Show All and Bring All to Front: muda documents
        // its predefined fullscreen item as unsupported on Windows and
        // Linux, where it renders as an entry that does nothing when
        // clicked. Windows reaches fullscreen through the app-drawn menu
        // instead, which calls the window API directly
        // (src/app/app-menu-actions.ts).
        #[cfg(target_os = "macos")]
        let builder = builder
            .separator()
            .fullscreen_with_text(l("predefined:fullscreen", "Full Screen"));
        builder.build()?
    };

    // Cmd/Ctrl+Shift+N everywhere: what file managers, browsers and VS Code
    // open a window with. Cmd+T read as "new tab" to anyone coming from a
    // browser, and this app has tabs (Cmd+N opens a new document in one).
    const NEW_WINDOW_ACCEL: &str = "CmdOrCtrl+Shift+N";
    let new_window_item = item(NEW_WINDOW_ID, "New Window")
        .accelerator(NEW_WINDOW_ACCEL)
        .build(app)?;
    // Built manually (not the .close_window() predefined item) so it
    // doesn't own the OS-default Cmd+W accelerator - that's Close
    // Tab's now (see CLOSE_TAB_ID above).
    let close_window_item = item(CLOSE_WINDOW_ID, "Close Window")
        .accelerator("CmdOrCtrl+Shift+W")
        .build(app)?;

    let window_menu = {
        let builder = SubmenuBuilder::new(app, l("menu:window", "Window"))
            .item(&new_window_item)
            .separator()
            .minimize_with_text(l("predefined:minimize", "Minimize"))
            .maximize_with_text(l("predefined:maximize", "Zoom"))
            .separator()
            .item(&close_window_item);
        // Same story as Hide/Show All above: "Bring All to Front" is an
        // NSApplication command with no Windows counterpart.
        #[cfg(target_os = "macos")]
        let builder = builder
            .separator()
            .bring_all_to_front_with_text(l("predefined:bring-all-to-front", "Bring All to Front"));
        builder.build()?
    };

    let help = |doc: &str, english: &'static str| {
        let id = format!("{HELP_DOC_PREFIX}{doc}");
        let text = l(&id, english);
        (id, text)
    };
    let (welcome_id, welcome) = help("welcome", "Welcome and Tutorial");
    let (markdown_id, markdown) = help("markdown", "Markdown Guide");
    let (agent_id, agent) = help("agent", "AI Features Guide");
    let help_menu = SubmenuBuilder::new(app, l("menu:help", "Help"))
        .text(welcome_id, welcome)
        .separator()
        .text(markdown_id, markdown)
        .text(agent_id, agent)
        .text(TUTORIALS_ID, l(TUTORIALS_ID, "Video Tutorials"))
        .separator()
        .text(COMMUNITY_ID, l(COMMUNITY_ID, "Join the Community"))
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &format_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;
    let check_items = vec![
        toggle_sidebar_item,
        toggle_agent_panel_item,
        toggle_source_mode_item,
        toggle_split_view_item,
        toggle_typewriter_mode_item,
        toggle_zen_mode_item,
    ];
    Ok(BuiltMenu {
        menu,
        open_recent: open_recent_menu,
        check_items,
    })
}

/// Settings…: in the front editor window, or a new one.
pub(crate) fn open_settings(app: &tauri::AppHandle) {
    emit_or_open_window(app, "menu-open-settings");
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

/// What a menu id does. Reached from a native menu click (`on_menu_event`
/// above), from the app-drawn menu's `trigger_menu_item` and from the
/// tray's menu (Tauri sends its clicks to the same handler), so every entry
/// point stays one behaviour.
fn dispatch(app_handle: &tauri::AppHandle, id: &str) {
    if id == SETTINGS_MENU_ID {
        open_settings(app_handle);
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
    } else if id == OPEN_FILE_ID {
        emit_or_open_window(app_handle, "menu-open-file");
    } else if id == SAVE_FILE_ID {
        if !emit_to_quick_note(app_handle, "menu-save-file") {
            emit_to_focused(app_handle, "menu-save-file");
        }
    } else if id == SAVE_FILE_AS_ID {
        emit_document_command(app_handle, "menu-save-file-as", ());
    } else if id == RECENT_CLEAR_ID {
        commands::recents::clear_recent_files(app_handle);
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
        emit_document_command(app_handle, "menu-export-pdf", ());
    } else if id == EXPORT_HTML_ID {
        emit_document_command(app_handle, "menu-export-html", ());
    } else if let Some(format) = id.strip_prefix(EXPORT_PANDOC_PREFIX) {
        emit_document_command(app_handle, "menu-export-pandoc", format);
    } else if id == QUIT_ID {
        quit(app_handle);
    } else if let Some(kind) = id.strip_prefix(INSERT_BLOCK_PREFIX) {
        emit_document_command(app_handle, "menu-insert-block", kind);
    } else if id == TOGGLE_SOURCE_MODE_ID {
        emit_document_command(app_handle, "menu-toggle-source-mode", ());
    } else if id == TOGGLE_TYPEWRITER_MODE_ID {
        emit_document_command(app_handle, "menu-toggle-typewriter-mode", ());
    } else if id == TOGGLE_SIDEBAR_ID {
        emit_document_command(app_handle, "menu-toggle-sidebar", ());
    } else if id == TOGGLE_AGENT_PANEL_ID {
        emit_document_command(app_handle, "menu-toggle-agent-panel", ());
    } else if id == TOGGLE_SPLIT_VIEW_ID {
        emit_document_command(app_handle, "menu-toggle-split-view", ());
    } else if id == TOGGLE_ZEN_MODE_ID {
        emit_document_command(app_handle, "menu-toggle-zen-mode", ());
    } else if id == FIND_REPLACE_ID {
        if !emit_to_quick_note(app_handle, "menu-find-replace") {
            emit_to_focused(app_handle, "menu-find-replace");
        }
    } else if id == ZOOM_IN_ID {
        emit_document_command(app_handle, "menu-zoom-in", ());
    } else if id == ZOOM_OUT_ID {
        emit_document_command(app_handle, "menu-zoom-out", ());
    } else if id == ZOOM_RESET_ID {
        emit_document_command(app_handle, "menu-zoom-reset", ());
    } else if id == CLOSE_TAB_ID {
        if !emit_to_quick_note(app_handle, "menu-close-tab") {
            emit_to_focused(app_handle, "menu-close-tab");
        }
    } else if id == NEW_QUICK_NOTE_ID {
        commands::quick_note::window::open_soon(app_handle);
    } else if id == OPEN_QUICK_NOTES_FOLDER_ID {
        if let Err(err) = commands::quick_note::open_folder(app_handle) {
            eprintln!("quick notes: could not open the folder: {err}");
        }
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
mod tests {
    #[test]
    fn every_label_key_is_one_the_frontend_sends() {
        // Submenus and muda's own items have no menu id to key a label by;
        // their keys are made up on both sides, so a typo on either would
        // leave that one label English with nothing to say so.
        let source = include_str!("menu.rs");
        let frontend = include_str!("../../src/app/app-menu-model.ts");
        let keys: Vec<&str> = source
            .split('"')
            .filter(|s| s.starts_with("menu:") || s.starts_with("predefined:"))
            .filter(|s| {
                s.chars()
                    .all(|c| c.is_ascii_lowercase() || c == ':' || c == '-')
            })
            .filter(|s| !s.ends_with(':'))
            .collect();
        assert!(keys.len() >= 20, "found {keys:?}");
        for key in keys {
            assert!(
                frontend.contains(&format!("\"{key}\"")),
                "the frontend sends no {key}"
            );
        }
    }
}
