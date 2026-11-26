//! Which open window documents handed over from outside (Finder, a second
//! launch, Open Recent) go to, as VS Code picks one: the window that has
//! them open already, else the one whose folder holds them all.

use crate::commands::session::WindowSession;
use std::collections::HashMap;
use std::path::Path;

/// The window for `paths` among `windows` (label → its session), or None
/// when no window has them or holds them: then the focused one takes them.
/// `focused` wins a tie, so a second window on the same folder keeps them.
pub(crate) fn window_for(
    windows: &HashMap<String, WindowSession>,
    paths: &[String],
    focused: Option<&str>,
) -> Option<String> {
    let has_open = |window: &WindowSession| paths.iter().all(|p| window.paths.contains(p));
    // The innermost folder holding them all: its depth, None if it doesn't.
    let holds = |window: &WindowSession| {
        let folder = Path::new(window.folder.as_deref()?);
        paths
            .iter()
            .all(|p| Path::new(p).starts_with(folder))
            .then(|| folder.components().count())
    };
    let pick = |rank: &dyn Fn(&WindowSession) -> Option<usize>| {
        windows
            .iter()
            .filter_map(|(label, window)| rank(window).map(|r| (r, focused == Some(label), label)))
            .max_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)).then_with(|| b.2.cmp(a.2)))
            .map(|(_, _, label)| label.clone())
    };
    pick(&|w| has_open(w).then_some(0)).or_else(|| pick(&holds))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(folder: Option<&str>, paths: &[&str]) -> WindowSession {
        WindowSession {
            folder: folder.map(str::to_string),
            ..WindowSession::of_paths(paths.iter().map(|p| (*p).to_string()).collect())
        }
    }

    fn map(entries: Vec<(&str, WindowSession)>) -> HashMap<String, WindowSession> {
        entries
            .into_iter()
            .map(|(l, w)| (l.to_string(), w))
            .collect()
    }

    fn of(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|p| (*p).to_string()).collect()
    }

    #[test]
    fn a_document_goes_to_the_window_whose_folder_holds_it() {
        let windows = map(vec![
            ("a", window(Some("/work"), &[])),
            ("b", window(Some("/notes"), &[])),
        ]);
        let to = window_for(&windows, &of(&["/notes/x.md"]), Some("a"));
        assert_eq!(to.as_deref(), Some("b"));
    }

    #[test]
    fn outside_every_folder_none_and_the_focused_window_takes_it() {
        let windows = map(vec![("a", window(Some("/work"), &[]))]);
        assert_eq!(
            window_for(&windows, &of(&["/elsewhere/x.md"]), Some("a")),
            None
        );
        // A window without a folder holds nothing.
        let windows = map(vec![("a", window(None, &[]))]);
        assert_eq!(window_for(&windows, &of(&["/x.md"]), None), None);
    }

    #[test]
    fn the_window_that_has_it_open_comes_first() {
        let windows = map(vec![
            ("a", window(Some("/notes"), &[])),
            ("b", window(None, &["/notes/x.md"])),
        ]);
        let to = window_for(&windows, &of(&["/notes/x.md"]), Some("a"));
        assert_eq!(to.as_deref(), Some("b"));
    }

    #[test]
    fn the_innermost_folder_wins_then_the_focused_window() {
        let windows = map(vec![
            ("a", window(Some("/notes"), &[])),
            ("b", window(Some("/notes/daily"), &[])),
            ("c", window(Some("/notes/daily"), &[])),
        ]);
        let paths = of(&["/notes/daily/x.md"]);
        assert_eq!(
            window_for(&windows, &paths, Some("c")).as_deref(),
            Some("c")
        );
        assert_eq!(
            window_for(&windows, &paths, Some("a")).as_deref(),
            Some("b")
        );
    }

    #[test]
    fn a_batch_goes_where_all_of_it_belongs() {
        let windows = map(vec![("a", window(Some("/notes"), &[]))]);
        let split = of(&["/notes/x.md", "/work/y.md"]);
        assert_eq!(window_for(&windows, &split, None), None);
        // A folder name that only starts the same is not the folder.
        let near = of(&["/notes-old/x.md"]);
        assert_eq!(window_for(&windows, &near, None), None);
    }
}
