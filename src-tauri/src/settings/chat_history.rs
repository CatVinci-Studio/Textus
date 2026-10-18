//! Saved Agent conversations: one file per conversation in
//! `<data>/chat-history/`, plus `index.json`, the small list the Chats
//! sidebar shows (docs/dev/storage.md).
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

    /// How many conversations the trash holds - the Chats tab says when
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
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static DIR_COUNTER: AtomicU32 = AtomicU32::new(0);

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "textus-chat-history-test-{}-{}",
            std::process::id(),
            DIR_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn conversation(id: &str, doc: &str, at: u64) -> Value {
        json!({ "id": id, "docPath": doc, "title": id, "updatedAt": at, "turns": [{ "kind": "User", "text": id }] })
    }

    fn read(path: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn ids(history: &ChatHistory) -> Vec<String> {
        history
            .list()
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap().to_owned())
            .collect()
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }

    fn write_old(data: &Path, entries: Value) -> PathBuf {
        let old = data.join(file_name("chat-history"));
        std::fs::write(
            &old,
            json!({ "schemaVersion": 1, "entries": entries }).to_string(),
        )
        .unwrap();
        old
    }

    #[test]
    fn the_old_file_is_split_into_one_file_per_conversation_and_kept() {
        let data = temp_dir();
        let old = write_old(
            &data,
            json!([conversation("b", "/n/b.md", 2), conversation("a", "/n/a.md", 1), { "id": "broken" }]),
        );
        let history = ChatHistory::load(&data);
        assert!(!history.missing_at_load());
        let dir = data.join(dir_name());
        assert_eq!(names(&dir), ["a.json", "b.json", "index.json"]);
        assert_eq!(
            read(&dir.join("a.json")),
            json!({ "schemaVersion": 1, "entry": conversation("a", "/n/a.md", 1) })
        );
        assert_eq!(
            read(&dir.join("index.json"))["entries"],
            json!([
                { "id": "b", "docPath": "/n/b.md", "title": "b", "updatedAt": 2, "turnCount": 1 },
                { "id": "a", "docPath": "/n/a.md", "title": "a", "updatedAt": 1, "turnCount": 1 },
            ])
        );
        // Never deleted: renamed, every byte as it was.
        assert!(!old.exists());
        let migrated = data.join(format!("{}.migrated", file_name("chat-history")));
        assert!(read(&migrated)["entries"].as_array().unwrap().len() == 3);
        assert!(!data.join(format!("{}.migrating", dir_name())).exists());
        assert_eq!(history.get("a").unwrap()["turns"][0]["text"], "a");
    }

    #[test]
    fn migration_happens_once() {
        let data = temp_dir();
        write_old(&data, json!([conversation("a", "/a.md", 1)]));
        let history = ChatHistory::load(&data);
        history.save(conversation("new", "/b.md", 5));
        history.flush();
        // An old file put back (a downgrade wrote one) is left alone: the
        // folder is what counts from now on.
        let old = write_old(&data, json!([conversation("old", "/c.md", 9)]));
        let history = ChatHistory::load(&data);
        assert_eq!(ids(&history), ["new", "a"]);
        assert!(old.exists());
    }

    #[test]
    fn a_corrupt_old_file_is_moved_aside_and_the_history_starts_empty() {
        let data = temp_dir();
        std::fs::write(data.join(file_name("chat-history")), "{ not json").unwrap();
        let history = ChatHistory::load(&data);
        assert_eq!(history.list(), json!([]));
        let aside: Vec<_> = names(&data)
            .into_iter()
            .filter(|n| n.contains(".corrupt-"))
            .collect();
        assert_eq!(aside.len(), 1);
        history.save(conversation("a", "/a.md", 1));
        history.flush();
        assert_eq!(ids(&ChatHistory::load(&data)), ["a"]);
    }

    #[test]
    fn no_old_file_and_no_folder_is_a_first_launch() {
        let data = temp_dir();
        let history = ChatHistory::load(&data);
        assert!(history.missing_at_load());
        assert!(
            !data.join(dir_name()).exists(),
            "nothing written until a save"
        );
    }

    #[test]
    fn a_save_writes_only_that_conversation_and_the_index() {
        let data = temp_dir();
        let history = ChatHistory::load(&data);
        history.save(conversation("a", "/a.md", 1));
        history.save(conversation("b", "/b.md", 2));
        history.flush();
        let dir = data.join(dir_name());
        let b_before = std::fs::read_to_string(dir.join("b.json")).unwrap();
        let mut a = conversation("a", "/a.md", 3);
        a["turns"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "kind": "Assistant", "text": "hi" }));
        let line = history.save(a);
        assert_eq!(line["turnCount"], 2);
        assert!(line.get("turns").is_none(), "the index holds no turns");
        history.flush();
        assert_eq!(
            std::fs::read_to_string(dir.join("b.json")).unwrap(),
            b_before
        );
        assert_eq!(read(&dir.join("a.json"))["entry"]["turns"][1]["text"], "hi");
        assert_eq!(ids(&ChatHistory::load(&data)), ["a", "b"]);
    }

    #[test]
    fn beyond_the_cap_the_oldest_move_to_the_trash() {
        let data = temp_dir();
        let history = ChatHistory::load(&data);
        for i in 0..MAX_CONVERSATIONS + 3 {
            history.save(conversation(&format!("c{i}"), "/a.md", i as u64));
        }
        history.flush();
        let dir = data.join(dir_name());
        let list = history.list();
        assert_eq!(list.as_array().unwrap().len(), MAX_CONVERSATIONS);
        assert_eq!(names(&dir.join(TRASH)), ["c0.json", "c1.json", "c2.json"]);
        assert!(!dir.join("c0.json").exists());
        assert_eq!(history.archived(), 3);
        // Still whole, for a hand recovery.
        assert_eq!(read(&dir.join(TRASH).join("c1.json"))["entry"]["id"], "c1");
    }

    #[test]
    fn the_trash_keeps_its_newest_files() {
        let data = temp_dir();
        let history = ChatHistory::load(&data);
        let trash = data.join(dir_name()).join(TRASH);
        std::fs::create_dir_all(&trash).unwrap();
        // Something else in the trash is never touched.
        std::fs::write(trash.join("notes.txt"), "mine").unwrap();
        for i in 0..MAX_TRASHED {
            let path = trash.join(format!("t{i}.json"));
            std::fs::write(&path, "{}").unwrap();
            let at = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000 + i as u64);
            std::fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(at)
                .unwrap();
        }
        for i in 0..=MAX_CONVERSATIONS {
            history.save(conversation(&format!("c{i}"), "/a.md", i as u64));
        }
        assert_eq!(history.archived(), MAX_TRASHED);
        assert!(!trash.join("t0.json").exists(), "the oldest went");
        assert!(trash.join("t1.json").exists());
        assert!(trash.join("c0.json").exists(), "the one just trimmed stays");
        assert!(trash.join("notes.txt").exists());
    }

    #[test]
    fn clear_deletes_every_conversation_file_and_nothing_else() {
        let data = temp_dir();
        let history = ChatHistory::load(&data);
        for i in 0..=MAX_CONVERSATIONS {
            history.save(conversation(&format!("c{i}"), "/a.md", i as u64));
        }
        history.flush();
        let dir = data.join(dir_name());
        std::fs::write(dir.join("README.txt"), "mine").unwrap();
        // A save still waiting on its debounce doesn't come back after.
        history.save(conversation("late", "/a.md", 10_000));
        history.clear();
        std::thread::sleep(super::super::FLUSH_DELAY * 3);
        assert_eq!(names(&dir), ["README.txt", "index.json"]);
        assert_eq!(read(&dir.join("index.json"))["entries"], json!([]));
        assert_eq!(history.archived(), 0);
        assert!(history.get("late").is_none());
    }

    #[test]
    fn remove_deletes_one_conversation() {
        let data = temp_dir();
        let history = ChatHistory::load(&data);
        history.save(conversation("a", "/a.md", 1));
        history.save(conversation("b", "/b.md", 2));
        history.flush();
        history.remove("a");
        history.remove("../index");
        history.flush();
        assert_eq!(names(&data.join(dir_name())), ["b.json", "index.json"]);
        assert_eq!(ids(&history), ["b"]);
    }

    #[test]
    fn a_moved_document_takes_its_conversations_along() {
        let data = temp_dir();
        write_old(
            &data,
            json!([
                conversation("a", "/old.md", 1),
                conversation("b", "/other.md", 2)
            ]),
        );
        let history = ChatHistory::load(&data);
        assert!(history.move_document("/old.md", "/new.md"));
        assert!(!history.move_document("/nowhere.md", "/x.md"));
        history.flush();
        let dir = data.join(dir_name());
        assert_eq!(read(&dir.join("a.json"))["entry"]["docPath"], "/new.md");
        assert_eq!(read(&dir.join("b.json"))["entry"]["docPath"], "/other.md");
        assert_eq!(history.list()[1]["docPath"], "/new.md");
    }

    #[test]
    fn a_lost_index_is_built_again_from_the_files() {
        let data = temp_dir();
        let history = ChatHistory::load(&data);
        history.save(conversation("a", "/a.md", 1));
        history.save(conversation("b", "/b.md", 2));
        history.flush();
        std::fs::write(data.join(dir_name()).join(INDEX), "{ torn").unwrap();
        assert_eq!(ids(&ChatHistory::load(&data)), ["b", "a"]);
    }

    #[test]
    fn imports_join_without_replacing() {
        let data = temp_dir();
        let history = ChatHistory::load(&data);
        history.save(json!({ "id": "shared", "updatedAt": 9, "turns": ["textus"] }));
        history.merge(vec![
            conversation("shared", "/levis.md", 1),
            conversation("a", "/a.md", 5),
            json!({ "id": "../escape", "updatedAt": 1, "turns": [] }),
        ]);
        assert_eq!(ids(&history), ["shared", "a"]);
        assert_eq!(history.get("shared").unwrap()["turns"][0], "textus");
    }

    #[test]
    fn unsafe_ids_never_name_a_file() {
        for id in ["", "index", "../x", "a/b", "a.json", "c:\\x"] {
            assert!(!safe_id(id), "{id}");
        }
        assert!(safe_id("4f1c2d9e-0b7a-4c55-9a51-3d8e2f6b7c10"));
    }
}
