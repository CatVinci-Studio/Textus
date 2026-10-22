
use super::*;

#[cfg(desktop)]
#[test]
fn only_a_picture_in_the_documents_folder_may_go_to_the_trash() {
    let root = std::env::temp_dir().join(format!("textus-trash-{}", std::process::id()));
    let notes = root.join("notes");
    let assets = notes.join("assets");
    let elsewhere = root.join("elsewhere");
    std::fs::create_dir_all(&assets).unwrap();
    std::fs::create_dir_all(&elsewhere).unwrap();
    let doc = notes.join("harbour.md");
    std::fs::write(&doc, "# Harbour").unwrap();
    let picture = assets.join("boats.png");
    std::fs::write(&picture, [0u8; 4]).unwrap();
    let outside = elsewhere.join("boats.png");
    std::fs::write(&outside, [0u8; 4]).unwrap();
    let text = assets.join("notes.txt");
    std::fs::write(&text, "x").unwrap();

    assert!(may_trash_picture(None, Some(&doc), &picture).is_ok());
    // Through .. out of the folder, or a file elsewhere: no.
    let sneaky = assets.join("../../elsewhere/boats.png");
    assert!(may_trash_picture(None, Some(&doc), &sneaky).is_err());
    assert!(may_trash_picture(None, Some(&doc), &outside).is_err());
    // Not a picture, or not there: no.
    assert!(may_trash_picture(None, Some(&doc), &text).is_err());
    assert!(may_trash_picture(None, Some(&doc), &assets.join("gone.png")).is_err());
    // A draft's picture, among the drafts' images.
    assert!(may_trash_picture(Some(&elsewhere), None, &outside).is_ok());
    assert!(may_trash_picture(Some(&elsewhere), None, &picture).is_err());
    let _ = std::fs::remove_dir_all(&root);
}

#[cfg(not(target_os = "macos"))]
#[test]
fn open_dialog_defaults_to_markdown_and_offers_any_file() {
    let filters = open_document_filters("Text", "Word", "All files");
    let names: Vec<&str> = filters.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, ["Markdown", "Text", "Word", "All files"]);
    assert_eq!(filters[0].1, ["md", "markdown"]);
    assert_eq!(filters[2].1, ["docx"]);
    assert_eq!(filters[3].1, ["*"]);
}

#[cfg(target_os = "macos")]
#[test]
fn open_dialog_leaves_every_file_pickable_on_macos() {
    assert!(open_document_filters("Text", "Word", "All files").is_empty());
}

fn doc() -> PathBuf {
    Path::new("notes").join("week").join("My Notes.md")
}

/// The folder for `setting` and the src a pasted "a.png" gets in it.
fn image_in(setting: &str) -> (PathBuf, String) {
    let folder = ImageFolder::resolve(&doc(), setting).unwrap();
    let src = folder.src("a.png");
    (folder.dir, src)
}

#[test]
fn the_default_image_folder_is_assets_next_to_the_document() {
    let dir = doc().parent().unwrap().join("assets");
    assert_eq!(image_in("assets"), (dir, "assets/a.png".to_string()));
}

#[test]
fn dot_slash_puts_images_beside_the_document() {
    let dir = doc().parent().unwrap().to_path_buf();
    assert_eq!(image_in("./"), (dir.clone(), "a.png".to_string()));
    assert_eq!(image_in("."), (dir, "a.png".to_string()));
}

#[test]
fn a_subfolder_is_written_with_forward_slashes() {
    let dir = doc().parent().unwrap().join("img").join("shots");
    let expected = (dir, "img/shots/a.png".to_string());
    assert_eq!(image_in("img/shots"), expected);
    assert_eq!(image_in("img\\shots\\"), expected);
    assert_eq!(image_in("  ./img/./shots/  "), expected);
}

#[test]
fn an_image_folder_never_leaves_the_documents_folder() {
    for setting in ["..", "../images", "img/../../x", "img/.."] {
        assert!(
            ImageFolder::resolve(&doc(), setting).is_err(),
            "{setting:?} was accepted"
        );
    }
}

#[test]
fn empty_absolute_and_doubled_slash_folders_are_refused() {
    for setting in ["", "  ", "/", "/tmp/img", "\\img", "img//x", "//server/x"] {
        assert!(
            ImageFolder::resolve(&doc(), setting).is_err(),
            "{setting:?} was accepted"
        );
    }
}

#[cfg(windows)]
#[test]
fn a_windows_drive_is_refused_as_an_image_folder() {
    for setting in ["C:\\img", "C:img", "C:/img"] {
        assert!(ImageFolder::resolve(&doc(), setting).is_err());
    }
}
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn images_written_at_once_never_overwrite_each_other() {
    let dir = tempfile::tempdir().unwrap();
    let writes: Vec<_> = (0..16u8)
        .map(|i| {
            let dir = dir.path().to_path_buf();
            tokio::spawn(async move {
                let name = write_new_file(&dir, "image-1.png", &[i; 64], false).await;
                (i, name.unwrap())
            })
        })
        .collect();
    let mut names = std::collections::HashSet::new();
    for write in writes {
        let (i, name) = write.await.unwrap();
        let held = fs::read(dir.path().join(&name)).await.unwrap();
        assert_eq!(held, [i; 64], "{name} was overwritten");
        names.insert(name);
    }
    assert_eq!(names.len(), 16);
}

#[tokio::test]
async fn a_taken_name_is_numbered_unless_it_holds_the_same_picture() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("a.png"), b"one").unwrap();
    let name = write_new_file(dir.path(), "a.png", b"two", true).await;
    assert_eq!(name.unwrap(), "a-1.png");
    let name = write_new_file(dir.path(), "a.png", b"one", true).await;
    assert_eq!(name.unwrap(), "a.png");
    assert_eq!(std::fs::read(dir.path().join("a.png")).unwrap(), b"one");
}

/// Two folders under one root, a document "A/a.md" and its picture.
fn two_folders() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let a = root.path().join("A");
    let b = root.path().join("B");
    std::fs::create_dir_all(a.join("pics")).unwrap();
    std::fs::create_dir_all(&b).unwrap();
    std::fs::write(a.join("pics").join("p.png"), b"picture").unwrap();
    (root, a.join("a.md"), b.join("b.md"))
}

#[tokio::test]
async fn save_as_elsewhere_copies_relative_images_into_the_image_folder() {
    let (root, old, new) = two_folders();
    let srcs = vec!["pics/p.png".to_string(), "notes.txt".to_string()];
    let drafts = root.path().join("drafts");
    let moved = migrate_images(&new, srcs, "assets", Some(&old), &drafts)
        .await
        .unwrap();
    assert_eq!(moved.len(), 1);
    assert_eq!(moved[0].old, "pics/p.png");
    assert_eq!(moved[0].new.as_deref(), Some("assets/p.png"));
    let b = new.parent().unwrap();
    assert_eq!(std::fs::read(b.join("assets/p.png")).unwrap(), b"picture");
    // The old document still links to its copy.
    assert!(old.parent().unwrap().join("pics/p.png").is_file());
}

#[tokio::test]
async fn save_as_in_the_same_folder_leaves_relative_images_alone() {
    let (root, old, _) = two_folders();
    let renamed = old.with_file_name("renamed.md");
    let drafts = root.path().join("drafts");
    let srcs = vec!["pics/p.png".to_string()];
    let moved = migrate_images(&renamed, srcs, "assets", Some(&old), &drafts)
        .await
        .unwrap();
    assert!(moved.is_empty());
}

#[tokio::test]
async fn a_drafts_pasted_image_moves_into_the_image_folder() {
    let (root, _, new) = two_folders();
    let drafts = root.path().join("drafts");
    std::fs::create_dir_all(&drafts).unwrap();
    let pasted = drafts.join("image-1.png");
    std::fs::write(&pasted, b"pasted").unwrap();
    let srcs = vec![pasted.to_string_lossy().to_string()];
    let moved = migrate_images(&new, srcs, "./", None, &drafts)
        .await
        .unwrap();
    assert_eq!(moved[0].new.as_deref(), Some("image-1.png"));
    assert!(!pasted.exists());
    let b = new.parent().unwrap();
    assert_eq!(std::fs::read(b.join("image-1.png")).unwrap(), b"pasted");
}
