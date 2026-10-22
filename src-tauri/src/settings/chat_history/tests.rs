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
