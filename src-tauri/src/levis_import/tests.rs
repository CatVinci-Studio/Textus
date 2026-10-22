use super::*;

fn scratch(name: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("textus-levis-import-{name}-{}", std::process::id()));
    if dir.exists() {
        std::fs::remove_dir_all(&dir).unwrap();
    }
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

/// Every file under `dir` with its contents, to prove Levis's side is
/// left exactly as it was.
fn snapshot(dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                out.push((p.clone(), std::fs::read(&p).unwrap()));
            }
        }
    }
    out.sort();
    out
}

#[test]
fn levis_dirs_are_textus_dirs_siblings() {
    let dirs = Dirs::beside(
        Path::new("/home/u/.config/com.catvinci.textus"),
        Path::new("/home/u/.local/share/com.catvinci.textus"),
    )
    .unwrap();
    assert_eq!(
        dirs.config,
        Path::new("/home/u/.config/com.chengaoshen.levis")
    );
    assert_eq!(
        dirs.data,
        Path::new("/home/u/.local/share/com.chengaoshen.levis")
    );
}

#[test]
fn nothing_to_import_without_a_levis_installation() {
    let root = scratch("none");
    let levis = Dirs {
        config: root.join("levis-config"),
        data: root.join("levis-data"),
    };
    assert!(items(&levis).is_empty());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn imports_a_levis_installation_by_copying_and_never_touches_it() {
    let root = scratch("full");
    let levis = Dirs {
        config: root.join("levis-config"),
        data: root.join("levis-data"),
    };
    let config = root.join("textus-config");
    let data = root.join("textus-data");
    write(
        &levis.config.join("settings.json"),
        r#"{"schemaVersion":1,"settings":{"theme":"dark","fontSize":18,"userThemes":[{"id":"ink"}]}}"#,
    );
    write(
        &levis.data.join("ui-state.json"),
        r#"{"schemaVersion":1,"state":{"agentPanelOpen":true}}"#,
    );
    write(
        &levis.data.join("chat-history.json"),
        r#"{"schemaVersion":1,"entries":[{"id":"a","updatedAt":5,"turns":[]},{"id":"shared","updatedAt":1,"turns":[]}]}"#,
    );
    write(
        &levis.data.join("clipboard-history.json"),
        r#"{"schemaVersion":1,"entries":[{"text":"copied in Levis","at":3}]}"#,
    );
    write(&levis.config.join("themes/ink/light.css"), "body{}");
    write(
        &levis.config.join("agent/agent.md"),
        "Write in British English.",
    );
    write(
        &levis.config.join("agent/skills/house.md"),
        "---\nname: house\n---\nShort.",
    );
    write(
        &levis.config.join("recent_files.json"),
        r#"["/docs/levis.md","/docs/both.md"]"#,
    );
    write(&levis.config.join("session.json"), r#"{"windows":[]}"#);
    write(
        &levis.config.join("prefs.json"),
        r#"{"editor_window_size":[900,700]}"#,
    );
    write(
        &levis.data.join("drafts/tab-1.json"),
        r#"{"tabId":"tab-1"}"#,
    );
    write(&levis.data.join("assets/shot.png"), "png");
    write(
        &levis.config.join("provider_keys.json"),
        r#"{"anthropic":"levis-key","openai":"levis-openai"}"#,
    );
    write(&levis.config.join("auth-codex.json"), r#"{"token":"t"}"#);

    // Textus has already run once: defaults, a key, a recent file, a
    // conversation (one Levis also has), the starter agent.md.
    let own = |stem: &str| crate::settings::file_name(stem);
    write(
        &config.join(own("settings")),
        r#"{"schemaVersion":1,"settings":{"theme":"system","textusOnly":1}}"#,
    );
    write(
        &data.join(own("chat-history")),
        r#"{"schemaVersion":1,"entries":[{"id":"shared","updatedAt":9,"turns":["textus"]}]}"#,
    );
    write(
        &config.join("provider_keys.json"),
        r#"{"openai":"textus-openai"}"#,
    );
    write(
        &config.join("recent_files.json"),
        r#"["/docs/both.md","/docs/textus.md"]"#,
    );
    write(
        &config.join("agent/agent.md"),
        "<!-- starter template -->\n",
    );

    let before = snapshot(&root.join("levis-config"));
    let before_data = snapshot(&root.join("levis-data"));
    let stores = Stores::load(&config, &data);
    assert_eq!(items(&levis).len(), 10);
    let report = import(&levis, &config, &data, &stores, true);

    assert_eq!(
        snapshot(&root.join("levis-config")),
        before,
        "Levis config untouched"
    );
    assert_eq!(
        snapshot(&root.join("levis-data")),
        before_data,
        "Levis data untouched"
    );
    assert!(report.failed.is_empty(), "{:?}", report.failed);
    assert_eq!(report.imported.len(), 10, "{:?}", report.imported);

    let (settings, _) = stores.settings.snapshot();
    assert_eq!(settings["theme"], "dark", "Levis's value wins");
    assert_eq!(settings["fontSize"], 18);
    assert_eq!(settings["textusOnly"], 1, "Textus-only fields stay");
    assert_eq!(settings[OFFERED_SETTING], true);
    assert_eq!(stores.ui_state.snapshot().0["agentPanelOpen"], true);
    let chats = stores.chat.list();
    let ids: Vec<_> = chats
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["shared", "a"]);
    assert_eq!(
        stores.chat.get("shared").unwrap()["turns"][0],
        "textus",
        "Textus's copy wins a tie"
    );
    // Written in the folder layout, one file per conversation.
    stores.flush_all();
    let chat_dir = data.join(own("chat-history").trim_end_matches(".json"));
    assert!(chat_dir.join("a.json").is_file());
    assert_eq!(stores.clipboard.snapshot().0[0]["text"], "copied in Levis");

    let read = |p: &Path| std::fs::read_to_string(p).unwrap();
    assert_eq!(read(&config.join("themes/ink/light.css")), "body{}");
    assert_eq!(
        read(&config.join("textus/agent.md")),
        "Write in British English."
    );
    assert!(config.join("textus/skills/house.md").is_file());
    assert_eq!(
        read_json(&config.join("recent_files.json")).unwrap(),
        json!(["/docs/both.md", "/docs/textus.md", "/docs/levis.md"])
    );
    assert!(config.join("session.json").is_file());
    assert!(config.join("prefs.json").is_file());
    assert!(data.join("drafts/tab-1.json").is_file());
    assert!(data.join("assets/shot.png").is_file());
    assert_eq!(
        read_json(&config.join("provider_keys.json")).unwrap(),
        json!({"openai": "textus-openai", "anthropic": "levis-key"})
    );
    assert!(config.join("auth-codex.json").is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for f in ["provider_keys.json", "auth-codex.json"] {
            let mode = std::fs::metadata(config.join(f))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "{f}");
        }
    }

    // Running it again changes nothing and copies nothing twice.
    let again = import(&levis, &config, &data, &stores, true);
    assert!(again.kept.contains(&"session.json".to_string()));
    assert_eq!(stores.chat.list().as_array().unwrap().len(), 2);
    assert_eq!(snapshot(&root.join("levis-config")), before);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn credentials_stay_behind_without_consent() {
    let root = scratch("no-creds");
    let levis = Dirs {
        config: root.join("levis-config"),
        data: root.join("levis-data"),
    };
    let config = root.join("textus-config");
    let data = root.join("textus-data");
    write(
        &levis.config.join("settings.json"),
        r#"{"schemaVersion":1,"settings":{"theme":"dark"}}"#,
    );
    write(
        &levis.config.join("provider_keys.json"),
        r#"{"anthropic":"k"}"#,
    );
    write(&levis.config.join("auth-claude.json"), r#"{"token":"t"}"#);
    let stores = Stores::load(&config, &data);
    let report = import(&levis, &config, &data, &stores, false);
    assert_eq!(report.imported, [Item::Settings]);
    assert!(!config.join("provider_keys.json").exists());
    assert!(!config.join("auth-claude.json").exists());
    std::fs::remove_dir_all(&root).unwrap();
}
