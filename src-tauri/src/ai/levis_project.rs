//! A project made with Levis keeps its settings (style profile, library,
//! writing instructions, skills) in `.levis/` - Textus's `.textus/` under
//! its old name. Textus reads only `.textus/` (docs/design/ai-concepts.md),
//! so such a project is converted once, when the user agrees: the project
//! bar asks while `.levis/` holds a file `.textus/` doesn't have. All of
//! Textus's knowledge of a project's `.levis/` is in this module.
//!
//! Converting copies; `.levis/` stays exactly as it was, so a Levis install
//! sharing the folder keeps working. (The app-wide "Import from Levis" -
//! settings, histories, the global config folder - is levis_import.rs.)

use crate::ai::workspace::project_dir;
use std::path::{Path, PathBuf};

/// A Levis project's settings folder.
const LEVIS_DIR_NAME: &str = ".levis";

/// The files a conversion would copy: each regular file under `.levis/`
/// with no file at the same place under `.textus/`, as (from, to). A
/// project made with Levis and later opened by Textus 1.0, which read both
/// folders, can have both - and what only `.levis/` has would otherwise
/// quietly stop reaching Textus AI. Symlinks and anything else that isn't
/// a plain file or folder are skipped: a link could point anywhere, and
/// Levis never wrote one.
fn missing_files(root: &Path) -> Vec<(PathBuf, PathBuf)> {
    let mut out = Vec::new();
    let mut pending = vec![(root.join(LEVIS_DIR_NAME), project_dir(root))];
    while let Some((from, to)) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&from) else {
            continue;
        };
        for entry in entries.flatten() {
            // The entry's own type: a symlink reports as one, never as what
            // it points to.
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let target = to.join(entry.file_name());
            if kind.is_dir() {
                pending.push((entry.path(), target));
            } else if kind.is_file() && !target.exists() {
                out.push((entry.path(), target));
            }
        }
    }
    out.sort();
    out
}

/// Whether the project folder `root` has Levis settings that Textus would
/// not read - what the project bar offers to convert.
pub fn unconverted(root: &Path) -> bool {
    root.join(LEVIS_DIR_NAME).is_dir() && !missing_files(root).is_empty()
}

/// Copies what `.textus/` lacks from `.levis/` (missing_files) through the
/// atomic writer, and returns how many files. Nothing in `.textus/` is
/// overwritten.
pub fn convert(root: &Path) -> Result<usize, String> {
    let files = missing_files(root);
    for (from, to) in &files {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let bytes = std::fs::read(from).map_err(|e| e.to_string())?;
        crate::atomic::write_sync(to, bytes).map_err(|e| e.to_string())?;
    }
    Ok(files.len())
}

/// Converts the project folder of a document (as workspace::project_root
/// resolves it) - the project bar's "Convert" and the Memory tab's
/// "Convert Levis data". Returns how many files were copied.
#[tauri::command]
pub async fn convert_levis_project(
    doc_path: Option<String>,
    workspace_root: Option<String>,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root =
            crate::ai::workspace::project_root(doc_path.as_deref(), workspace_root.as_deref())
                .ok_or_else(|| "NO_PROJECT".to_string())?;
        convert(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "textus-levis-project-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn converting_copies_levis_into_textus_and_leaves_levis_alone() {
        let root = scratch("convert");
        for (rel, text) in [
            ("agent.md", "British English."),
            ("style.md", "Short sentences."),
            ("library/lin.md", "---\nname: Lin\n---\nTeacher."),
            ("skills/house.md", "---\nname: house\n---\nKeep it short."),
        ] {
            write(&root.join(".levis").join(rel), text);
        }
        assert!(unconverted(&root));
        assert_eq!(convert(&root).unwrap(), 4);
        assert_eq!(
            std::fs::read_to_string(root.join(".textus/library/lin.md")).unwrap(),
            "---\nname: Lin\n---\nTeacher."
        );
        assert_eq!(
            std::fs::read_to_string(root.join(".levis/agent.md")).unwrap(),
            "British English."
        );
        // Converted: nothing more to offer, and nothing copied again.
        assert!(!unconverted(&root));
        assert_eq!(convert(&root).unwrap(), 0);
        // And the workspace now reads it.
        let doc = root.join("chapter.md");
        write(&doc, "# One");
        let ws = crate::ai::workspace::load_layers(None, doc.to_str(), None, &[]);
        assert_eq!(ws.project_instructions.as_deref(), Some("British English."));
        assert!(!ws.levis_project);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn converting_never_overwrites_what_textus_has() {
        let root = scratch("both");
        write(&root.join(".levis/agent.md"), "Levis rules.");
        write(&root.join(".levis/library/wu.md"), "Levis Wu.");
        write(&root.join(".textus/agent.md"), "Textus rules.");
        assert!(unconverted(&root), "wu.md is only in .levis/");
        assert_eq!(convert(&root).unwrap(), 1);
        assert_eq!(
            std::fs::read_to_string(root.join(".textus/agent.md")).unwrap(),
            "Textus rules."
        );
        assert!(root.join(".textus/library/wu.md").is_file());
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn converting_skips_symlinks() {
        let root = scratch("links");
        let outside = scratch("outside");
        write(&outside.join("secret.md"), "secret");
        write(&root.join(".levis/agent.md"), "Rules.");
        std::os::unix::fs::symlink(outside.join("secret.md"), root.join(".levis/link.md")).unwrap();
        std::os::unix::fs::symlink(&outside, root.join(".levis/linked-dir")).unwrap();
        assert_eq!(convert(&root).unwrap(), 1);
        assert!(!root.join(".textus/link.md").exists());
        assert!(!root.join(".textus/linked-dir").exists());
        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn a_project_without_levis_has_nothing_to_convert() {
        let root = scratch("none");
        assert!(!unconverted(&root));
        assert_eq!(convert(&root).unwrap(), 0);
        assert!(!root.join(".textus").exists());
        std::fs::remove_dir_all(&root).ok();
    }
}
