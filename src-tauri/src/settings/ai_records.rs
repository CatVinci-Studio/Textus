//! The AI records a settings file can carry: every saved conversation and
//! every memory, the user's own and each project's. An import only adds: a
//! conversation comes in when it is new here or newer than this computer's
//! copy, a memory when no file of its name is here. Nothing is deleted.

use super::chat_history::ChatHistory;
use super::HistoryKind;
use crate::ai::memory::MEMORY_FOLDER as MEMORY;
use crate::ai::project_data::PROJECTS;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Default)]
#[cfg_attr(test, derive(specta::Type))]
pub struct AiRecords {
    /// Whole conversations, turns included, as the chat history keeps them.
    pub conversations: Vec<Value>,
    pub memories: Vec<MemoryFile>,
}

/// A memory by its path under the global folder: `memory/<name>.md`, or
/// `projects/<key>/memory/<name>.md` for a project's.
#[derive(Serialize, Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct MemoryFile {
    pub path: String,
    pub text: String,
}

/// How many of each an import added.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct Imported {
    pub conversations: u32,
    pub memories: u32,
}

pub(crate) fn collect(chat: &ChatHistory, global: &Path) -> AiRecords {
    let conversations = chat
        .list()
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|line| chat.get(line.get("id")?.as_str()?))
        .collect();
    let mut memories = Vec::new();
    read_memories(global, MEMORY, &mut memories);
    for project in std::fs::read_dir(global.join(PROJECTS))
        .into_iter()
        .flatten()
        .flatten()
    {
        if let Some(key) = project.file_name().to_str() {
            read_memories(global, &format!("{PROJECTS}/{key}/{MEMORY}"), &mut memories);
        }
    }
    AiRecords {
        conversations,
        memories,
    }
}

fn read_memories(global: &Path, folder: &str, out: &mut Vec<MemoryFile>) {
    for entry in std::fs::read_dir(global.join(folder))
        .into_iter()
        .flatten()
        .flatten()
    {
        let name = entry.file_name();
        let Some(name) = name.to_str().filter(|n| n.ends_with(".md")) else {
            continue;
        };
        if !entry.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(entry.path()) {
            out.push(MemoryFile {
                path: format!("{folder}/{name}"),
                text,
            });
        }
    }
}

/// Where a memory's path puts it under `global`: only the two shapes a
/// memory has, each part a plain name. A file's path is untrusted.
fn memory_target(global: &Path, path: &str) -> Option<PathBuf> {
    let parts: Vec<&str> = path.split('/').collect();
    let plain = |s: &str| {
        !s.is_empty()
            && !s.starts_with('.')
            && !s.contains('\\')
            && !s.chars().any(char::is_control)
    };
    let shaped = match parts.as_slice() {
        [MEMORY, name] => plain(name),
        [PROJECTS, key, MEMORY, name] => plain(key) && plain(name),
        _ => false,
    };
    (shaped && path.ends_with(".md"))
        .then(|| parts.iter().fold(global.to_path_buf(), |p, s| p.join(s)))
}

fn updated(entry: &Value) -> f64 {
    entry
        .get("updatedAt")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

/// Adds `records`; returns the count and each conversation saved, as its
/// index line, for the other windows.
pub(crate) fn merge(
    chat: &ChatHistory,
    global: &Path,
    records: AiRecords,
) -> (Imported, Vec<Value>) {
    let mut saved = Vec::new();
    for entry in records.conversations {
        if !HistoryKind::Chat.valid(&entry) {
            continue;
        }
        let id = entry["id"].as_str().unwrap_or_default();
        if chat
            .get(id)
            .is_none_or(|mine| updated(&entry) > updated(&mine))
        {
            saved.push(chat.save(entry));
        }
    }
    let mut memories = 0;
    for memory in records.memories {
        let Some(path) = memory_target(global, &memory.path) else {
            continue;
        };
        if std::fs::symlink_metadata(&path).is_ok() {
            continue;
        }
        let written = path
            .parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|()| std::fs::write(&path, memory.text));
        if written.is_ok() {
            memories += 1;
        }
    }
    let imported = Imported {
        conversations: saved.len() as u32,
        memories,
    };
    (imported, saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conversation(id: &str, at: u64, text: &str) -> Value {
        json!({"id": id, "title": text, "updatedAt": at, "turns": [{"text": text}]})
    }

    #[test]
    fn records_carry_to_another_computer_and_only_add() {
        let (from, to) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (data_a, data_b) = (from.path().join("data"), to.path().join("data"));
        let (global_a, global_b) = (from.path().join("textus"), to.path().join("textus"));
        let a = ChatHistory::load(&data_a);
        a.save(conversation("c1", 10, "tides"));
        a.save(conversation("c2", 20, "gauges, newer there"));
        std::fs::create_dir_all(global_a.join("memory")).unwrap();
        std::fs::write(global_a.join("memory/likes.md"), "tea").unwrap();
        std::fs::create_dir_all(global_a.join("projects/novel-1a2b/memory")).unwrap();
        std::fs::write(global_a.join("projects/novel-1a2b/memory/cast.md"), "Ada").unwrap();

        let b = ChatHistory::load(&data_b);
        b.save(conversation("c2", 5, "gauges, older here"));
        b.save(conversation("c3", 30, "only here"));
        std::fs::create_dir_all(global_b.join("memory")).unwrap();
        std::fs::write(global_b.join("memory/likes.md"), "coffee").unwrap();

        let records = collect(&a, &global_a);
        let text = serde_json::to_string(&records).unwrap();
        let (imported, saved) = merge(&b, &global_b, serde_json::from_str(&text).unwrap());

        assert_eq!((imported.conversations, imported.memories), (2, 1));
        assert_eq!(saved.len(), 2);
        assert_eq!(b.get("c2").unwrap()["title"], "gauges, newer there");
        assert!(b.get("c3").is_some());
        // A memory of the same name here stays as it is.
        assert_eq!(
            std::fs::read_to_string(global_b.join("memory/likes.md")).unwrap(),
            "coffee"
        );
        assert_eq!(
            std::fs::read_to_string(global_b.join("projects/novel-1a2b/memory/cast.md")).unwrap(),
            "Ada"
        );
    }

    #[test]
    fn a_memory_path_can_only_name_a_memory() {
        let global = Path::new("/g");
        assert!(memory_target(global, "memory/a.md").is_some());
        assert!(memory_target(global, "projects/k/memory/a.md").is_some());
        for bad in [
            "memory/../a.md",
            "../memory/a.md",
            "memory/a.txt",
            "agent.md",
            "projects/../memory/a.md",
            "memory/sub/a.md",
            "memory/.hidden.md",
            "projects/k/skills/a.md",
        ] {
            assert!(memory_target(global, bad).is_none(), "{bad}");
        }
    }
}
