//! Saved Agent conversations: one file per conversation in
//! `<data>/chat-history/`, plus `index.json`, the small list the AI panel's
//! history shows (docs/dev/storage.md).
//!
//! Up to 1.0 they were one `chat-history.json`, rewritten whole on every
//! saved turn and capped at 60 by silently dropping the oldest. A long
//! conversation made every save of every other one megabytes of writing, and
//! the cap lost conversations people still wanted. Now a save rewrites only
//! that conversation's file and the index, each through the same debounced,
//! atomic `Store` as the other files, and a conversation beyond the cap is
//! moved into `.trash/` rather than dropped.
//!
//! The old file is split into this layout on the first launch that finds no
//! folder (`migrate`), and renamed to `chat-history.json.migrated` - never
//! deleted, so a downgrade or a hand recovery still has it.

use super::{
    file_name, move_aside, parse, read_store_file, write_file, HistoryKind, Store, SCHEMA_VERSION,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Conversations listed before the oldest is moved to `.trash/`.
pub const MAX_CONVERSATIONS: usize = 500;
/// Conversations kept in `.trash/`; beyond it the oldest are deleted.
const MAX_TRASHED: usize = 200;
const INDEX: &str = "index.json";
const TRASH: &str = ".trash";

/// The folder, named like the files: a debug build gets `chat-history.dev/`
/// (see `file_name`).
fn dir_name() -> String {
    file_name(HistoryKind::Chat.stem())
        .trim_end_matches(".json")
        .to_owned()
}

/// Whether `id` can name a file: conversation ids are UUIDs, but a stored
/// one is untrusted (a hand edit, an import) and becomes a path component.
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

/// A conversation as the index lists it. Mirrors `ChatSummary` in
/// src/ai/chat/chat-history.ts.
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
    /// The conversation files saved or changed this session, each a `Store`
    /// with its own debounced write. The lock is held through every whole
    /// operation, so a save never interleaves with a trim or a clear.
    files: Mutex<HashMap<String, Arc<Store>>>,
    /// Nothing may be written this session: the old file was there but
    /// couldn't be read, or couldn't be split (see `Store::unreadable`).
    frozen: bool,
    /// Neither the folder nor the old file existed - a first launch.
    missing_at_load: bool,
}

impl ChatHistory {
    pub fn load(data_dir: &Path) -> Self {
        let dir = data_dir.join(dir_name());
        let index_path = dir.join(INDEX);
        let mut files = HashMap::new();
        let mut frozen = false;
        let mut missing_at_load = false;
        // The folder, once there, is all that's read from then on.
        let migration = if dir.exists() {
            Migration::Done
        } else {
            migrate(&data_dir.join(file_name(HistoryKind::Chat.stem())), &dir)
        };
        let index = match migration {
            Migration::Done | Migration::Corrupt => {
                Store::load(index_path, "entries", json!([]), false)
            }
            Migration::NoOldFile => {
                missing_at_load = true;
                Store::load(index_path, "entries", json!([]), false)
            }
            // Run on what could be read, in memory only: the old file stays
            // where it is and the split is tried again next launch.
            Migration::Failed(entries) => {
                frozen = true;
                for entry in &entries {
                    let id = id_str(entry).unwrap_or_default().to_owned();
                    let path = dir.join(file_of(&id));
                    let store = Store::unwritable(path, "entry", entry.clone());
                    files.insert(id, Arc::new(store));
                }
                let lines = entries.iter().map(summary).collect();
                Store::unwritable(index_path, "entries", Value::Array(lines))
            }
            Migration::Unreadable => {
                frozen = true;
                Store::unwritable(index_path, "entries", json!([]))
            }
        };
        let history = Self {
            dir,
            index: Arc::new(index),
            files: Mutex::new(files),
            frozen,
            missing_at_load,
        };
        if !frozen {
            history.rebuild_lost_index();
        }
        history
    }

    pub fn missing_at_load(&self) -> bool {
        self.missing_at_load
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

    /// Writes one conversation's file and its line in the index (moving the
    /// oldest beyond the cap to the trash). Returns the summary - what other
    /// windows are told about.
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

    /// Adds the conversations an import brings (the move out of
    /// localStorage, a Levis installation): ones already here are kept as
    /// they are, invalid ones skipped.
    pub fn merge(&self, entries: Vec<Value>) {
        let mut files = self.files.lock().unwrap();
        let mut seen: HashSet<String> = self
            .list()
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|e| id_str(e).map(str::to_owned))
            .collect();
        let mut lines = Vec::new();
        for entry in entries {
            if !HistoryKind::Chat.valid(&entry) {
                continue;
            }
            let id = id_str(&entry).unwrap_or_default().to_owned();
            if !seen.insert(id.clone()) {
                continue;
            }
            lines.push(summary(&entry));
            self.file_store(&mut files, &id).update(|p| *p = entry);
        }
        if lines.is_empty() {
            return;
        }
        let dropped = self
            .index
            .update(|p| {
                let list = super::as_list(p);
                list.extend(lines);
                HistoryKind::Chat.tidy(list)
            })
            .0;
        self.trash(&mut files, &dropped);
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
        if !self.frozen {
            remove_file(&self.dir.join(file_of(id)));
        }
    }

    /// Privacy › Clear chat history: every conversation file, in the folder
    /// and in the trash, by name - nothing else in the folder is touched.
    pub fn clear(&self) {
        let mut files = self.files.lock().unwrap();
        let stores: Vec<_> = files.drain().map(|(_, store)| store).collect();
        let _held: Vec<_> = stores.iter().map(|s| s.discard()).collect();
        self.index.update(|p| super::as_list(p).clear());
        if self.frozen {
            return;
        }
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

    /// A document Textus saved under a new path (Save As, a rename) takes
    /// its conversations along. Returns whether any did.
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
        let store = files.entry(id.to_owned()).or_insert_with(|| {
            Arc::new(if self.frozen {
                Store::unwritable(path, "entry", json!({}))
            } else {
                Store::load(path, "entry", json!({}), false)
            })
        });
        Arc::clone(store)
    }

    /// Moves the conversations trimmed off the index into `.trash/`, then
    /// keeps the trash to `MAX_TRASHED`, deleting the oldest.
    fn trash(&self, files: &mut HashMap<String, Arc<Store>>, dropped: &[Value]) {
        if dropped.is_empty() || self.frozen {
            return;
        }
        let trash = self.dir.join(TRASH);
        if let Err(e) = std::fs::create_dir_all(&trash) {
            eprintln!("textus: cannot create {}: {e}", trash.display());
            return;
        }
        for id in dropped.iter().filter_map(id_str).filter(|id| safe_id(id)) {
            // A save still waiting on its debounce is written first, so the
            // file moved is the latest; then nothing more may write it.
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

    /// An index that's missing or was unreadable (moved aside) while the
    /// conversation files are all still there: built again from them, so
    /// they don't vanish from the list.
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

enum Migration {
    /// Split into the folder; the old file renamed `.migrated`.
    Done,
    NoOldFile,
    /// Moved aside as `.corrupt-<time>`, the way every store treats a file
    /// it can't parse; the history starts empty.
    Corrupt,
    /// There but unreadable (permissions, an I/O error): left alone.
    Unreadable,
    /// Read, but the folder couldn't be written: what was read.
    Failed(Vec<Value>),
}

/// Splits the old single file into the folder. Everything is written into a
/// `<folder>.migrating` sibling first and renamed into place in one step, so
/// a crash halfway leaves no folder and the next launch simply starts over
/// (reusing what that sibling already holds). Only then is the old file
/// renamed - a crash between the two leaves both, and the folder wins.
fn migrate(old: &Path, dir: &Path) -> Migration {
    let raw = match std::fs::read_to_string(old) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Migration::NoOldFile,
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            move_aside(old);
            return Migration::Corrupt;
        }
        Err(e) => {
            eprintln!(
                "textus: cannot read {}: {e}; chat history is not saved this session",
                old.display()
            );
            return Migration::Unreadable;
        }
    };
    let Some((Value::Array(entries), _)) = parse(&raw, "entries", &json!([])) else {
        move_aside(old);
        return Migration::Corrupt;
    };
    let mut seen = HashSet::new();
    let mut entries: Vec<Value> = entries
        .into_iter()
        .filter(|e| HistoryKind::Chat.valid(e))
        .filter(|e| seen.insert(id_str(e).unwrap_or_default().to_owned()))
        .collect();
    // The old file kept 60; anything past the cap is still in it.
    HistoryKind::Chat.tidy(&mut entries);
    match split(&entries, dir) {
        Ok(()) => {
            let name = old
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("chat-history.json");
            if let Err(e) = std::fs::rename(old, old.with_file_name(format!("{name}.migrated"))) {
                eprintln!(
                    "textus: cannot rename {} after the split: {e}",
                    old.display()
                );
            }
            Migration::Done
        }
        Err(e) => {
            eprintln!(
                "textus: cannot split {} into {}: {e}",
                old.display(),
                dir.display()
            );
            Migration::Failed(entries)
        }
    }
}

fn split(entries: &[Value], dir: &Path) -> std::io::Result<()> {
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("chat-history");
    let staging = dir.with_file_name(format!("{name}.migrating"));
    std::fs::create_dir_all(&staging)?;
    for entry in entries {
        let id = id_str(entry).unwrap_or_default();
        write_file(
            &staging.join(file_of(id)),
            SCHEMA_VERSION,
            "entry",
            entry,
            false,
        )?;
    }
    let index: Vec<Value> = entries.iter().map(summary).collect();
    write_file(
        &staging.join(INDEX),
        SCHEMA_VERSION,
        "entries",
        &Value::Array(index),
        false,
    )?;
    std::fs::rename(&staging, dir)
}

#[cfg(test)]
mod tests;
