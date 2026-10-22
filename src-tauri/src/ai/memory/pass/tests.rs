use super::*;

fn folders(tag: &str) -> (PathBuf, MemoryDirs) {
    let base = std::env::temp_dir().join(format!(
        "textus-pass-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(base.join("novel")).unwrap();
    let dirs = MemoryDirs::new(Some(&base.join("agent")), Some(&base.join("novel")));
    (base, dirs)
}

const NOW: &str = "2026-10-22T09:30:00Z";

#[test]
fn the_changes_are_read_however_they_are_wrapped() {
    let fenced = "Here you go:\n```json\n{\"changes\": [{\"op\": \"add\", \"kind\": \"preference\", \"scope\": \"personal\", \"text\": \"Reply briefly.\"}]}\n```";
    let changes = parse_changes(fenced);
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].text, "Reply briefly.");
    assert!(parse_changes("{\"changes\": []}").is_empty());
    assert!(parse_changes("Nothing to remember.").is_empty());
    assert!(parse_changes("} not json {").is_empty());
}

#[test]
fn added_updated_and_forgotten_as_the_writer_keeps_them() {
    let (base, dirs) = folders("apply");
    let source = Source::default();
    let added = dirs.apply_changes(
        parse_changes(
            r#"{"changes": [
            {"op": "add", "kind": "preference", "scope": "personal", "text": "Don't use dashes."},
            {"op": "add", "kind": "fact", "name": "林晚", "text": "林晚性子冷。"},
            {"op": "add", "kind": "preference", "scope": "personal", "text": "Don't use dashes."},
            {"op": "dance", "text": "x"}
        ]}"#,
        ),
        &source,
        NOW,
    );
    // The duplicate and the unknown op are left out.
    assert_eq!(added.len(), 2);
    let dashes = added[0].remembered.clone();
    let updated = dirs.apply_changes(
        parse_changes(&format!(
            r#"{{"changes": [{{"op": "update", "id": "{dashes}", "kind": "preference", "text": "Dashes are fine in dialogue only."}}]}}"#
        )),
        &source,
        NOW,
    );
    assert_eq!(updated[0].remembered, dashes);
    assert!(updated[0].previous.is_some());
    let forgot = dirs.apply_changes(
        parse_changes(&format!(
            r#"{{"changes": [{{"op": "forget", "id": "{dashes}"}}]}}"#
        )),
        &source,
        NOW,
    );
    assert!(forgot[0].forgot);
    assert_eq!(forgot[0].text, "Dashes are fine in dialogue only.");
    assert!(dirs.load().items.is_empty());
    // An update by a made-up id is kept as an addition: a fact joins its
    // entry.
    dirs.apply_changes(
        parse_changes(r#"{"changes": [{"op": "update", "id": "林晚", "kind": "fact", "name": "林晚", "text": "第四章起话多。"}]}"#),
        &source,
        NOW,
    );
    let lin = read_library(&base.join("novel"));
    assert_eq!(lin.len(), 1);
    assert!(lin[0].body.contains("林晚性子冷。") && lin[0].body.contains("第四章起话多。"));
    // Undo puts it back.
    dirs.undo(&dashes, forgot[0].previous.as_deref()).unwrap();
    assert_eq!(dirs.load().items.len(), 1);
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn the_users_own_library_entry_is_never_forgotten() {
    let (base, dirs) = folders("theirs");
    let library = base.join("novel/.textus/library");
    std::fs::create_dir_all(&library).unwrap();
    std::fs::write(
        library.join("harbour.md"),
        "---\nname: Harbour\n---\nA port city.",
    )
    .unwrap();
    let done = dirs.apply_changes(
        parse_changes(r#"{"changes": [{"op": "forget", "id": "project/library/harbour"}]}"#),
        &Source::default(),
        NOW,
    );
    assert!(done.is_empty());
    assert!(library.join("harbour.md").exists());
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn the_pass_is_shown_what_is_remembered_and_the_entries_named() {
    let (base, dirs) = folders("input");
    dirs.keep(
        "preference",
        "personal",
        "Reply briefly.",
        &Source::default(),
    )
    .unwrap();
    let library = base.join("novel/.textus/library");
    std::fs::create_dir_all(&library).unwrap();
    std::fs::write(library.join("lin.md"), "---\nname: 林晚\n---\n灯塔看守人。").unwrap();
    std::fs::write(library.join("zhou.md"), "---\nname: 老周\n---\n渔夫。").unwrap();
    let input = pass_input(
        &dirs,
        &Exchange {
            messages: vec!["续写一段。".into(), "林晚其实话多。".into()],
            reply: "改好了。".into(),
        },
    );
    assert!(input.contains("[personal/memory/Reply-briefly] (personal, preference) Reply briefly."));
    assert!(
        input.contains("- 林晚 - the user's own entry: never update or forget it: 灯塔看守人。")
    );
    assert!(
        !input.contains("老周"),
        "only the entries the exchange names"
    );
    assert!(input.contains("1. 续写一段。\n2. 林晚其实话多。"));
    assert!(input.contains("---project folder---\nyes"));
    // One Textus AI wrote has its id, to update or forget.
    dirs.apply_changes(
        parse_changes(r#"{"changes": [{"op": "add", "kind": "fact", "name": "阿青", "text": "林晚的妹妹。"}]}"#),
        &Source::default(),
        NOW,
    );
    let input = pass_input(
        &dirs,
        &Exchange {
            messages: vec!["阿青来了。".into()],
            reply: String::new(),
        },
    );
    assert!(
        input.contains("- 阿青 [project/library/阿青]: 林晚的妹妹。"),
        "{input}"
    );
    std::fs::remove_dir_all(&base).ok();
}
