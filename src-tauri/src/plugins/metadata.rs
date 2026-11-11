//! What Textus knows of the open folder's documents, for plugins: titles, front
//! matter, headings, links, tags and tasks, re-read only when a file's size or
//! time changes. Built on the first request. Lines count from 0.

use super::access::{in_folder, refused, require_not_app_data};
use super::state;
use crate::ai::doc_blocks::Document as DocBlocks;
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

/// A document larger than this is left out of the index: no note is.
const MAX_DOCUMENT_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct HeadingMeta {
    level: u8,
    text: String,
    line: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct LinkMeta {
    /// As written: a path, a URL, or a [[wiki link]]'s name.
    target: String,
    text: String,
    line: u32,
    wiki: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct TaskMeta {
    text: String,
    done: bool,
    due: Option<String>,
    tags: Vec<String>,
    line: u32,
}

/// An Obsidian block id (`^abc123`), the line it marks, and that block's
/// first words.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct BlockIdMeta {
    id: String,
    line: u32,
    text: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct BlockMeta {
    id: String,
    kind: String,
    line: u32,
}

/// One document as the index knows it.
#[derive(Serialize, Clone, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    path: String,
    rel: String,
    title: String,
    /// The YAML of its front matter as written; the window reads it.
    frontmatter: Option<String>,
    headings: Vec<HeadingMeta>,
    links: Vec<LinkMeta>,
    tags: Vec<String>,
    tasks: Vec<TaskMeta>,
    block_ids: Vec<BlockIdMeta>,
    blocks: Option<Vec<BlockMeta>>,
    modified_ms: Option<f64>,
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("a valid pattern"))
}

static HEADING: OnceLock<Regex> = OnceLock::new();
static FENCE: OnceLock<Regex> = OnceLock::new();
static CODE_SPAN: OnceLock<Regex> = OnceLock::new();
static LINK: OnceLock<Regex> = OnceLock::new();
static WIKI: OnceLock<Regex> = OnceLock::new();
static TAG: OnceLock<Regex> = OnceLock::new();
static TASK: OnceLock<Regex> = OnceLock::new();
static DUE: OnceLock<Regex> = OnceLock::new();
static LINK_TARGET: OnceLock<Regex> = OnceLock::new();
static BLOCK_ID: OnceLock<Regex> = OnceLock::new();

/// How much of a block a block id's entry quotes.
const BLOCK_TEXT_CHARS: usize = 60;

/// `line` without its `%%comments%%`, which Obsidian hides and doesn't count:
/// `open` says whether one runs on from an earlier line, and is left saying
/// whether one runs on past this one.
fn without_comments(line: &str, open: &mut bool) -> String {
    let mut out = String::new();
    for (i, part) in line.split("%%").enumerate() {
        if i > 0 {
            *open = !*open;
        }
        if !*open {
            out.push_str(part);
        }
    }
    out
}

/// The front matter's YAML and the line the rest starts on.
fn front_matter(text: &str) -> (Option<String>, usize) {
    let mut lines = text.split('\n');
    if lines.next().map(|l| l.trim_end()) != Some("---") {
        return (None, 0);
    }
    let mut yaml = Vec::new();
    for (i, line) in lines.enumerate() {
        if line.trim_end() == "---" {
            return (Some(yaml.join("\n")), i + 2);
        }
        yaml.push(line.trim_end_matches('\r'));
    }
    (None, 0)
}

fn tags_in(text: &str) -> Vec<String> {
    re(
        &TAG,
        r"(?:^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)",
    )
    .captures_iter(text)
    .map(|c| c[1].trim_end_matches('/').to_string())
    .filter(|t| !t.is_empty())
    .collect()
}

/// What `text` (the document at `path`, `rel` in its folder) holds.
pub fn parse_document(path: &str, rel: &str, text: &str) -> DocumentMeta {
    let (frontmatter, body_start) = front_matter(text);
    let mut headings = Vec::new();
    let mut links = Vec::new();
    let mut tags: Vec<String> = Vec::new();
    let mut seen_tags = HashSet::new();
    let mut tasks = Vec::new();
    let mut block_ids = Vec::new();
    let mut previous_text = String::new();
    let mut fence: Option<char> = None;
    let mut comment = false;
    for (i, raw) in text.split('\n').enumerate().skip(body_start) {
        let line_no = i as u32;
        let raw_line = raw.trim_end_matches('\r');
        if let Some(m) = re(&FENCE, r"^\s{0,3}(`{3,}|~{3,})").captures(raw_line) {
            let c = m[1].chars().next().unwrap_or('`');
            fence = match fence {
                None => Some(c),
                Some(open) if open == c => None,
                other => other,
            };
            continue;
        }
        if fence.is_some() {
            continue;
        }
        let line = &without_comments(raw_line, &mut comment);
        if let Some(b) = re(&BLOCK_ID, r"(?:^|\s)\^([A-Za-z0-9-]+)\s*$").captures(line) {
            let before = line[..b.get(0).map_or(0, |m| m.start())].trim();
            let quoted = if before.is_empty() {
                &previous_text
            } else {
                before
            };
            block_ids.push(BlockIdMeta {
                id: b[1].to_string(),
                line: line_no,
                text: quoted.chars().take(BLOCK_TEXT_CHARS).collect(),
            });
        }
        if !line.trim().is_empty() {
            previous_text = line.trim().to_string();
        }
        // Code spans hold no links or tags.
        let plain = re(&CODE_SPAN, r"`+[^`]*`+").replace_all(line, "");
        if let Some(h) = re(&HEADING, r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$").captures(&plain) {
            headings.push(HeadingMeta {
                level: h[1].len() as u8,
                text: h[2].to_string(),
                line: line_no,
            });
        }
        for l in re(&LINK, r"!?\[([^\]\n]*)\]\((<[^>\n]+>|[^)\s]+)").captures_iter(&plain) {
            let target = l[2].trim_start_matches('<').trim_end_matches('>');
            links.push(LinkMeta {
                target: target.to_string(),
                text: l[1].to_string(),
                line: line_no,
                wiki: false,
            });
        }
        for w in re(&WIKI, r"\[\[([^\]\n]+)\]\]").captures_iter(&plain) {
            let inner = &w[1];
            // In a table the bar is written `\|`; its backslash isn't the name's.
            let (target, label) = match inner.split_once('|') {
                Some((t, l)) => (t.strip_suffix('\\').unwrap_or(t), l),
                None => (inner, inner),
            };
            links.push(LinkMeta {
                target: target.trim().to_string(),
                text: label.trim().to_string(),
                line: line_no,
                wiki: true,
            });
        }
        // A heading's # is not a tag.
        let tag_text = if plain.trim_start().starts_with('#')
            && !headings.is_empty()
            && headings.last().map(|h| h.line) == Some(line_no)
        {
            headings.last().map(|h| h.text.clone()).unwrap_or_default()
        } else {
            // A link's `(#anchor)` is no tag.
            re(&LINK_TARGET, r"\]\([^)\n]*\)")
                .replace_all(&plain, "]")
                .into_owned()
        };
        for tag in tags_in(&tag_text) {
            if seen_tags.insert(tag.to_lowercase()) {
                tags.push(tag);
            }
        }
        if let Some(t) = re(&TASK, r"^\s*(?:[-*+]|\d+[.)])\s+\[([^\]])\]\s+(.*)$").captures(line) {
            let task_text = t[2].to_string();
            let due = re(&DUE, r"(?:📅\s*|due::?\s*)(\d{4}-\d{2}-\d{2})")
                .captures(&task_text)
                .map(|d| d[1].to_string());
            tasks.push(TaskMeta {
                tags: tags_in(&task_text),
                text: task_text,
                done: &t[1] != " ",
                due,
                line: line_no,
            });
        }
    }
    let title = headings.first().map(|h| h.text.clone()).unwrap_or_else(|| {
        Path::new(rel)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default()
    });
    DocumentMeta {
        path: path.to_string(),
        rel: rel.to_string(),
        title,
        frontmatter,
        headings,
        links,
        tags,
        tasks,
        block_ids,
        blocks: None,
        modified_ms: None,
    }
}

/// `text`'s blocks, with the line each starts on.
fn blocks_of(text: &str) -> Vec<BlockMeta> {
    let doc = DocBlocks::from_markdown(text);
    doc.blocks
        .iter()
        .map(|b| BlockMeta {
            id: b.id.clone(),
            kind: b.kind.clone(),
            line: text[..b.start].matches('\n').count() as u32,
        })
        .collect()
}

struct Cached {
    modified: Option<u128>,
    size: u64,
    meta: DocumentMeta,
}

/// The index of every folder a plugin asked about in this run, by root.
#[derive(Default)]
pub struct MetadataIndex(Arc<Mutex<HashMap<String, HashMap<String, Cached>>>>);

fn modified_of(meta: &std::fs::Metadata) -> Option<u128> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
}

fn is_markdown(path: &Path) -> bool {
    matches!(
        crate::extract::extension_of(path).as_str(),
        "md" | "markdown"
    )
}

/// Brings `root`'s index up to date: the paths added, changed or gone.
fn refresh(index: &MetadataIndex, root: &Path) -> Vec<String> {
    let walk = crate::walk::walk(root, &crate::walk::LIMITS, is_markdown);
    let key = root.to_string_lossy().to_string();
    let mut all = index.0.lock().unwrap_or_else(|e| e.into_inner());
    let known = all.entry(key).or_default();
    let mut changed = Vec::new();
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
        if let Some(cached) = known.get(&path) {
            if cached.modified == modified && cached.size == stat.len() {
                continue;
            }
        }
        let Ok(text) = std::fs::read_to_string(&file.path) else {
            continue;
        };
        let mut meta = parse_document(&path, &file.rel, &text);
        meta.modified_ms = modified.map(|m| m as f64);
        known.insert(
            path.clone(),
            Cached {
                modified,
                size: stat.len(),
                meta,
            },
        );
        changed.push(path);
    }
    let gone: Vec<String> = known
        .keys()
        .filter(|p| !present.contains(*p))
        .cloned()
        .collect();
    for path in gone {
        known.remove(&path);
        changed.push(path);
    }
    changed
}

fn checked_root(app: &tauri::AppHandle, id: &str, root: &str) -> Result<(), String> {
    if !state::read(app).allows(id, "files.read") {
        return Err(refused(id, "files.read"));
    }
    if root.is_empty() || !Path::new(root).is_dir() {
        return Err("No folder is open.".to_string());
    }
    require_not_app_data(app, Path::new(root))
}

/// Every document of the folder and what it holds (blocks left out), and
/// the paths that changed since the index was last brought up to date.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct MetadataAll {
    documents: Vec<DocumentMeta>,
    changed: Vec<String>,
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_metadata_all(
    app: tauri::AppHandle,
    index: tauri::State<'_, MetadataIndex>,
    id: String,
    root: String,
) -> Result<MetadataAll, String> {
    checked_root(&app, &id, &root)?;
    let shared = MetadataIndex(index.0.clone());
    let root_path = std::path::PathBuf::from(&root);
    // The walk and the reads are blocking file work.
    let changed = tauri::async_runtime::spawn_blocking(move || refresh(&shared, &root_path))
        .await
        .map_err(|e| e.to_string())?;
    let all = index.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut documents: Vec<DocumentMeta> = all
        .get(&root)
        .map(|docs| docs.values().map(|c| c.meta.clone()).collect())
        .unwrap_or_default();
    documents.sort_by_key(|d| d.rel.to_lowercase());
    Ok(MetadataAll { documents, changed })
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

#[cfg(test)]
mod tests;
