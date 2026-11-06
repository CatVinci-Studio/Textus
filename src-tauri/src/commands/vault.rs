//! Finds the file an Obsidian image embed (`![[name.png]]`), a wikilink
//! (`[[Note]]`) or a Markdown link to a note points at, inside the vault (the
//! folder holding `.obsidian/`, else the folder open in the window when the
//! document is in it, else the document's own folder). A wikilink with a
//! folder is from the vault root. The rules are `link-resolve.ts`'s; both
//! run `src/links/link-resolve.cases.json`.

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

/// The folder a document's links are resolved in: the nearest app that
/// links notes by name (an Obsidian vault, a Logseq graph...), else `folder`
/// (the one open in the window) when the document is inside it, else the
/// document's own folder.
fn vault_root(doc_path: &Path, folder: Option<&Path>) -> Option<PathBuf> {
    let doc_dir = doc_path.parent()?;
    if let Some(root) = crate::conventions::of_folder(doc_dir).notes_root() {
        return Some(root);
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

/// The vault's files, relative to its root with `/`. Hidden folders and
/// `node_modules` are skipped; symlinks are not followed.
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
            } else if kind.is_file() {
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

/// The file names a link may mean, in the order tried: a note first
/// (`[[Note v1.2]]` is `Note v1.2.md`), then the name as written.
fn file_names(link: &str, kind: LinkKind) -> Vec<String> {
    match kind {
        LinkKind::Note if !is_note(Path::new(link)) => vec![
            format!("{link}.md"),
            format!("{link}.markdown"),
            link.to_string(),
        ],
        _ => vec![link.to_string()],
    }
}

/// `link` from the vault-relative folder `dir`, `.` and `..` folded; None
/// above the root.
fn join_rel(dir: &str, link: &str) -> Option<String> {
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for part in link.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

fn folder_of(rel: &str) -> &str {
    rel.rfind('/').map_or("", |i| &rel[..i])
}

fn folders(rel: &str) -> Vec<&str> {
    rel.split('/').filter(|s| !s.is_empty()).collect()
}

/// The indexed file at `rel` in any of its spellings, without case.
fn direct(index: &[String], rel: Option<String>, kind: LinkKind) -> Option<&str> {
    let rel = rel?;
    file_names(&rel, kind).iter().find_map(|name| {
        let lower = name.to_lowercase();
        index
            .iter()
            .find(|p| p.to_lowercase() == lower)
            .map(String::as_str)
    })
}

/// A name, or a path's tail, compared without case as Obsidian does. Ties go
/// to the nearest, then shortest, then alphabetical path.
fn by_name<'a>(index: &'a [String], link: &str, from_dir: &str, kind: LinkKind) -> Option<&'a str> {
    let names = file_names(link, kind);
    // A note's spellings (.md, .markdown) compete as one; a name as written is
    // only tried after them.
    let groups: Vec<&[String]> = if names.len() > 1 {
        vec![&names[..names.len() - 1], &names[names.len() - 1..]]
    } else {
        vec![&names[..]]
    };
    groups.into_iter().find_map(|group| {
        let wanted: Vec<(String, String)> = group
            .iter()
            .map(|name| {
                let lower = name.trim_start_matches("./").to_lowercase();
                let tail = format!("/{lower}");
                (lower, tail)
            })
            .collect();
        index
            .iter()
            .filter(|rel| {
                let rel = rel.to_lowercase();
                wanted
                    .iter()
                    .any(|(lower, tail)| rel == *lower || rel.ends_with(tail))
            })
            .min_by_key(|rel| {
                (
                    folder_distance(&folders(from_dir), &folders(folder_of(rel))),
                    rel.encode_utf16().count(),
                    rel.as_str(),
                )
            })
            .map(String::as_str)
    })
}

/// Picks the indexed file `link` means from the vault-relative file `from`,
/// as `pickNote` in `link-resolve.ts` does.
fn pick_from_index<'a>(
    index: &'a [String],
    link: &str,
    wiki: bool,
    from: &str,
    kind: LinkKind,
) -> Option<&'a str> {
    let link = link.replace('\\', "/");
    let from_dir = folder_of(from);
    let relative = link.starts_with("./") || link.starts_with("../");
    if !wiki || relative {
        let found = direct(index, join_rel(from_dir, &link), kind);
        if found.is_some() || relative || link.contains('/') {
            return found;
        }
        return by_name(index, &link, from_dir, kind);
    }
    if link.contains('/') {
        return direct(index, join_rel("", &link), kind)
            .or_else(|| direct(index, join_rel(from_dir, &link), kind))
            .or_else(|| by_name(index, &link, from_dir, kind));
    }
    by_name(index, &link, from_dir, kind)
}

/// The file of `kind` that `link` names for the document, if it is inside the
/// vault. `index` is asked again, fresh, when the first answer misses. A
/// link from `/` is read from the project's root (`link_root`).
fn resolve_with(
    doc_path: &Path,
    folder: Option<&Path>,
    link: &str,
    kind: LinkKind,
    wiki: bool,
    index: &mut dyn FnMut(&Path, bool) -> Arc<Vec<String>>,
) -> Option<PathBuf> {
    let link = link.trim();
    if link.is_empty() || (Path::new(link).is_absolute() && !link.starts_with('/')) {
        return None;
    }
    let fits = |path: &Path| match kind {
        LinkKind::Image => is_image(path),
        LinkKind::Note => true,
    };
    if let Some(from_root) = link.strip_prefix('/') {
        let root = super::link_root::link_root(doc_path, folder)?;
        return file_names(from_root, kind)
            .iter()
            .filter_map(|name| join_within(&root, &root, name))
            .find(|p| p.is_file() && fits(p));
    }
    let root = vault_root(doc_path, folder)?;
    let inside = |path: PathBuf| -> Option<PathBuf> {
        // A symlink inside the vault can still point out of it.
        let real = path.canonicalize().ok()?;
        let real_root = root.canonicalize().ok()?;
        (real.starts_with(&real_root) && real.is_file() && fits(&path)).then_some(path)
    };
    let from = doc_path
        .strip_prefix(&root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    for fresh in [false, true] {
        let files = index(&root, fresh);
        if let Some(rel) = pick_from_index(&files, link, wiki, &from, kind) {
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
pub(crate) fn cached_index(root: &Path, fresh: bool) -> Arc<Vec<String>> {
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
            true,
            &mut cached_index,
        )
        .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

/// Where a link to a note leads: the file, or for one that doesn't exist,
/// where following it creates it. Shared with `NoteLinkTarget` in
/// `src/platform/ipc-files.ts`.
#[derive(serde::Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct NoteLinkTarget {
    path: String,
    exists: bool,
}

/// Where a new note `link` names goes: a wikilink with a folder from the vault
/// root, a bare name where the vault puts new notes (Obsidian's
/// `newFileLocation`), a Markdown link beside the document.
fn new_note_path(
    doc_path: &Path,
    folder: Option<&Path>,
    link: &str,
    wiki: bool,
) -> Option<PathBuf> {
    let root = vault_root(doc_path, folder)?;
    let doc_dir = doc_path.parent()?;
    let name = file_names(link.trim(), LinkKind::Note).into_iter().next()?;
    let relative = name.starts_with("./") || name.starts_with("../");
    let base = if !wiki || relative {
        doc_dir.to_path_buf()
    } else if name.contains('/') {
        root.clone()
    } else {
        new_note_folder(&root).unwrap_or_else(|| doc_dir.to_path_buf())
    };
    join_within(&root, &base, &name)
}

/// The folder an Obsidian vault puts new notes in, read from `app.json`
/// (never written); None outside a vault, or for "beside the current note".
fn new_note_folder(root: &Path) -> Option<PathBuf> {
    if !root.join(".obsidian").is_dir() {
        return None;
    }
    let json: serde_json::Value = std::fs::read_to_string(root.join(".obsidian/app.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    match json.get("newFileLocation").and_then(|v| v.as_str()) {
        Some("current") => None,
        Some("folder") => {
            let sub = json.get("newFileFolderPath").and_then(|v| v.as_str())?;
            join_within(root, root, sub)
        }
        _ => Some(root.to_path_buf()),
    }
}

/// The file a wikilink's or a Markdown link's note part names, as an absolute
/// path; for one that isn't there, where following it creates it.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn resolve_note_link(
    doc_path: String,
    link: String,
    folder: Option<String>,
    wiki: bool,
) -> Result<Option<NoteLinkTarget>, String> {
    super::fs::require_non_empty(&doc_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let doc = Path::new(&doc_path);
        let folder = folder.as_deref().map(Path::new);
        if let Some(found) =
            resolve_with(doc, folder, &link, LinkKind::Note, wiki, &mut cached_index)
        {
            return Some(NoteLinkTarget {
                path: found.to_string_lossy().to_string(),
                exists: true,
            });
        }
        new_note_path(doc, folder, &link, wiki).map(|p| NoteLinkTarget {
            path: p.to_string_lossy().to_string(),
            exists: false,
        })
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
