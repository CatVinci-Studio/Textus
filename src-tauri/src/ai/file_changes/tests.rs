use super::*;

fn call(name: &str, args: serde_json::Value) -> ToolCall {
    ToolCall {
        call_id: "c".into(),
        name: name.into(),
        arguments: args.to_string(),
    }
}

fn folder() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.md"), "One two three.\n").unwrap();
    std::fs::write(dir.path().join("open.md"), "Open.\n").unwrap();
    std::fs::create_dir(dir.path().join(".textus")).unwrap();
    let conversation = format!("test-{}", change_id());
    (dir, conversation)
}

fn change_of(out: &ToolOutput) -> String {
    let args: serde_json::Value =
        serde_json::from_str(out.call_arguments.as_deref().expect("recorded")).unwrap();
    args["change"].as_str().unwrap().to_string()
}

#[test]
fn changes_land_on_disk_inside_the_folder_and_undo_together() {
    let (dir, conversation) = folder();
    let open = dir.path().join("open.md");
    let edits = FileEdits::new(Some(dir.path()), Some(&conversation), Some(&open), false).unwrap();
    let a = dir.path().join("a.md");

    let edit = edits.run(&call("edit_file", json!({"path": "a.md", "old": "two", "new": "2"})), edit_file);
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "One 2 three.\n");
    // A second change to the same file builds on the first.
    let again = edits.run(&call("edit_file", json!({"path": "a.md", "old": "three", "new": "3"})), edit_file);
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "One 2 3.\n");
    let made = edits.run(&call("write_file", json!({"path": "new/b.md", "content": "B"})), write_file);
    assert_eq!(std::fs::read_to_string(dir.path().join("new/b.md")).unwrap(), "B");

    // Refused: the open document, hidden folders, outside the folder, a
    // missing passage, a file that isn't text.
    for (args, why) in [
        (json!({"path": "open.md", "content": "x"}), "propose_edit"),
        (json!({"path": ".textus/agent.md", "content": "x"}), "start with"),
        (json!({"path": "../out.md", "content": "x"}), "without `..`"),
        (json!({"path": "pic.png", "content": "x"}), "isn't a text file"),
    ] {
        let out = edits.run(&call("write_file", args), write_file);
        assert!(out.text.contains(why), "{}", out.text);
        assert!(out.call_arguments.is_none());
    }
    let missing = edits.run(&call("edit_file", json!({"path": "a.md", "old": "four", "new": "4"})), edit_file);
    assert!(missing.text.contains("isn't in the file"));
    assert_eq!(std::fs::read_to_string(&open).unwrap(), "Open.\n");

    // The reply's changes undo together, the file made going to the Trash,
    // and redo.
    let ids = vec![change_of(&edit), change_of(&again), change_of(&made)];
    let (changes, problems) = ai_set_file_changes(conversation.clone(), ids.clone(), false).unwrap();
    assert!(problems.is_empty(), "{problems:?}");
    assert!(changes.iter().all(|c| !c.applied));
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "One two three.\n");
    assert!(!dir.path().join("new/b.md").exists());
    let (_, problems) = ai_set_file_changes(conversation.clone(), ids, true).unwrap();
    assert!(problems.is_empty(), "{problems:?}");
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "One 2 3.\n");
}

#[test]
fn asked_first_a_change_waits_and_an_edited_file_is_left_alone() {
    let (dir, conversation) = folder();
    let edits = FileEdits::new(Some(dir.path()), Some(&conversation), None, true).unwrap();
    let a = dir.path().join("a.md");
    let out = edits.run(&call("edit_file", json!({"path": "a.md", "old": "two", "new": "2"})), edit_file);
    assert!(out.text.contains("for the user to apply"));
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "One two three.\n");
    let ids = vec![change_of(&out)];
    let (changes, _) = ai_set_file_changes(conversation.clone(), ids.clone(), true).unwrap();
    assert!(changes[0].applied);
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "One 2 three.\n");
    // Changed by hand since: undo leaves it.
    std::fs::write(&a, "Mine.\n").unwrap();
    let (changes, problems) = ai_set_file_changes(conversation, ids, false).unwrap();
    assert!(changes[0].applied);
    assert_eq!(problems.len(), 1);
    assert_eq!(std::fs::read_to_string(&a).unwrap(), "Mine.\n");
}
