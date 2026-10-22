use super::pandoc_args;

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
