#[test]
fn a_written_plugin_is_the_users_own() {
    assert_eq!(
        written_id(r#"{"id":"local.word-count"}"#).unwrap(),
        "local.word-count"
    );
    assert!(written_id(r#"{"id":"catvinci.tasks"}"#)
        .unwrap_err()
        .contains("someone else's"));
    assert!(written_id("{}").is_err());
}

#[test]
fn a_written_plugin_file_stays_inside_the_plugin() {
    assert!(super::plain_relative("host.js"));
    assert!(super::plain_relative("lib/view.js"));
    assert!(!super::plain_relative("../host.js"));
    assert!(!super::plain_relative("/etc/passwd"));
    assert!(!super::plain_relative(".hidden"));
    assert!(!super::plain_relative(""));
    assert!(!super::plain_relative("a\\b.js"));
}

use super::*;
use std::io::Write;

fn manifest(dir: &Path, id: &str) {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        dir.join(MANIFEST),
        format!(r#"{{"id":"{id}","version":"1.0.0","name":"X"}}"#),
    )
    .unwrap();
}

#[test]
fn a_manifest_needs_a_good_id_and_a_version() {
    let tmp = tempfile::tempdir().unwrap();
    manifest(tmp.path(), "a.b");
    assert_eq!(read_manifest(tmp.path()).unwrap().0.id, "a.b");
    manifest(tmp.path(), "../evil");
    assert!(read_manifest(tmp.path()).is_err());
    std::fs::write(tmp.path().join(MANIFEST), r#"{"id":"a.b","version":" "}"#).unwrap();
    assert!(read_manifest(tmp.path()).is_err());
}

#[test]
fn installing_checks_the_whole_manifest() {
    let tmp = tempfile::tempdir().unwrap();
    let good = r#"{"id":"a.b","version":"1.0.0","name":"X","publisher":"a",
        "engines":{"textus":"^1.3.0"},"permissions":["files.read"]}"#;
    std::fs::write(tmp.path().join(MANIFEST), good).unwrap();
    assert!(read_checked_manifest(tmp.path()).is_ok());
    let bad = good.replace("files.read", "shell");
    std::fs::write(tmp.path().join(MANIFEST), bad).unwrap();
    // Listed, so Settings can say what is wrong, but never installed.
    assert!(read_manifest(tmp.path()).is_ok());
    assert!(read_checked_manifest(tmp.path()).is_err_and(|e| e.contains("No permission")));
}

#[test]
fn a_package_may_hold_the_plugin_or_its_folder() {
    let tmp = tempfile::tempdir().unwrap();
    manifest(tmp.path(), "a.b");
    assert_eq!(plugin_dir_in(tmp.path()).unwrap(), tmp.path());
    let outer = tempfile::tempdir().unwrap();
    manifest(&outer.path().join("inner"), "a.b");
    assert_eq!(
        plugin_dir_in(outer.path()).unwrap(),
        outer.path().join("inner")
    );
    let empty = tempfile::tempdir().unwrap();
    assert!(plugin_dir_in(empty.path()).is_err());
}

#[test]
fn a_zip_naming_a_file_outside_itself_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("bad.textusplugin");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&file).unwrap());
    zip.start_file("../escape.txt", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(b"x").unwrap();
    zip.finish().unwrap();
    let out = tmp.path().join("out");
    assert!(unzip(&file, &out).is_err());
    assert!(!tmp.path().join("escape.txt").exists());
}

#[test]
fn a_zip_unpacks_its_files() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("ok.textusplugin");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&file).unwrap());
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file(MANIFEST, options).unwrap();
    zip.write_all(br#"{"id":"a.b","version":"1.0.0"}"#).unwrap();
    zip.start_file("dist/host.js", options).unwrap();
    zip.write_all(b"1").unwrap();
    zip.finish().unwrap();
    let out = tmp.path().join("out");
    unzip(&file, &out).unwrap();
    assert!(out.join("dist/host.js").is_file());
    assert_eq!(plugin_dir_in(&out).unwrap(), out);
}

#[test]
fn an_update_that_cannot_move_in_keeps_the_version_there() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("p");
    manifest(&target, "p");
    let aside = root.path().join(".p.old");
    assert!(swap_in(&root.path().join("missing"), &target, &aside).is_err());
    assert!(target.join(MANIFEST).is_file());
    assert!(!aside.exists());

    let new = root.path().join("new");
    manifest(&new, "p");
    std::fs::write(new.join("added"), "x").unwrap();
    swap_in(&new, &target, &aside).unwrap();
    assert!(target.join("added").is_file());
    assert!(!aside.exists() && !new.exists());
}
