//! Where a plugin's file paths may lead: inside the open folder, past no
//! link out of it, into nothing hidden and no other plugin's storage.

use std::path::{Component, Path, PathBuf};

/// `path` resolved inside the open folder `root`: as [`inside`], and in no
/// hidden folder or file of it - .git's hooks and config, an editor's or
/// another app's settings, .env - which hold tokens, or which a write could
/// turn into code that runs. The folder's own .textus is the user's writing
/// (instructions, library, memory, skills), which a sync carries; nothing
/// hidden inside it.
pub(crate) fn in_folder(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let resolved = inside(root, path)?;
    let base = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let hidden = resolved
        .strip_prefix(&base)
        .map(|rel| {
            rel.components().enumerate().any(|(i, c)| {
                matches!(c, Component::Normal(n)
                    if n.to_string_lossy().starts_with('.') && !(i == 0 && n == ".textus"))
            })
        })
        .unwrap_or(true);
    if hidden {
        return Err(
            "Files and folders whose names start with \".\" aren't open to plugins.".to_string(),
        );
    }
    Ok(resolved)
}

/// `path` in the open folder for plugin `id`: as [`in_folder`], and not in
/// another plugin's storage there (`.textus/plugins/<other>/`).
pub(crate) fn plugin_path(root: &Path, path: &Path, id: &str) -> Result<PathBuf, String> {
    let resolved = in_folder(root, path)?;
    let base = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let rel = resolved.strip_prefix(&base).unwrap_or(&resolved);
    if let [".textus", "plugins", owner, ..] = rel
        .components()
        .map(|c| c.as_os_str().to_str().unwrap_or(""))
        .collect::<Vec<_>>()
        .as_slice()
    {
        if *owner != id {
            return Err("Another plugin's files aren't open to this one.".to_string());
        }
    }
    Ok(resolved)
}

/// Whether `rel` passes through anything hidden (`.env`, `.git/config`) or
/// node_modules: what a plugin's own folder serves and lists leaves out.
pub(crate) fn hidden_part(rel: &Path) -> bool {
    rel.components().any(|c| {
        matches!(c, Component::Normal(n)
            if n.to_string_lossy().starts_with('.') || n == "node_modules")
    })
}

/// `path` resolved inside `root`: no `..`, and still under `root` after
/// following links in the part that exists; the rest is kept as named.
pub(crate) fn inside(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("{}: {e}", root.display()))?;
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("A path with \"..\" is refused.".to_string());
    }
    let mut existing = path.clone();
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    while !existing.exists() {
        match existing.file_name() {
            Some(name) => missing.push(name.to_os_string()),
            None => break,
        }
        if !existing.pop() {
            break;
        }
    }
    let mut resolved = std::fs::canonicalize(&existing).map_err(|e| e.to_string())?;
    for name in missing.into_iter().rev() {
        resolved.push(name);
    }
    if resolved.starts_with(&root) {
        Ok(resolved)
    } else {
        Err(format!("{} is outside the folder.", path.display()))
    }
}
