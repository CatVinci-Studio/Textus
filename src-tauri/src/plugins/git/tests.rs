use super::*;

fn state(granted: &[&str]) -> PluginsState {
    serde_json::from_value(serde_json::json!({
        "plugins": { "a.b": { "enabled": true, "granted": granted } }
    }))
    .unwrap()
}

fn git(dir: &Path, args: &[&str]) {
    let ok = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap()
        .status
        .success();
    assert!(ok, "git {args:?}");
}

/// A repository with notes/a.md committed, renamed to notes/b.md and
/// committed again, then b.md changed, c.md new and .env changed.
fn repo() -> (tempfile::TempDir, String) {
    let tmp = tempfile::tempdir().unwrap();
    let top = std::fs::canonicalize(tmp.path()).unwrap();
    let root = top.join("notes");
    std::fs::create_dir_all(&root).unwrap();
    git(&top, &["init", "-q", "-b", "main"]);
    git(&top, &["config", "user.email", "a@b.c"]);
    git(&top, &["config", "user.name", "A"]);
    git(&top, &["config", "commit.gpgsign", "false"]);
    std::fs::write(root.join("a.md"), "one\n").unwrap();
    std::fs::write(root.join(".env"), "TOKEN=1\n").unwrap();
    git(&top, &["add", "."]);
    git(&top, &["commit", "-qm", "First"]);
    git(&top, &["mv", "notes/a.md", "notes/b.md"]);
    git(&top, &["commit", "-qm", "Renamed"]);
    std::fs::write(root.join("b.md"), "one\ntwo\n").unwrap();
    std::fs::write(root.join("c.md"), "new\n").unwrap();
    std::fs::write(root.join(".env"), "TOKEN=2\n").unwrap();
    let root = root.to_string_lossy().to_string();
    (tmp, root)
}

#[test]
fn status_names_the_branch_and_the_changes_but_no_hidden_file() {
    let (_tmp, root) = repo();
    let s = status(&state(&["files.read"]), "a.b", &root)
        .unwrap()
        .unwrap();
    assert_eq!(s.branch.as_deref(), Some("main"));
    let mut seen: Vec<(String, &str)> = s
        .changes
        .iter()
        .map(|c| (relative_name(&c.path), c.state.as_str()))
        .collect();
    seen.sort();
    assert_eq!(
        seen,
        vec![("b.md".into(), "modified"), ("c.md".into(), "untracked")]
    );
}

fn relative_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string()
}

#[cfg(unix)]
#[test]
fn paths_are_named_under_the_folder_as_given_not_its_real_path() {
    let (tmp, real_root) = repo();
    let link = tempfile::tempdir().unwrap();
    let root = link.path().join("linked");
    std::os::unix::fs::symlink(&real_root, &root).unwrap();
    let root = root.to_string_lossy().to_string();
    let s = state(&["files.read"]);
    let changes = status(&s, "a.b", &root).unwrap().unwrap().changes;
    assert!(
        changes.iter().all(|c| c.path.starts_with(&root)),
        "{changes:?}"
    );
    let b = format!("{root}/b.md");
    assert!(log(&s, "a.b", &root, &b, None).unwrap()[0]
        .path
        .starts_with(&root));
    drop(tmp);
}

#[test]
fn a_folder_in_no_repository_has_no_status() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().to_string_lossy().to_string();
    assert!(status(&state(&["files.read"]), "a.b", &root)
        .unwrap()
        .is_none());
}

#[test]
fn a_files_history_follows_renames_and_shows_each_version() {
    let (_tmp, root) = repo();
    let s = state(&["files.read"]);
    let b = format!("{root}/b.md");
    let commits = log(&s, "a.b", &root, &b, None).unwrap();
    let subjects: Vec<&str> = commits.iter().map(|c| c.subject.as_str()).collect();
    assert_eq!(subjects, ["Renamed", "First"]);
    assert!(commits[1].path.ends_with("a.md"));
    let first = &commits[1];
    assert_eq!(
        show(&s, "a.b", &root, &first.hash, &first.path)
            .unwrap()
            .as_deref(),
        Some("one\n")
    );
    // Not a file of that commit; not a hash; not a hidden file.
    assert_eq!(show(&s, "a.b", &root, &first.hash, &b).unwrap(), None);
    assert!(show(&s, "a.b", &root, "--output=x", &b).is_err());
    assert!(show(&s, "a.b", &root, &first.hash, &format!("{root}/.env")).is_err());
    assert!(log(&s, "a.b", &root, &format!("{root}/.env"), None).is_err());
}

#[test]
fn reading_history_needs_files_read() {
    let (_tmp, root) = repo();
    assert!(log(&state(&[]), "a.b", &root, &format!("{root}/b.md"), None).is_err());
}

#[test]
fn a_commit_takes_the_named_files_only_and_needs_its_grant() {
    let (_tmp, root) = repo();
    let b = format!("{root}/b.md");
    let c = format!("{root}/c.md");
    assert!(commit(&state(&["files.read"]), "a.b", &root, "Add c", std::slice::from_ref(&c)).is_err());
    let s = state(&["files.read", "git.commit"]);
    assert!(commit(&s, "a.b", &root, "Hidden", &[format!("{root}/.env")]).is_err());
    let hash = commit(
        &s,
        "a.b",
        &root,
        "Add c\n\nWith a body.",
        std::slice::from_ref(&c),
    )
    .unwrap();
    assert!(is_hash(&hash));
    assert_eq!(log(&s, "a.b", &root, &c, None).unwrap()[0].subject, "Add c");
    let left: Vec<String> = status(&s, "a.b", &root)
        .unwrap()
        .unwrap()
        .changes
        .into_iter()
        .map(|c| c.path)
        .collect();
    assert_eq!(left, vec![b]);
}
