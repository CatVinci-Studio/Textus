//! New document, new folder and move, from the sidebar's file tree
//! (src/sidebar/FileTree.tsx) on the desktop. The iPhone keeps its own
//! document list (documents.rs).
//!
//! Nothing here overwrites or deletes: a name already taken is refused,
//! creating uses create-new semantics, and a move is one rename that fails
//! rather than replaces. A folder can't move into itself.

use std::path::{Path, PathBuf};
use tokio::fs;

/// A name the user typed: one path component, nothing that walks out of the
/// folder it is meant for.
fn check_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\']) {
        return Err("Invalid name".into());
    }
    Ok(name)
}

/// A new document's file name: what was typed, with `.md` added unless it
/// already names a Markdown file.
fn document_name(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        name.to_string()
    } else {
        format!("{name}.md")
    }
}

async fn existing_dir(dir: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(dir);
    if !fs::metadata(&dir)
        .await
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("Not a folder".into());
    }
    Ok(dir)
}

/// Creates an empty Markdown document in `dir`. Returns its path.
#[tauri::command]
pub async fn tree_create_document(dir: String, name: String) -> Result<String, String> {
    let dir = existing_dir(&dir).await?;
    let path = dir.join(document_name(check_name(&name)?));
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => "Already exists".to_string(),
            _ => e.to_string(),
        })?;
    Ok(path.to_string_lossy().to_string())
}

/// Creates a folder in `dir`. Returns its path.
#[tauri::command]
pub async fn tree_create_folder(dir: String, name: String) -> Result<String, String> {
    let dir = existing_dir(&dir).await?;
    let path = dir.join(check_name(&name)?);
    fs::create_dir(&path).await.map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => "Already exists".to_string(),
        _ => e.to_string(),
    })?;
    Ok(path.to_string_lossy().to_string())
}

/// Where `path` lands when moved into `into`, or why it can't: the same
/// folder it is in, into itself or below, or onto a name already taken.
fn move_target(path: &Path, into: &Path) -> Result<PathBuf, String> {
    let name = path.file_name().ok_or("No file name")?;
    if path.parent() == Some(into) {
        return Err("Already there".into());
    }
    if into.starts_with(path) {
        return Err("A folder can't move into itself".into());
    }
    Ok(into.join(name))
}

/// Moves a file or folder into the folder `into`. Returns its new path.
#[tauri::command]
pub async fn tree_move_entry(path: String, into: String) -> Result<String, String> {
    let from = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let into = existing_dir(&into)
        .await?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let to = move_target(&from, &into)?;
    if fs::try_exists(&to).await.unwrap_or(true) {
        return Err("Already exists".into());
    }
    fs::rename(&from, &to).await.map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_stay_one_component() {
        assert_eq!(check_name("  笔记 ").unwrap(), "笔记");
        for bad in ["", "  ", ".", "..", "a/b", "a\\b", "../x"] {
            assert!(check_name(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn documents_get_md() {
        assert_eq!(document_name("Notes"), "Notes.md");
        assert_eq!(document_name("Notes.MD"), "Notes.MD");
        assert_eq!(document_name("a.markdown"), "a.markdown");
        assert_eq!(document_name("v1.2"), "v1.2.md");
    }

    #[test]
    fn a_move_never_lands_in_itself_or_in_place() {
        let a = Path::new("/w/a");
        assert_eq!(
            move_target(a, Path::new("/w/b")).unwrap(),
            Path::new("/w/b/a")
        );
        assert!(move_target(a, Path::new("/w")).is_err());
        assert!(move_target(a, Path::new("/w/a")).is_err());
        assert!(move_target(a, Path::new("/w/a/sub")).is_err());
        // "/w/ab" is not inside "/w/a".
        assert!(move_target(a, Path::new("/w/ab")).is_ok());
    }

    #[tokio::test]
    async fn create_and_move_refuse_to_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let doc = tree_create_document(root.clone(), "Notes".into())
            .await
            .unwrap();
        assert!(doc.ends_with("Notes.md"));
        assert!(tree_create_document(root.clone(), "Notes".into())
            .await
            .is_err());
        let sub = tree_create_folder(root.clone(), "Sub".into())
            .await
            .unwrap();
        assert!(tree_create_folder(root.clone(), "Sub".into())
            .await
            .is_err());
        let moved = tree_move_entry(doc.clone(), sub.clone()).await.unwrap();
        assert!(Path::new(&moved).ends_with("Sub/Notes.md"));
        // A second Notes.md at the top can't be moved onto the first.
        let again = tree_create_document(root.clone(), "Notes".into())
            .await
            .unwrap();
        assert!(tree_move_entry(again, sub.clone()).await.is_err());
        assert!(tree_move_entry(sub.clone(), sub).await.is_err());
    }
}
