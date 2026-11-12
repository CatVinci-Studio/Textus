//! New document, new folder, move, rename and trash for the sidebar's file
//! tree. Nothing here overwrites or deletes: a taken name is refused, and what
//! the user removes goes to the Trash.

use std::path::{Path, PathBuf};
use tokio::fs;

/// A new document's file name: what was typed, with `.md` added unless it
/// already names a Markdown file.
fn document_name(name: &str) -> String {
    if crate::extract::is_markdown(Path::new(name)) {
        name.to_string()
    } else {
        format!("{name}.md")
    }
}

/// Whether `name` ends in a file type (`.txt`, `.md`): letters after its
/// last dot, not a date's or a version's digits (`Meeting 11.11`).
fn names_a_type(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| {
            e.len() <= 8
                && e.chars().all(|c| c.is_ascii_alphanumeric())
                && e.chars().any(|c| c.is_ascii_alphabetic())
        })
}

async fn existing_dir(dir: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(dir);
    if !fs::metadata(&dir)
        .await
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err(crate::errors::error("notFolder"));
    }
    Ok(dir)
}

/// Creates an empty Markdown document in `dir`. Returns its path.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn tree_create_document(dir: String, name: String) -> Result<String, String> {
    let dir = existing_dir(&dir).await?;
    let path = dir.join(document_name(crate::ids::typed_name(&name)?));
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => crate::errors::error("exists"),
            _ => e.to_string(),
        })?;
    Ok(path.to_string_lossy().to_string())
}

/// Creates a folder in `dir`. Returns its path.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn tree_create_folder(dir: String, name: String) -> Result<String, String> {
    let dir = existing_dir(&dir).await?;
    let path = dir.join(crate::ids::typed_name(&name)?);
    fs::create_dir(&path).await.map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => crate::errors::error("exists"),
        _ => e.to_string(),
    })?;
    Ok(path.to_string_lossy().to_string())
}

/// Where `path` lands when moved into `into`, or why it can't: the same
/// folder it is in, into itself or below, or onto a name already taken.
fn move_target(path: &Path, into: &Path) -> Result<PathBuf, String> {
    let name = path.file_name().ok_or("No file name")?;
    if path.parent() == Some(into) {
        return Err(crate::errors::error("alreadyThere"));
    }
    if into.starts_with(path) {
        return Err(crate::errors::error("moveIntoItself"));
    }
    Ok(into.join(name))
}

/// `path` with its folder made canonical but not itself: a link is moved
/// or trashed as the link, never as the file it points to.
fn itself(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let name = path.file_name().ok_or("No name")?;
    let parent = path.parent().ok_or("No folder")?;
    let parent = if parent.as_os_str().is_empty() {
        std::path::Path::new(".")
    } else {
        parent
    };
    let folder = parent.canonicalize().map_err(|e| e.to_string())?;
    let me = folder.join(name);
    std::fs::symlink_metadata(&me).map_err(|e| e.to_string())?;
    Ok(me)
}

/// Moves a file or folder into the folder `into`. Returns its new path.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn tree_move_entry(path: String, into: String) -> Result<String, String> {
    let from = itself(&path)?;
    let into = existing_dir(&into)
        .await?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let to = move_target(&from, &into)?;
    if fs::try_exists(&to).await.unwrap_or(true) {
        return Err(crate::errors::error("exists"));
    }
    let (a, b) = (from.clone(), to.clone());
    tokio::task::spawn_blocking(move || crate::atomic::move_entry(&a, &b))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().to_string())
}

/// Gives a file or folder a new name in its folder. A document renamed without
/// an extension gets `.md`; a folder takes the name as typed. Returns its new path.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn tree_rename_entry(path: String, name: String) -> Result<String, String> {
    let from = PathBuf::from(&path);
    let is_dir = fs::metadata(&from)
        .await
        .map_err(|e| e.to_string())?
        .is_dir();
    let name = crate::ids::typed_name(&name)?;
    let was_doc = !is_dir && document_name(&path) == path;
    let name = if was_doc && !names_a_type(name) {
        document_name(name)
    } else {
        name.to_string()
    };
    let parent = from.parent().ok_or("No folder")?;
    let to = parent.join(&name);
    if to == from {
        return Ok(path);
    }
    // A change of case only (notes.md -> Notes.md) is the same file on
    // macOS and Windows, so it can't be checked for as taken - but on a
    // disk that tells case apart the other name is another file.
    let case_only = to.to_string_lossy().to_lowercase() == path.to_lowercase()
        && crate::atomic::same_file(&from, &to);
    if !case_only && fs::try_exists(&to).await.unwrap_or(true) {
        return Err(crate::errors::error("exists"));
    }
    fs::rename(&from, &to).await.map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().to_string())
}

/// Moves a file or folder to the system's Trash (Recycle Bin), never
/// deleting it, and refuses the folder the tree is showing.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn tree_trash_entry(path: String, root: String) -> Result<(), String> {
    let target = itself(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::atomic::user_file_to_trash(&target, Some(std::path::Path::new(&root)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[tokio::test]
    async fn rename_keeps_documents_documents_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let doc = tree_create_document(root.clone(), "Draft".into())
            .await
            .unwrap();
        let renamed = tree_rename_entry(doc, "Chapter 1".into()).await.unwrap();
        assert!(renamed.ends_with("Chapter 1.md"));
        // A dot in a date or a version isn't a file type.
        let dated = tree_rename_entry(renamed, "Meeting 11.11".into())
            .await
            .unwrap();
        assert!(dated.ends_with("Meeting 11.11.md"));
        let renamed = tree_rename_entry(dated, "Chapter 1".into()).await.unwrap();
        let other = tree_create_document(root.clone(), "Other".into())
            .await
            .unwrap();
        assert!(tree_rename_entry(other.clone(), "Chapter 1".into())
            .await
            .is_err());
        assert!(tree_rename_entry(other.clone(), "../out".into())
            .await
            .is_err());
        let as_text = tree_rename_entry(other, "notes.txt".into()).await.unwrap();
        assert!(as_text.ends_with("notes.txt"));
        let sub = tree_create_folder(root.clone(), "Sub".into())
            .await
            .unwrap();
        let folder = tree_rename_entry(sub, "Part One".into()).await.unwrap();
        assert!(folder.ends_with("Part One"));
        assert!(tree_trash_entry(root.clone(), root).await.is_err());
    }
}
