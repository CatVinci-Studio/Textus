use super::*;

const DOC: &str = "---\ntitle: Plan\ntags: [a]\n---\n# The plan\n\nSee [goals](goals.md#now) and [[Roadmap|the road]].\nTagged #work and #home/kids, not #123 or `#code`.\n\n```\n# not a heading [[nor a link]]\n```\n\n## Tasks\n- [ ] Write it 📅 2026-11-01 #work\n- [x] Read it due:2026-10-01\n* [ ] Third\n";

#[test]
fn reads_what_a_note_holds() {
    let m = parse_document("/r/plan.md", "plan.md", DOC);
    assert_eq!(m.title, "The plan");
    assert_eq!(m.frontmatter.as_deref(), Some("title: Plan\ntags: [a]"));
    assert_eq!(
        m.headings
            .iter()
            .map(|h| (h.level, h.text.as_str(), h.line))
            .collect::<Vec<_>>(),
        vec![(1, "The plan", 4), (2, "Tasks", 13)]
    );
    assert_eq!(m.links.len(), 2);
    assert_eq!(m.links[0].target, "goals.md#now");
    assert!(!m.links[0].wiki);
    assert_eq!(m.links[1].target, "Roadmap");
    assert_eq!(m.links[1].text, "the road");
    assert!(m.links[1].wiki);
    assert_eq!(m.tags, vec!["work", "home/kids"]);
    assert_eq!(m.tasks.len(), 3);
    assert_eq!(m.tasks[0].due.as_deref(), Some("2026-11-01"));
    assert_eq!(m.tasks[0].tags, vec!["work"]);
    assert!(!m.tasks[0].done);
    assert!(m.tasks[1].done);
    assert_eq!(m.tasks[1].due.as_deref(), Some("2026-10-01"));
    assert_eq!(m.tasks[2].line, 16);
}

#[test]
fn comments_anchors_and_escaped_bars_are_read_as_obsidian_reads_them() {
    let text = "See [a](#intro) and [[Note\\|shown]] #real\n%% [[Hidden]] #secret\nstill hidden [[Gone]] %% [[Kept]]\n- [/] half done\n";
    let m = parse_document("/r/a.md", "a.md", text);
    let targets: Vec<_> = m
        .links
        .iter()
        .map(|l| (l.target.as_str(), l.text.as_str()))
        .collect();
    assert_eq!(
        targets,
        vec![("#intro", "a"), ("Note", "shown"), ("Kept", "Kept")]
    );
    assert_eq!(m.tags, vec!["real"]);
    assert_eq!(m.tasks.len(), 1);
    assert!(m.tasks[0].done);
}

#[test]
fn block_ids_carry_their_line_and_block() {
    let text = "A paragraph ^para1\n\n- one\n- two\n\n^list-2\n";
    let m = parse_document("/r/a.md", "a.md", text);
    let ids: Vec<_> = m
        .block_ids
        .iter()
        .map(|b| (b.id.as_str(), b.line, b.text.as_str()))
        .collect();
    assert_eq!(
        ids,
        vec![("para1", 0, "A paragraph"), ("list-2", 5, "- two")]
    );
}

#[test]
fn a_note_without_a_heading_is_named_after_its_file() {
    let m = parse_document("/r/a/b note.md", "a/b note.md", "Just text.");
    assert_eq!(m.title, "b note");
    assert!(m.frontmatter.is_none());
}

#[test]
fn blocks_carry_their_lines() {
    let blocks = blocks_of("# A\n\nPara one\n\nPara two\n");
    assert_eq!(
        blocks.iter().map(|b| b.line).collect::<Vec<_>>(),
        vec![0, 2, 4]
    );
}

#[test]
fn a_caller_is_sent_only_what_changed_since_it_asked() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.md"), "# A").unwrap();
    std::fs::write(dir.path().join("b.md"), "# B").unwrap();
    let index = MetadataIndex::default();
    let ask = |after: Option<u64>| {
        refresh(&index, dir.path());
        let all = index.0.lock().unwrap();
        since(&all[&dir.path().to_string_lossy().to_string()], after)
    };
    let first = ask(None);
    assert!(first.whole && first.documents.len() == 2);
    let quiet = ask(Some(first.generation));
    assert!(!quiet.whole && quiet.documents.is_empty() && quiet.gone.is_empty());
    std::fs::write(dir.path().join("b.md"), "# B, longer now").unwrap();
    std::fs::remove_file(dir.path().join("a.md")).unwrap();
    let again = ask(Some(quiet.generation));
    assert_eq!(again.documents.len(), 1);
    assert!(again.documents[0].path.ends_with("b.md"));
    assert!(again.gone.len() == 1 && again.gone[0].ends_with("a.md"));
    // A caller that has seen nothing gets the whole index.
    assert!(ask(None).whole);
    // Other folders push this one out; indexed again, a caller still
    // holding its old generation gets the whole index, not "no change".
    let held = first.generation;
    for _ in 0..ROOTS_KEPT {
        refresh(&index, tempfile::tempdir().unwrap().path());
    }
    std::fs::write(dir.path().join("c.md"), "# C").unwrap();
    let back = ask(Some(held));
    assert!(back.whole && back.documents.len() == 2);
}

#[test]
fn front_matter_is_read_as_the_app_does() {
    for (name, text, yaml, _) in crate::ai::workspace::tests::frontmatter_cases() {
        assert_eq!(front_matter(&text).0, yaml, "{name}");
    }
}
