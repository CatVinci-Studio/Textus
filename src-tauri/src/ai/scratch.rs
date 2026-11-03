//! Textus AI's scratch space: a folder per conversation in the system's
//! temporary folder, for the files attached to it and the work the agent
//! does without a project folder. Never inside the user's own folders.

use std::path::{Path, PathBuf};

/// The folder in a conversation's scratch space the attachments go to; the
/// file tools address it as `attached/...`.
pub(crate) const ATTACHED: &str = "attached";

/// The user's own folder under the system's temporary folder. On Linux the
/// runtime folder when there is one, since /tmp is shared between users.
fn base() -> Result<PathBuf, String> {
    let temp = std::env::var_os("XDG_RUNTIME_DIR")
        .filter(|_| cfg!(target_os = "linux"))
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(std::env::temp_dir);
    let dir = temp.join("textus-agent");
    private_dir(&dir)?;
    Ok(dir)
}

/// Makes `dir` owner-only, or checks that the one there is ours and not a
/// link someone planted.
fn private_dir(dir: &Path) -> Result<(), String> {
    match crate::atomic::create_private_dir(dir) {
        Ok(()) => return Ok(()),
        Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => return Err(e.to_string()),
        Err(_) => {}
    }
    let meta = std::fs::symlink_metadata(dir).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
        return Err(format!("{} is not a folder.", dir.display()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // SAFETY: geteuid takes nothing and cannot fail.
        let mine = unsafe { libc::geteuid() };
        if meta.uid() != mine || meta.mode() & 0o077 != 0 {
            return Err(format!("{} belongs to someone else.", dir.display()));
        }
    }
    Ok(())
}

/// Whether `id` is safe as one folder name: what the frontend's conversation
/// and paper ids look like.
pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A conversation's scratch folder, made on first use.
pub(crate) fn conversation_dir(id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("Not a conversation id: {id:?}"));
    }
    let dir = base()?.join(id);
    private_dir(&dir)?;
    Ok(dir)
}

/// A conversation's attachments folder, made on first use.
pub(crate) fn attached_dir(id: &str) -> Result<PathBuf, String> {
    let dir = conversation_dir(id)?.join(ATTACHED);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The scratch folder of a conversation that has files attached; nothing is
/// made.
pub(crate) fn with_attachments(id: Option<&str>) -> Option<PathBuf> {
    let id = id.filter(|id| valid_id(id))?;
    let dir = base().ok()?.join(id);
    dir.join(ATTACHED).is_dir().then_some(dir)
}

/// Where research keeps a paper that has no project folder.
pub(crate) fn research_dir() -> Result<PathBuf, String> {
    let dir = base()?.join("research");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_single_safe_folder_names() {
        assert!(valid_id("c-1a2b_3"));
        for bad in ["", "../x", "a/b", "a b", ".", &"x".repeat(65)] {
            assert!(!valid_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_conversation_gets_a_private_attachments_folder() {
        let id = format!("test-{}", std::process::id());
        let dir = attached_dir(&id).unwrap();
        assert!(dir.ends_with(Path::new(&id).join(ATTACHED)));
        assert_eq!(with_attachments(Some(&id)).as_deref(), dir.parent());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.parent().unwrap())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o077, 0);
        }
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
        assert_eq!(with_attachments(Some("../etc")), None);
    }
}
