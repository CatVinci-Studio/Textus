//! Saved Agent conversations: one file per conversation plus `index.json`, so a
//! save rewrites only that conversation and the index. Conversations past the
//! cap move into `.trash/` rather than being dropped.

use super::{file_name, read_store_file, HistoryKind, Store};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Conversations listed before the oldest is moved to `.trash/`.
pub const MAX_CONVERSATIONS: usize = 500;
/// Conversations kept in `.trash/`; beyond it the oldest are deleted.
const MAX_TRASHED: usize = 200;
const INDEX: &str = "index.json";
const TRASH: &str = ".trash";

/// The folder, named like the files (a debug build gets `chat-history.dev/`).
fn dir_name() -> String {
    file_name(HistoryKind::Chat.stem())
        .trim_end_matches(".json")
        .to_owned()
}

/// Whether `id` can name a file: a stored id is untrusted and becomes a path
/// component.
pub fn safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id != "index"
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn file_of(id: &str) -> String {
    format!("{id}.json")
}

/// The id a conversation file in the folder or the trash belongs to, so
/// nothing but conversation files is ever moved or deleted.
fn id_of_file(name: &str) -> Option<&str> {
    name.strip_suffix(".json").filter(|id| safe_id(id))
}

/// A conversation as the index lists it.
fn summary(entry: &Value) -> Value {
    json!({
        "id": entry["id"],
        "docPath": entry.get("docPath").cloned().unwrap_or(Value::Null),
        "title": entry.get("title").cloned().unwrap_or(json!("")),
        "updatedAt": entry["updatedAt"],
        "turnCount": entry["turns"].as_array().map_or(0, Vec::len),
    })
}

fn id_str(entry: &Value) -> Option<&str> {
    entry.get("id")?.as_str()
}

pub struct ChatHistory {
    dir: PathBuf,
    index: Arc<Store>,
    /// The conversation files saved or changed this session, each a `Store`. The
    /// lock is held through every whole operation, so a save never interleaves with a trim.
    files: Mutex<HashMap<String, Arc<Store>>>,
}

impl ChatHistory {
    pub fn load(data_dir: &Path) -> Self {
        let dir = data_dir.join(dir_name());
        let index = Store::load(dir.join(INDEX), "entries", json!([]), false);
        let history = Self {
            dir,
            index: Arc::new(index),
            files: Mutex::new(HashMap::new()),
        };
        history.rebuild_lost_index();
        history
    }

    /// The index: every conversation's summary, most recent first.
    pub fn list(&self) -> Value {
        self.index.snapshot().0
    }

    /// One whole conversation, turns included, or `None` when it's gone.
    pub fn get(&self, id: &str) -> Option<Value> {
        if !safe_id(id) {
            return None;
        }
        if let Some(store) = self.files.lock().unwrap().get(id) {
            let entry = store.snapshot().0;
            return entry.get("turns").is_some().then_some(entry);
        }
        read_store_file(&self.dir.join(file_of(id)), "entry", &json!({}))
            .filter(|entry| entry.get("turns").is_some())
    }

    /// Writes one conversation's file and its index line (trashing the oldest past
    /// the cap). Returns the summary other windows are told.
    pub fn save(&self, entry: Value) -> Value {
        let mut files = self.files.lock().unwrap();
        let Some(id) = id_str(&entry).map(str::to_owned) else {
            return Value::Null;
        };
        let line = summary(&entry);
        self.file_store(&mut files, &id).update(|p| *p = entry);
        let dropped = self
            .index
            .update(|p| {
                let list = super::as_list(p);
                list.retain(|e| id_str(e) != Some(&id));
                list.insert(0, line.clone());
                HistoryKind::Chat.tidy(list)
            })
            .0;
        self.trash(&mut files, &dropped);
        line
    }

    /// Deletes one conversation for good: the user asked for exactly that.
    pub fn remove(&self, id: &str) {
        let mut files = self.files.lock().unwrap();
        self.index
            .update(|p| super::as_list(p).retain(|e| id_str(e) != Some(id)));
        if !safe_id(id) {
            return;
        }
        let store = files.remove(id);
        let _held = store.as_ref().map(|s| s.discard());
        remove_file(&self.dir.join(file_of(id)));
    }

    /// Privacy › Clear chat history: every conversation file, in the folder and the
    /// trash, by name; nothing else is touched.
    pub fn clear(&self) {
        let mut files = self.files.lock().unwrap();
        let stores: Vec<_> = files.drain().map(|(_, store)| store).collect();
        let _held: Vec<_> = stores.iter().map(|s| s.discard()).collect();
        self.index.update(|p| super::as_list(p).clear());
        let trash = self.dir.join(TRASH);
        for dir in [&self.dir, &trash] {
            for (name, _) in conversation_files(dir) {
                remove_file(&dir.join(name));
            }
        }
        // Only if empty: never a recursive delete.
        let _ = std::fs::remove_dir(&trash);
        // The files are gone now; the index says so at once too.
        if let Err(e) = self.index.flush() {
            eprintln!("textus: cannot write {}: {e}", self.index.path.display());
        }
    }

    /// A document saved under a new path takes its conversations along. Returns
    /// whether any did.
    pub fn move_document(&self, from: &str, to: &str) -> bool {
        let mut files = self.files.lock().unwrap();
        let belongs = |e: &Value| e.get("docPath").and_then(Value::as_str) == Some(from);
        let ids: Vec<String> = self
            .list()
            .as_array()
            .into_iter()
            .flatten()
            .filter(|e| belongs(e))
            .filter_map(|e| id_str(e).map(str::to_owned))
            .collect();
        if ids.is_empty() {
            return false;
        }
        self.index.update(|p| {
            for entry in super::as_list(p).iter_mut().filter(|e| belongs(e)) {
                entry["docPath"] = json!(to);
            }
        });
        for id in ids.iter().filter(|id| safe_id(id)) {
            let store = self.file_store(&mut files, id);
            // A file that's gone has nothing to move; don't create a stub.
            if store.snapshot().0.get("turns").is_none() {
                files.remove(id.as_str());
                continue;
            }
            store.update(|p| p["docPath"] = json!(to));
        }
        true
    }

    /// How many conversations the trash holds - the history list says when
    /// there are any.
    pub fn archived(&self) -> usize {
        conversation_files(&self.dir.join(TRASH)).len()
    }

    pub fn flush(&self) {
        let files = self.files.lock().unwrap();
        for store in files.values().chain([&self.index]) {
            if let Err(e) = store.flush() {
                eprintln!("textus: cannot write {}: {e}", store.path.display());
            }
        }
    }

    /// The store of conversation `id`'s file, loaded once per session.
    fn file_store(&self, files: &mut HashMap<String, Arc<Store>>, id: &str) -> Arc<Store> {
        let path = self.dir.join(file_of(id));
        let store = files
            .entry(id.to_owned())
            .or_insert_with(|| Arc::new(Store::load(path, "entry", json!({}), false)));
        Arc::clone(store)
    }

    /// Moves the conversations trimmed off the index into `.trash/`, then
    /// keeps the trash to `MAX_TRASHED`, deleting the oldest.
    fn trash(&self, files: &mut HashMap<String, Arc<Store>>, dropped: &[Value]) {
        if dropped.is_empty() {
            return;
        }
        let trash = self.dir.join(TRASH);
        if let Err(e) = std::fs::create_dir_all(&trash) {
            eprintln!("textus: cannot create {}: {e}", trash.display());
            return;
        }
        for id in dropped.iter().filter_map(id_str).filter(|id| safe_id(id)) {
            // A save still waiting on its debounce is written first, so the moved file is
            // the latest; then nothing more may write it.
            let store = files.remove(id);
            if let Some(Err(e)) = store.as_ref().map(|s| s.flush()) {
                eprintln!("textus: cannot write {}: {e}", file_of(id));
            }
            let _held = store.as_ref().map(|s| s.discard());
            let name = file_of(id);
            match std::fs::rename(self.dir.join(&name), trash.join(&name)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => eprintln!("textus: cannot move {name} to the trash: {e}"),
            }
        }
        let mut trashed = conversation_files(&trash);
        if trashed.len() > MAX_TRASHED {
            // Oldest first: a move keeps the file's time, its last save.
            trashed.sort_by_key(|(_, modified)| *modified);
            for (name, _) in &trashed[..trashed.len() - MAX_TRASHED] {
                remove_file(&trash.join(name));
            }
        }
    }

    /// An index that's missing or was unreadable while the conversation files remain
    /// is rebuilt from them, so they don't vanish from the list.
    fn rebuild_lost_index(&self) {
        let listed = self.list().as_array().is_some_and(|l| !l.is_empty());
        if listed || self.index.unreadable {
            return;
        }
        let mut lines: Vec<Value> = conversation_files(&self.dir)
            .into_iter()
            .filter_map(|(name, _)| read_store_file(&self.dir.join(name), "entry", &json!({})))
            .filter(|entry| HistoryKind::Chat.valid(entry))
            .map(|entry| summary(&entry))
            .collect();
        if lines.is_empty() {
            return;
        }
        // Over the cap only by hand; those stay where they are, unlisted.
        HistoryKind::Chat.tidy(&mut lines);
        self.index.update(|p| *p = Value::Array(lines));
    }
}

/// The conversation files directly in `dir`, with their modification times.
fn conversation_files(dir: &Path) -> Vec<(String, std::time::SystemTime)> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    read.filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            id_of_file(&name)?;
            let modified = e.metadata().and_then(|m| m.modified()).ok()?;
            Some((name, modified))
        })
        .collect()
}

fn remove_file(path: &Path) {
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => eprintln!("textus: cannot delete {}: {e}", path.display()),
    }
}

pub mod search;

#[cfg(test)]
mod tests;
