use super::*;

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "textus-memory-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A global config folder and a project folder side by side.
fn dirs(base: &Path) -> MemoryDirs {
    std::fs::create_dir_all(base.join("novel")).unwrap();
    MemoryDirs::new(Some(&base.join("agent")), Some(&base.join("novel")))
}

fn args(kind: &str, scope: Option<&str>, text: &str) -> RememberArgs {
    RememberArgs {
        kind: kind.into(),
        scope: scope.map(str::to_string),
        text: text.into(),
        ..Default::default()
    }
}

fn source() -> Source {
    Source {
        conversation: Some("c-1".into()),
        title: Some("Tighten \"the\" opening".into()),
        document: Some("novel/one.md".into()),
    }
}

const NOW: &str = "2026-10-18T09:30:00Z";

#[test]
fn a_memory_is_written_where_its_scope_says() {
    let base = scratch("scope");
    let dirs = dirs(&base);
    let done = dirs
        .remember(
            args("style", Some("project"), "Use 「」 for quotations."),
            &source(),
            NOW,
        )
        .unwrap();
    assert!(done.created && done.previous.is_none());
    assert_eq!(done.scope, Scope::Project);
    let stem = done.remembered.rsplit('/').next().unwrap();
    let file = base.join(format!("novel/.textus/memory/{stem}.md"));
    let content = std::fs::read_to_string(&file).unwrap();
    assert!(content.starts_with("---\nkind: style\nremembered-by: textus-ai\n"));
    assert!(content.contains("source-title: \"Tighten \\\"the\\\" opening\"\n"));
    assert!(content.ends_with("---\nUse 「」 for quotations.\n"));

    let personal = dirs
        .remember(
            args("preference", Some("personal"), "Reply briefly."),
            &source(),
            NOW,
        )
        .unwrap();
    assert!(personal.remembered.starts_with("personal/memory/"));
    assert_eq!(base.join("agent/memory").read_dir().unwrap().count(), 1);

    // No project: personal, whatever was asked.
    let alone = MemoryDirs::new(Some(&base.join("agent")), None);
    let done = alone
        .remember(
            args("requirement", Some("project"), "Never use emoji."),
            &source(),
            NOW,
        )
        .unwrap();
    assert_eq!(done.scope, Scope::Personal);

    let loaded = dirs.load();
    assert_eq!(loaded.items.len(), 3);
    assert_eq!(loaded.items[0].scope, Scope::Personal, "personal first");
    let style = loaded
        .items
        .iter()
        .find(|m| m.kind == MemoryKind::Style)
        .unwrap();
    assert_eq!(
        style.remembered.title.as_deref(),
        Some("Tighten \"the\" opening")
    );
    assert_eq!(style.remembered.created, NOW);
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn the_same_memory_is_not_saved_twice() {
    let base = scratch("dedupe");
    let dirs = dirs(&base);
    let first = dirs
        .remember(args("preference", None, "Keep it short."), &source(), NOW)
        .unwrap();
    let again = dirs
        .remember(
            args("preference", Some("personal"), "keep it  SHORT"),
            &source(),
            NOW,
        )
        .unwrap_err();
    assert!(again.contains(&first.remembered), "{again}");
    assert_eq!(dirs.load().items.len(), 1);
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn replaces_updates_in_place_and_undo_puts_it_back() {
    let base = scratch("replace");
    let dirs = dirs(&base);
    let first = dirs
        .remember(args("style", None, "Short sentences."), &source(), NOW)
        .unwrap();
    let before = std::fs::read_to_string(&dirs.load().items[0].file).unwrap();
    let mut update = args("style", None, "Short sentences, no semicolons.");
    update.replaces = Some(first.remembered.clone());
    let second = dirs
        .remember(update, &source(), "2026-10-19T00:00:00Z")
        .unwrap();
    assert_eq!(second.remembered, first.remembered);
    assert!(!second.created);
    assert_eq!(second.previous.as_deref(), Some(before.as_str()));
    let memory = &dirs.load().items[0];
    assert_eq!(memory.text, "Short sentences, no semicolons.");
    assert_eq!(memory.remembered.created, NOW, "created is kept");
    assert_eq!(memory.remembered.updated, "2026-10-19T00:00:00Z");
    // Undo of the update restores the first version...
    dirs.undo(&second.remembered, second.previous.as_deref())
        .unwrap();
    assert_eq!(dirs.load().items[0].text, "Short sentences.");
    // ...and undo of the creation removes it.
    dirs.undo(&first.remembered, None).unwrap();
    assert!(dirs.load().items.is_empty());
    assert_eq!(dirs.undo(&first.remembered, None).unwrap_err(), "GONE");
    // A replaces naming nothing is refused, not turned into a new one.
    let mut stale = args("style", None, "Other.");
    stale.replaces = Some("project/memory/nope".into());
    assert!(dirs.remember(stale, &source(), NOW).is_err());
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn a_memory_moves_between_personal_and_project() {
    let base = scratch("move");
    let dirs = dirs(&base);
    let done = dirs
        .remember(
            args("preference", Some("project"), "Prefer British spelling."),
            &source(),
            NOW,
        )
        .unwrap();
    let moved = dirs.move_to(&done.remembered, Scope::Personal).unwrap();
    assert!(moved.starts_with("personal/memory/"));
    let items = dirs.load().items;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].scope, Scope::Personal);
    assert!(Path::new(&items[0].file).starts_with(base.join("agent/memory")));
    let back = dirs.move_to(&moved, Scope::Project).unwrap();
    assert!(back.starts_with("project/memory/"));
    // Without a project there is nowhere to move it to.
    let personal = dirs.move_to(&back, Scope::Personal).unwrap();
    let alone = MemoryDirs::new(Some(&base.join("agent")), None);
    assert_eq!(
        alone.move_to(&personal, Scope::Project).unwrap_err(),
        "NO_PROJECT"
    );
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn ids_never_reach_outside_the_memory_folders() {
    let base = scratch("paths");
    let dirs = dirs(&base);
    std::fs::write(base.join("novel/chapter.md"), "keep").unwrap();
    for id in [
        "project/memory/../../chapter",
        "project/memory/../chapter",
        "project/memory/a/b",
        "project/memory/..",
        "project/memory/.hidden",
        "project/memory/",
        "project/style/x",
        "personal/library/x",
        "other/memory/x",
        "project/memory/..\\..\\chapter",
    ] {
        assert!(dirs.locate(id).is_err(), "{id}");
        assert!(dirs.delete(id).is_err(), "{id}");
    }
    assert!(base.join("novel/chapter.md").exists());
    // A link in the memory folder is never followed.
    #[cfg(unix)]
    {
        let memory = base.join("novel/.textus/memory");
        std::fs::create_dir_all(&memory).unwrap();
        std::os::unix::fs::symlink(base.join("novel/chapter.md"), memory.join("link.md")).unwrap();
        assert!(dirs.delete("project/memory/link").is_err());
        assert!(dirs.undo("project/memory/link", Some("x")).is_err());
        assert_eq!(
            std::fs::read_to_string(base.join("novel/chapter.md")).unwrap(),
            "keep"
        );
    }
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn facts_go_to_the_library_and_never_change_the_users_entries() {
    let base = scratch("facts");
    let dirs = dirs(&base);
    let mut fact = args("fact", None, "Teaches Chinese at a secondary school.");
    fact.name = Some("Lin Wan".into());
    fact.aliases = vec!["Wan".into(), "Lin Wan".into()];
    let done = dirs.remember(fact, &source(), NOW).unwrap();
    assert_eq!(done.remembered, "project/library/Lin-Wan");
    let library = read_library(&base.join("novel"));
    assert_eq!(library[0].name, "Lin Wan");
    assert_eq!(library[0].aliases, ["Wan"]);
    // One character, or two letters, would match far too much.
    let mut short = args("fact", None, "The heroine, a lighthouse keeper.");
    short.name = Some("林晚".into());
    short.aliases = vec!["晚".into(), "LW".into(), "阿晚".into()];
    dirs.remember(short, &source(), NOW).unwrap();
    let library = read_library(&base.join("novel"));
    let heroine = library.iter().find(|e| e.name == "林晚").unwrap();
    assert_eq!(heroine.aliases, ["阿晚"]);
    assert_eq!(library[0].body, "Teaches Chinese at a secondary school.");
    assert!(library[0].remembered.is_some());
    // The same name (or an alias) again updates the entry it wrote.
    let mut again = args("fact", None, "Teaches Chinese; 32 years old.");
    again.name = Some("wan".into());
    let updated = dirs.remember(again, &source(), NOW).unwrap();
    assert_eq!(updated.remembered, done.remembered);
    assert!(!updated.created);
    // An entry the user wrote is theirs.
    std::fs::write(
        base.join("novel/.textus/library/harbour.md"),
        "---\nname: Harbour\n---\nA port city.",
    )
    .unwrap();
    let mut theirs = args("fact", None, "A port city in the south.");
    theirs.name = Some("Harbour".into());
    assert!(dirs
        .remember(theirs, &source(), NOW)
        .unwrap_err()
        .contains("user's own"));
    assert_eq!(
        dirs.undo("project/library/harbour", None).unwrap_err(),
        "NOT_REMEMBERED"
    );
    // No project: no library.
    let alone = MemoryDirs::new(Some(&base.join("agent")), None);
    let mut fact = args("fact", None, "x");
    fact.name = Some("X".into());
    assert!(alone.remember(fact, &source(), NOW).is_err());
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn the_prompt_budget_counts_characters_and_keeps_the_project_first() {
    let base = scratch("cap");
    let dirs = dirs(&base);
    // 1,500 Chinese characters each: 4,500 bytes, but 1,500 against the
    // 4,000-character budget - two fit, the third doesn't. (Written
    // by hand: the tool keeps a memory under MAX_TEXT_CHARS.)
    for (i, scope) in ["personal", "project", "project"].iter().enumerate() {
        let text = format!("{i}{}", "字".repeat(1_499));
        let dir = dirs
            .folder(Scope::parse(scope).unwrap(), MEMORY_FOLDER)
            .unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(format!("m{i}.md")),
            format!("---\nkind: style\nupdated: 2026-10-1{i}T00:00:00Z\n---\n{text}"),
        )
        .unwrap();
    }
    let memories = dirs.load();
    assert_eq!(memories.chars, 3_000);
    let included: Vec<Scope> = memories
        .items
        .iter()
        .filter(|m| m.included)
        .map(|m| m.scope)
        .collect();
    assert_eq!(
        included,
        [Scope::Project, Scope::Project],
        "the project's win the budget"
    );
    let sections = memory_sections(&memories, &[], false);
    assert!(sections
        .iter()
        .any(|s| s.contains("1 older memories don't fit")));
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn the_prompt_lists_personal_then_project_and_ids_only_for_the_tool() {
    let base = scratch("prompt");
    let dirs = dirs(&base);
    dirs.remember(
        args("preference", Some("personal"), "Reply briefly."),
        &source(),
        NOW,
    )
    .unwrap();
    dirs.remember(
        args("requirement", Some("project"), "Spell it colour."),
        &source(),
        NOW,
    )
    .unwrap();
    let memories = dirs.load();
    let with_tool = memory_sections(&memories, &[], true).join("\n\n");
    let personal = with_tool.find("Reply briefly.").unwrap();
    let project = with_tool.find("Spell it colour.").unwrap();
    assert!(personal < project);
    assert!(
        with_tool.contains("where these conflict with the personal memories above, follow these")
    );
    assert!(with_tool.contains("- [personal/memory/Reply-briefly] (preference) Reply briefly."));
    assert!(remember_instructions(true, true).is_some_and(|s| s.contains("---remembering---")));
    assert!(remember_instructions(true, false).is_none());
    let without = memory_sections(&memories, &[], false).join("\n\n");
    assert!(without.contains("- (requirement) Spell it colour."));
    assert!(!without.contains("[project/"));
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn the_tool_reports_what_it_saved_as_json() {
    let base = scratch("tool");
    let ctx = MemoryContext {
        dirs: dirs(&base),
        source: source(),
    };
    let out = run_tool(
        &ctx,
        r#"{"kind":"preference","scope":"personal","text":"No emoji."}"#,
    );
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["remembered"], "personal/memory/No-emoji");
    assert_eq!(v["scope"], "personal");
    assert_eq!(v["created"], true);
    assert!(v["previous"].is_null());
    assert!(run_tool(&ctx, "{}").contains("`text` is required"));
    assert!(run_tool(&ctx, r#"{"kind":"mood","text":"x"}"#).contains("`kind` must be"));
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn the_revision_choices_log_sits_beside_the_personal_memories_unlisted() {
    let base = scratch("choices");
    let dirs = dirs(&base);
    assert!(dirs.read_choices().is_none());
    let log = serde_json::json!({ "choices": [{ "kind": "sentences\tsplit", "taken": false }] });
    dirs.write_choices(&log).unwrap();
    assert_eq!(dirs.read_choices(), Some(log));
    assert!(base.join("agent/memory/.revision-choices.json").is_file());
    // Not a memory: nothing to list, send, or reach by id.
    assert!(dirs.load().items.is_empty());
    assert!(dirs.locate("personal/memory/.revision-choices").is_err());
    assert!(dirs.write_choices(&serde_json::json!([1, 2])).is_err());
    let huge = serde_json::json!({ "x": "a".repeat(MAX_CHOICES_BYTES) });
    assert!(dirs.write_choices(&huge).is_err());
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn the_setting_is_the_field_settings_writes_on_by_default() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let settings = std::fs::read_to_string(repo.join("src/settings/settings-types.ts")).unwrap();
    assert!(settings.contains(&format!("  {REMEMBER_SETTING}: true,\n")));
}

#[test]
fn timestamps_are_utc_dates_and_times() {
    assert_eq!(timestamp(0), "1970-01-01T00:00:00Z");
    assert_eq!(timestamp(951_782_400), "2000-02-29T00:00:00Z");
    assert_eq!(timestamp(1_792_315_800), "2026-10-18T09:30:00Z");
}
