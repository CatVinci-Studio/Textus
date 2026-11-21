use super::super::status;
use super::*;
use std::path::PathBuf;

fn state(granted: &[&str]) -> PluginsState {
    serde_json::from_value(serde_json::json!({
        "plugins": { "a.b": { "enabled": true, "granted": granted } }
    }))
    .unwrap()
}

fn list() -> PathBuf {
    PathBuf::from("/nowhere/git-trusted.json")
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

fn clone_of(remote: &Path, name: &str, into: &Path) -> PathBuf {
    let dir = into.join(name);
    git(into, &["clone", "-q", &remote.to_string_lossy(), name]);
    for args in [
        ["config", "user.email", "a@b.c"],
        ["config", "user.name", "A"],
        ["config", "commit.gpgsign", "false"],
        ["config", "pull.rebase", "false"],
    ] {
        git(&dir, &args);
    }
    dir
}

fn commit(dir: &Path, file: &str, text: &str) {
    std::fs::write(dir.join(file), text).unwrap();
    git(dir, &["add", file]);
    git(dir, &["commit", "-qm", file]);
}

/// A bare remote with one commit on main, and two clones of it.
fn remote() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let base = std::fs::canonicalize(tmp.path()).unwrap();
    let bare = base.join("remote.git");
    git(&base, &["init", "-q", "--bare", "-b", "main", "remote.git"]);
    let seed = clone_of(&bare, "seed", &base);
    commit(&seed, "a.md", "one\n");
    git(&seed, &["push", "-q", "origin", "main"]);
    let mine = clone_of(&bare, "mine", &base);
    let theirs = clone_of(&bare, "theirs", &base);
    (tmp, mine, theirs)
}

fn root(dir: &Path) -> String {
    dir.to_string_lossy().to_string()
}

const SYNC: &[&str] = &["files.read", "git.sync"];

#[test]
fn each_needs_git_sync() {
    let (_tmp, mine, _) = remote();
    let s = state(&["files.read", "git.commit"]);
    for call in [fetch, push, pull] {
        let err = call(&s, &list(), "a.b", &root(&mine)).unwrap_err();
        assert!(err.contains("git.sync"), "{err}");
    }
}

#[test]
fn push_sends_the_commits_status_counted_and_pull_brings_them() {
    let (_tmp, mine, theirs) = remote();
    commit(&mine, "b.md", "two\n");
    let s = state(SYNC);
    let before = status(&s, &list(), "a.b", &root(&mine)).unwrap().unwrap();
    assert_eq!(before.upstream.as_deref(), Some("origin/main"));
    assert_eq!((before.ahead, before.behind), (1, 0));
    push(&s, &list(), "a.b", &root(&mine)).unwrap();

    fetch(&s, &list(), "a.b", &root(&theirs)).unwrap();
    let behind = status(&s, &list(), "a.b", &root(&theirs)).unwrap().unwrap();
    assert_eq!((behind.ahead, behind.behind), (0, 1));
    pull(&s, &list(), "a.b", &root(&theirs)).unwrap();
    assert_eq!(
        std::fs::read_to_string(theirs.join("b.md")).unwrap(),
        "two\n"
    );
}

#[test]
fn a_branch_with_no_remote_branch_goes_to_origin_and_follows_it() {
    let (_tmp, mine, _) = remote();
    git(&mine, &["switch", "-q", "-c", "draft"]);
    commit(&mine, "c.md", "three\n");
    let s = state(SYNC);
    push(&s, &list(), "a.b", &root(&mine)).unwrap();
    let after = status(&s, &list(), "a.b", &root(&mine)).unwrap().unwrap();
    assert_eq!(after.upstream.as_deref(), Some("origin/draft"));
    assert_eq!(after.ahead, 0);
}

#[test]
fn a_pull_that_conflicts_is_undone_and_says_so() {
    let (_tmp, mine, theirs) = remote();
    commit(&theirs, "a.md", "theirs\n");
    git(&theirs, &["push", "-q", "origin", "main"]);
    commit(&mine, "a.md", "mine\n");
    let s = state(SYNC);
    let err = pull(&s, &list(), "a.b", &root(&mine)).unwrap_err();
    assert!(err.contains("conflict"), "{err}");
    assert_eq!(
        std::fs::read_to_string(mine.join("a.md")).unwrap(),
        "mine\n"
    );
    assert!(!mine.join(".git/MERGE_HEAD").exists());
}
