
use super::*;

fn registry(entries: Vec<(&str, &str)>) -> OpenChatWindows {
    OpenChatWindows(Mutex::new(
        entries
            .into_iter()
            .map(|(label, scope)| ChatWindowEntry {
                label: label.to_string(),
                scope: scope.to_string(),
            })
            .collect(),
    ))
}

/// The window-classification bugs this predicate exists to prevent were
/// all silent: a tab dropped on a chat window vanished, menu commands
/// went nowhere, files opened into the void. Worth pinning down.
#[test]
fn editor_windows_are_those_holding_a_document() {
    assert!(is_editor_window("main"));
    assert!(is_editor_window("window-1"));
    assert!(is_editor_window("window-42"));
}

#[test]
fn chat_and_pill_windows_are_not_editors() {
    assert!(!is_editor_window("chat-1"));
    assert!(!is_editor_window("chat-99"));
    assert!(!is_editor_window(crate::tab_drag::DRAG_PILL_LABEL));
}

#[test]
fn detached_chat_labels_are_classified_as_chats() {
    // The label format detach_chat_window builds must keep matching the
    // prefix the predicate tests, or every guard silently stops working.
    let label = format!("{CHAT_LABEL_PREFIX}{}", 7);
    assert!(!is_editor_window(&label));
}

#[test]
fn a_chat_resolves_back_to_the_editor_that_opened_it() {
    let open = registry(vec![("chat-1", "main"), ("chat-3", "window-2")]);
    assert_eq!(
        editor_for_chat("chat-3", &open),
        Some("window-2".to_string())
    );
    assert_eq!(editor_for_chat("chat-1", &open), Some("main".to_string()));
}

#[test]
fn an_unknown_chat_resolves_to_no_editor() {
    let open = registry(vec![("chat-1", "main")]);
    assert_eq!(editor_for_chat("chat-9", &open), None);
}

#[test]
fn a_chat_serves_only_its_own_editor() {
    let open = registry(vec![("chat-1", "main")]);
    assert_eq!(chat_serving("main", &open), Some("chat-1".to_string()));
    assert_eq!(chat_serving("window-2", &open), None);
}

#[test]
fn forgetting_clears_both_directions_of_the_mapping() {
    let open = registry(vec![("chat-1", "main"), ("chat-3", "window-2")]);

    // A closed CHAT window drops its own entry, freeing its editor to
    // detach again.
    forget_entries("chat-1", &open);
    assert_eq!(chat_serving("main", &open), None);
    assert_eq!(chat_serving("window-2", &open), Some("chat-3".to_string()));

    // A closed EDITOR window drops the chat scoped to it.
    forget_entries("window-2", &open);
    assert_eq!(chat_serving("window-2", &open), None);
}
