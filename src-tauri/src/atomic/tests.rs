use super::*;

#[test]
fn temp_files_are_unique_private_and_removed_on_drop() {
    let a = TempFile::create("textus-test-", ".html", "<p>a</p>").unwrap();
    let b = TempFile::create("textus-test-", ".html", "<p>b</p>").unwrap();
    assert_ne!(a.path(), b.path());
    assert_eq!(std::fs::read_to_string(a.path()).unwrap(), "<p>a</p>");
    let name = a.path().file_name().unwrap().to_str().unwrap();
    assert!(name.starts_with("textus-test-") && name.ends_with(".html"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(a.path()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
    let path = a.path().to_path_buf();
    drop(a);
    assert!(!path.exists());
}

#[test]
fn temp_dirs_are_unique_private_and_removed_on_drop() {
    let mut a = TempDir::create("textus-test-").unwrap();
    let b = TempDir::create("textus-test-").unwrap();
    assert_ne!(a.path, b.path);
    let file = a.write_file("shot.png", "png").unwrap();
    assert_eq!(file, a.path.join("shot.png"));
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "png");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&a.path), 0o700);
        assert_eq!(mode(&file), 0o600);
    }
    let dir = a.path.clone();
    drop(a);
    assert!(!file.exists() && !dir.exists());
}

#[test]
fn a_temp_dir_never_reuses_what_is_already_there() {
    let mut temp = TempDir::create("textus-test-").unwrap();
    assert_eq!(
        create_private_dir(&temp.path).unwrap_err().kind(),
        std::io::ErrorKind::AlreadyExists
    );
    temp.write_file("shot.png", "one").unwrap();
    let again = temp.write_file("shot.png", "two").unwrap_err();
    assert_eq!(again.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(
        temp.write_file("../shot.png", "x").unwrap_err().kind(),
        std::io::ErrorKind::InvalidInput
    );
}

// Unix only: symlinks.
#[cfg(unix)]
#[test]
fn a_planted_symlink_is_not_followed() {
    let temp = TempDir::create("textus-test-").unwrap();
    let target = temp.path.join("target");
    let planted = temp.path.join("planted");
    std::os::unix::fs::symlink(&target, &planted).unwrap();
    assert!(create_private_dir(&planted).is_err());
    assert!(create_private_file(&planted).is_err());
    assert!(!target.exists());
    std::fs::remove_file(&planted).unwrap();
}

fn scratch_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("textus-atomic-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn leftovers(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".tmp"))
        .collect()
}

#[test]
fn replaces_the_target_and_leaves_no_temp_file() {
    let dir = scratch_dir("sync");
    let path = dir.join("doc.md");
    write_sync(&path, "one").unwrap();
    write_sync(&path, "two").unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "two");
    assert!(leftovers(&dir).is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_failed_write_cleans_up_its_temp_file() {
    let dir = scratch_dir("fail");
    // Renaming a file over a non-empty directory fails on every OS.
    let target = dir.join("taken");
    std::fs::create_dir_all(target.join("inside")).unwrap();
    assert!(write_sync(&target, "x").is_err());
    assert!(leftovers(&dir).is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn the_async_writer_writes_too() {
    let dir = scratch_dir("async");
    let path = dir.join("draft.json");
    write(&path, b"{}").await.unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
    assert!(leftovers(&dir).is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

// Unix only: modes and symlinks.
#[cfg(unix)]
#[test]
fn a_replaced_file_keeps_its_mode_and_a_read_only_one_is_refused() {
    use std::os::unix::fs::PermissionsExt;
    let dir = scratch_dir("mode");
    let shared = dir.join("shared.md");
    std::fs::write(&shared, "one").unwrap();
    std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o664)).unwrap();
    write_sync(&shared, "two").unwrap();
    assert_eq!(std::fs::read_to_string(&shared).unwrap(), "two");
    let mode = std::fs::metadata(&shared).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o664, "the mode it had, not the default");

    let locked = dir.join("locked.md");
    std::fs::write(&locked, "keep").unwrap();
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o444)).unwrap();
    let err = write_sync(&locked, "lost").unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
    assert_eq!(std::fs::read_to_string(&locked).unwrap(), "keep");
    assert!(leftovers(&dir).is_empty());
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o644)).unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_symlink_is_written_through_not_replaced() {
    let dir = scratch_dir("link");
    let real = dir.join("real.md");
    let link = dir.join("link.md");
    std::fs::write(&real, "one").unwrap();
    std::os::unix::fs::symlink(&real, &link).unwrap();
    write_sync(&link, "two").unwrap();
    assert!(std::fs::symlink_metadata(&link)
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(std::fs::read_to_string(&real).unwrap(), "two");
    let _ = std::fs::remove_dir_all(&dir);
}

// Unix only: what it checks is the file mode, which Windows doesn't have.
#[cfg(unix)]
#[test]
fn secrets_are_owner_only_and_replace_atomically() {
    use std::os::unix::fs::PermissionsExt;
    let path = std::env::temp_dir().join(format!("textus-secret-{}.json", std::process::id()));
    write_secret_sync(&path, "one").unwrap();
    write_secret_sync(&path, "two").unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "two");
    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn a_move_renames_and_never_goes_over_what_is_there() {
    let dir = scratch_dir("move-entry");
    let from = dir.join("notes");
    std::fs::create_dir_all(from.join("inner")).unwrap();
    std::fs::write(from.join("inner/a.md"), "a").unwrap();
    let taken = dir.join("taken");
    std::fs::create_dir(&taken).unwrap();
    std::fs::write(taken.join("keep.md"), "keep").unwrap();
    // A folder there already: nothing moves, nothing of it goes.
    assert!(move_entry(&from, &taken).is_err());
    assert_eq!(
        std::fs::read_to_string(taken.join("keep.md")).unwrap(),
        "keep"
    );
    assert!(from.join("inner/a.md").exists());
    let to = dir.join("moved");
    move_entry(&from, &to).unwrap();
    assert_eq!(std::fs::read_to_string(to.join("inner/a.md")).unwrap(), "a");
    assert!(!from.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_copy_across_disks_keeps_links_as_links() {
    let dir = scratch_dir("copy-entry");
    let from = dir.join("from");
    std::fs::create_dir(&from).unwrap();
    std::fs::write(from.join("a.md"), "a").unwrap();
    std::os::unix::fs::symlink("a.md", from.join("link.md")).unwrap();
    let to = dir.join("to");
    copy_entry(&from, &to).unwrap();
    assert_eq!(std::fs::read_to_string(to.join("a.md")).unwrap(), "a");
    let link = std::fs::symlink_metadata(to.join("link.md")).unwrap();
    assert!(link.file_type().is_symlink());
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_copy_set_aside_across_disks_leaves_the_original() {
    let dir = scratch_dir("copy-aside");
    let from = dir.join("from");
    std::fs::create_dir(&from).unwrap();
    std::fs::write(from.join("a.md"), "a").unwrap();
    std::os::unix::fs::symlink("a.md", from.join("link.md")).unwrap();
    let to = dir.join("to");
    copy_aside(&from, &to).unwrap();
    assert!(std::fs::symlink_metadata(to.join("link.md"))
        .unwrap()
        .file_type()
        .is_symlink());
    // No Trash in tests: the original stays as it was.
    assert_eq!(std::fs::read_to_string(from.join("a.md")).unwrap(), "a");
    let _ = std::fs::remove_dir_all(&dir);
}
