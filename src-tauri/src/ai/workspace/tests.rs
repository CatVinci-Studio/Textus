use super::*;

#[test]
fn strips_comments_leaving_instructions() {
    let text = "<!-- how-to guide -->\nReply in Chinese.\n<!-- note to self -->";
    assert_eq!(strip_html_comments(text).trim(), "Reply in Chinese.");
}

#[test]
fn unterminated_comment_swallows_rest() {
    assert_eq!(strip_html_comments("keep <!-- open forever"), "keep ");
}

#[test]
fn parses_frontmatter_skill() {
    let skill = parse_skill_file(
        "polish",
        "---\nname: tighten\ndescription: Tighten prose\n---\nRewrite the text to be tighter.",
    );
    assert_eq!(skill.name, "tighten");
    assert_eq!(skill.description, "Tighten prose");
    assert_eq!(skill.prompt, "Rewrite the text to be tighter.");
}

#[test]
fn skill_without_frontmatter_uses_file_stem() {
    let skill = parse_skill_file("outline", "Make an outline of the document.");
    assert_eq!(skill.name, "outline");
    assert_eq!(skill.description, "");
    assert_eq!(skill.prompt, "Make an outline of the document.");
}

#[test]
fn workspace_root_defaults_to_the_documents_folder() {
    assert_eq!(
        resolve_root(Some("/tmp/novel/chapter-1.md"), None),
        Some(PathBuf::from("/tmp/novel"))
    );
    assert_eq!(resolve_root(None, None), None);
    assert_eq!(
        resolve_root(Some("/tmp/novel/.textus/library/Lin.md"), None),
        Some(PathBuf::from("/tmp/novel"))
    );
    assert_eq!(
        resolve_root(Some("/tmp/novel/.textus/style.md"), None),
        Some(PathBuf::from("/tmp/novel"))
    );
}

#[test]
fn an_explicit_root_wins_over_the_documents_folder() {
    // The whole point of the setting: sources and draft in different
    // folders. Uses a directory guaranteed to exist, since resolve_root
    // only honours an override that is really there.
    let existing = std::env::temp_dir();
    assert_eq!(
        resolve_root(
            Some("/tmp/novel/chapter-1.md"),
            Some(&existing.to_string_lossy())
        ),
        Some(existing)
    );
}

#[test]
fn a_stale_root_falls_back_instead_of_leaving_no_workspace() {
    // A moved or unmounted folder must not cost the agent its skills and
    // file tools entirely - that would look like the feature breaking.
    assert_eq!(
        resolve_root(
            Some("/tmp/novel/chapter-1.md"),
            Some("/definitely/not/a/real/folder")
        ),
        Some(PathBuf::from("/tmp/novel"))
    );
    assert_eq!(
        resolve_root(Some("/tmp/novel/chapter-1.md"), Some("   ")),
        Some(PathBuf::from("/tmp/novel"))
    );
}

#[test]
fn a_skill_name_cannot_escape_the_skills_folder() {
    let dir = Path::new("/config/agent/skills");
    for name in [
        "../../x",
        "..",
        "/etc/passwd",
        "a/../b",
        "..\\..\\win",
        "nul",
        "",
    ] {
        let path = skill_file_path(dir, name).unwrap();
        assert_eq!(path.parent(), Some(dir), "{name}");
        let file = path.file_name().unwrap().to_str().unwrap();
        assert!(!file.starts_with('.'), "{name} -> {file}");
        assert!(!file.contains(".."), "{name} -> {file}");
    }
    assert_eq!(skill_file_stem("../../x"), "x");
    assert_eq!(skill_file_stem("nul"), "nul-skill");
    assert_eq!(skill_file_stem("润色"), "润色");
    assert_eq!(skill_file_stem("fix-my_prose2"), "fix-my_prose2");
    // 100 Chinese characters are 300 bytes - past a 255-byte file name.
    let long = skill_file_stem(&"润".repeat(100));
    assert!(
        long.len() <= 120 && long.chars().all(|c| c == '润'),
        "{long}"
    );
    assert_eq!(skill_file_stem(&"a".repeat(300)).len(), 120);
}

#[test]
fn block_scalar_descriptions_are_read_whole() {
    let literal = parse_skill_file(
        "x",
        "---\nname: x\ndescription: |\n  First line.\n  Second line.\nlicense: MIT\n---\nbody",
    );
    assert_eq!(literal.description, "First line.\nSecond line.");
    let folded = parse_skill_file(
            "x",
            "---\nname: x\ndescription: >-\n  Writes the next scene\n  of a story.\n\n  Use when asked.\n---\nbody",
        );
    assert_eq!(
        folded.description,
        "Writes the next scene of a story.\nUse when asked."
    );
    let plain = parse_skill_file(
        "x",
        "---\ndescription: Tighten prose\n  without losing facts # a comment\n---\nbody",
    );
    assert_eq!(plain.description, "Tighten prose without losing facts");
    let quoted = parse_skill_file(
        "x",
        "---\nname: 'it''s'\ndescription: \"Say \\\"hi\\\": politely\"\n---\nbody",
    );
    assert_eq!(quoted.name, "it's");
    assert_eq!(quoted.description, "Say \"hi\": politely");
}

#[test]
fn a_name_nested_under_metadata_does_not_rename_the_skill() {
    let skill = parse_skill_file(
            "polish",
            "---\nname: polish\nmetadata:\n  name: other\n  textus-category: \"revise\"\n  textus-packs: \"contract standards#words\"\n  textus-aliases-zh: \"润色， 打磨, 润色\"\n  textus-invocation: user-only\ndescription: Polish\n---\nbody",
        );
    assert_eq!(skill.name, "polish");
    assert_eq!(skill.description, "Polish");
    assert_eq!(skill.category.as_deref(), Some("revise"));
    assert_eq!(skill.packs, ["contract", "standards#words"]);
    assert_eq!(skill.aliases["zh"], ["润色", "打磨"]);
    assert_eq!(skill.invocation, Invocation::UserOnly);
    // Without the frontmatter name, the nested one still doesn't count.
    let skill = parse_skill_file("polish", "---\nmetadata:\n  name: other\n---\nbody");
    assert_eq!(skill.name, "polish");
    // Lists and other nested blocks are skipped without harm.
    let skill = parse_skill_file(
            "x",
            "---\nallowed-tools:\n  - Read\n  - Grep\nname: listed\ndisable-model-invocation: true\n---\nbody",
        );
    assert_eq!(skill.name, "listed");
    assert_eq!(skill.invocation, Invocation::UserOnly);
}

#[test]
fn comments_crlf_and_bom_are_handled() {
    let skill = parse_skill_file(
            "x",
            "\u{feff}---\r\nname: crlf\r\ndescription: Windows file\r\n---\r\n<!-- note to self -->\r\nDo the thing.\r\n",
        );
    assert_eq!(skill.name, "crlf");
    assert_eq!(skill.description, "Windows file");
    assert_eq!(skill.prompt.trim(), "Do the thing.");
    assert!(!skill.prompt.contains("note to self"));
    // An unterminated frontmatter is body, as before.
    let skill = parse_skill_file("stem", "---\nname: x\nno end");
    assert_eq!(skill.name, "stem");
    assert!(skill.prompt.contains("no end"));
}

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "textus-skills-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

#[test]
fn the_project_is_the_nearest_folder_above_with_a_textus_folder() {
    let root = scratch("walk-up");
    let novel = root.join("novel");
    write(&novel.join(".textus/agent.md"), "Novel rules.");
    write(&novel.join("part-1/scenes/one.md"), "# One");
    let doc = novel.join("part-1/scenes/one.md");
    assert_eq!(resolve_root(doc.to_str(), None), Some(novel.clone()));
    let ws = load_layers(None, doc.to_str(), None, &[]);
    assert_eq!(ws.root_source, RootSource::EnclosingProject);
    assert_eq!(ws.project_instructions.as_deref(), Some("Novel rules."));
    // A nearer .textus/ wins.
    write(&novel.join("part-1/.textus/agent.md"), "Part rules.");
    assert_eq!(resolve_root(doc.to_str(), None), Some(novel.join("part-1")));
    // With none anywhere above, the document's own folder, as before.
    let loose = root.join("loose/notes.md");
    write(&loose, "x");
    assert_eq!(resolve_root(loose.to_str(), None), Some(root.join("loose")));
    let ws = load_layers(None, loose.to_str(), None, &[]);
    assert_eq!(ws.root_source, RootSource::DocumentFolder);
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn the_walk_up_never_takes_a_folder_too_broad() {
    let root = scratch("walk-stop");
    write(&root.join("a/b/c.md"), "x");
    assert_eq!(enclosing_project(&root.join("a/b")), None);
    assert_eq!(enclosing_project(Path::new("/")), None);
    // Even with a .textus/ in it, the home folder is no project.
    if let Some(home) = std::env::var_os("HOME") {
        assert_eq!(enclosing_project(Path::new(&home)), None);
    }
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn only_textus_metadata_keys_are_read() {
    let skill = parse_skill_file(
        "x",
        "---\nname: x\nmetadata:\n  other-version: \"1\"\n  textus-version: \"2\"\n  other-based-on: \"tighten@1\"\n  other-aliases-en: \"old\"\n  textus-aliases-en: \"new\"\n---\nbody",
    );
    assert_eq!(skill.version.as_deref(), Some("2"));
    assert_eq!(skill.based_on, None);
    assert_eq!(skill.aliases["en"], ["new"]);
    assert_eq!(skill.aliases.len(), 1);
}

#[test]
fn layers_override_built_ins_by_name() {
    let root = scratch("layers");
    let global = root.join("agent");
    let project = root.join("novel");
    write(
        &global.join("skills/tighten.md"),
        "---\nname: tighten\ndescription: Mine\n---\nCut hard.",
    );
    write(
        &global.join("skills/headline.md"),
        "---\nname: headline\ndescription: Global headline\n---\nGlobal.",
    );
    write(
        &project.join(".textus/skills/headline.md"),
        "---\nname: headline\ndescription: House style\n---\nAt most 6 words.",
    );
    write(&project.join("chapter.md"), "# One");
    let doc = project.join("chapter.md");
    let ws = load_layers(
        Some(&global),
        doc.to_str(),
        None,
        &["proofread".to_string(), "not-a-skill".to_string()],
    );
    let get = |name: &str| ws.skills.iter().find(|s| s.name == name).unwrap();
    assert_eq!(ws.skills.iter().filter(|s| s.name == "headline").count(), 1);
    let headline = get("headline");
    assert_eq!(headline.source, SkillSource::Project);
    assert!(headline.overrides_builtin && headline.prompt.contains("6 words"));
    let tighten = get("tighten");
    assert_eq!(tighten.source, SkillSource::Global);
    assert!(tighten.overrides_builtin && tighten.enabled);
    let proofread = get("proofread");
    assert_eq!(proofread.source, SkillSource::Builtin);
    assert!(!proofread.enabled, "turned off, still listed");
    assert!(get("email").enabled && get("email").source == SkillSource::Builtin);
    assert_eq!(ws.skills.len(), builtin::skills().len());
    assert!(
        !ws.skills.iter().any(|s| s.name.starts_with("standards")),
        "packs aren't skills"
    );
    // Disabling a built-in leaves a user override alone.
    let ws = load_layers(Some(&global), doc.to_str(), None, &["tighten".to_string()]);
    let tighten = ws.skills.iter().find(|s| s.name == "tighten").unwrap();
    assert!(tighten.enabled && tighten.source == SkillSource::Global);
    // ...but a copy made by Customize… follows the built-in's switch.
    customize_in(&global.join("skills"), "email").unwrap();
    let ws = load_layers(Some(&global), doc.to_str(), None, &["email".to_string()]);
    let email = ws.skills.iter().find(|s| s.name == "email").unwrap();
    assert!(email.based_on.is_some() && !email.enabled);
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn customize_copies_and_reset_deletes_only_copies() {
    let root = scratch("customize");
    let skills = root.join("skills");
    let path = customize_in(&skills, "tighten").unwrap();
    assert_eq!(path, skills.join("tighten.md"));
    let copy = std::fs::read_to_string(&path).unwrap();
    assert!(copy.contains("textus-based-on: \"tighten@1\""));
    // The copy now shadows the built-in, marked as such.
    let ws = load_layers(Some(&root), None, None, &[]);
    let tighten = ws.skills.iter().find(|s| s.name == "tighten").unwrap();
    assert_eq!(tighten.source, SkillSource::Global);
    assert!(tighten.overrides_builtin && !tighten.builtin_updated);
    assert_eq!(tighten.based_on.as_deref(), Some("tighten@1"));
    // Customizing again never overwrites the user's edits.
    std::fs::write(&path, copy.replace("Cut words", "Cut WORDS")).unwrap();
    assert_eq!(customize_in(&skills, "tighten").unwrap(), path);
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("Cut WORDS"));
    // An older copy is flagged once the built-in moves on.
    std::fs::write(&path, copy.replace("tighten@1", "tighten@0")).unwrap();
    let ws = load_layers(Some(&root), None, None, &[]);
    assert!(
        ws.skills
            .iter()
            .find(|s| s.name == "tighten")
            .unwrap()
            .builtin_updated
    );
    // Reset deletes the copy, and says which file went (for the tab).
    assert_eq!(
        reset_in(&skills, "tighten").unwrap(),
        vec![path.to_string_lossy().to_string()]
    );
    assert!(!path.exists());
    assert!(reset_in(&skills, "tighten").unwrap().is_empty());
    // A hand-written skill of the same name is the user's own.
    write(
        &skills.join("mine.md"),
        "---\nname: email\n---\nMy email rules.",
    );
    assert_eq!(reset_in(&skills, "email").unwrap_err(), NOT_A_COPY);
    assert!(skills.join("mine.md").exists());
    assert_eq!(
        customize_in(&skills, "email").unwrap(),
        skills.join("mine.md")
    );
    // A file with the stem but another skill inside keeps its name.
    write(&skills.join("notice.md"), "---\nname: my-notice\n---\nx");
    assert_eq!(
        customize_in(&skills, "notice").unwrap(),
        skills.join("notice-2.md")
    );
    assert_eq!(customize_in(&skills, "nope").unwrap_err(), UNKNOWN_BUILTIN);
    assert_eq!(reset_in(&skills, "nope").unwrap_err(), UNKNOWN_BUILTIN);
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn turning_built_ins_off_and_on() {
    let off = toggled_builtins(&[], "tighten", false);
    assert_eq!(off, ["tighten"]);
    let off = toggled_builtins(&off, "email", false);
    assert_eq!(off, ["email", "tighten"]);
    let off = toggled_builtins(&off, "email", false);
    assert_eq!(off, ["email", "tighten"], "no repeats");
    assert_eq!(toggled_builtins(&off, "tighten", true), ["email"]);
    assert_eq!(
        toggled_builtins(&["gone".to_string(), "email".to_string()], "email", true),
        Vec::<String>::new(),
        "names that are no longer built-ins drop out"
    );
}

#[test]
fn skill_list_serialises_the_interface_the_frontend_reads() {
    let skill = builtin::find("continue-story").unwrap();
    let v = serde_json::to_value(skill).unwrap();
    assert_eq!(v["name"], "continue-story");
    assert_eq!(v["category"], "write");
    assert_eq!(v["invocation"], "both");
    assert_eq!(v["source"], "builtin");
    assert_eq!(v["overridesBuiltin"], false);
    assert_eq!(v["enabled"], true);
    assert_eq!(v["aliases"]["zh"][0], "接着写");
    assert_eq!(v["packs"][0], "contract");
    assert_eq!(v["version"], "1");
    assert!(v["basedOn"].is_null());
    assert_eq!(v["builtinUpdated"], false);
    assert!(v.get("targetPacks").is_none());
    let tighten = serde_json::to_value(builtin::find("tighten").unwrap()).unwrap();
    assert_eq!(tighten["invocation"], "userOnly");
}

#[test]
fn skill_name_with_spaces_is_slugged() {
    // /name invocation can't contain spaces - collapse them so the
    // picker and use_skill lookups agree on one token.
    let skill = parse_skill_file("x", "---\nname: fix my prose\n---\nbody");
    assert_eq!(skill.name, "fix-my-prose");
}

#[test]
fn the_skill_list_keeps_turned_off_built_ins_and_drops_hidden_ones() {
    let ws = load_layers(None, None, None, &["describe".to_string()]);
    let mut skills = ws.skills.clone();
    skills.push(AgentSkill {
        name: "secret".into(),
        invocation: Invocation::Hidden,
        ..Default::default()
    });
    let list = listed(skills);
    assert_eq!(list.len(), 20);
    let describe = list.iter().find(|s| s.name == "describe").unwrap();
    assert!(!describe.enabled && describe.source == SkillSource::Builtin);
    let json = serde_json::to_value(&list[0]).unwrap();
    assert!(json.get("overridesBuiltin").is_some() && json.get("invocation").is_some());
}
