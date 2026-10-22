//! Every store the app keeps (settings, UI state, the history lists),
//! and the one-time import of what an older version kept in the webview's
//! storage.

use super::*;

// ---------------------------------------------------------------------------
// Histories
// ---------------------------------------------------------------------------

/// The two histories. Their caps match the frontend's
/// (src/ai/chat/chat-history.ts, src/clipboard/history.ts); they're
/// enforced here too because this is the one writer. The chat history is a
/// folder of its own (settings/chat_history.rs), the clipboard one file.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryKind {
    Chat,
    Clipboard,
}

pub(crate) const MAX_CLIPBOARD_TEXT: usize = 50_000;

impl HistoryKind {
    pub(crate) fn stem(self) -> &'static str {
        match self {
            Self::Chat => "chat-history",
            Self::Clipboard => "clipboard-history",
        }
    }

    pub(crate) fn max(self) -> usize {
        match self {
            Self::Chat => chat_history::MAX_CONVERSATIONS,
            Self::Clipboard => 30,
        }
    }

    /// What makes two entries the same entry: a conversation's id; a
    /// clipboard text itself (copying it again moves it to the top).
    pub(crate) fn key_of(self, entry: &Value) -> Option<&str> {
        let field = match self {
            Self::Chat => "id",
            Self::Clipboard => "text",
        };
        entry.get(field)?.as_str()
    }

    pub(crate) fn valid(self, entry: &Value) -> bool {
        let Some(key) = self.key_of(entry) else {
            return false;
        };
        match self {
            // The id names the conversation's file.
            Self::Chat => {
                chat_history::safe_id(key)
                    && entry.get("updatedAt").is_some_and(Value::is_number)
                    && entry.get("turns").is_some_and(Value::is_array)
            }
            Self::Clipboard => {
                key.chars().count() <= MAX_CLIPBOARD_TEXT
                    && entry.get("at").is_some_and(Value::is_number)
            }
        }
    }

    /// Order and cap: conversations most recently active first (the stable
    /// sort keeps an upserted entry ahead of an equal timestamp); clipboard
    /// entries stay in the order they were recorded, newest first. Returns
    /// the entries beyond the cap, taken off the list.
    pub(crate) fn tidy(self, list: &mut Vec<Value>) -> Vec<Value> {
        if self == Self::Chat {
            let updated = |e: &Value| e.get("updatedAt").and_then(Value::as_f64).unwrap_or(0.0);
            list.sort_by(|a, b| updated(b).total_cmp(&updated(a)));
        }
        list.split_off(list.len().min(self.max()))
    }
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

pub struct Stores {
    pub settings: Arc<Store>,
    pub ui_state: Arc<Store>,
    pub chat: ChatHistory,
    pub clipboard: Arc<Store>,
    pub(crate) legacy: Mutex<Legacy>,
}

/// The one-time move out of localStorage.
pub(crate) struct Legacy {
    /// settings.json didn't exist at launch and no window has imported yet.
    pub(crate) pending: bool,
    /// Settings fields changed since launch, which an import that arrives
    /// late must not undo.
    pub(crate) touched: HashSet<String>,
}

impl Stores {
    pub fn load(config_dir: &Path, data_dir: &Path) -> Self {
        let settings = Store::load(
            config_dir.join(file_name("settings")),
            "settings",
            json!({}),
            true,
        );
        let pending = settings.missing_at_load();
        let stores = Self {
            settings: Arc::new(settings),
            ui_state: Arc::new(Store::load(
                data_dir.join(file_name("ui-state")),
                "state",
                json!({}),
                true,
            )),
            chat: ChatHistory::load(data_dir),
            clipboard: Arc::new(Store::load(
                data_dir.join(file_name(HistoryKind::Clipboard.stem())),
                "entries",
                json!([]),
                false,
            )),
            legacy: Mutex::new(Legacy {
                pending,
                touched: HashSet::new(),
            }),
        };
        if pending {
            stores.seed_from_prefs(config_dir);
        }
        stores
    }

    /// Up to 0.9.6 the frontend mirrored two settings into prefs.json for
    /// setup() to read before any webview existed. On the first launch
    /// after the move setup() still needs them - the import from
    /// localStorage only arrives once a window has loaded - so they seed the
    /// in-memory settings now; the import then brings the rest. Written to
    /// nothing until then, and prefs.json is left as it is for a downgrade.
    pub(crate) fn seed_from_prefs(&self, config_dir: &Path) {
        let Ok(raw) = std::fs::read_to_string(config_dir.join("prefs.json")) else {
            return;
        };
        let Ok(prefs) = serde_json::from_str::<Value>(&raw) else {
            return;
        };
        let mut inner = self.settings.inner.lock().unwrap();
        let mut seed = Map::new();
        if let Some(mode) = prefs.get("new_document_mode").and_then(Value::as_str) {
            seed.insert("newDocumentMode".into(), json!(mode));
        }
        if let Some(restore) = prefs
            .get("restore_session_on_startup")
            .and_then(Value::as_bool)
        {
            seed.insert("restoreSessionOnStartup".into(), json!(restore));
        }
        merge_top_level(&mut inner.payload, &seed);
    }

    pub fn legacy_import_pending(&self) -> bool {
        self.legacy.lock().unwrap().pending
    }

    pub fn patch_settings(&self, patch: &Map<String, Value>) -> u64 {
        let mut legacy = self.legacy.lock().unwrap();
        if legacy.pending {
            legacy.touched.extend(patch.keys().cloned());
        }
        self.settings.patch(patch)
    }

    /// Adds the fields of `defaults` the settings don't have yet, and
    /// nothing else - checked and changed under one lock, so it can never
    /// overwrite a value, whoever set it and whenever. A window whose boot
    /// snapshot had no settings at all (a corrupt settings.json was moved
    /// aside at launch, or an unreadable one is being left alone) writes
    /// the fresh defaults out through this;
    /// reloaded later, it replays that same empty snapshot, and a plain
    /// patch would then put every default back over what the user has
    /// changed since. Returns the fields added and the new revision, or
    /// `None` when nothing was missing.
    pub fn fill_missing_settings(
        &self,
        defaults: &Map<String, Value>,
    ) -> Option<(Map<String, Value>, u64)> {
        let mut legacy = self.legacy.lock().unwrap();
        let (added, rev) = self.settings.fill_missing(defaults)?;
        if legacy.pending {
            legacy.touched.extend(added.keys().cloned());
        }
        Some((added, rev))
    }

    /// Takes the localStorage contents one window read at its first launch
    /// after the move. Only the first call counts: every window restored at
    /// launch boots with the same "import" flag and will try. Returns
    /// whether this call was the one accepted.
    pub fn import_legacy(&self, payload: LegacyPayload) -> bool {
        let mut legacy = self.legacy.lock().unwrap();
        if !legacy.pending {
            return false;
        }
        legacy.pending = false;

        let current = self.settings.snapshot().0;
        let mut merged = payload.settings.unwrap_or_default();
        // Anything changed since launch is newer than the import.
        for key in &legacy.touched {
            match current.get(key) {
                Some(value) => merged.insert(key.clone(), value.clone()),
                None => merged.remove(key),
            };
        }
        // A blob without these (from before they existed) falls back to
        // what prefs.json said rather than to the defaults.
        for key in ["newDocumentMode", "restoreSessionOnStartup"] {
            if let (false, Some(value)) = (merged.contains_key(key), current.get(key)) {
                merged.insert(key.into(), value.clone());
            }
        }
        self.settings.update(|p| *p = Value::Object(merged));
        // Even an empty import must create the file, so the next launch
        // doesn't think it's the first one again.
        let _ = self.settings.flush();

        if let Some(state) = payload.ui_state {
            if self.ui_state.missing_at_load() {
                // Anything already set this session is newer.
                let current = self.ui_state.snapshot().0;
                let mut state = state;
                if let Value::Object(current) = current {
                    state.extend(current);
                }
                self.ui_state.update(|p| *p = Value::Object(state));
            }
        }
        // Entries recorded this session come first and win a tie.
        if let (true, Some(entries)) = (self.chat.missing_at_load(), payload.chat_history) {
            self.chat.merge(entries);
        }
        if let (true, Some(entries)) = (self.clipboard.missing_at_load(), payload.clipboard_history)
        {
            merge_clipboard(&self.clipboard, entries);
        }
        true
    }

    /// Takes a Levis installation's settings, UI state and histories (see
    /// levis_import.rs): the user asked for them, so Levis's value wins for
    /// every settings and UI-state field Levis has, and its conversations
    /// and clipboard entries join the ones Textus already holds (Textus's
    /// copy wins a tie). Fields only Textus has stay. Written at once.
    pub fn import_levis(&self, payload: LegacyPayload) {
        // A pending localStorage import (no settings.json at launch) would
        // later undo this one; Textus's webview never had Levis's
        // localStorage anyway.
        self.legacy.lock().unwrap().pending = false;
        if let Some(settings) = payload.settings {
            self.settings.update(|p| merge_top_level(p, &settings));
        }
        if let Some(state) = payload.ui_state {
            self.ui_state.update(|p| merge_top_level(p, &state));
        }
        if let Some(entries) = payload.chat_history {
            self.chat.merge(entries);
        }
        if let Some(entries) = payload.clipboard_history {
            merge_clipboard(&self.clipboard, entries);
        }
        self.flush_all();
    }

    pub fn flush_all(&self) {
        for store in [&self.settings, &self.ui_state, &self.clipboard] {
            if let Err(e) = store.flush() {
                eprintln!("textus: cannot write {}: {e}", store.path.display());
            }
        }
        self.chat.flush();
    }
}

/// Adds imported clipboard entries after the ones already held, which win
/// a tie.
pub(crate) fn merge_clipboard(store: &Arc<Store>, entries: Vec<Value>) {
    let kind = HistoryKind::Clipboard;
    store.update(|p| {
        let list = as_list(p);
        let seen: HashSet<String> = list
            .iter()
            .filter_map(|e| kind.key_of(e).map(str::to_owned))
            .collect();
        list.extend(
            entries
                .into_iter()
                .filter(|e| kind.valid(e))
                .filter(|e| kind.key_of(e).is_some_and(|k| !seen.contains(k))),
        );
        kind.tidy(list);
    });
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LegacyPayload {
    pub settings: Option<Map<String, Value>>,
    pub ui_state: Option<Map<String, Value>>,
    pub chat_history: Option<Vec<Value>>,
    pub clipboard_history: Option<Vec<Value>>,
}

/// A settings, UI-state or history file as another installation wrote it
/// (Levis's, for the import): its payload under `key`, or `None` when the
/// file is missing or isn't one. A newer `schemaVersion` is read
/// best-effort, like Textus reads its own: unknown fields are kept.
pub fn read_store_file(path: &Path, key: &str, empty: &Value) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    parse(&raw, key, empty).map(|(payload, _)| payload)
}
