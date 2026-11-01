//! Finds the file an Obsidian image embed (`![[name.png]]`) or wikilink
//! (`[[Note]]`) points at, inside the vault (the folder holding `.obsidian/`,
//! else the folder open in the window when the document is in it, else the
//! document's own folder). A link with a folder is from the vault root.

use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Image types a vault embed shows; keep in step with the frontend's
/// IMAGE_EXTENSIONS.
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"];

/// The walk that indexes a vault stops here: a vault this size is rare, and a
/// "vault" that is really a home folder must not stall the editor.
const MAX_INDEXED_FILES: usize = 20_000;
const MAX_VISITED_ENTRIES: usize = 200_000;
const MAX_DEPTH: usize = 24;

/// How long an index is trusted. A miss rebuilds it sooner (MISS_REBUILD_AFTER),
/// so a just-saved image shows.
const INDEX_TTL: Duration = Duration::from_secs(60);
const MISS_REBUILD_AFTER: Duration = Duration::from_secs(2);

/// How far up from the document a `.obsidian/` folder is looked for.
const MAX_VAULT_ASCENT: usize = 32;

/// The vault a document belongs to: the nearest folder above it holding
/// `.obsidian/`, else `folder` (the one open in the window) when the document
/// is inside it, else the document's own folder.
fn vault_root(doc_path: &Path, folder: Option<&Path>) -> Option<PathBuf> {
    let doc_dir = doc_path.parent()?;
    let mut dir = Some(doc_dir);
    for _ in 0..MAX_VAULT_ASCENT {
        let Some(current) = dir else { break };
        if current.join(".obsidian").is_dir() {
            return Some(current.to_path_buf());
        }
        dir = current.parent();
    }
    if let Some(folder) = folder.filter(|f| doc_dir.starts_with(f)) {
        return Some(folder.to_path_buf());
    }
    Some(doc_dir.to_path_buf())
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

fn is_note(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
}

/// What a link may name: a picture for an embed, a note for a wikilink.
#[derive(Clone, Copy)]
enum LinkKind {
    Image,
    Note,
}

/// `base` joined with a link's relative path, `.` and `..` folded by hand (the
/// file may not exist). None when absolute or above `root`.
fn join_within(root: &Path, base: &Path, link: &str) -> Option<PathBuf> {
    let link = Path::new(link);
    let mut out = base.to_path_buf();
    for component in link.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    out.starts_with(root).then_some(out)
}

/// The vault's image and note files, relative to its root with `/`. Hidden
/// folders and `node_modules` are skipped; symlinks are not followed.
fn index_vault(root: &Path) -> Vec<String> {
    let mut found = Vec::new();
    let mut visited = 0usize;
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_VISITED_ENTRIES || found.len() >= MAX_INDEXED_FILES {
                return found;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                if name != "node_modules" && depth + 1 < MAX_DEPTH {
                    stack.push((path, depth + 1));
                }
            } else if kind.is_file() && (is_image(&path) || is_note(&path)) {
                if let Ok(rel) = path.strip_prefix(root) {
                    found.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    found
}

/// Folder steps between two vault-relative folders: up from `from` to their
/// common ancestor, then down to `to`. "Closest" for Obsidian's tie-break.
fn folder_distance(from: &[&str], to: &[&str]) -> usize {
    let common = from.iter().zip(to).take_while(|(a, b)| a == b).count();
    (from.len() - common) + (to.len() - common)
}

/// Picks the indexed file a link means, by its tail compared without case, as
/// Obsidian does. Ties go to the nearest, then shortest, then alphabetical path.
fn pick_from_index<'a>(index: &'a [String], link: &str, doc_dir: &[&str]) -> Option<&'a str> {
    let link = link.trim_start_matches("./").to_lowercase();
    if link.is_empty() {
        return None;
    }
    let suffix = format!("/{link}");
    index
        .iter()
        .filter(|rel| {
            let lower = rel.to_lowercase();
            lower == link || lower.ends_with(&suffix)
        })
        .min_by_key(|rel| {
            let folders: Vec<&str> = rel.split('/').collect();
            let folders = &folders[..folders.len() - 1];
            (folder_distance(doc_dir, folders), rel.len(), rel.as_str())
        })
        .map(String::as_str)
}

/// The file of `kind` that `link` names for the document, if it is inside the
/// vault. `index` is asked only when a direct path misses; a note may omit `.md`.
fn resolve_with(
    doc_path: &Path,
    folder: Option<&Path>,
    link: &str,
    kind: LinkKind,
    index: &mut dyn FnMut(&Path, bool) -> Arc<Vec<String>>,
) -> Option<PathBuf> {
    let link = link.trim();
    let named;
    let link = match kind {
        LinkKind::Note if !link.is_empty() && Path::new(link).extension().is_none() => {
            named = format!("{link}.md");
            named.as_str()
        }
        _ => link,
    };
    let fits = match kind {
        LinkKind::Image => is_image(Path::new(link)),
        LinkKind::Note => is_note(Path::new(link)),
    };
    if link.is_empty() || !fits {
        return None;
    }
    let root = vault_root(doc_path, folder)?;
    let doc_dir = doc_path.parent()?;
    let inside = |path: PathBuf| -> Option<PathBuf> {
        // A symlink inside the vault can still point out of it.
        let real = path.canonicalize().ok()?;
        let real_root = root.canonicalize().ok()?;
        (real.starts_with(&real_root) && real.is_file()).then_some(path)
    };

    let relative = link.starts_with("./") || link.starts_with("../");
    // A path from the vault root first, then from the document's folder. A bare
    // name skips the root: the search prefers the copy nearest the document.
    if !relative && link.contains('/') {
        if let Some(found) = join_within(&root, &root, link).and_then(inside) {
            return Some(found);
        }
    }
    if let Some(found) = join_within(&root, doc_dir, link).and_then(inside) {
        return Some(found);
    }
    if relative {
        return None;
    }

    let doc_rel = doc_dir
        .strip_prefix(&root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    let doc_folders: Vec<&str> = doc_rel.split('/').filter(|s| !s.is_empty()).collect();
    for fresh in [false, true] {
        let files = index(&root, fresh);
        if let Some(rel) = pick_from_index(&files, link, &doc_folders) {
            return join_within(&root, &root, rel).and_then(inside);
        }
    }
    None
}

struct CachedIndex {
    root: PathBuf,
    built: Instant,
    files: Arc<Vec<String>>,
}

/// The vaults indexed lately, most recently used first.
const MAX_CACHED_VAULTS: usize = 4;

static INDEXES: Mutex<Vec<CachedIndex>> = Mutex::new(Vec::new());

/// Moves `root`'s index to the front of `cache` (or puts `fresh` there) and
/// drops what falls past MAX_CACHED_VAULTS.
fn touch_cached(cache: &mut Vec<CachedIndex>, root: &Path, fresh: Option<CachedIndex>) {
    let found = cache.iter().position(|c| c.root == root);
    let entry = match (fresh, found) {
        (Some(entry), found) => {
            if let Some(i) = found {
                cache.remove(i);
            }
            entry
        }
        (None, Some(i)) => cache.remove(i),
        (None, None) => return,
    };
    cache.insert(0, entry);
    cache.truncate(MAX_CACHED_VAULTS);
}

/// The vault's index, built again when it is older than INDEX_TTL - or, for
/// a lookup that just missed (`fresh`), older than MISS_REBUILD_AFTER.
fn cached_index(root: &Path, fresh: bool) -> Arc<Vec<String>> {
    let limit = if fresh { MISS_REBUILD_AFTER } else { INDEX_TTL };
    if let Ok(mut cache) = INDEXES.lock() {
        let hit = cache
            .iter()
            .find(|c| c.root == root && c.built.elapsed() < limit)
            .map(|c| c.files.clone());
        if let Some(files) = hit {
            touch_cached(&mut cache, root, None);
            return files;
        }
    }
    let files = Arc::new(index_vault(root));
    if let Ok(mut cache) = INDEXES.lock() {
        let entry = CachedIndex {
            root: root.to_path_buf(),
            built: Instant::now(),
            files: files.clone(),
        };
        touch_cached(&mut cache, root, Some(entry));
    }
    files
}

/// Where an Obsidian image embed's file is, as an absolute path for the asset
/// protocol; None when it isn't an image or isn't in the vault.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn resolve_vault_image(
    doc_path: String,
    link: String,
    folder: Option<String>,
) -> Result<Option<String>, String> {
    super::fs::require_non_empty(&doc_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        resolve_with(
            Path::new(&doc_path),
            folder.as_deref().map(Path::new),
            &link,
            LinkKind::Image,
            &mut cached_index,
        )
        .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

/// The note an Obsidian wikilink names, as an absolute path; None when it isn't
/// in the vault.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn resolve_vault_note(
    doc_path: String,
    link: String,
    folder: Option<String>,
) -> Result<Option<String>, String> {
    super::fs::require_non_empty(&doc_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        resolve_with(
            Path::new(&doc_path),
            folder.as_deref().map(Path::new),
            &link,
            LinkKind::Note,
            &mut cached_index,
        )
        .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
