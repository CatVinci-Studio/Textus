//! One settings file and its copy in memory: read once, patched in
//! place, written back a moment later in one atomic write, a damaged file
//! moved aside rather than lost.

use super::*;

/// Written into every file as `schemaVersion`. Bump it only for a change an
/// older reader would misread; adding a field never needs it, since every
/// reader fills in what's missing with its default.
pub const SCHEMA_VERSION: u64 = 1;

/// How long a change waits before it's written, so a burst (dragging the
/// zoom, typing custom CSS) costs one write instead of dozens.
pub(crate) const FLUSH_DELAY: Duration = Duration::from_millis(250);

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
    pub(crate) path: PathBuf,
    pub(crate) key: &'static str,
    /// Pretty-printed for the small hand-readable files; the histories can
    /// run to megabytes and are written compact.
    pub(crate) pretty: bool,
    pub(crate) inner: Mutex<Inner>,
    pub(crate) flush_scheduled: AtomicBool,
    /// Whether the file was absent when loaded - for settings.json, what
    /// decides that this is a new profile (`Stores::seed_new_profile`).
    pub(crate) missing_at_load: bool,
    /// The file exists but couldn't be read (permissions, an I/O error): it
    /// probably still holds the user's real data, which the first write
    /// would replace with this session's defaults. So nothing is written
    /// for the rest of the session - changes live in memory only.
    pub(crate) unreadable: bool,
}

pub(crate) struct Inner {
    pub(crate) payload: Value,
    pub(crate) rev: u64,
    /// Kept as read, so a file written by a newer build keeps its marker
    /// when an older one writes a field back into it.
    pub(crate) schema: u64,
    pub(crate) dirty: bool,
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
            // start empty, but neither treat it as a new profile nor write
            // it at all: it probably still holds the real data (see
            // `unreadable`).
            Err(e) => {
                eprintln!(
                    "textus: cannot read {}: {e}; using defaults for this session and leaving the file alone",
                    path.display()
                );
                unreadable = true;
                (empty, SCHEMA_VERSION)
            }
        };
        Self::new(path, key, pretty, payload, schema, missing, unreadable)
    }

    pub(crate) fn new(
        path: PathBuf,
        key: &'static str,
        pretty: bool,
        payload: Value,
        schema: u64,
        missing_at_load: bool,
        unreadable: bool,
    ) -> Self {
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
            missing_at_load,
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
    pub(crate) fn update<T>(self: &Arc<Self>, change: impl FnOnce(&mut Value) -> T) -> (T, u64) {
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

    pub(crate) fn schedule_flush(self: &Arc<Self>) {
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
        write_file(
            &self.path,
            inner.schema,
            self.key,
            &inner.payload,
            self.pretty,
        )?;
        inner.dirty = false;
        Ok(())
    }

    /// Drops a change still waiting on its debounce and hands back the
    /// lock, so the caller can move or delete the file without a write
    /// already on its way bringing it back.
    pub(crate) fn discard(&self) -> std::sync::MutexGuard<'_, Inner> {
        let mut inner = self.inner.lock().unwrap();
        inner.dirty = false;
        inner
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

/// Writes `{"schemaVersion": schema, "<key>": payload}` to `path` with the
/// atomic writer, creating its folder if need be.
pub(crate) fn write_file(
    path: &Path,
    schema: u64,
    key: &str,
    payload: &Value,
    pretty: bool,
) -> std::io::Result<()> {
    let mut file = Map::new();
    file.insert("schemaVersion".into(), json!(schema));
    file.insert(key.into(), payload.clone());
    let file = Value::Object(file);
    let text = if pretty {
        serde_json::to_string_pretty(&file)
    } else {
        serde_json::to_string(&file)
    }
    .map_err(std::io::Error::other)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    crate::atomic::write_sync(path, text)
}

pub(crate) fn parse(raw: &str, key: &str, empty: &Value) -> Option<(Value, u64)> {
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

pub(crate) fn move_aside(path: &Path) {
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

pub(crate) fn merge_top_level(payload: &mut Value, patch: &Map<String, Value>) {
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

pub(crate) fn as_list(payload: &mut Value) -> &mut Vec<Value> {
    if !payload.is_array() {
        *payload = Value::Array(Vec::new());
    }
    match payload {
        Value::Array(list) => list,
        _ => unreachable!(),
    }
}
