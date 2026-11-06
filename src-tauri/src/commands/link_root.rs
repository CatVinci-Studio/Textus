//! The folder a link starting with `/` is read from: GitHub reads it from the
//! repository, VS Code from the workspace and Typora from `typora-root-url`,
//! never from the disk's root. Read only; nothing is written.

use std::path::{Path, PathBuf};

/// How much of a document is read for its front matter.
const FRONT_MATTER_BYTES: usize = 8 * 1024;

/// The value of `key` in the document's front matter (`typora-root-url`,
/// `typora-copy-images-to`), quotes dropped; None when unset or empty. The
/// one reader for Typora's per-document settings.
pub(crate) fn front_matter_value(doc_path: &Path, key: &str) -> Option<String> {
    let bytes = std::fs::read(doc_path).ok()?;
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(FRONT_MATTER_BYTES)]).into_owned();
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let mut lines = text.lines();
    if lines.next()?.trim_end() != "---" {
        return None;
    }
    let value = lines
        .take_while(|l| l.trim_end() != "---")
        .find_map(|l| l.strip_prefix(key)?.strip_prefix(':'))?
        .trim()
        .trim_matches(['"', '\'']);
    (!value.is_empty()).then(|| value.to_string())
}

/// `/`'s folder for the document: its `typora-root-url`, a site's or the
/// git repository's (the folder's conventions), the nearest notes app's, the
/// folder open in the window holding it; None for the disk's root.
pub fn link_root(doc_path: &Path, folder: Option<&Path>) -> Option<PathBuf> {
    let conventions = crate::conventions::of_document(doc_path);
    conventions
        .link_root
        .as_ref()
        .map(|r| PathBuf::from(&r.value))
        .or_else(|| conventions.notes_root())
        .or_else(|| {
            folder
                .filter(|f| doc_path.starts_with(f))
                .map(Path::to_path_buf)
        })
}

/// `link_root` for the window: where `/img/a.png` and `[a](/docs/a.md)` are
/// read from.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn document_link_root(
    doc_path: String,
    folder: Option<String>,
) -> Result<Option<String>, String> {
    super::fs::require_non_empty(&doc_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        link_root(Path::new(&doc_path), folder.as_deref().map(Path::new))
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
