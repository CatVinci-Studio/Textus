//! Settings, UI state and the two histories, as plain JSON files owned by
//! Rust - docs/dev/storage.md lists every file.
//!
//! They are not kept in each webview's localStorage, for two reasons:
//!
//! - localStorage belongs to the webview engine, keyed by app identifier and
//!   stored in a different format on every platform (SQLite under WebKitGTK
//!   and WKWebView, LevelDB under WebView2): plain files can be backed up,
//!   read and repaired by hand.
//! - Every window would write the WHOLE settings object (and whole history
//!   arrays) back on every change, so two windows changing different things
//!   race and the slower one silently undoes the other.
//!
//! So each file is held here in memory, changed through small commands that
//! merge one top-level field (settings, UI state) or one entry (histories)
//! at a time, broadcast to every window, and written back shortly after
//! (debounced, flushed on exit) with the crate's atomic writer.
//!
//! Before any window exists, `init` loads everything, and `boot_script`
//! hands each new webview a snapshot (`window.__BOOT__`) through an
//! initialization script, so the first frame already has the right theme
//! and the frontend can read settings synchronously - see
//! src/storage/boot.ts for the other end.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

mod chat_history;
use chat_history::ChatHistory;

mod store;
pub(crate) use store::*;
mod stores;
pub(crate) use stores::*;
mod app;
pub(crate) use app::*;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct Snapshot {
    value: Value,
    rev: u64,
}

#[derive(Serialize, Clone)]
struct SettingsChanged {
    rev: u64,
    patch: Map<String, Value>,
    from: String,
}

/// The live settings, for a window to correct its boot snapshot with.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn settings_get(stores: tauri::State<Stores>) -> Snapshot {
    let (value, rev) = stores.settings.snapshot();
    Snapshot { value, rev }
}

/// Changes the given top-level settings fields and tells every window
/// ("settings-changed"; each skips the event its own patch caused).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn settings_patch(
    app: AppHandle,
    window: tauri::WebviewWindow,
    stores: tauri::State<Stores>,
    patch: Map<String, Value>,
) -> u64 {
    let rev = stores.patch_settings(&patch);
    if patch.contains_key("theme") {
        theme_changed(&app);
    }
    // Background mode's tray, built or dropped as the setting changes; its
    // menu follows the UI language.
    #[cfg(desktop)]
    if patch.contains_key(crate::background::ENABLED_SETTING) {
        crate::background::apply(&app, crate::background::Change::Settings);
    } else if patch.contains_key("language") {
        crate::background::apply(&app, crate::background::Change::Language);
    }
    emit_to_all(
        &app,
        "settings-changed",
        SettingsChanged {
            rev,
            patch,
            from: window.label().to_string(),
        },
    );
    rev
}

/// Writes out the frontend's defaults for whatever settings fields are
/// missing - never over a field that's set (`Stores::fill_missing_settings`)
/// - and answers with the live settings either way, which the window then
/// adopts in place of its (empty, possibly stale) boot snapshot. Fields it
/// added are broadcast like any other change.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn settings_fill_defaults(
    app: AppHandle,
    window: tauri::WebviewWindow,
    stores: tauri::State<Stores>,
    defaults: Map<String, Value>,
) -> Snapshot {
    if let Some((patch, rev)) = stores.fill_missing_settings(&defaults) {
        emit_to_all(
            &app,
            "settings-changed",
            SettingsChanged {
                rev,
                patch,
                from: window.label().to_string(),
            },
        );
    }
    let (value, rev) = stores.settings.snapshot();
    Snapshot { value, rev }
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ui_state_get(stores: tauri::State<Stores>) -> Value {
    stores.ui_state.snapshot().0
}

/// Same top-level merge as settings. Not broadcast: these are remembered
/// for the next window or launch (panel width, tutorial step, recents),
/// never pushed into windows already open.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ui_state_patch(stores: tauri::State<Stores>, patch: Map<String, Value>) {
    stores.ui_state.patch(&patch);
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
enum HistoryOp {
    Upsert {
        entry: Value,
    },
    Remove {
        key: String,
    },
    Clear,
    /// The whole list changed (a document's conversations moved) - fetch
    /// it again.
    Reload,
}

#[derive(Serialize, Clone)]
struct HistoryChanged {
    kind: HistoryKind,
    op: HistoryOp,
    from: String,
}

/// The clipboard entries, or the chat history's index: each conversation's
/// summary without its turns (`chat_history_get` has those).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn history_list(stores: tauri::State<Stores>, kind: HistoryKind) -> Value {
    match kind {
        HistoryKind::Chat => stores.chat.list(),
        HistoryKind::Clipboard => stores.clipboard.snapshot().0,
    }
}

/// Adds an entry, or replaces the one with the same key, and moves it to
/// the front. One entry per call, never the whole list: two windows saving
/// different conversations at once both land. A conversation is announced
/// to the windows as its summary, the form their lists hold.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn history_upsert(
    app: AppHandle,
    window: tauri::WebviewWindow,
    stores: tauri::State<Stores>,
    kind: HistoryKind,
    entry: Value,
) -> Result<(), String> {
    if !kind.valid(&entry) {
        return Err(format!("invalid {kind:?} history entry"));
    }
    let entry = match kind {
        HistoryKind::Chat => stores.chat.save(entry),
        HistoryKind::Clipboard => {
            stores.clipboard.upsert(kind, entry.clone());
            entry
        }
    };
    emit_to_all(
        &app,
        "history-changed",
        HistoryChanged {
            kind,
            op: HistoryOp::Upsert { entry },
            from: window.label().to_string(),
        },
    );
    Ok(())
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn history_remove(
    app: AppHandle,
    window: tauri::WebviewWindow,
    stores: tauri::State<Stores>,
    kind: HistoryKind,
    key: String,
) {
    match kind {
        HistoryKind::Chat => stores.chat.remove(&key),
        HistoryKind::Clipboard => {
            stores.clipboard.remove(kind, &key);
        }
    }
    emit_to_all(
        &app,
        "history-changed",
        HistoryChanged {
            kind,
            op: HistoryOp::Remove { key },
            from: window.label().to_string(),
        },
    );
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn history_clear(
    app: AppHandle,
    window: tauri::WebviewWindow,
    stores: tauri::State<Stores>,
    kind: HistoryKind,
) {
    match kind {
        HistoryKind::Chat => stores.chat.clear(),
        HistoryKind::Clipboard => {
            stores.clipboard.clear();
        }
    }
    emit_to_all(
        &app,
        "history-changed",
        HistoryChanged {
            kind,
            op: HistoryOp::Clear,
            from: window.label().to_string(),
        },
    );
}

/// One saved conversation whole, turns included - what restoring it from
/// the history list loads. `None` when its file is gone.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn chat_history_get(stores: tauri::State<Stores>, id: String) -> Option<Value> {
    stores.chat.get(&id)
}

/// How many older conversations sit in the chat history's trash.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn chat_history_archived(stores: tauri::State<Stores>) -> usize {
    stores.chat.archived()
}

/// A document Textus saved under a new path (Save As, a rename): its
/// conversations follow it, and every window lists them again.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn chat_history_move_document(
    app: AppHandle,
    stores: tauri::State<Stores>,
    from: String,
    to: String,
) {
    if stores.chat.move_document(&from, &to) {
        emit_to_all(
            &app,
            "history-changed",
            HistoryChanged {
                kind: HistoryKind::Chat,
                op: HistoryOp::Reload,
                from: String::new(),
            },
        );
    }
}

#[cfg(test)]
mod tests;
