
#[test]
fn a_recent_folder_ends_in_a_separator_to_set_it_apart_from_files() {
    assert_eq!(super::folder_menu_text("/srv/notes"), "/srv/notes/");
    assert_eq!(super::folder_menu_text("/srv/notes/"), "/srv/notes/");
    assert_eq!(super::folder_menu_text(r"D:\Notes"), r"D:\Notes\");
    assert_eq!(super::folder_menu_text("/srv/Q&A"), "/srv/Q&&A/");
}

#[test]
fn every_label_key_is_one_the_frontend_sends() {
    // Submenus and muda's own items have no menu id to key a label by;
    // their keys are made up on both sides, so a typo on either would
    // leave that one label English with nothing to say so.
    let source = include_str!("../menu.rs");
    let frontend = include_str!("../../../src/app/app-menu-model.ts");
    let keys: Vec<&str> = source
        .split('"')
        .filter(|s| s.starts_with("menu:") || s.starts_with("predefined:"))
        .filter(|s| {
            s.chars()
                .all(|c| c.is_ascii_lowercase() || c == ':' || c == '-')
        })
        .filter(|s| !s.ends_with(':'))
        .collect();
    assert!(keys.len() >= 20, "found {keys:?}");
    for key in keys {
        assert!(
            frontend.contains(&format!("\"{key}\"")),
            "the frontend sends no {key}"
        );
    }
}
