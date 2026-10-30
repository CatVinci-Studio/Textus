use super::*;

#[test]
fn a_readme_is_in_the_language_asked_for_its_base_or_english() {
    let readme: std::collections::BTreeMap<String, String> =
        [("en", "en.md"), ("zh", "zh.md"), ("zh-Hant", "hant.md")]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
    assert_eq!(readme_for(&readme, "zh-Hant").as_deref(), Some("hant.md"));
    assert_eq!(readme_for(&readme, "zh").as_deref(), Some("zh.md"));
    assert_eq!(readme_for(&readme, "ja").as_deref(), Some("en.md"));
    assert_eq!(readme_for(&Default::default(), "en"), None);
}

#[test]
fn a_plugin_s_readme_and_icon_come_only_from_the_catalog_s_address() {
    let ok = format!("{PACKAGE_PREFIX}catalog/readme-a.b.en.md");
    let text = format!(
        r#"{{"schema": 1, "plugins": [{{"id": "a.b", "version": "0.1.1", "manifest": {{}}, "url": "{PACKAGE_PREFIX}a.b-v0.1.1/a.b-0.1.1.zip", "sha256": "ab", "size": 1, "readme": {{"en": "{ok}", "zh": "https://example.com/x.md"}}, "icon": "https://example.com/i.svg", "installs": 12, "installs30": 3}}]}}"#
    );
    let (plugins, _) = parse_all(&text).unwrap();
    assert_eq!(plugins[0].readme.keys().collect::<Vec<_>>(), ["en"]);
    assert_eq!(plugins[0].icon, None);
    assert_eq!(plugins[0].installs, Some(12));
    assert_eq!(plugins[0].installs30, Some(3));
}

#[test]
fn the_catalog_lists_skills_beside_plugins_and_an_older_one_none() {
    let url = format!("{PACKAGE_PREFIX}catalog/skill-press-release.md");
    let text = format!(
        r#"{{"schema": 1, "plugins": [], "skills": [{{"name": "press-release", "version": "1.0.0", "description": "Writes a press release.", "url": "{url}", "sha256": "ab", "size": 10, "installs": 4}}, {{"name": "elsewhere", "version": "1", "description": "x", "url": "https://example.com/x.md", "sha256": "ab", "size": 10}}]}}"#
    );
    let (_, skills) = parse_all(&text).unwrap();
    assert_eq!(skills.len(), 1, "only from the catalog's own address");
    assert_eq!(skills[0].name, "press-release");
    assert_eq!((skills[0].installs, skills[0].installs30), (Some(4), None));
    let (_, none) = parse_all(r#"{"schema": 1, "plugins": []}"#).unwrap();
    assert!(none.is_empty());
}

#[test]
fn a_skill_installs_once_and_never_over_one_there() {
    let dir = tempfile::tempdir().unwrap();
    let text = "---\nname: press-release\ndescription: Writes a press release.\n---\n\nWrite it as a press release.";
    let path = install_skill_in(dir.path(), "press-release", text).unwrap();
    assert!(path.exists());
    assert_eq!(
        install_skill_in(dir.path(), "press-release", text).unwrap_err(),
        SKILL_EXISTS
    );
    assert!(install_skill_in(dir.path(), "empty", "---\nname: empty\n---\n").is_err());
}

fn entry(bytes: &[u8]) -> CatalogEntry {
    CatalogEntry {
        id: "catvinci.tasks".into(),
        version: "1.0.0".into(),
        official: true,
        manifest: Value::Null,
        url: format!("{PACKAGE_PREFIX}catvinci.tasks-v1.0.0/catvinci.tasks-1.0.0.zip"),
        sha256: hex(&Sha256::digest(bytes)),
        size: bytes.len() as u64,
        ..Default::default()
    }
}

#[test]
fn a_screenshot_from_anywhere_else_is_left_out() {
    let text = format!(
        r#"{{"schema": 1, "plugins": [{{"id": "catvinci.tasks", "version": "1.0.0", "manifest": null, "url": "{PACKAGE_PREFIX}t/t.zip", "sha256": "ab", "size": 1, "screenshots": ["{PACKAGE_PREFIX}catalog/shot-catvinci.tasks-1.png", "https://example.com/x.png"]}}]}}"#
    );
    let (plugins, _) = parse_all(&text).unwrap();
    assert_eq!(
        plugins[0].screenshots,
        vec![format!("{PACKAGE_PREFIX}catalog/shot-catvinci.tasks-1.png")]
    );
}

#[test]
fn a_package_must_be_the_one_the_catalog_lists() {
    let good = b"the package";
    assert!(checked(&entry(good), good).is_ok());
    assert!(checked(&entry(good), b"the packagE")
        .unwrap_err()
        .contains("isn't the package"));
    assert!(checked(&entry(good), b"short")
        .unwrap_err()
        .contains("bytes"));
}

/// The published catalog, and one package from it, through the same checks an
/// install uses. Needs the network.
#[test]
#[ignore = "network: the published catalog"]
fn the_published_catalog_and_its_packages_check_out() {
    tauri::async_runtime::block_on(async {
        let entries = parse(&fetch().await.expect("the catalog")).expect("readable");
        assert!(entries.len() >= 11, "{} plugins", entries.len());
        let tasks = entries.iter().find(|e| e.id == "catvinci.tasks").unwrap();
        assert!(tasks.official);
        let bytes = client()
            .unwrap()
            .get(&tasks.url)
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        checked(tasks, &bytes).expect("the package the catalog lists");
    });
}

#[test]
fn the_catalog_keeps_only_packages_from_its_own_releases() {
    let text = serde_json::json!({
        "schema": 1,
        "plugins": [
            {"id": "catvinci.tasks", "version": "1.0.0", "official": true, "manifest": {},
             "url": format!("{PACKAGE_PREFIX}catvinci.tasks-v1.0.0/a.zip"), "sha256": "00", "size": 1},
            {"id": "someone.else", "version": "1.0.0", "manifest": {},
             "url": "https://example.com/else.zip", "sha256": "00", "size": 1},
            {"id": "../escape", "version": "1.0.0", "manifest": {},
             "url": format!("{PACKAGE_PREFIX}x/x.zip"), "sha256": "00", "size": 1}
        ]
    })
    .to_string();
    let entries = parse(&text).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].id, "catvinci.tasks");
    assert!(parse(r#"{"schema": 2, "plugins": []}"#)
        .unwrap_err()
        .contains("newer Textus"));
}

/// A package through the install counter and on to GitHub, as an install
/// fetches it. Needs the network and a counter: TEXTUS_EXT_STATS set to
/// `wrangler dev`'s (services/ext-stats/README.md).
#[test]
#[ignore = "network: the published catalog and a local install counter"]
fn a_package_comes_through_the_install_counter() {
    let base = std::env::var("TEXTUS_EXT_STATS").expect("TEXTUS_EXT_STATS");
    tauri::async_runtime::block_on(async {
        let entries = parse(&fetch().await.expect("the catalog")).expect("readable");
        let tasks = entries.iter().find(|e| e.id == "catvinci.tasks").unwrap();
        let package = ext_stats::Download {
            kind: ext_stats::Kind::Plugin,
            id: &tasks.id,
            version: &tasks.version,
            update: false,
            present: false,
            direct: &tasks.url,
        };
        let url = ext_stats::download_url(&base, &package, ext_stats::Event::Install).unwrap();
        let client = client_with(ext_stats::redirects(&tasks.url, download_host)).unwrap();
        let bytes = download_with(client, &url, "tasks")
            .await
            .expect("redirected");
        checked(tasks, &bytes).expect("the package the catalog lists");
    });
}
