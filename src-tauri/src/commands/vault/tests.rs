use super::*;
use std::fs;

/// A throwaway folder under the system temp dir, removed when dropped.
struct Scratch(PathBuf);

impl Scratch {
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        // Only ever a folder this module made under the temp dir.
        if self.0.starts_with(std::env::temp_dir()) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

fn tempdir(name: &str) -> Scratch {
    let dir = std::env::temp_dir().join(format!("textus-vault-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    // Canonical, so paths compare equal to resolved ones on macOS
    // (/var is /private/var).
    Scratch(dir.canonicalize().unwrap())
}

fn touch(root: &Path, rel: &str) -> PathBuf {
    let path = root.join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, b"x").unwrap();
    path
}

fn resolve(doc: &Path, link: &str) -> Option<PathBuf> {
    resolve_with(doc, None, link, LinkKind::Image, true, &mut |root, _| {
        Arc::new(index_vault(root))
    })
}

fn resolve_note(doc: &Path, link: &str) -> Option<PathBuf> {
    resolve_with(doc, None, link, LinkKind::Note, true, &mut |root, _| {
        Arc::new(index_vault(root))
    })
}

#[test]
fn a_wikilink_finds_the_note_in_the_same_folder_first() {
    let dir = tempdir("a_wikilink_finds_the_note_in_the_same_folder_first");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "notes/a.md");
    let near = touch(dir.path(), "notes/Page.md");
    touch(dir.path(), "Page.md");
    assert_eq!(resolve_note(&doc, "Page"), Some(near.clone()));
    assert_eq!(resolve_note(&doc, "Page.md"), Some(near));
}

#[test]
fn a_wikilink_finds_a_note_anywhere_in_the_vault_by_name() {
    let dir = tempdir("a_wikilink_finds_a_note_anywhere_in_the_vault_by_name");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "a.md");
    let page = touch(dir.path(), "deep/down/Page.md");
    assert_eq!(resolve_note(&doc, "page"), Some(page.clone()));
    assert_eq!(resolve_note(&doc, "down/Page"), Some(page));
    assert_eq!(resolve_note(&doc, "Missing"), None);
}

#[test]
fn a_wikilink_to_a_picture_or_a_pdf_finds_the_file() {
    let dir = tempdir("a_wikilink_to_a_picture_or_a_pdf_finds_the_file");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "a.md");
    let pic = touch(dir.path(), "pics/pic.png");
    let pdf = touch(dir.path(), "docs/paper.pdf");
    assert_eq!(resolve_note(&doc, "pic.png"), Some(pic));
    assert_eq!(resolve_note(&doc, "paper.pdf"), Some(pdf));
}

#[derive(serde::Deserialize)]
struct CaseTable {
    files: Vec<String>,
    cases: Vec<Case>,
}

#[derive(serde::Deserialize)]
struct Case {
    name: String,
    from: String,
    note: String,
    wiki: bool,
    expect: Option<String>,
}

#[test]
fn links_resolve_as_the_shared_case_table_says() {
    let table: CaseTable = serde_json::from_str(include_str!(
        "../../../../src/plugins/workspace/link-resolve.cases.json"
    ))
    .unwrap();
    let dir = tempdir("links_resolve_as_the_shared_case_table_says");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    for file in &table.files {
        touch(dir.path(), file);
    }
    for case in &table.cases {
        let found = resolve_with(
            &dir.path().join(&case.from),
            None,
            &case.note,
            LinkKind::Note,
            case.wiki,
            &mut |root, _| Arc::new(index_vault(root)),
        );
        let want = case.expect.as_ref().map(|rel| dir.path().join(rel));
        assert_eq!(found, want, "{}", case.name);
    }
}

#[test]
fn a_missing_note_is_created_where_the_vault_puts_new_notes() {
    let dir = tempdir("a_missing_note_is_created_where_the_vault_puts_new_notes");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "notes/a.md");
    let new = |link: &str, wiki: bool| new_note_path(&doc, None, link, wiki);
    assert_eq!(new("Idea", true), Some(dir.path().join("Idea.md")));
    assert_eq!(new("sub/Idea", true), Some(dir.path().join("sub/Idea.md")));
    assert_eq!(new("Idea", false), Some(dir.path().join("notes/Idea.md")));
    fs::write(
        dir.path().join(".obsidian/app.json"),
        r#"{"newFileLocation":"folder","newFileFolderPath":"Inbox"}"#,
    )
    .unwrap();
    assert_eq!(new("Idea", true), Some(dir.path().join("Inbox/Idea.md")));
    fs::write(
        dir.path().join(".obsidian/app.json"),
        r#"{"newFileLocation":"current"}"#,
    )
    .unwrap();
    assert_eq!(new("Idea", true), Some(dir.path().join("notes/Idea.md")));
    assert_eq!(new("../../out", true), None);
}

#[test]
fn outside_a_vault_a_new_note_goes_beside_the_document() {
    let dir = tempdir("outside_a_vault_a_new_note_goes_beside_the_document");
    let doc = touch(dir.path(), "notes/a.md");
    assert_eq!(
        new_note_path(&doc, Some(dir.path()), "Idea", true),
        Some(dir.path().join("notes/Idea.md"))
    );
}

#[test]
fn a_link_from_slash_is_read_from_the_repository() {
    let dir = tempdir("a_link_from_slash_is_read_from_the_repository");
    fs::create_dir_all(dir.path().join(".git")).unwrap();
    let doc = touch(dir.path(), "docs/guide/a.md");
    let image = touch(dir.path(), "assets/logo.png");
    let note = touch(dir.path(), "docs/b.md");
    assert_eq!(resolve(&doc, "/assets/logo.png"), Some(image));
    let found = resolve_with(
        &doc,
        None,
        "/docs/b",
        LinkKind::Note,
        false,
        &mut |root, _| Arc::new(index_vault(root)),
    );
    assert_eq!(found, Some(note));
}

#[test]
fn the_vault_is_the_nearest_folder_with_dot_obsidian() {
    let dir = tempdir("the_vault_is_the_nearest_folder_with_dot_obsidian");
    let vault = dir.path().join("vault");
    fs::create_dir_all(vault.join(".obsidian")).unwrap();
    let doc = touch(&vault, "notes/deep/a.md");
    assert_eq!(vault_root(&doc, None), Some(vault));
}

#[test]
fn without_dot_obsidian_the_documents_folder_is_the_vault() {
    let dir = tempdir("without_dot_obsidian_the_documents_folder_is_the_vault");
    let doc = touch(dir.path(), "notes/a.md");
    assert_eq!(vault_root(&doc, None), Some(dir.path().join("notes")));
}

#[test]
fn without_dot_obsidian_the_open_folder_holding_the_document_is_the_vault() {
    let dir = tempdir("without_dot_obsidian_the_open_folder_holding_the_document_is_the_vault");
    let doc = touch(dir.path(), "notes/deep/a.md");
    let other = touch(dir.path(), "people/Ann.md");
    assert_eq!(
        vault_root(&doc, Some(dir.path())),
        Some(dir.path().to_path_buf())
    );
    let found = resolve_with(
        &doc,
        Some(dir.path()),
        "Ann",
        LinkKind::Note,
        true,
        &mut |root, _| Arc::new(index_vault(root)),
    );
    assert_eq!(found, Some(other));
    // A folder the document isn't in is no vault for it.
    let elsewhere = dir.path().join("people");
    assert_eq!(
        vault_root(&doc, Some(&elsewhere)),
        Some(dir.path().join("notes/deep"))
    );
}

#[test]
fn a_path_with_a_folder_is_read_from_the_vault_root() {
    let dir = tempdir("a_path_with_a_folder_is_read_from_the_vault_root");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "notes/a.md");
    let image = touch(dir.path(), "attachments/x.gif");
    assert_eq!(resolve(&doc, "attachments/x.gif"), Some(image));
}

#[test]
fn a_path_relative_to_the_document_resolves_too() {
    let dir = tempdir("a_path_relative_to_the_document_resolves_too");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "notes/a.md");
    let image = touch(dir.path(), "notes/img/x.png");
    assert_eq!(resolve(&doc, "img/x.png"), Some(image.clone()));
    assert_eq!(resolve(&doc, "./img/x.png"), Some(image));
}

#[test]
fn a_bare_name_is_found_anywhere_in_the_vault() {
    let dir = tempdir("a_bare_name_is_found_anywhere_in_the_vault");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "notes/a.md");
    let image = touch(dir.path(), "z/attachments/2024/Pasted image 1.png");
    assert_eq!(resolve(&doc, "Pasted image 1.png"), Some(image.clone()));
    // Obsidian matches names without case.
    assert_eq!(resolve(&doc, "pasted IMAGE 1.png"), Some(image));
}

#[test]
fn of_two_files_with_one_name_the_one_nearest_the_document_wins() {
    let dir = tempdir("of_two_files_with_one_name_the_one_nearest_the_document_wins");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "projects/alpha/a.md");
    touch(dir.path(), "x.png");
    touch(dir.path(), "projects/beta/x.png");
    let near = touch(dir.path(), "projects/alpha/assets/x.png");
    assert_eq!(resolve(&doc, "x.png"), Some(near));
}

#[test]
fn of_two_equally_near_files_the_shorter_path_wins() {
    let dir = tempdir("of_two_equally_near_files_the_shorter_path_wins");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "a.md");
    touch(dir.path(), "long-folder/x.png");
    let short = touch(dir.path(), "b/x.png");
    assert_eq!(resolve(&doc, "x.png"), Some(short));
}

#[test]
fn a_partial_path_matches_the_tail_of_a_longer_one() {
    let dir = tempdir("a_partial_path_matches_the_tail_of_a_longer_one");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "a.md");
    touch(dir.path(), "one/x.png");
    let wanted = touch(dir.path(), "two/sub/x.png");
    assert_eq!(resolve(&doc, "sub/x.png"), Some(wanted));
}

#[test]
fn a_missing_file_resolves_to_nothing() {
    let dir = tempdir("a_missing_file_resolves_to_nothing");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "a.md");
    assert_eq!(resolve(&doc, "nope.png"), None);
    assert_eq!(resolve(&doc, "attachments/nope.png"), None);
}

#[test]
fn a_note_embed_is_not_an_image() {
    let dir = tempdir("a_note_embed_is_not_an_image");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "a.md");
    touch(dir.path(), "Other.md");
    assert_eq!(resolve(&doc, "Other.md"), None);
    assert_eq!(resolve(&doc, "Other"), None);
}

#[test]
fn a_link_never_leaves_the_vault() {
    let dir = tempdir("a_link_never_leaves_the_vault");
    let vault = dir.path().join("vault");
    fs::create_dir_all(vault.join(".obsidian")).unwrap();
    let doc = touch(&vault, "notes/a.md");
    touch(dir.path(), "secret.png");
    assert_eq!(resolve(&doc, "../../secret.png"), None);
    assert_eq!(resolve(&doc, "notes/../../secret.png"), None);
    let absolute = dir.path().join("secret.png");
    assert_eq!(resolve(&doc, &absolute.to_string_lossy()), None);
}

#[cfg(unix)]
#[test]
fn a_symlink_out_of_the_vault_is_not_followed() {
    let dir = tempdir("a_symlink_out_of_the_vault_is_not_followed");
    let vault = dir.path().join("vault");
    fs::create_dir_all(vault.join(".obsidian")).unwrap();
    let doc = touch(&vault, "a.md");
    let outside = touch(dir.path(), "outside/secret.png");
    std::os::unix::fs::symlink(&outside, vault.join("link.png")).unwrap();
    assert_eq!(resolve(&doc, "link.png"), None);
}

#[test]
fn hidden_folders_and_node_modules_are_not_indexed() {
    let dir = tempdir("hidden_folders_and_node_modules_are_not_indexed");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    touch(dir.path(), ".obsidian/plugins/p/icon.png");
    touch(dir.path(), ".trash/old.png");
    touch(dir.path(), "node_modules/pkg/logo.png");
    touch(dir.path(), "notes/kept.png");
    touch(dir.path(), "notes/readme.md");
    touch(dir.path(), "notes/data.csv");
    let mut indexed = index_vault(dir.path());
    indexed.sort();
    assert_eq!(
        indexed,
        vec![
            "notes/data.csv".to_string(),
            "notes/kept.png".to_string(),
            "notes/readme.md".to_string()
        ]
    );
}

#[test]
fn a_new_file_is_found_after_a_miss_rebuilds_the_index() {
    let dir = tempdir("a_new_file_is_found_after_a_miss_rebuilds_the_index");
    fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
    let doc = touch(dir.path(), "a.md");
    let stale = Arc::new(Vec::new());
    let mut asked_fresh = false;
    let image = touch(dir.path(), "late/new.png");
    let found = resolve_with(
        &doc,
        None,
        "new.png",
        LinkKind::Image,
        true,
        &mut |root, fresh| {
            if fresh {
                asked_fresh = true;
                Arc::new(index_vault(root))
            } else {
                stale.clone()
            }
        },
    );
    assert!(asked_fresh);
    assert_eq!(found, Some(image));
}

#[test]
fn only_the_most_recently_used_vaults_stay_cached() {
    let entry = |name: &str| CachedIndex {
        root: PathBuf::from(name),
        built: Instant::now(),
        files: Arc::new(Vec::new()),
    };
    let mut cache = Vec::new();
    for name in ["a", "b", "c", "d"] {
        touch_cached(&mut cache, Path::new(name), Some(entry(name)));
    }
    // Using "a" again keeps it; the next new vault pushes out "b".
    touch_cached(&mut cache, Path::new("a"), None);
    touch_cached(&mut cache, Path::new("e"), Some(entry("e")));
    let roots: Vec<_> = cache
        .iter()
        .map(|c| c.root.to_string_lossy().to_string())
        .collect();
    assert_eq!(roots, ["e", "a", "d", "c"]);
}
