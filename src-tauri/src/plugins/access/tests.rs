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
fn plain_http_only_to_this_computer_or_an_address_the_user_types() {
    let named = grants(&["network:example.com", "network:localhost:23119"]);
    let ok = |u: &str| url_allowed(&named, &reqwest::Url::parse(u).unwrap());
    assert!(ok("https://example.com/x"));
    assert!(!ok("http://example.com/x"));
    assert!(ok("http://localhost:23119/api"));
    assert!(!ok("file:///etc/passwd"));
    let any = grants(&["network:*"]);
    let ok = |u: &str| url_allowed(&any, &reqwest::Url::parse(u).unwrap());
    assert!(ok("http://192.168.1.20:5005/dav"));
    assert!(ok("http://nas.example.com/dav"));
    assert!(ok("http://127.0.0.1:23119/api"));
    assert!(!ok("ftp://example.com/x"));
    assert!(!ok("file:///etc/passwd"));
}

#[test]
fn a_redirect_never_drops_from_https_to_http() {
    let url = |u: &str| reqwest::Url::parse(u).unwrap();
    let https = [url("https://nas.example.com/dav")];
    let http = [url("http://nas.example.com/dav")];
    assert!(downgrades(&https, &url("http://nas.example.com/dav/")));
    assert!(downgrades(
        &[http[0].clone(), https[0].clone()],
        &url("http://x/")
    ));
    assert!(!downgrades(&https, &url("https://other.example.com/")));
    assert!(!downgrades(&http, &url("http://nas.example.com/dav/")));
    assert!(!downgrades(&http, &url("https://nas.example.com/dav/")));
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
    assert!(in_folder(root.path(), Path::new(".obsidian/app.json")).is_ok());
    for shut in [
        ".obsidian/workspace.json",
        ".obsidian/community-plugins.json",
        ".obsidian/plugins/x/main.js",
        "sub/.obsidian/app.json",
    ] {
        assert!(in_folder(root.path(), Path::new(shut)).is_err(), "{shut}");
    }
    std::fs::create_dir_all(root.path().join(".textus/plugins/a.b")).unwrap();
    assert!(plugin_path(root.path(), Path::new(".textus/plugins/a.b/x.json"), "a.b").is_ok());
    assert!(plugin_path(root.path(), Path::new(".textus/plugins/a.b/x.json"), "c.d").is_err());
}

#[test]
fn three_secret_free_hidden_files_are_readable_and_nothing_else_in_git() {
    assert!(paths::read_only_hidden("/v", ".obsidian.vimrc"));
    assert!(paths::read_only_hidden("/v", "/v/.git/HEAD"));
    assert!(paths::read_only_hidden("/v", ".gitignore"));
    assert!(paths::read_only_hidden("C:\\v", "C:\\v\\.wakatime-project"));
    assert!(!paths::read_only_hidden("/v", ".git/config"));
    assert!(!paths::read_only_hidden("/v", ".env"));
    assert!(!paths::read_only_hidden("/v", "sub/.git/HEAD"));
}

#[cfg(unix)]
#[test]
fn a_hidden_file_granted_by_name_is_readable_and_only_that() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    std::fs::create_dir_all(root.join(".vitepress")).unwrap();
    std::fs::write(root.join(".vitepress/config.ts"), "export default {}").unwrap();
    std::fs::write(root.join(".env"), "TOKEN=x").unwrap();
    std::os::unix::fs::symlink(root.join(".env"), root.join(".vitepress/env.ts")).unwrap();
    let state: PluginsState = serde_json::from_value(serde_json::json!({
        "plugins": { "a.b": { "enabled": true, "granted": [
            "files.write",
            "hidden:.vitepress/config.ts",
            "hidden:.vitepress/env.ts",
        ] } }
    }))
    .unwrap();
    let at = |permission: &str, path: &str| {
        folder_path(&state, "a.b", permission, &root.to_string_lossy(), path)
    };
    assert!(at("files.read", ".vitepress/config.ts").is_ok());
    // Read only; not another plugin's grant; not through a link to .env.
    assert!(at("files.write", ".vitepress/config.ts").is_err());
    assert!(folder_path(
        &state,
        "c.d",
        "files.read",
        &root.to_string_lossy(),
        ".vitepress/config.ts"
    )
    .is_err());
    assert!(at("files.read", ".vitepress/env.ts").is_err());
    assert!(at("files.read", ".env").is_err());
}

#[test]
fn no_plugin_may_ask_for_a_file_that_holds_keys_or_tokens() {
    use super::paths::hidden_file_path;
    for ok in [
        ".vitepress/config.ts",
        ".obsidian/app.json",
        ".github/workflows/ci.yml",
    ] {
        assert!(hidden_file_path(ok), "{ok}");
    }
    for secret in [
        ".git/config",
        ".git-credentials",
        ".env.local",
        ".ssh/id_ed25519",
        ".config/gh/hosts.yml",
        ".cursor/mcp.json",
        ".mcp.json",
        ".zsh_history",
        ".vault-token",
        ".terraformrc",
        ".aws/credentials",
        ".certs/site.pem",
        "notes/visible.md",
        ".a/../b",
    ] {
        assert!(!hidden_file_path(secret), "{secret}");
    }
}

#[test]
fn a_plugin_may_trash_a_file_in_its_folder_but_not_the_folder() {
    let tmp = tempfile::tempdir().unwrap();
    let root = std::fs::canonicalize(tmp.path()).unwrap().join("notes");
    std::fs::create_dir_all(root.join("sub")).unwrap();
    std::fs::write(root.join("sub/a.md"), "a").unwrap();
    let state = |granted: &[&str]| -> PluginsState {
        serde_json::from_value(serde_json::json!({
            "plugins": { "a.b": { "enabled": true, "granted": granted } }
        }))
        .unwrap()
    };
    let writer = state(&["files.write"]);
    let folder = root.to_string_lossy();
    let at = |state: &PluginsState, path: &str| trash_path(state, "a.b", &folder, path);
    assert_eq!(at(&writer, "sub/a.md").unwrap(), root.join("sub/a.md"));
    assert!(at(&writer, "sub").is_ok());
    for shown in ["", ".", &folder] {
        let err = at(&writer, shown).unwrap_err();
        assert!(err.ends_with("[trashShownFolder]"), "{shown}: {err}");
    }
    assert!(at(&writer, "..").is_err());
    assert!(at(&state(&["files.read"]), "sub/a.md").is_err());
    assert!(at(&writer, ".env").is_err());
}
