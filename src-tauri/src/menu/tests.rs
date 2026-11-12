#[test]
fn a_recent_folder_ends_in_a_separator_to_set_it_apart_from_files() {
    assert_eq!(super::folder_menu_text("/srv/notes"), "/srv/notes/");
    assert_eq!(super::folder_menu_text("/srv/notes/"), "/srv/notes/");
    assert_eq!(super::folder_menu_text(r"D:\Notes"), r"D:\Notes\");
    assert_eq!(super::folder_menu_text("/srv/Q&A"), "/srv/Q&&A/");
}

#[test]
fn the_menu_table_reads_whole() {
    use super::table::{Node, TABLE};
    fn walk(nodes: &[Node], seen: &mut Vec<String>) {
        for node in nodes {
            match node {
                Node::Menu(menu) => {
                    seen.push(format!("menu:{}", menu.menu));
                    walk(&menu.items, seen);
                }
                Node::Item(item) => {
                    assert!(
                        item.id.is_some() || item.predefined.is_some(),
                        "{} has neither id nor predefined",
                        item.en
                    );
                    seen.push(item.label_key());
                }
                Node::Line(line) => assert_eq!(line, "-"),
                _ => {}
            }
        }
    }
    let mut seen = Vec::new();
    for menu in &TABLE.bar {
        seen.push(format!("menu:{}", menu.menu));
        walk(&menu.items, &mut seen);
    }
    for key in [
        "menu:open-recent",
        "menu:plugins",
        "settings",
        "quit",
        "predefined:undo",
    ] {
        assert!(seen.iter().any(|s| s == key), "no {key}");
    }
    assert_eq!(super::table::text_en("recent-none"), "No Recent Files");
}

#[test]
fn keys_reach_muda_as_it_reads_them() {
    assert_eq!(
        super::table::accelerator("mod+shift+s"),
        "CmdOrCtrl+Shift+s"
    );
    assert_eq!(super::table::accelerator("ctrl+`"), "Ctrl+`");
    assert_eq!(super::table::accelerator("mod+="), "CmdOrCtrl+=");
}
