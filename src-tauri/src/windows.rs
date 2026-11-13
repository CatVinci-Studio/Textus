//! What kind of window a label names: one list, so a new kind is never taken
//! for an editor by default.

use crate::commands::chat_window::CHAT_LABEL_PREFIX;
use crate::commands::export::PDF_EXPORT_LABEL_PREFIX;
use crate::commands::floating_window::FLOATING_LABEL_PREFIX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowKind {
    /// Holds documents: "main", "window-<n>".
    Editor,
    /// A detached AI chat.
    Chat,
    /// A plugin's view floating on the desktop.
    Floating,
    /// Off screen, laying a document out for PDF.
    PdfExport,
    /// The tab being dragged between windows.
    DragPill,
    /// Where plugins run in the background.
    BackgroundHost,
}

impl WindowKind {
    /// The kind `label` names; None for a label no window of ours has.
    pub(crate) fn of(label: &str) -> Option<Self> {
        let numbered = |prefix: &str| {
            label.strip_prefix(prefix).is_some_and(|n| {
                !n.is_empty()
                    && n.chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
            })
        };
        if label == "main" || numbered("window-") {
            Some(Self::Editor)
        } else if numbered(CHAT_LABEL_PREFIX) {
            Some(Self::Chat)
        } else if label.starts_with(FLOATING_LABEL_PREFIX) {
            Some(Self::Floating)
        } else if label.starts_with(PDF_EXPORT_LABEL_PREFIX) {
            Some(Self::PdfExport)
        } else if label == crate::tab_drag::DRAG_PILL_LABEL {
            Some(Self::DragPill)
        } else if label == crate::schedule::HOST_LABEL {
            Some(Self::BackgroundHost)
        } else {
            None
        }
    }
}

/// Whether `label` names a window that holds documents.
pub(crate) fn is_editor_window(label: &str) -> bool {
    WindowKind::of(label) == Some(WindowKind::Editor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_listed_label_is_an_editor() {
        for editor in ["main", "window-1", "window-42"] {
            assert!(is_editor_window(editor), "{editor}");
        }
        for other in [
            "chat-1",
            "floating-x",
            "pdf-export-3",
            "drag-pill",
            "something-new",
            "window-",
        ] {
            assert!(!is_editor_window(other), "{other}");
        }
        assert_eq!(WindowKind::of("chat-99"), Some(WindowKind::Chat));
    }

    #[test]
    fn the_window_last_in_use_ranks_first() {
        use crate::editor_windows::{focus_rank, note_focused};
        note_focused("window-71");
        note_focused("window-72");
        note_focused("chat-7");
        assert!(focus_rank("window-72") < focus_rank("window-71"));
        note_focused("window-71");
        assert!(focus_rank("window-71") < focus_rank("window-72"));
        assert_eq!(focus_rank("chat-7"), usize::MAX);
    }
}
