use super::{breaks_extension, pandoc_args, usable_reference_doc};

#[test]
fn pandoc_reads_the_editor_dialect_and_titles_only_epub() {
    let docx = pandoc_args("docx", "notes");
    assert_eq!(docx[0], "--from");
    assert!(docx[1].starts_with("commonmark_x-smart-subscript-superscript"));
    assert!(docx[1].ends_with("+autolink_bare_uris"));
    assert!(!docx[1].contains(char::is_whitespace));
    assert!(docx.contains(&"pagetitle=notes".to_string()));
    assert!(!docx.iter().any(|a| a.starts_with("title=")));
    assert!(pandoc_args("epub", "notes").contains(&"title=notes".to_string()));
}

#[test]
fn a_folder_that_shows_single_newlines_exports_them_as_breaks() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    assert_eq!(breaks_extension(Some(path)), "");
    assert_eq!(breaks_extension(None), "");
    std::fs::create_dir(dir.path().join(".textus")).unwrap();
    std::fs::write(
        dir.path().join(".textus/settings.json"),
        r#"{"conventions":{"softBreaks":true}}"#,
    )
    .unwrap();
    assert_eq!(breaks_extension(Some(path)), "+hard_line_breaks");
}

#[test]
fn a_word_template_is_used_only_while_it_is_there() {
    let dir = tempfile::tempdir().unwrap();
    let template = dir.path().join("house.docx");
    let path = template.to_string_lossy().to_string();
    assert_eq!(usable_reference_doc(Some(path.clone())), None);
    std::fs::write(&template, b"docx").unwrap();
    assert_eq!(usable_reference_doc(Some(path.clone())), Some(path));
    assert_eq!(usable_reference_doc(None), None);
}
