//! What Textus AI makes for a project folder - its memories and research
//! papers - kept in Textus's own config folder, not the user's:
//! `<config>/textus/projects/<key>/`. The project's `.textus/` keeps only
//! what the user writes (agent.md, skills, style profile, library).

use crate::ai::workspace::project_dir;

use std::path::{Path, PathBuf};

pub(crate) const PROJECTS: &str = "projects";

/// A folder name for `root`: its path with every separator and odd
/// character as `-`, as Claude Code names its projects, ended by a short
/// hash so two paths that read the same stay apart.
pub(crate) fn key(root: &Path) -> String {
    let path = root.to_string_lossy();
    let readable: String = path
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let readable: String = readable.trim_matches('-').chars().take(80).collect();
    let short = crate::ids::path_key(&path, 4);
    format!("{readable}-{short}")
}

/// `<global>/projects/<key>/`.
pub(crate) fn dir(global: &Path, root: &Path) -> PathBuf {
    global.join(PROJECTS).join(key(root))
}

/// `sub` of the project's data folder. What an older Textus kept in
/// `<root>/.textus/<sub>` moves there the first time; where it can't be
/// moved it is copied, and the original left as it was.
pub(crate) fn adopt(global: &Path, root: &Path, sub: &str) -> PathBuf {
    let to = dir(global, root).join(sub);
    let from = project_dir(root).join(sub);
    if from.is_dir() && !to.exists() {
        if let Err(e) = crate::atomic::move_or_copy(&from, &to) {
            eprintln!(
                "textus: could not move {} to {}: {e}",
                from.display(),
                to.display()
            );
        }
    }
    to
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_read_like_the_path_and_never_collide_on_lookalikes() {
        let a = key(Path::new("/Users/me/my notes"));
        assert!(a.starts_with("Users-me-my-notes-"), "{a}");
        assert_ne!(a, key(Path::new("/Users/me/my-notes")));
        assert!(!a.contains(['/', '\\', ' ']));
    }

    #[test]
    fn what_an_older_textus_kept_in_the_folder_moves_out() {
        let tmp = std::env::temp_dir().join(format!("textus-pdata-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let root = tmp.join("novel");
        let global = tmp.join("config/textus");
        std::fs::create_dir_all(project_dir(&root).join("memory/sub")).unwrap();
        std::fs::write(project_dir(&root).join("memory/sub/likes.md"), "tea").unwrap();

        let memory = adopt(&global, &root, "memory");

        assert!(memory.starts_with(&global));
        assert_eq!(
            std::fs::read_to_string(memory.join("sub/likes.md")).unwrap(),
            "tea"
        );
        assert!(!project_dir(&root).join("memory").exists());
        // Once there, a stale copy left in the folder isn't taken again.
        std::fs::create_dir_all(project_dir(&root).join("memory")).unwrap();
        assert_eq!(adopt(&global, &root, "memory"), memory);
        assert!(!memory.join("likes.md").exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
