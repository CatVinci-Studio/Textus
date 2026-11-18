//! What Textus knows of the open folder's documents, for plugins: titles, front
//! matter, headings, links, tags and tasks, re-read only when a file's size or
//! time changes. Built on the first request. Lines count from 0.

use super::access::{checked_root, in_folder};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

use super::workspace::MAX_DOCUMENT_BYTES;

mod parse;
#[cfg(test)]
use parse::front_matter;
pub use parse::*;

struct Cached {
    modified: Option<u128>,
    size: u64,
    meta: DocumentMeta,
    /// The generation it was last read in.
    generation: u64,
}

/// One folder's index, and what changed in it by generation, so a window
/// is sent only what changed since it last asked.
#[derive(Default)]
struct RootIndex {
    docs: HashMap<String, Cached>,
    generation: u64,
    /// Paths gone, each with the generation it went in; the oldest let go.
    removed: Vec<(u64, String)>,
    /// A caller behind this has missed removals: it is sent the whole index.
    floor: u64,
}

/// Removals kept for callers catching up; past it, they get the whole index.
const REMOVALS_KEPT: usize = 4096;
/// Folders kept indexed at once: a window's folder, and another window's.
const ROOTS_KEPT: usize = 2;

static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// The index of the folders plugins ask about, by root.
#[derive(Default)]
pub struct MetadataIndex(Arc<Mutex<HashMap<String, RootIndex>>>);

fn modified_of(meta: &std::fs::Metadata) -> Option<u128> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
}

/// Brings `root`'s index up to date: what was added, changed or gone gets
/// the next generation. Answers a caller at `after` under the same lock,
/// so another folder can't push this one out in between.
fn refresh(index: &MetadataIndex, root: &Path, after: Option<u64>) -> MetadataAll {
    refresh_within(index, root, after, &crate::walk::LIMITS)
}

fn refresh_within(
    index: &MetadataIndex,
    root: &Path,
    after: Option<u64>,
    limits: &crate::walk::Limits,
) -> MetadataAll {
    let walk = crate::walk::walk(root, limits, crate::extract::is_markdown);
    let cut_short = walk.truncated;
    let key = root.to_string_lossy().to_string();
    let mut all = index.0.lock().unwrap_or_else(|e| e.into_inner());
    if !all.contains_key(&key) && all.len() >= ROOTS_KEPT {
        all.clear();
    }
    // Generations count across folders: one dropped and indexed again never
    // repeats a number a window holds, which then gets the whole index.
    let now = GENERATION.load(std::sync::atomic::Ordering::SeqCst);
    let known = all.entry(key).or_insert_with(|| RootIndex {
        generation: now,
        floor: now + 1,
        ..RootIndex::default()
    });
    let next = GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let mut any = false;
    let mut present = HashSet::new();
    for file in walk.files {
        let path = file.path.to_string_lossy().to_string();
        present.insert(path.clone());
        let Ok(stat) = std::fs::metadata(&file.path) else {
            continue;
        };
        if stat.len() > MAX_DOCUMENT_BYTES {
            continue;
        }
        let modified = modified_of(&stat);
        if let Some(cached) = known.docs.get(&path) {
            if cached.modified == modified && cached.size == stat.len() {
                continue;
            }
        }
        let Ok(text) = std::fs::read_to_string(&file.path) else {
            continue;
        };
        let mut meta = parse_document(&path, &file.rel, &text);
        meta.modified_ms = modified.map(|m| m as f64);
        known.docs.insert(
            path,
            Cached {
                modified,
                size: stat.len(),
                meta,
                generation: next,
            },
        );
        any = true;
    }
    let gone: Vec<String> = known
        .docs
        .keys()
        .filter(|p| !present.contains(*p))
        // A walk cut short (a slow drive, a huge folder) reached only part
        // of the folder: what it missed is gone only if its file is.
        .filter(|p| !cut_short || !Path::new(p).exists())
        .cloned()
        .collect();
    for path in gone {
        known.docs.remove(&path);
        known.removed.push((next, path));
        any = true;
    }
    if known.removed.len() > REMOVALS_KEPT {
        let cut = known.removed.len() - REMOVALS_KEPT / 2;
        known.floor = known.removed[cut - 1].0;
        known.removed.drain(..cut);
    }
    if any {
        known.generation = next;
    }
    since(known, after)
}

/// What a caller at generation `since` hasn't seen: everything when it has
/// seen nothing of this index, or missed removals no longer kept.
fn since(known: &RootIndex, since: Option<u64>) -> MetadataAll {
    let whole = since.is_none_or(|s| s < known.floor || s > known.generation);
    let after = if whole { 0 } else { since.unwrap_or(0) };
    let mut documents: Vec<DocumentMeta> = known
        .docs
        .values()
        .filter(|c| c.generation > after)
        .map(|c| c.meta.clone())
        .collect();
    documents.sort_by_key(|d| d.rel.to_lowercase());
    let gone = if whole {
        Vec::new()
    } else {
        known
            .removed
            .iter()
            .filter(|(g, _)| *g > after)
            .map(|(_, p)| p.clone())
            .collect()
    };
    MetadataAll {
        generation: known.generation,
        whole,
        documents,
        gone,
    }
}

/// The folder's documents and what they hold (blocks left out): every one
/// when `whole`, else those changed since the caller's generation, with the
/// paths gone since.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct MetadataAll {
    generation: u64,
    whole: bool,
    documents: Vec<DocumentMeta>,
    gone: Vec<String>,
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_metadata_all(
    app: tauri::AppHandle,
    index: tauri::State<'_, MetadataIndex>,
    id: String,
    root: String,
    after: Option<u64>,
) -> Result<MetadataAll, String> {
    checked_root(&app, &id, &root)?;
    let shared = MetadataIndex(index.0.clone());
    let root_path = std::path::PathBuf::from(&root);
    // The walk and the reads are blocking file work.
    tauri::async_runtime::spawn_blocking(move || refresh(&shared, &root_path, after))
        .await
        .map_err(|e| e.to_string())
}

/// What one document holds now, its blocks with it - read afresh.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_metadata_get(
    app: tauri::AppHandle,
    id: String,
    root: String,
    path: String,
) -> Result<Option<DocumentMeta>, String> {
    checked_root(&app, &id, &root)?;
    let file = in_folder(Path::new(&root), Path::new(&path))?;
    let Ok(text) = tokio::fs::read_to_string(&file).await else {
        return Ok(None);
    };
    let rel = file
        .strip_prefix(std::fs::canonicalize(&root).map_err(|e| e.to_string())?)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.clone());
    let mut meta = parse_document(&file.to_string_lossy(), &rel, &text);
    meta.blocks = Some(blocks_of(&text));
    meta.modified_ms = tokio::fs::metadata(&file)
        .await
        .ok()
        .and_then(|m| modified_of(&m))
        .map(|m| m as f64);
    Ok(Some(meta))
}

pub mod texts;

#[cfg(test)]
mod tests;
