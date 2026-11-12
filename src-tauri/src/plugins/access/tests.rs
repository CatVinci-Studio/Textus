use super::*;

fn grants(list: &[&str]) -> Vec<String> {
    list.iter().map(|g| g.to_string()).collect()
}

#[test]
fn a_path_must_stay_in_the_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("notes");
    std::fs::create_dir_all(root.join("sub")).unwrap();
    std::fs::write(root.join("sub/a.md"), "a").unwrap();
    assert!(inside(&root, Path::new("sub/a.md")).is_ok());
    assert!(inside(&root, &root.join("Daily/2026-10-21.md")).is_ok());
    assert!(inside(&root, Path::new("../secret")).is_err());
    assert!(inside(&root, &tmp.path().join("elsewhere.md")).is_err());
}

#[cfg(unix)]
#[test]
fn a_link_out_of_the_folder_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("notes");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(tmp.path().join("secret.txt"), "s").unwrap();
    std::os::unix::fs::symlink(tmp.path(), root.join("out")).unwrap();
    assert!(inside(&root, Path::new("out/secret.txt")).is_err());
}

#[test]
fn hosts_match_their_grants() {
    let g = grants(&[
        "network:api.zotero.org",
        "network:*.wikipedia.org",
        "network:localhost:23119",
    ]);
    assert!(host_allowed(&g, "api.zotero.org", Some(443)));
    assert!(host_allowed(&g, "en.wikipedia.org", Some(443)));
    assert!(host_allowed(&g, "wikipedia.org", Some(443)));
    assert!(!host_allowed(&g, "evil-wikipedia.org", Some(443)));
    assert!(host_allowed(&g, "localhost", Some(23119)));
    assert!(!host_allowed(&g, "localhost", Some(8080)));
    assert!(!host_allowed(&g, "example.com", Some(443)));
    assert!(host_allowed(
        &grants(&["network:*"]),
        "example.com",
        Some(443)
    ));
}

#[test]
fn plain_http_only_to_this_computer() {
    let g = grants(&["network:*"]);
    let ok = |u: &str| url_allowed(&g, &reqwest::Url::parse(u).unwrap());
    assert!(ok("https://example.com/x"));
    assert!(!ok("http://example.com/x"));
    assert!(ok("http://localhost:23119/api"));
    assert!(ok("http://127.0.0.1:23119/api"));
    assert!(!ok("file:///etc/passwd"));
}

#[test]
fn a_plugin_reaches_no_hidden_file_but_the_folders_own_settings() {
    let root = tempfile::tempdir().unwrap();
    for hidden in [
        ".git/hooks/post-commit",
        ".git/config",
        "notes/.vscode/tasks.json",
        ".env",
        ".obsidian/plugins/x/data.json",
    ] {
        assert!(
            in_folder(root.path(), Path::new(hidden)).is_err(),
            "{hidden}"
        );
    }
    assert!(in_folder(root.path(), Path::new("notes/a.md")).is_ok());
    assert!(in_folder(root.path(), Path::new(".textus/sync.json")).is_ok());
    std::fs::create_dir_all(root.path().join(".textus/plugins/a.b")).unwrap();
    assert!(plugin_path(root.path(), Path::new(".textus/plugins/a.b/x.json"), "a.b").is_ok());
    assert!(plugin_path(root.path(), Path::new(".textus/plugins/a.b/x.json"), "c.d").is_err());
}

#[test]
fn three_secret_free_hidden_files_are_readable_and_nothing_else_in_git() {
    assert!(paths::read_only_hidden("/v", ".obsidian.vimrc"));
    assert!(paths::read_only_hidden("/v", "/v/.git/HEAD"));
    assert!(paths::read_only_hidden("C:\\v", "C:\\v\\.wakatime-project"));
    assert!(!paths::read_only_hidden("/v", ".git/config"));
    assert!(!paths::read_only_hidden("/v", ".env"));
    assert!(!paths::read_only_hidden("/v", "sub/.git/HEAD"));
}
