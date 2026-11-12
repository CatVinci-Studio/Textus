//! What else in the folder bears on the document: the folder's AGENTS.md,
//! the instructions it keeps for AI agents, and the files beside the
//! document - the same series, a template - named for the model to read
//! when they matter.

use super::{is_hidden, is_text_file};
use std::path::Path;

/// Most of AGENTS.md sent, in characters.
const MAX_AGENTS_CHARS: usize = 8_000;
/// Most files named beside the document, and in a templates folder.
const MOST_BESIDE: usize = 30;
const MOST_TEMPLATES: usize = 10;
/// Folders that hold templates, by the names people give them.
const TEMPLATE_FOLDERS: &[&str] = &["templates", "Templates", "_templates", "模板", "範本"];

/// The folder's AGENTS.md, comments taken out; None without one.
pub fn read_agents_md(root: &Path) -> Option<String> {
    let text = std::fs::read_to_string(root.join("AGENTS.md")).ok()?;
    let text = crate::ai::workspace::strip_html_comments(&text);
    let text = text.trim();
    (!text.is_empty()).then(|| text.chars().take(MAX_AGENTS_CHARS).collect())
}

/// The text files beside `doc` and in the folder's templates folder, from
/// `root`, sorted; `doc` itself left out.
pub fn nearby_files(root: &Path, doc: Option<&Path>) -> Vec<String> {
    let mut found = Vec::new();
    if let Some(dir) = doc.and_then(Path::parent) {
        found.extend(texts_in(root, dir, doc, MOST_BESIDE));
    }
    for name in TEMPLATE_FOLDERS {
        let dir = root.join(name);
        if dir.is_dir() {
            found.extend(texts_in(root, &dir, doc, MOST_TEMPLATES));
            break;
        }
    }
    found.dedup();
    found
}

fn texts_in(root: &Path, dir: &Path, doc: Option<&Path>, most: usize) -> Vec<String> {
    if !dir.starts_with(root) {
        return Vec::new();
    }
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && Some(path.as_path()) != doc)
        .filter(|path| !is_hidden(&path.file_name().unwrap_or_default().to_string_lossy()))
        .filter(|path| is_text_file(path))
        .filter_map(|path| {
            path.strip_prefix(root)
                .ok()
                .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        })
        .collect();
    names.sort();
    names.truncate(most);
    names
}

/// The files beside the document, for the request; None without any.
pub fn nearby_section(files: &[String]) -> Option<String> {
    (!files.is_empty()).then(|| {
        format!(
            "---files beside this document (the same series, templates): read_file one when it bears on the request - an earlier chapter for names and continuity, a template for the shape to follow, every one of its sections kept (one with nothing to say left empty or marked so, never dropped); don't read them otherwise---\n{}",
            files.iter().map(|f| format!("- {f}")).collect::<Vec<_>>().join("\n")
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agents_md_and_the_files_beside_the_document() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("book")).unwrap();
        std::fs::create_dir_all(root.join("模板")).unwrap();
        for (rel, text) in [
            ("AGENTS.md", "<!-- note -->\nKeep British spelling."),
            ("book/01.md", "One"),
            ("book/02.md", "Two"),
            ("book/.draft.md", "Hidden"),
            ("book/cover.png", "x"),
            ("模板/章节.md", "# 标题"),
            ("other.md", "Elsewhere"),
        ] {
            std::fs::write(root.join(rel), text).unwrap();
        }
        assert_eq!(
            read_agents_md(root).as_deref(),
            Some("Keep British spelling.")
        );
        let doc = root.join("book/02.md");
        assert_eq!(
            nearby_files(root, Some(&doc)),
            ["book/01.md", "模板/章节.md"]
        );
        assert!(nearby_section(&[]).is_none());
        assert!(nearby_section(&["book/01.md".into()])
            .unwrap()
            .contains("- book/01.md"));
        assert_eq!(read_agents_md(&root.join("book")), None);
    }
}
