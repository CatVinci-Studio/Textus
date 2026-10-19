//! Finds the file an Obsidian image embed (`![[name.png]]`) or wikilink
//! (`[[Note]]`) points at. The frontend half is in src/editor/images/
//! (obsidian-embed.ts parses the embed, obsidian-embed-preview.ts shows it)
//! and src/editor/markdown/wikilink.ts; this side owns the filesystem.
//!
//! Obsidian resolves a link inside its vault: the folder holding `.obsidian/`.
//! A link with a folder in it (`attachments/a.png`) is a path from the vault
//! root; a bare name (`a.png`) is found anywhere in the vault ("shortest path
//! when possible", Obsidian's default link format). Outside a vault the
//! document's own folder stands in for one.

use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Image types a vault embed shows - the frontend's IMAGE_EXTENSIONS in
/// src/editor/images/obsidian-embed.ts. Anything else (a note, a PDF) stays
/// text.
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"];

/// The walk that indexes a vault stops here: a vault this size is rare, and a
/// "vault" that is really a home folder must not stall the editor.
const MAX_INDEXED_FILES: usize = 20_000;
const MAX_VISITED_ENTRIES: usize = 200_000;
const MAX_DEPTH: usize = 24;

/// How long an index is trusted. A file looked up and not found rebuilds it
/// sooner (MISS_REBUILD_AFTER), so an image saved into the vault a moment
/// ago shows on the next render.
const INDEX_TTL: Duration = Duration::from_secs(60);
const MISS_REBUILD_AFTER: Duration = Duration::from_secs(2);

/// How far up from the document a `.obsidian/` folder is looked for.
const MAX_VAULT_ASCENT: usize = 32;

/// The vault a document belongs to: the nearest folder above it holding
/// `.obsidian/`, or else the document's own folder.
fn vault_root(doc_path: &Path) -> Option<PathBuf> {
    let doc_dir = doc_path.parent()?;
    let mut dir = Some(doc_dir);
    for _ in 0..MAX_VAULT_ASCENT {
        let Some(current) = dir else { break };
        if current.join(".obsidian").is_dir() {
            return Some(current.to_path_buf());
        }
        dir = current.parent();
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

/// `base` joined with a link's relative path, `.` and `..` folded away by
/// hand (the file may not exist, so no canonicalize). None when the path is
/// absolute or climbs above `root` - a link never reaches outside its vault.
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

/// The vault's image and note files, as paths relative to its root with `/`
/// separators. Hidden folders (`.obsidian`, `.git`, `.trash`) are skipped as
/// Obsidian skips them, and so is `node_modules`; symlinks are not followed.
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

/// Picks the indexed file a link means. A link names a file by its tail -
/// `a.png`, or `sub/a.png` - compared without case, as Obsidian does. Of
/// several, the one nearest the document wins, then the shorter path, then
/// the alphabetically first, so the same vault always gives the same answer.
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

/// The file of `kind` that `link` names for the document at `doc_path`, if
/// it exists inside the vault. `index` is asked only when a direct path
/// misses. A note's link may leave out the `.md`, as Obsidian writes it.
fn resolve_with(
    doc_path: &Path,
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
    let root = vault_root(doc_path)?;
    let doc_dir = doc_path.parent()?;
    let inside = |path: PathBuf| -> Option<PathBuf> {
        // A symlink inside the vault can still point out of it.
        let real = path.canonicalize().ok()?;
        let real_root = root.canonicalize().ok()?;
        (real.starts_with(&real_root) && real.is_file()).then_some(path)
    };

    let relative = link.starts_with("./") || link.starts_with("../");
    // A path from the vault root first (Obsidian's "absolute path in
    // vault"), then from the document's folder ("relative path to file").
    // A bare name skips the root: the search below prefers the copy nearest
    // the document, which the root's may not be.
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

/// The vaults indexed lately, most recently used first. A writer keeps a
/// vault or two open; the rest are dropped, not kept for the whole session.
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

/// Where an Obsidian image embed's file is, as an absolute path for the
/// asset protocol; None when it isn't an image or isn't in the vault.
/// Shape shared with fs.resolveVaultImage in src/platform/ipc.ts.
#[tauri::command]
pub async fn resolve_vault_image(doc_path: String, link: String) -> Result<Option<String>, String> {
    super::fs::require_non_empty(&doc_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        resolve_with(
            Path::new(&doc_path),
            &link,
            LinkKind::Image,
            &mut cached_index,
        )
        .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

/// The note an Obsidian wikilink (`[[Note]]`, `[[folder/Note]]`) names, as
/// an absolute path; None when it isn't in the vault. Shape shared with
/// fs.resolveVaultNote in src/platform/ipc.ts.
#[tauri::command]
pub async fn resolve_vault_note(doc_path: String, link: String) -> Result<Option<String>, String> {
    super::fs::require_non_empty(&doc_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        resolve_with(
            Path::new(&doc_path),
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
mod tests {
    use super::*;
    use std::fs;

    /// A throwaway folder under the system temp dir, removed when dropped.
    struct Scratch(PathBuf);

    impl Scratch {
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            // Only ever a folder this module made under the temp dir.
            if self.0.starts_with(std::env::temp_dir()) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
    }

    fn tempdir(name: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("textus-vault-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        // Canonical, so paths compare equal to resolved ones on macOS
        // (/var is /private/var).
        Scratch(dir.canonicalize().unwrap())
    }

    fn touch(root: &Path, rel: &str) -> PathBuf {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"x").unwrap();
        path
    }

    fn resolve(doc: &Path, link: &str) -> Option<PathBuf> {
        resolve_with(doc, link, LinkKind::Image, &mut |root, _| {
            Arc::new(index_vault(root))
        })
    }

    fn resolve_note(doc: &Path, link: &str) -> Option<PathBuf> {
        resolve_with(doc, link, LinkKind::Note, &mut |root, _| {
            Arc::new(index_vault(root))
        })
    }

    #[test]
    fn a_wikilink_finds_the_note_in_the_same_folder_first() {
        let dir = tempdir("a_wikilink_finds_the_note_in_the_same_folder_first");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "notes/a.md");
        let near = touch(dir.path(), "notes/Page.md");
        touch(dir.path(), "Page.md");
        assert_eq!(resolve_note(&doc, "Page"), Some(near.clone()));
        assert_eq!(resolve_note(&doc, "Page.md"), Some(near));
    }

    #[test]
    fn a_wikilink_finds_a_note_anywhere_in_the_vault_by_name() {
        let dir = tempdir("a_wikilink_finds_a_note_anywhere_in_the_vault_by_name");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "a.md");
        let page = touch(dir.path(), "deep/down/Page.md");
        assert_eq!(resolve_note(&doc, "page"), Some(page.clone()));
        assert_eq!(resolve_note(&doc, "down/Page"), Some(page));
        assert_eq!(resolve_note(&doc, "Missing"), None);
    }

    #[test]
    fn a_wikilink_names_notes_not_pictures() {
        let dir = tempdir("a_wikilink_names_notes_not_pictures");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "a.md");
        touch(dir.path(), "pic.png");
        assert_eq!(resolve_note(&doc, "pic.png"), None);
    }

    #[test]
    fn the_vault_is_the_nearest_folder_with_dot_obsidian() {
        let dir = tempdir("the_vault_is_the_nearest_folder_with_dot_obsidian");
        let vault = dir.path().join("vault");
        fs::create_dir_all(vault.join(".obsidian")).unwrap();
        let doc = touch(&vault, "notes/deep/a.md");
        assert_eq!(vault_root(&doc), Some(vault));
    }

    #[test]
    fn without_dot_obsidian_the_documents_folder_is_the_vault() {
        let dir = tempdir("without_dot_obsidian_the_documents_folder_is_the_vault");
        let doc = touch(dir.path(), "notes/a.md");
        assert_eq!(vault_root(&doc), Some(dir.path().join("notes")));
    }

    #[test]
    fn a_path_with_a_folder_is_read_from_the_vault_root() {
        let dir = tempdir("a_path_with_a_folder_is_read_from_the_vault_root");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "notes/a.md");
        let image = touch(dir.path(), "attachments/x.gif");
        assert_eq!(resolve(&doc, "attachments/x.gif"), Some(image));
    }

    #[test]
    fn a_path_relative_to_the_document_resolves_too() {
        let dir = tempdir("a_path_relative_to_the_document_resolves_too");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "notes/a.md");
        let image = touch(dir.path(), "notes/img/x.png");
        assert_eq!(resolve(&doc, "img/x.png"), Some(image.clone()));
        assert_eq!(resolve(&doc, "./img/x.png"), Some(image));
    }

    #[test]
    fn a_bare_name_is_found_anywhere_in_the_vault() {
        let dir = tempdir("a_bare_name_is_found_anywhere_in_the_vault");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "notes/a.md");
        let image = touch(dir.path(), "z/attachments/2024/Pasted image 1.png");
        assert_eq!(resolve(&doc, "Pasted image 1.png"), Some(image.clone()));
        // Obsidian matches names without case.
        assert_eq!(resolve(&doc, "pasted IMAGE 1.png"), Some(image));
    }

    #[test]
    fn of_two_files_with_one_name_the_one_nearest_the_document_wins() {
        let dir = tempdir("of_two_files_with_one_name_the_one_nearest_the_document_wins");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "projects/alpha/a.md");
        touch(dir.path(), "x.png");
        touch(dir.path(), "projects/beta/x.png");
        let near = touch(dir.path(), "projects/alpha/assets/x.png");
        assert_eq!(resolve(&doc, "x.png"), Some(near));
    }

    #[test]
    fn of_two_equally_near_files_the_shorter_path_wins() {
        let dir = tempdir("of_two_equally_near_files_the_shorter_path_wins");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "a.md");
        touch(dir.path(), "long-folder/x.png");
        let short = touch(dir.path(), "b/x.png");
        assert_eq!(resolve(&doc, "x.png"), Some(short));
    }

    #[test]
    fn a_partial_path_matches_the_tail_of_a_longer_one() {
        let dir = tempdir("a_partial_path_matches_the_tail_of_a_longer_one");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "a.md");
        touch(dir.path(), "one/x.png");
        let wanted = touch(dir.path(), "two/sub/x.png");
        assert_eq!(resolve(&doc, "sub/x.png"), Some(wanted));
    }

    #[test]
    fn a_missing_file_resolves_to_nothing() {
        let dir = tempdir("a_missing_file_resolves_to_nothing");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "a.md");
        assert_eq!(resolve(&doc, "nope.png"), None);
        assert_eq!(resolve(&doc, "attachments/nope.png"), None);
    }

    #[test]
    fn a_note_embed_is_not_an_image() {
        let dir = tempdir("a_note_embed_is_not_an_image");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "a.md");
        touch(dir.path(), "Other.md");
        assert_eq!(resolve(&doc, "Other.md"), None);
        assert_eq!(resolve(&doc, "Other"), None);
    }

    #[test]
    fn a_link_never_leaves_the_vault() {
        let dir = tempdir("a_link_never_leaves_the_vault");
        let vault = dir.path().join("vault");
        fs::create_dir_all(vault.join(".obsidian")).unwrap();
        let doc = touch(&vault, "notes/a.md");
        touch(dir.path(), "secret.png");
        assert_eq!(resolve(&doc, "../../secret.png"), None);
        assert_eq!(resolve(&doc, "notes/../../secret.png"), None);
        let absolute = dir.path().join("secret.png");
        assert_eq!(resolve(&doc, &absolute.to_string_lossy()), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_vault_is_not_followed() {
        let dir = tempdir("a_symlink_out_of_the_vault_is_not_followed");
        let vault = dir.path().join("vault");
        fs::create_dir_all(vault.join(".obsidian")).unwrap();
        let doc = touch(&vault, "a.md");
        let outside = touch(dir.path(), "outside/secret.png");
        std::os::unix::fs::symlink(&outside, vault.join("link.png")).unwrap();
        assert_eq!(resolve(&doc, "link.png"), None);
    }

    #[test]
    fn hidden_folders_and_node_modules_are_not_indexed() {
        let dir = tempdir("hidden_folders_and_node_modules_are_not_indexed");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        touch(dir.path(), ".obsidian/plugins/p/icon.png");
        touch(dir.path(), ".trash/old.png");
        touch(dir.path(), "node_modules/pkg/logo.png");
        touch(dir.path(), "notes/kept.png");
        touch(dir.path(), "notes/readme.md");
        touch(dir.path(), "notes/data.csv");
        let mut indexed = index_vault(dir.path());
        indexed.sort();
        assert_eq!(
            indexed,
            vec!["notes/kept.png".to_string(), "notes/readme.md".to_string()]
        );
    }

    #[test]
    fn a_new_file_is_found_after_a_miss_rebuilds_the_index() {
        let dir = tempdir("a_new_file_is_found_after_a_miss_rebuilds_the_index");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        let doc = touch(dir.path(), "a.md");
        let stale = Arc::new(Vec::new());
        let mut asked_fresh = false;
        let image = touch(dir.path(), "late/new.png");
        let found = resolve_with(&doc, "new.png", LinkKind::Image, &mut |root, fresh| {
            if fresh {
                asked_fresh = true;
                Arc::new(index_vault(root))
            } else {
                stale.clone()
            }
        });
        assert!(asked_fresh);
        assert_eq!(found, Some(image));
    }

    #[test]
    fn only_the_most_recently_used_vaults_stay_cached() {
        let entry = |name: &str| CachedIndex {
            root: PathBuf::from(name),
            built: Instant::now(),
            files: Arc::new(Vec::new()),
        };
        let mut cache = Vec::new();
        for name in ["a", "b", "c", "d"] {
            touch_cached(&mut cache, Path::new(name), Some(entry(name)));
        }
        // Using "a" again keeps it; the next new vault pushes out "b".
        touch_cached(&mut cache, Path::new("a"), None);
        touch_cached(&mut cache, Path::new("e"), Some(entry("e")));
        let roots: Vec<_> = cache
            .iter()
            .map(|c| c.root.to_string_lossy().to_string())
            .collect();
        assert_eq!(roots, ["e", "a", "d", "c"]);
    }
}
