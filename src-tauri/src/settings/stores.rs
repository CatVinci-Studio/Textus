//! Every store the app keeps (settings, UI state, the history lists).

use super::*;

// ---------------------------------------------------------------------------
// Histories
// ---------------------------------------------------------------------------

/// The two histories. Their caps match the frontend's
/// (src/ai/chat/chat-history.ts, src/clipboard/history.ts); they're
/// enforced here too because this is the one writer. The chat history is a
/// folder of its own (settings/chat_history.rs), the clipboard one file.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
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
}

impl Stores {
    pub fn load(config_dir: &Path, data_dir: &Path) -> Self {
        let settings = Store::load(
            config_dir.join(file_name("settings")),
            "settings",
            json!({}),
            true,
        );
        let new_profile = settings.missing_at_load();
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
        };
        if new_profile {
            stores.seed_new_profile();
        }
        stores
    }

    /// What a profile starts with that a profile from before it was added
    /// doesn't: only the core built-in skills on (ai::builtin::CORE_SKILLS);
    /// the rest are added in Settings › Extensions › Skills. A settings
    /// file that already exists has no such list, and keeps every skill it
    /// had. In memory until the first write.
    fn seed_new_profile(&self) {
        let mut inner = self.settings.inner.lock().unwrap();
        let mut seed = Map::new();
        seed.insert(
            crate::ai::workspace::DISABLED_BUILTINS_KEY.into(),
            json!(crate::ai::builtin::optional_skill_names()),
        );
        merge_top_level(&mut inner.payload, &seed);
    }

    pub fn patch_settings(&self, patch: &Map<String, Value>) -> u64 {
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
        self.settings.fill_missing(defaults)
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

/// A store file read once, without keeping a `Store` for it (a saved
/// conversation): its payload under `key`, or `None` when the file is
/// missing or isn't one. A newer `schemaVersion` is read best-effort:
/// unknown fields are kept.
pub fn read_store_file(path: &Path, key: &str, empty: &Value) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    parse(&raw, key, empty).map(|(payload, _)| payload)
}
