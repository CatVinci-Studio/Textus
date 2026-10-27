//! Settings, UI state and the two histories as plain JSON files owned by Rust:
//! hand-repairable, and patched per field so windows can't undo each other.
//! Held in memory, broadcast, written back debounced; webviews get a boot snapshot.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub(crate) mod chat_history;
use chat_history::ChatHistory;

mod store;
pub(crate) use store::*;
mod stores;
pub(crate) use stores::*;
mod app;
pub(crate) use app::*;

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
/// ("settings-changed").
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
    // Background mode's tray follows the setting and the UI language.
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

/// Writes out the frontend's defaults for missing settings fields, never over a
/// set one, and answers with the live settings for the window to adopt.
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

/// Same top-level merge as settings. Not broadcast: remembered for the next
/// window or launch only.
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

/// Adds an entry, or replaces the one with the same key, and moves it to the
/// front. One entry per call, so two windows saving at once both land.
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

/// One saved conversation whole, turns included. `None` when its file is gone.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn chat_history_get(stores: tauri::State<Stores>, id: String) -> Option<Value> {
    stores.chat.get(&id)
}

/// The saved conversations with every word of `query` in a message or a
/// reply, newest first (the history list's search).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn chat_history_search(stores: tauri::State<Stores>, query: String) -> Vec<Value> {
    stores.chat.search(&query, 50)
}

/// How many older conversations sit in the chat history's trash.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn chat_history_archived(stores: tauri::State<Stores>) -> usize {
    stores.chat.archived()
}

/// A document saved under a new path: its conversations follow it.
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
