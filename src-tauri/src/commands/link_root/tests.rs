use super::*;
use std::fs;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("textus-link-root-{name}-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

#[test]
fn typora_root_url_wins_then_the_repository_then_the_vault() {
    let dir = scratch("order");
    let doc = dir.join("repo/vault/blog/post.md");
    fs::create_dir_all(dir.join("repo/.git")).unwrap();
    fs::create_dir_all(dir.join("repo/vault/.obsidian")).unwrap();
    write(&doc, "# Post\n");
    assert_eq!(link_root(&doc, None), Some(dir.join("repo")));
    write(&doc, "---\ntypora-root-url: ../site\n---\n# Post\n");
    fs::create_dir_all(dir.join("repo/vault/site")).unwrap();
    assert_eq!(
        link_root(&doc, None),
        Some(dir.join("repo/vault/blog/../site"))
    );
}

#[test]
fn a_vault_or_the_open_folder_serves_outside_a_repository() {
    let dir = scratch("vault");
    let doc = dir.join("v/notes/a.md");
    write(&doc, "text");
    assert_eq!(link_root(&doc, Some(&dir.join("v"))), Some(dir.join("v")));
    assert_eq!(link_root(&doc, None), None);
    fs::create_dir_all(dir.join("v/.obsidian")).unwrap();
    assert_eq!(link_root(&doc, None), Some(dir.join("v")));
}
