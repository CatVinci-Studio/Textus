//! Settings, UI state and the two histories, as plain JSON files owned by
//! Rust - docs/dev/storage.md lists every file.
//!
//! They used to live in each webview's localStorage, which has two problems
//! this module exists to fix:
//!
//! - localStorage belongs to the webview engine, keyed by app identifier and
//!   stored in a different format on every platform (SQLite under WebKitGTK
//!   and WKWebView, LevelDB under WebView2). At 1.0.0 Levis became Textus
//!   with a new identifier; Textus can import a Levis user's data by copying
//!   a few files, but not by reaching into another app's browser profile.
//! - Every window wrote the WHOLE settings object (and whole history arrays)
//!   back on every change, so two windows changing different things raced
//!   and the slower one silently undid the other.
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
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Written into every file as `schemaVersion`. Bump it only for a change an
/// older reader would misread; adding a field never needs it, since every
/// reader fills in what's missing with its default.
pub const SCHEMA_VERSION: u64 = 1;

/// How long a change waits before it's written, so a burst (dragging the
/// zoom, typing custom CSS) costs one write instead of dozens.
const FLUSH_DELAY: Duration = Duration::from_millis(250);

/// Debug builds get their own files: a dev build shares the installed app's
/// identifier, hence its config directory, and must not rewrite the real
/// settings with whatever a development session left behind.
pub(crate) fn file_name(stem: &str) -> String {
    if cfg!(debug_assertions) {
        format!("{stem}.dev.json")
    } else {
        format!("{stem}.json")
    }
}

// ---------------------------------------------------------------------------
// One JSON file
// ---------------------------------------------------------------------------

/// One file: `{"schemaVersion": n, "<key>": payload}`, where the payload is
/// an object (settings, UI state) or an array (histories).
pub struct Store {
    path: PathBuf,
    key: &'static str,
    /// Pretty-printed for the small hand-readable files; the histories can
    /// run to megabytes and are written compact.
    pretty: bool,
    inner: Mutex<Inner>,
    flush_scheduled: AtomicBool,
    /// Whether the file was absent when loaded - what decides that this is
    /// the first launch since the move and localStorage should be imported.
    missing_at_load: bool,
    /// The file exists but couldn't be read (permissions, an I/O error): it
    /// probably still holds the user's real data, which the first write
    /// would replace with this session's defaults. So nothing is written
    /// for the rest of the session - changes live in memory only.
    unreadable: bool,
}

struct Inner {
    payload: Value,
    rev: u64,
    /// Kept as read, so a file written by a newer build keeps its marker
    /// when an older one writes a field back into it.
    schema: u64,
    dirty: bool,
}

impl Store {
    /// Loads `path`, or starts from `empty` when it's missing. A file that
    /// can't be parsed (or holds the wrong shape) is renamed aside rather
    /// than overwritten, so whatever is in it can still be recovered by
    /// hand, and the app starts from defaults instead of refusing to start.
    pub fn load(path: PathBuf, key: &'static str, empty: Value, pretty: bool) -> Self {
        let mut missing = false;
        let mut unreadable = false;
        let (payload, schema) = match std::fs::read_to_string(&path) {
            Ok(raw) => match parse(&raw, key, &empty) {
                Some(parsed) => parsed,
                None => {
                    move_aside(&path);
                    (empty, SCHEMA_VERSION)
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                missing = true;
                (empty, SCHEMA_VERSION)
            }
            // Not UTF-8: as corrupt as a file that doesn't parse.
            Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
                move_aside(&path);
                (empty, SCHEMA_VERSION)
            }
            // Unreadable for another reason (permissions, an I/O error):
            // start empty, but neither treat it as a first launch -
            // importing would then replace a file that probably still holds
            // the real data - nor write it at all (see `unreadable`).
            Err(e) => {
                eprintln!(
                    "textus: cannot read {}: {e}; using defaults for this session and leaving the file alone",
                    path.display()
                );
                unreadable = true;
                (empty, SCHEMA_VERSION)
            }
        };
        Self {
            path,
            key,
            pretty,
            inner: Mutex::new(Inner {
                payload,
                rev: 1,
                schema,
                dirty: false,
            }),
            flush_scheduled: AtomicBool::new(false),
            missing_at_load: missing,
            unreadable,
        }
    }

    pub fn missing_at_load(&self) -> bool {
        self.missing_at_load
    }

    pub fn snapshot(&self) -> (Value, u64) {
        let inner = self.inner.lock().unwrap();
        (inner.payload.clone(), inner.rev)
    }

    /// Changes the payload under the lock, bumps the revision, and schedules
    /// a write. Returns the new revision alongside the closure's result.
    fn update<T>(self: &Arc<Self>, change: impl FnOnce(&mut Value) -> T) -> (T, u64) {
        let (result, rev) = {
            let mut inner = self.inner.lock().unwrap();
            let result = change(&mut inner.payload);
            inner.rev += 1;
            inner.dirty = true;
            (result, inner.rev)
        };
        self.schedule_flush();
        (result, rev)
    }

    fn schedule_flush(self: &Arc<Self>) {
        if self.unreadable || self.flush_scheduled.swap(true, Ordering::AcqRel) {
            return;
        }
        let store = Arc::clone(self);
        std::thread::spawn(move || {
            std::thread::sleep(FLUSH_DELAY);
            // Cleared before writing, so a change landing mid-write
            // schedules another write instead of being left unwritten.
            store.flush_scheduled.store(false, Ordering::Release);
            if let Err(e) = store.flush() {
                eprintln!("textus: cannot write {}: {e}", store.path.display());
            }
        });
    }

    /// Writes the file now if anything changed since the last write - never
    /// over a file that was there but couldn't be read (`unreadable`).
    pub fn flush(&self) -> std::io::Result<()> {
        let mut inner = self.inner.lock().unwrap();
        if !inner.dirty || self.unreadable {
            return Ok(());
        }
        let mut file = Map::new();
        file.insert("schemaVersion".into(), json!(inner.schema));
        file.insert(self.key.into(), inner.payload.clone());
        let file = Value::Object(file);
        let text = if self.pretty {
            serde_json::to_string_pretty(&file)
        } else {
            serde_json::to_string(&file)
        }
        .map_err(std::io::Error::other)?;
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        crate::atomic::write_sync(&self.path, text)?;
        inner.dirty = false;
        Ok(())
    }

    // -- object payloads ----------------------------------------------------

    /// Merges TOP-LEVEL fields only: each field in `patch` replaces that
    /// field whole (null removes it), and every other field is left alone -
    /// which is exactly what lets two windows change different settings at
    /// once without one undoing the other.
    pub fn patch(self: &Arc<Self>, patch: &Map<String, Value>) -> u64 {
        self.update(|payload| merge_top_level(payload, patch)).1
    }

    /// Sets the fields of `defaults` that are absent, leaving every present
    /// one alone. Returns what was added and the new revision, or `None`
    /// (no new revision, nothing to write) when nothing was missing.
    pub fn fill_missing(
        self: &Arc<Self>,
        defaults: &Map<String, Value>,
    ) -> Option<(Map<String, Value>, u64)> {
        let (added, rev) = {
            let mut inner = self.inner.lock().unwrap();
            let missing: Map<String, Value> = defaults
                .iter()
                .filter(|(key, value)| {
                    !value.is_null() && inner.payload.get(key.as_str()).is_none()
                })
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect();
            if missing.is_empty() {
                return None;
            }
            merge_top_level(&mut inner.payload, &missing);
            inner.rev += 1;
            inner.dirty = true;
            (missing, inner.rev)
        };
        self.schedule_flush();
        Some((added, rev))
    }

    // -- array payloads -----------------------------------------------------

    pub fn upsert(self: &Arc<Self>, kind: HistoryKind, entry: Value) -> u64 {
        self.update(|payload| {
            let list = as_list(payload);
            let key = kind.key_of(&entry).map(str::to_owned);
            list.retain(|e| kind.key_of(e) != key.as_deref());
            list.insert(0, entry);
            kind.tidy(list);
        })
        .1
    }

    pub fn remove(self: &Arc<Self>, kind: HistoryKind, key: &str) -> u64 {
        self.update(|payload| as_list(payload).retain(|e| kind.key_of(e) != Some(key)))
            .1
    }

    pub fn clear(self: &Arc<Self>) -> u64 {
        self.update(|payload| as_list(payload).clear()).1
    }
}

fn parse(raw: &str, key: &str, empty: &Value) -> Option<(Value, u64)> {
    let Value::Object(mut file) = serde_json::from_str::<Value>(raw).ok()? else {
        return None;
    };
    let payload = file.remove(key)?;
    let same_shape =
        payload.is_object() == empty.is_object() && payload.is_array() == empty.is_array();
    if !same_shape {
        return None;
    }
    // A file without a marker was written by hand; read it as the current
    // version rather than rejecting it.
    let schema = file
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .unwrap_or(SCHEMA_VERSION);
    Some((payload, schema))
}

fn move_aside(path: &Path) {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("settings.json");
    let aside = path.with_file_name(format!("{name}.corrupt-{stamp}"));
    match std::fs::rename(path, &aside) {
        Ok(()) => eprintln!(
            "textus: {} was unreadable; moved to {} and starting from defaults",
            path.display(),
            aside.display()
        ),
        Err(e) => eprintln!("textus: cannot move aside {}: {e}", path.display()),
    }
}

fn merge_top_level(payload: &mut Value, patch: &Map<String, Value>) {
    if !payload.is_object() {
        *payload = Value::Object(Map::new());
    }
    let Value::Object(object) = payload else {
        unreachable!()
    };
    for (key, value) in patch {
        if value.is_null() {
            object.remove(key);
        } else {
            object.insert(key.clone(), value.clone());
        }
    }
}

fn as_list(payload: &mut Value) -> &mut Vec<Value> {
    if !payload.is_array() {
        *payload = Value::Array(Vec::new());
    }
    match payload {
        Value::Array(list) => list,
        _ => unreachable!(),
    }
}

// ---------------------------------------------------------------------------
// Histories
// ---------------------------------------------------------------------------

/// The two histories. Their caps match what the frontend kept in
/// localStorage (src/ai/chat/chat-history.ts, src/clipboard/history.ts);
/// they're enforced here too because this is now the one writer.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryKind {
    Chat,
    Clipboard,
}

const MAX_CLIPBOARD_TEXT: usize = 50_000;

impl HistoryKind {
    fn stem(self) -> &'static str {
        match self {
            Self::Chat => "chat-history",
            Self::Clipboard => "clipboard-history",
        }
    }

    fn max(self) -> usize {
        match self {
            Self::Chat => 60,
            Self::Clipboard => 30,
        }
    }

    /// What makes two entries the same entry: a conversation's id; a
    /// clipboard text itself (copying it again moves it to the top).
    fn key_of(self, entry: &Value) -> Option<&str> {
        let field = match self {
            Self::Chat => "id",
            Self::Clipboard => "text",
        };
        entry.get(field)?.as_str()
    }

    fn valid(self, entry: &Value) -> bool {
        let Some(key) = self.key_of(entry) else {
            return false;
        };
        match self {
            Self::Chat => {
                entry.get("updatedAt").is_some_and(Value::is_number)
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
    /// entries stay in the order they were recorded, newest first.
    fn tidy(self, list: &mut Vec<Value>) {
        if self == Self::Chat {
            let updated = |e: &Value| e.get("updatedAt").and_then(Value::as_f64).unwrap_or(0.0);
            list.sort_by(|a, b| updated(b).total_cmp(&updated(a)));
        }
        list.truncate(self.max());
    }
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

pub struct Stores {
    pub settings: Arc<Store>,
    pub ui_state: Arc<Store>,
    pub chat: Arc<Store>,
    pub clipboard: Arc<Store>,
    legacy: Mutex<Legacy>,
}

/// The one-time move out of localStorage.
struct Legacy {
    /// settings.json didn't exist at launch and no window has imported yet.
    pending: bool,
    /// Settings fields changed since launch, which an import that arrives
    /// late must not undo.
    touched: HashSet<String>,
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
            chat: Arc::new(Store::load(
                data_dir.join(file_name(HistoryKind::Chat.stem())),
                "entries",
                json!([]),
                false,
            )),
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
    fn seed_from_prefs(&self, config_dir: &Path) {
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

    pub fn history(&self, kind: HistoryKind) -> &Arc<Store> {
        match kind {
            HistoryKind::Chat => &self.chat,
            HistoryKind::Clipboard => &self.clipboard,
        }
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
        for (kind, entries) in [
            (HistoryKind::Chat, payload.chat_history),
            (HistoryKind::Clipboard, payload.clipboard_history),
        ] {
            let store = self.history(kind);
            let Some(entries) = entries else { continue };
            if !store.missing_at_load() {
                continue;
            }
            store.update(|p| {
                let list = as_list(p);
                // Entries recorded this session come first and win a tie.
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
        for (kind, entries) in [
            (HistoryKind::Chat, payload.chat_history),
            (HistoryKind::Clipboard, payload.clipboard_history),
        ] {
            let Some(entries) = entries else { continue };
            self.history(kind).update(|p| {
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
        self.flush_all();
    }

    pub fn flush_all(&self) {
        for store in [&self.settings, &self.ui_state, &self.chat, &self.clipboard] {
            if let Err(e) = store.flush() {
                eprintln!("textus: cannot write {}: {e}", store.path.display());
            }
        }
    }
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

/// After an import replaced settings, UI state and histories underneath
/// every window: each window adopts the whole settings object and reloads
/// both histories, and the native appearance follows the imported theme.
pub fn broadcast_reload(app: &AppHandle) {
    let Some(stores) = app.try_state::<Stores>() else {
        return;
    };
    let (value, rev) = stores.settings.snapshot();
    theme_changed(app);
    emit_to_all(
        app,
        "settings-changed",
        SettingsChanged {
            rev,
            patch: value.as_object().cloned().unwrap_or_default(),
            from: String::new(),
        },
    );
    for kind in [HistoryKind::Chat, HistoryKind::Clipboard] {
        emit_to_all(
            app,
            "history-changed",
            HistoryChanged {
                kind,
                op: HistoryOp::Reload,
                from: String::new(),
            },
        );
    }
}

/// Loads every store into app state. Called first thing in setup(), before
/// any window is built - the windows' boot scripts are made from it.
pub fn init(app: &AppHandle) {
    let config_dir = app.path().app_config_dir().unwrap_or_default();
    let data_dir = app.path().app_data_dir().unwrap_or_default();
    app.manage(Stores::load(&config_dir, &data_dir));
    #[cfg(target_os = "macos")]
    apply_app_theme(app);
}

/// The appearance setting changed, or first arrived with the legacy import:
/// brings the native side in line with it, so what a window shows before
/// (and around) its page matches the page. macOS sets the app's appearance
/// (`apply_app_theme`), Linux the open windows' background colour
/// (`apply_window_backgrounds`); Windows and iOS need nothing.
fn theme_changed(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    apply_app_theme(app);
    #[cfg(target_os = "linux")]
    apply_window_backgrounds(app);
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = app;
}

/// The appearance AppKit gives the app - Light or Dark when Settings pins
/// one, the system's otherwise. Set here before any window is built, and
/// again whenever the setting changes.
///
/// It decides a new window's first frames: until its page has painted
/// (some 125 ms), a WKWebView shows a background that follows the app's
/// appearance, not the page. So with Textus pinned to Dark on a light Mac,
/// every window opened white for a moment however early the boot script
/// put the theme on the document. It also gives scrollbars, context menus,
/// open/save panels and the page's prefers-color-scheme the same appearance
/// as the app. App-wide on macOS (tao sets NSApp.appearance); left alone
/// on the other platforms.
#[cfg(target_os = "macos")]
fn apply_app_theme(app: &AppHandle) {
    let Some(stores) = app.try_state::<Stores>() else {
        return;
    };
    let (settings, _) = stores.settings.snapshot();
    app.set_theme(app_theme(&settings));
}

/// The pinned appearance in `settings`, if any.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn app_theme(settings: &Value) -> Option<tauri::Theme> {
    match settings.get("theme").and_then(Value::as_str) {
        Some("dark") => Some(tauri::Theme::Dark),
        Some("light") => Some(tauri::Theme::Light),
        _ => None,
    }
}

/// Writes whatever is still waiting on its debounce. From the exit event.
pub fn flush_all(app: &AppHandle) {
    if let Some(stores) = app.try_state::<Stores>() {
        stores.flush_all();
    }
}

/// A settings field as Rust sees it, for the few decisions made in Rust
/// before any webview exists (window vs tab, session restore), for the
/// writing conventions profile (`writingConventions`, ai::conventions) and
/// for the built-in skills turned off.
pub fn read_setting(app: &AppHandle, key: &str) -> Option<Value> {
    let stores = app.try_state::<Stores>()?;
    let (settings, _) = stores.settings.snapshot();
    settings.get(key).cloned()
}

/// Changes settings fields on Rust's own initiative - a command that owns a
/// setting's logic, like turning a built-in skill off - and tells every
/// window, the way settings_patch does for a window's change (`from` names
/// no window, so every one applies it).
pub fn patch_from_backend(app: &AppHandle, patch: Map<String, Value>) -> Option<u64> {
    let stores = app.try_state::<Stores>()?;
    let rev = stores.patch_settings(&patch);
    emit_to_all(
        app,
        "settings-changed",
        SettingsChanged {
            rev,
            patch,
            from: String::new(),
        },
    );
    Some(rev)
}

/// Delivers an event to every window. Each one individually: every event in
/// this app is window-addressed (see src/utils/tauri-events.ts), and the
/// frontend only listens for events sent to its own label.
fn emit_to_all<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    for label in app.webview_windows().into_keys() {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window(&label),
            event,
            payload.clone(),
        );
    }
}

// ---------------------------------------------------------------------------
// Boot snapshot
// ---------------------------------------------------------------------------

/// The script every app webview runs before the page's own: it publishes
/// `window.__BOOT__` and applies the appearance settings to the document
/// (src-tauri/src/boot.js does the applying). Read when the window is BUILT,
/// so a page reload replays an old snapshot - the frontend treats it as a
/// first-paint hint and re-reads the live values once mounted.
pub fn boot_script(app: &AppHandle, label: &str) -> String {
    let Some(stores) = app.try_state::<Stores>() else {
        return String::new();
    };
    let (settings, rev) = stores.settings.snapshot();
    let (ui_state, _) = stores.ui_state.snapshot();
    let theme_css = user_theme_css(app, &settings);
    #[cfg(target_os = "macos")]
    let titlebar_height = crate::native_titlebar_height();
    #[cfg(not(target_os = "macos"))]
    let titlebar_height: Option<f64> = None;
    let boot = json!({
        "settings": settings,
        "rev": rev,
        "uiState": ui_state,
        "legacyImport": stores.legacy_import_pending(),
        "label": label,
        "titlebarHeight": titlebar_height,
    });
    format!(
        "{}\n;window.__textusBoot({boot}, {theme_css});",
        include_str!("boot.js")
    )
}

/// Above this an imported theme (fonts inlined as data URLs can make them
/// big) is left to the frontend's own async load rather than copied into
/// every window's boot script.
const MAX_BOOT_THEME_CSS: u64 = 2 * 1024 * 1024;

/// The selected imported theme's stylesheets, as `{light, dark}` JSON (or
/// `null` for a built-in theme), read from where commands/themes.rs saves
/// them.
fn user_theme_css(app: &AppHandle, settings: &Value) -> Value {
    let Some(id) = settings.get("themeId").and_then(Value::as_str) else {
        return Value::Null;
    };
    let Some(theme) = settings
        .get("userThemes")
        .and_then(Value::as_array)
        .and_then(|themes| {
            themes
                .iter()
                .find(|t| t.get("id").and_then(Value::as_str) == Some(id))
        })
    else {
        return Value::Null;
    };
    // Same rule as commands/themes.rs: the id becomes a path component.
    let safe = !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let Ok(config_dir) = app.path().app_config_dir() else {
        return Value::Null;
    };
    if !safe {
        return Value::Null;
    }
    let dir = config_dir.join("themes").join(id);
    let read = |name: &str| -> Option<String> {
        let path = dir.join(name);
        let size = std::fs::metadata(&path).ok()?.len();
        (size <= MAX_BOOT_THEME_CSS)
            .then(|| std::fs::read_to_string(&path).ok())
            .flatten()
    };
    let Some(light) = read("light.css") else {
        return Value::Null;
    };
    let has_dark = theme
        .get("hasDark")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let dark = if has_dark { read("dark.css") } else { None };
    json!({ "light": light, "dark": dark })
}

/// Adds the boot script to a webview that shows the app (editor windows,
/// the detached chat, the iOS webview), and on Linux builds the window in a
/// pinned appearance's background (`pinned_background`). The PDF-export and
/// tab-drag windows load other pages and go without either.
pub fn with_boot<'a, R: tauri::Runtime, M: Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
    app: &AppHandle,
    label: &str,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    let builder = builder.initialization_script(boot_script(app, label));
    #[cfg(target_os = "linux")]
    let builder = match app
        .try_state::<Stores>()
        .and_then(|stores| pinned_background(&stores.settings.snapshot().0))
    {
        Some(color) => builder.background_color(color),
        None => builder,
    };
    builder
}

/// The colour a window shows before its page has painted, for a pinned
/// appearance: the page's own background (ui/base.css's `--bg`, and what
/// index.html paints before any stylesheet loads).
///
/// On Linux the GTK window and the WebKit view start in their own colours -
/// the GTK theme's window background, then white - until the page's first
/// paint, so a window pinned to Dark opened with a white frame however early
/// the boot script put the theme on the document (measured on a release
/// build: GTK grey, one white frame, then the page). Built with this, the
/// window is the page's colour from its first frame. "system" is left alone:
/// what WebKitGTK resolves it to depends on GTK settings and the desktop's
/// colour-scheme preference, and guessing wrong would flash the other way.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn pinned_background(settings: &Value) -> Option<tauri::window::Color> {
    match settings.get("theme").and_then(Value::as_str) {
        Some("dark") => Some(tauri::window::Color(0x1b, 0x1e, 0x24, 0xff)),
        Some("light") => Some(tauri::window::Color(0xff, 0xff, 0xff, 0xff)),
        _ => None,
    }
}

/// Gives every open app window the background `with_boot` would give it now:
/// after the appearance changes (or first arrives, with the legacy import),
/// a window keeps showing its native background wherever the page hasn't
/// painted yet - the edges of a resize - which would otherwise stay the old
/// appearance's colour until the window is reopened.
#[cfg(target_os = "linux")]
fn apply_window_backgrounds(app: &AppHandle) {
    let Some(stores) = app.try_state::<Stores>() else {
        return;
    };
    let color = pinned_background(&stores.settings.snapshot().0);
    for (label, window) in app.webview_windows() {
        // Only the windows with_boot builds: not the transparent tab-drag
        // pill, nor the hidden PDF-export renderers.
        if label == crate::tab_drag::DRAG_PILL_LABEL
            || label.starts_with(crate::commands::export::PDF_EXPORT_LABEL_PREFIX)
        {
            continue;
        }
        let _ = window.set_background_color(color);
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Serialize)]
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

#[derive(Serialize)]
pub struct ImportResult {
    accepted: bool,
    value: Value,
    rev: u64,
}

/// The live settings, for a window to correct its boot snapshot with.
#[tauri::command]
pub fn settings_get(stores: tauri::State<Stores>) -> Snapshot {
    let (value, rev) = stores.settings.snapshot();
    Snapshot { value, rev }
}

/// Changes the given top-level settings fields and tells every window
/// ("settings-changed"; each skips the event its own patch caused).
#[tauri::command]
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

/// The first window's copy of what localStorage held (see
/// `Stores::import_legacy`). Every caller gets the resulting settings back,
/// accepted or not, so all windows end up on the same values.
#[tauri::command]
pub fn settings_import_legacy(
    app: AppHandle,
    window: tauri::WebviewWindow,
    stores: tauri::State<Stores>,
    payload: LegacyPayload,
) -> ImportResult {
    let accepted = stores.import_legacy(payload);
    let (value, rev) = stores.settings.snapshot();
    if accepted {
        // The appearance was only in localStorage until now.
        theme_changed(&app);
        // Windows that booted with the flag but lost the race adopt the
        // result from their own call; any other window learns it here.
        let patch = value.as_object().cloned().unwrap_or_default();
        emit_to_all(
            &app,
            "settings-changed",
            SettingsChanged {
                rev,
                patch,
                from: window.label().to_string(),
            },
        );
        for kind in [HistoryKind::Chat, HistoryKind::Clipboard] {
            emit_to_all(
                &app,
                "history-changed",
                HistoryChanged {
                    kind,
                    op: HistoryOp::Reload,
                    from: String::new(),
                },
            );
        }
    }
    ImportResult {
        accepted,
        value,
        rev,
    }
}

#[tauri::command]
pub fn ui_state_get(stores: tauri::State<Stores>) -> Value {
    stores.ui_state.snapshot().0
}

/// Same top-level merge as settings. Not broadcast: these are remembered
/// for the next window or launch (panel width, tutorial step, recents),
/// never pushed into windows already open.
#[tauri::command]
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
    /// The whole list changed (the legacy import) - fetch it again.
    Reload,
}

#[derive(Serialize, Clone)]
struct HistoryChanged {
    kind: HistoryKind,
    op: HistoryOp,
    from: String,
}

#[tauri::command]
pub fn history_list(stores: tauri::State<Stores>, kind: HistoryKind) -> Value {
    stores.history(kind).snapshot().0
}

/// Adds an entry, or replaces the one with the same key, and moves it to
/// the front. One entry per call, never the whole list: two windows saving
/// different conversations at once both land.
#[tauri::command]
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
    stores.history(kind).upsert(kind, entry.clone());
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
pub fn history_remove(
    app: AppHandle,
    window: tauri::WebviewWindow,
    stores: tauri::State<Stores>,
    kind: HistoryKind,
    key: String,
) {
    stores.history(kind).remove(kind, &key);
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
pub fn history_clear(
    app: AppHandle,
    window: tauri::WebviewWindow,
    stores: tauri::State<Stores>,
    kind: HistoryKind,
) {
    stores.history(kind).clear();
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;

    static DIR_COUNTER: AtomicU32 = AtomicU32::new(0);

    /// A fresh, empty directory per test.
    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "textus-settings-test-{}-{}",
            std::process::id(),
            DIR_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn obj(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    fn read_file(path: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn settings_path(dir: &Path) -> PathBuf {
        dir.join(file_name("settings"))
    }

    #[test]
    fn patches_merge_top_level_fields_and_bump_the_revision() {
        let dir = temp_dir();
        let stores = Stores::load(&dir, &dir);
        let rev0 = stores.settings.snapshot().1;
        let rev1 = stores.patch_settings(&obj(json!({ "theme": "dark" })));
        // A second window's patch of another field leaves the first alone.
        let rev2 = stores.patch_settings(&obj(json!({ "zoom": 1.2 })));
        assert!(rev0 < rev1 && rev1 < rev2);
        // A nested object is replaced whole, not deep-merged.
        stores.patch_settings(&obj(json!({ "shortcuts": { "a": "x", "b": "y" } })));
        stores.patch_settings(&obj(json!({ "shortcuts": { "a": "z" } })));
        // null removes a field.
        stores.patch_settings(&obj(json!({ "zoom": null })));
        assert_eq!(
            stores.settings.snapshot().0,
            json!({ "theme": "dark", "shortcuts": { "a": "z" } })
        );
    }

    #[test]
    fn writes_are_debounced_and_flushed() {
        let dir = temp_dir();
        let stores = Stores::load(&dir, &dir);
        stores.patch_settings(&obj(json!({ "theme": "dark" })));
        // Not yet: the write waits out the debounce.
        assert!(!settings_path(&dir).exists());
        std::thread::sleep(FLUSH_DELAY * 3);
        let file = read_file(&settings_path(&dir));
        assert_eq!(file["schemaVersion"], json!(SCHEMA_VERSION));
        assert_eq!(file["settings"], json!({ "theme": "dark" }));

        // An explicit flush (the exit path) writes immediately.
        stores.patch_settings(&obj(json!({ "theme": "light" })));
        stores.flush_all();
        assert_eq!(
            read_file(&settings_path(&dir))["settings"]["theme"],
            json!("light")
        );
        // ...and reloading reads back what was written, with no import.
        let reloaded = Stores::load(&dir, &dir);
        assert_eq!(reloaded.settings.snapshot().0["theme"], json!("light"));
        assert!(!reloaded.legacy_import_pending());
    }

    #[test]
    fn legacy_import_is_accepted_once_and_keeps_newer_changes() {
        let dir = temp_dir();
        let stores = Stores::load(&dir, &dir);
        assert!(stores.legacy_import_pending());
        // A change made before the import arrives is newer than it.
        stores.patch_settings(&obj(json!({ "zoom": 1.5 })));
        let accepted = stores.import_legacy(LegacyPayload {
            settings: Some(obj(
                json!({ "theme": "dark", "zoom": 1.0, "language": "ja" }),
            )),
            ..Default::default()
        });
        assert!(accepted);
        assert_eq!(
            stores.settings.snapshot().0,
            json!({ "theme": "dark", "zoom": 1.5, "language": "ja" })
        );
        // The file exists right away, so the next launch won't import.
        assert!(settings_path(&dir).exists());
        // A second window restored at the same launch loses the race.
        let again = stores.import_legacy(LegacyPayload {
            settings: Some(obj(json!({ "theme": "light" }))),
            ..Default::default()
        });
        assert!(!again);
        assert_eq!(stores.settings.snapshot().0["theme"], json!("dark"));
        assert!(!Stores::load(&dir, &dir).legacy_import_pending());
    }

    #[test]
    fn no_import_once_settings_json_exists() {
        let dir = temp_dir();
        std::fs::write(
            settings_path(&dir),
            r#"{"schemaVersion":1,"settings":{"theme":"dark"}}"#,
        )
        .unwrap();
        let stores = Stores::load(&dir, &dir);
        assert!(!stores.legacy_import_pending());
        assert!(!stores.import_legacy(LegacyPayload {
            settings: Some(obj(json!({ "theme": "light" }))),
            ..Default::default()
        }));
        assert_eq!(stores.settings.snapshot().0["theme"], json!("dark"));
    }

    #[test]
    fn import_brings_histories_and_ui_state() {
        let dir = temp_dir();
        let stores = Stores::load(&dir, &dir);
        stores
            .clipboard
            .upsert(HistoryKind::Clipboard, json!({ "text": "new", "at": 3 }));
        stores.import_legacy(LegacyPayload {
            settings: Some(Map::new()),
            ui_state: Some(obj(json!({ "agentPanelOpen": true }))),
            chat_history: Some(vec![
                json!({ "id": "a", "updatedAt": 1, "turns": [] }),
                json!({ "id": "b", "updatedAt": 2, "turns": [] }),
                json!({ "id": "broken" }),
            ]),
            clipboard_history: Some(vec![
                json!({ "text": "new", "at": 1 }),
                json!({ "text": "old", "at": 1 }),
            ]),
        });
        let ids: Vec<_> = stores
            .chat
            .snapshot()
            .0
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(ids, ["b", "a"]);
        assert_eq!(
            stores.clipboard.snapshot().0,
            json!([{ "text": "new", "at": 3 }, { "text": "old", "at": 1 }])
        );
        assert_eq!(
            stores.ui_state.snapshot().0,
            json!({ "agentPanelOpen": true })
        );
    }

    #[test]
    fn prefs_json_seeds_the_first_launch() {
        let dir = temp_dir();
        std::fs::write(
            dir.join("prefs.json"),
            r#"{"new_document_mode":"tab","restore_session_on_startup":false,"editor_window_size":[900,700]}"#,
        )
        .unwrap();
        let stores = Stores::load(&dir, &dir);
        let settings = stores.settings.snapshot().0;
        assert_eq!(settings["newDocumentMode"], json!("tab"));
        assert_eq!(settings["restoreSessionOnStartup"], json!(false));
        // An import without the fields (a blob from before they existed)
        // keeps what prefs.json said; one with them wins.
        stores.import_legacy(LegacyPayload {
            settings: Some(obj(json!({ "newDocumentMode": "window" }))),
            ..Default::default()
        });
        let settings = stores.settings.snapshot().0;
        assert_eq!(settings["newDocumentMode"], json!("window"));
        assert_eq!(settings["restoreSessionOnStartup"], json!(false));
    }

    #[test]
    fn corrupt_settings_are_moved_aside_and_defaults_used() {
        let dir = temp_dir();
        std::fs::write(settings_path(&dir), "{ not json").unwrap();
        let stores = Stores::load(&dir, &dir);
        assert_eq!(stores.settings.snapshot().0, json!({}));
        // Not a first launch: localStorage is months old by now.
        assert!(!stores.legacy_import_pending());
        assert!(!settings_path(&dir).exists());
        let aside: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".corrupt-"))
            .collect();
        assert_eq!(aside.len(), 1);
        assert_eq!(
            std::fs::read_to_string(aside[0].path()).unwrap(),
            "{ not json"
        );

        // The wrong shape counts as corrupt too.
        let dir = temp_dir();
        std::fs::write(settings_path(&dir), r#"{"settings":[1,2]}"#).unwrap();
        assert_eq!(Stores::load(&dir, &dir).settings.snapshot().0, json!({}));
    }

    #[test]
    fn a_settings_file_that_is_not_utf8_counts_as_corrupt() {
        let dir = temp_dir();
        std::fs::write(settings_path(&dir), [0xff, 0xfe, b'{']).unwrap();
        let stores = Stores::load(&dir, &dir);
        assert_eq!(stores.settings.snapshot().0, json!({}));
        assert!(!settings_path(&dir).exists());
        stores.patch_settings(&obj(json!({ "theme": "dark" })));
        stores.flush_all();
        assert_eq!(
            read_file(&settings_path(&dir))["settings"],
            json!({ "theme": "dark" })
        );
    }

    /// A settings.json that's there but can't be read (here: no read
    /// permission) is left exactly as it is - never replaced by this
    /// session's defaults - while the app runs on in-memory settings.
    #[cfg(unix)]
    #[test]
    fn an_unreadable_settings_file_is_never_overwritten() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir();
        let path = settings_path(&dir);
        let original = r#"{"schemaVersion":1,"settings":{"theme":"dark"}}"#;
        std::fs::write(&path, original).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
        if std::fs::read_to_string(&path).is_ok() {
            // Running as root: permissions don't stop reads, nothing to test.
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
            return;
        }
        let stores = Stores::load(&dir, &dir);
        assert_eq!(stores.settings.snapshot().0, json!({}));
        // Not a first launch either: no import over the real data.
        assert!(!stores.legacy_import_pending());
        // The frontend writes its defaults, the user changes something...
        stores.fill_missing_settings(&obj(json!({ "theme": "system", "zoom": 1 })));
        stores.patch_settings(&obj(json!({ "zoom": 1.5 })));
        // ...and it all works, in memory,
        assert_eq!(
            stores.settings.snapshot().0,
            json!({ "theme": "system", "zoom": 1.5 })
        );
        // without a write, debounced or on exit.
        std::thread::sleep(FLUSH_DELAY * 3);
        stores.flush_all();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        let names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, [file_name("settings")], "nothing moved aside");
    }

    #[test]
    fn filling_defaults_never_overwrites_a_set_field() {
        let dir = temp_dir();
        std::fs::write(settings_path(&dir), "{ not json").unwrap();
        // Launch after the corrupt file was moved aside: nothing stored.
        let stores = Stores::load(&dir, &dir);
        let defaults = obj(json!({ "theme": "system", "zoom": 1, "language": "en" }));
        let (added, rev) = stores.fill_missing_settings(&defaults).unwrap();
        assert_eq!(added, defaults);
        // The user changes things...
        let changed = stores.patch_settings(&obj(json!({ "theme": "dark", "zoom": null })));
        assert!(changed > rev);
        // ...and a reloaded window, replaying its empty boot snapshot, offers
        // the same defaults again: only the field that's missing comes back.
        let (added, _) = stores.fill_missing_settings(&defaults).unwrap();
        assert_eq!(added, obj(json!({ "zoom": 1 })));
        assert_eq!(
            stores.settings.snapshot().0,
            json!({ "theme": "dark", "zoom": 1, "language": "en" })
        );
        // Nothing missing: no change, no new revision.
        let rev = stores.settings.snapshot().1;
        assert!(stores.fill_missing_settings(&defaults).is_none());
        assert_eq!(stores.settings.snapshot().1, rev);
        stores.flush_all();
        assert_eq!(
            read_file(&settings_path(&dir))["settings"]["theme"],
            json!("dark")
        );
    }

    #[test]
    fn schema_version_is_written_and_a_newer_one_kept() {
        let dir = temp_dir();
        std::fs::write(
            settings_path(&dir),
            r#"{"schemaVersion":7,"settings":{"theme":"dark","fromTheFuture":true}}"#,
        )
        .unwrap();
        let stores = Stores::load(&dir, &dir);
        stores.patch_settings(&obj(json!({ "theme": "light" })));
        stores.flush_all();
        let file = read_file(&settings_path(&dir));
        assert_eq!(file["schemaVersion"], json!(7));
        assert_eq!(
            file["settings"],
            json!({ "theme": "light", "fromTheFuture": true })
        );
    }

    #[test]
    fn only_a_pinned_appearance_overrides_the_system() {
        assert_eq!(
            app_theme(&json!({ "theme": "dark" })),
            Some(tauri::Theme::Dark)
        );
        assert_eq!(
            app_theme(&json!({ "theme": "light" })),
            Some(tauri::Theme::Light)
        );
        assert_eq!(app_theme(&json!({ "theme": "system" })), None);
        assert_eq!(app_theme(&json!({})), None);
        assert_eq!(app_theme(&json!({ "theme": 42 })), None);
    }

    #[test]
    fn a_pinned_appearance_gives_windows_the_page_background() {
        // Checked against the page itself, not restated here: a window must
        // open in exactly the colour index.html paints first and ui/base.css's
        // --bg keeps, or the change is a flash of its own. A failure here
        // means one of the three moved without the others.
        let index = include_str!("../../index.html");
        let app_css = include_str!("../../src/ui/base.css");
        for (theme, app_css_rule) in [
            ("dark", ":root[data-theme=\"dark\"] {"),
            ("light", ":root {"),
        ] {
            let Some(tauri::window::Color(r, g, b, a)) =
                pinned_background(&json!({ "theme": theme }))
            else {
                panic!("no window background for a pinned {theme}");
            };
            let hex = format!("#{r:02x}{g:02x}{b:02x}");
            assert_eq!(a, 0xff, "{theme}: an opaque window");
            let index_rule = format!("html[data-theme=\"{theme}\"] {{");
            assert_eq!(
                css_value(index, &index_rule, "background:"),
                hex,
                "index.html, {theme}"
            );
            assert_eq!(
                css_value(app_css, app_css_rule, "--bg:"),
                hex,
                "ui/base.css, {theme}"
            );
        }
        // "system", missing or unreadable: the toolkit's own default.
        assert_eq!(pinned_background(&json!({ "theme": "system" })), None);
        assert_eq!(pinned_background(&json!({})), None);
        assert_eq!(pinned_background(&json!({ "theme": 1 })), None);
    }

    /// The value `property` has in the first rule that starts with `rule`.
    fn css_value<'a>(css: &'a str, rule: &str, property: &str) -> &'a str {
        let start = css.find(rule).unwrap_or_else(|| panic!("no `{rule}` rule"));
        let body = &css[start + rule.len()..];
        let body = &body[..body.find('}').expect("an unclosed rule")];
        let at = body
            .find(property)
            .unwrap_or_else(|| panic!("no `{property}` in `{rule}`"));
        body[at + property.len()..]
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
    }

    #[test]
    fn histories_upsert_dedupe_sort_and_cap() {
        let dir = temp_dir();
        let stores = Stores::load(&dir, &dir);
        let chat = &stores.chat;
        for i in 0..70 {
            chat.upsert(
                HistoryKind::Chat,
                json!({ "id": format!("c{i}"), "updatedAt": i, "turns": [] }),
            );
        }
        // Re-saving a conversation moves it, never duplicates it.
        chat.upsert(
            HistoryKind::Chat,
            json!({ "id": "c30", "updatedAt": 100, "turns": [1] }),
        );
        let list = chat.snapshot().0;
        let list = list.as_array().unwrap();
        assert_eq!(list.len(), 60);
        assert_eq!(list[0]["id"], json!("c30"));
        assert_eq!(list[1]["id"], json!("c69"));
        assert_eq!(list.iter().filter(|e| e["id"] == json!("c30")).count(), 1);

        chat.remove(HistoryKind::Chat, "c30");
        assert_eq!(chat.snapshot().0[0]["id"], json!("c69"));

        let clip = &stores.clipboard;
        for i in 0..35 {
            clip.upsert(
                HistoryKind::Clipboard,
                json!({ "text": format!("t{i}"), "at": i }),
            );
        }
        clip.upsert(HistoryKind::Clipboard, json!({ "text": "t10", "at": 99 }));
        let list = clip.snapshot().0;
        assert_eq!(list.as_array().unwrap().len(), 30);
        assert_eq!(list[0]["text"], json!("t10"));
        clip.clear();
        stores.flush_all();
        assert_eq!(
            read_file(&dir.join(file_name("clipboard-history")))["entries"],
            json!([])
        );
    }

    #[test]
    fn invalid_history_entries_are_rejected() {
        assert!(!HistoryKind::Chat.valid(&json!({ "id": "x" })));
        assert!(!HistoryKind::Clipboard.valid(&json!({ "text": 1, "at": 1 })));
        let long = "x".repeat(MAX_CLIPBOARD_TEXT + 1);
        assert!(!HistoryKind::Clipboard.valid(&json!({ "text": long, "at": 1 })));
        assert!(HistoryKind::Clipboard.valid(&json!({ "text": "ok", "at": 1 })));
    }
}
