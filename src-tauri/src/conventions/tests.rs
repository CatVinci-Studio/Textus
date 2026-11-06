use super::*;
use std::fs;

fn folder_with(files: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    for (path, text) in files {
        let path = dir.path().join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    fs::create_dir_all(dir.path().join("notes")).unwrap();
    dir
}

fn value<T: Clone>(s: &Option<Setting<T>>) -> Option<T> {
    s.as_ref().map(|s| s.value.clone())
}

#[test]
fn reads_an_obsidian_vault_and_its_defaults() {
    let dir = folder_with(&[(
        ".obsidian/app.json",
        r#"{"useMarkdownLinks":true,"newLinkFormat":"relative","strictLineBreaks":true,"alwaysUpdateLinks":false,"userIgnoreFilters":["Archive/"]}"#,
    )]);
    let c = of_folder(&dir.path().join("notes"));
    assert_eq!(value(&c.link_style).as_deref(), Some("markdown"));
    assert_eq!(value(&c.link_path).as_deref(), Some("relative"));
    assert_eq!(value(&c.soft_breaks), Some(false));
    assert_eq!(value(&c.update_links).as_deref(), Some("ask"));
    assert_eq!(c.ignore, vec!["Archive/"]);
    assert_eq!(c.sources[0].app, "obsidian");

    let plain = folder_with(&[(".obsidian/app.json", "not json")]);
    let c = of_folder(&plain.path().join("notes"));
    assert_eq!(value(&c.link_style).as_deref(), Some("wiki"));
    assert_eq!(value(&c.soft_breaks), Some(true));
    assert_eq!(value(&c.update_links).as_deref(), Some("always"));
    assert!(!soft_breaks_show(tempfile::tempdir().unwrap().path()));
}

#[test]
fn reads_templates_and_daily_notes_with_their_plugins_as_fallback() {
    let dir = folder_with(&[
        (".obsidian/app.json", "{}"),
        (
            ".obsidian/plugins/templater-obsidian/data.json",
            r#"{"templates_folder":"Meta/Templates"}"#,
        ),
        (
            ".obsidian/daily-notes.json",
            r#"{"folder":"Journal","format":"YYYY/MM-DD","template":"Meta/Day"}"#,
        ),
    ]);
    let root = dir.path();
    let c = of_folder(root);
    assert_eq!(
        value(&c.templates),
        Some(root.join("Meta/Templates").to_string_lossy().into_owned())
    );
    let daily = value(&c.daily).unwrap();
    assert_eq!(daily.folder, root.join("Journal").to_string_lossy());
    assert_eq!(daily.format, "YYYY/MM-DD");
    assert_eq!(
        daily.template.as_deref(),
        Some(&*root.join("Meta/Day.md").to_string_lossy())
    );
}

#[test]
fn reads_logseq_foam_and_our_own_settings() {
    let logseq = folder_with(&[(
        "logseq/config.edn",
        "{:journals-directory \"days\"\n :journal/file-name-format \"yyyy-MM-dd\"}",
    )]);
    let c = of_folder(logseq.path());
    let daily = value(&c.daily).unwrap();
    assert!(daily.folder.ends_with("days"));
    assert_eq!(daily.format, "YYYY-MM-DD");
    assert_eq!(value(&c.attachments).as_deref(), Some("assets"));

    let foam = folder_with(&[(
        ".vscode/settings.json",
        "{ // Foam\n \"foam.completion.linkFormat\": \"link\",\n \"markdown.preview.breaks\": true, }",
    )]);
    let c = of_folder(foam.path());
    assert_eq!(c.sources[0].app, "foam");
    assert_eq!(value(&c.link_style).as_deref(), Some("markdown"));
    assert_eq!(value(&c.soft_breaks), Some(true));

    // Ours stand over the vault's in the same folder.
    let ours = folder_with(&[
        (".obsidian/app.json", "{}"),
        (
            ".textus/settings.json",
            r#"{"conventions":{"linkStyle":"markdown","attachments":"./img"}}"#,
        ),
    ]);
    let c = of_folder(ours.path());
    assert_eq!(value(&c.link_style).as_deref(), Some("markdown"));
    assert_eq!(value(&c.link_path).as_deref(), Some("shortest"));
    assert_eq!(value(&c.attachments).as_deref(), Some("./img"));
}

#[test]
fn the_nearest_folder_decides_and_sites_say_where_slash_points() {
    let site = folder_with(&[
        ("mkdocs.yml", "site_name: x\ndocs_dir: pages\n"),
        (".git/HEAD", "x"),
    ]);
    let c = of_folder(&site.path().join("notes"));
    assert_eq!(
        value(&c.link_root),
        Some(site.path().join("pages").to_string_lossy().into_owned())
    );
    let hugo = folder_with(&[("hugo.toml", "baseURL = 'x'\n")]);
    assert!(value(&of_folder(hugo.path()).link_root)
        .unwrap()
        .ends_with("static"));
    // A vault inside a repository: the vault writes links, git keeps "/".
    let repo = folder_with(&[(".git/HEAD", "x"), ("notes/.obsidian/app.json", "{}")]);
    let c = of_folder(&repo.path().join("notes"));
    assert_eq!(c.notes_root(), Some(repo.path().join("notes")));
    assert_eq!(
        value(&c.link_root),
        Some(repo.path().to_string_lossy().into_owned())
    );
}

#[test]
fn puts_pictures_where_the_folder_keeps_attachments() {
    let cases = [
        ("{}", "", "../"),
        (r#"{"attachmentFolderPath":"./"}"#, "notes", ""),
        (r#"{"attachmentFolderPath":"./att"}"#, "notes/att", "att/"),
        (
            r#"{"attachmentFolderPath":"Files/img"}"#,
            "Files/img",
            "../Files/img/",
        ),
    ];
    for (app, dir, prefix) in cases {
        let vault = folder_with(&[(".obsidian/app.json", app)]);
        let doc = vault.path().join("notes/a.md");
        fs::write(&doc, "x").unwrap();
        let (folder, _) = attachment_folder(&doc).unwrap();
        assert_eq!(
            folder.dir,
            vault.path().join(dir).components().collect::<PathBuf>()
        );
        assert_eq!(folder.src("p.png"), format!("{prefix}p.png"), "{app}");
    }
    let escapes = folder_with(&[(".obsidian/app.json", r#"{"attachmentFolderPath":"../out"}"#)]);
    let doc = escapes.path().join("notes/a.md");
    fs::write(&doc, "x").unwrap();
    assert!(attachment_folder(&doc).is_none());
}

#[test]
fn follows_typora_copy_images_to_before_the_vault() {
    let vault = folder_with(&[(".obsidian/app.json", "{}")]);
    let doc = vault.path().join("notes/My Doc.md");
    fs::write(
        &doc,
        "---\r\ntitle: x\r\ntypora-copy-images-to: '../img/${filename}.assets'\r\n---\r\nbody",
    )
    .unwrap();
    let (folder, c) = attachment_folder(&doc).unwrap();
    assert_eq!(c.attachments.unwrap().app, "typora");
    assert_eq!(folder.dir, vault.path().join("img/My Doc.assets"));
    assert_eq!(folder.src("p.png"), "../img/My Doc.assets/p.png");
    let outside = tempfile::tempdir().unwrap();
    let plain = outside.path().join("a.md");
    fs::write(&plain, "no front matter\ntypora-copy-images-to: x").unwrap();
    assert!(attachment_folder(&plain).is_none());
}

#[test]
fn writes_an_embed_in_the_folders_link_form() {
    let vault = folder_with(&[(".obsidian/app.json", r#"{"newLinkFormat":"shortest"}"#)]);
    let doc = vault.path().join("notes/a.md");
    let file = vault.path().join("img/p.png");
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(&file, "x").unwrap();
    let mut c = of_folder(&vault.path().join("notes"));
    assert_eq!(wiki_embed(&c, &doc, &file).as_deref(), Some("![[p.png]]"));
    c.link_path.as_mut().unwrap().value = "relative".into();
    assert_eq!(
        wiki_embed(&c, &doc, &file).as_deref(),
        Some("![[../img/p.png]]")
    );
    c.link_path.as_mut().unwrap().value = "absolute".into();
    assert_eq!(
        wiki_embed(&c, &doc, &file).as_deref(),
        Some("![[img/p.png]]")
    );
    c.link_style.as_mut().unwrap().value = "markdown".into();
    assert_eq!(wiki_embed(&c, &doc, &file), None);
}

#[test]
fn never_writes_a_settings_file() {
    let dir = folder_with(&[
        (".obsidian/app.json", "{}"),
        ("logseq/config.edn", "{}"),
        (".vscode/settings.json", "{}"),
        (".textus/settings.json", "{}"),
    ]);
    let files = [
        ".obsidian/app.json",
        "logseq/config.edn",
        ".vscode/settings.json",
        ".textus/settings.json",
    ];
    let stamps = |d: &Path| files.map(|f| fs::metadata(d.join(f)).unwrap().modified().unwrap());
    let before = stamps(dir.path());
    let _ = of_folder(&dir.path().join("notes"));
    assert_eq!(stamps(dir.path()), before);
}
