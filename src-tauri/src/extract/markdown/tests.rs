use super::*;

const BOLD: Marks = Marks {
    bold: true,
    italic: false,
    strike: false,
};

#[test]
fn runs_with_the_same_marks_merge_before_emphasis() {
    let mut line = Inline::default();
    line.push("He", BOLD, None);
    line.push("llo", BOLD, None);
    line.push(" ", Marks::default(), None);
    line.push("world", BOLD, None);
    line.push(" and more", Marks::default(), None);
    assert_eq!(line.render(), "**Hello world** and more");
}

#[test]
fn emphasis_hugs_the_words() {
    assert_eq!(emphasize(" bold ", BOLD), " **bold** ");
    assert_eq!(emphasize("  ", BOLD), "  ");
}

#[test]
fn a_link_wraps_its_emphasis() {
    let mut line = Inline::default();
    line.push("See ", Marks::default(), None);
    line.push("the site", BOLD, Some("https://example.com/a b"));
    assert_eq!(
        line.render(),
        "See [**the site**](https://example.com/a%20b)"
    );
}

#[test]
fn list_items_are_tight_and_never_skip_a_level() {
    let mut blocks = Blocks::default();
    blocks.push("Intro");
    blocks.push_item(2, "-", "first");
    blocks.push_item(1, "1.", "nested\nsecond line");
    blocks.push_item(0, "-", "back out");
    blocks.push_item(0, "1.", "another list");
    blocks.push("After");
    assert_eq!(
            blocks.finish(),
            "Intro\n\n- first\n    1. nested\n       second line\n- back out\n\n1. another list\n\nAfter"
        );
}

#[test]
fn tables_get_a_header_padded_rows_and_escaped_cells() {
    let rows = vec![
        vec!["Name".to_string(), "Note".to_string()],
        vec!["a|b".to_string()],
        vec!["c".to_string(), "two\n\nlines".to_string()],
    ];
    assert_eq!(
        table(&rows),
        "| Name | Note |\n| --- | --- |\n| a\\|b |  |\n| c | two<br>lines |"
    );
}
