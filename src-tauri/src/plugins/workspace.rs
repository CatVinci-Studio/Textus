//! The open folder's Markdown documents for a plugin with
//! `workspace.read`, in one call rather than one read each: all of them
//! with their text (`plugin_fs_documents` - what a graph of links or a
//! list of tasks is built from), or the lines that hold some words
//! (`plugin_fs_search`). Walked as the sidebar walks (crate::walk), so
//! hidden and ignored files are left out and a huge tree stops.

use super::access::refused;
use super::state;
use serde::Serialize;
use std::path::Path;
use std::time::{Duration, Instant};

/// A document larger than this is left out: no notes file is.
const MAX_DOCUMENT_BYTES: u64 = 4 * 1024 * 1024;
/// The most text `plugin_fs_documents` hands over at once.
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
/// The most matching lines a search returns, whatever it asks.
const MAX_SEARCH_HITS: usize = 1000;
/// How long a search reads before it stops.
const SEARCH_TIME: Duration = Duration::from_secs(5);

fn is_markdown(path: &Path) -> bool {
    matches!(
        crate::extract::extension_of(path).as_str(),
        "md" | "markdown"
    )
}

fn checked_root(app: &tauri::AppHandle, id: &str, root: &str) -> Result<(), String> {
    if !state::read(app).allows(id, "workspace.read") {
        return Err(refused(id, "workspace.read"));
    }
    if root.is_empty() || !Path::new(root).is_dir() {
        return Err("No folder is open.".to_string());
    }
    Ok(())
}

/// One document and its text.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDocument {
    path: String,
    /// From the folder, `/`-separated.
    rel: String,
    text: String,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDocuments {
    documents: Vec<WorkspaceDocument>,
    /// The folder holds more than was read: a limit was reached.
    truncated: bool,
}

fn documents_in(root: &Path) -> WorkspaceDocuments {
    let walk = crate::walk::walk(root, &crate::walk::LIMITS, is_markdown);
    let mut truncated = walk.truncated;
    let mut total = 0;
    let mut documents = Vec::new();
    for file in walk.files {
        let size = std::fs::metadata(&file.path).map_or(0, |m| m.len());
        if size > MAX_DOCUMENT_BYTES {
            continue;
        }
        if total + size > MAX_TOTAL_BYTES {
            truncated = true;
            break;
        }
        // Not UTF-8: not a document of ours.
        let Ok(text) = std::fs::read_to_string(&file.path) else {
            continue;
        };
        total += size;
        documents.push(WorkspaceDocument {
            path: file.path.to_string_lossy().to_string(),
            rel: file.rel,
            text,
        });
    }
    WorkspaceDocuments {
        documents,
        truncated,
    }
}

/// Every Markdown document in the folder, in the sidebar's order, with
/// its text.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_documents(
    app: tauri::AppHandle,
    id: String,
    root: String,
) -> Result<WorkspaceDocuments, String> {
    checked_root(&app, &id, &root)?;
    tokio::task::spawn_blocking(move || documents_in(Path::new(&root)))
        .await
        .map_err(|e| e.to_string())
}

/// A line that holds what was searched for.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    path: String,
    rel: String,
    /// 1-based.
    line: u32,
    text: String,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    hits: Vec<SearchHit>,
    /// There may be more: the limit or the time was reached first.
    truncated: bool,
}

fn search_in(root: &Path, query: &str, limit: usize, deadline: Instant) -> SearchResult {
    let needle = query.trim().to_lowercase();
    let mut hits = Vec::new();
    if needle.is_empty() {
        return SearchResult {
            hits,
            truncated: false,
        };
    }
    let walk = crate::walk::walk(root, &crate::walk::LIMITS, is_markdown);
    let mut truncated = walk.truncated;
    'files: for file in walk.files {
        if Instant::now() >= deadline {
            truncated = true;
            break;
        }
        let size = std::fs::metadata(&file.path).map_or(0, |m| m.len());
        if size > MAX_DOCUMENT_BYTES {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&file.path) else {
            continue;
        };
        for (at, line) in text.lines().enumerate() {
            if !line.to_lowercase().contains(&needle) {
                continue;
            }
            if hits.len() == limit {
                truncated = true;
                break 'files;
            }
            hits.push(SearchHit {
                path: file.path.to_string_lossy().to_string(),
                rel: file.rel.clone(),
                line: at as u32 + 1,
                text: line.trim().chars().take(300).collect(),
            });
        }
    }
    SearchResult { hits, truncated }
}

/// The folder's documents' lines holding `query`, ignoring case, in the
/// sidebar's order: at most `limit` of them (and never more than
/// MAX_SEARCH_HITS).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_fs_search(
    app: tauri::AppHandle,
    id: String,
    root: String,
    query: String,
    limit: Option<u32>,
) -> Result<SearchResult, String> {
    checked_root(&app, &id, &root)?;
    let limit = limit.map_or(200, |n| n as usize).clamp(1, MAX_SEARCH_HITS);
    tokio::task::spawn_blocking(move || {
        search_in(
            Path::new(&root),
            &query,
            limit,
            Instant::now() + SEARCH_TIME,
        )
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("a.md"), "# A\n\nSee [[B]].\n- [ ] Call Ann\n").unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/b.markdown"), "B, calling back.\n").unwrap();
        std::fs::write(root.join("notes.txt"), "call me").unwrap();
        std::fs::create_dir(root.join(".hidden")).unwrap();
        std::fs::write(root.join(".hidden/c.md"), "call").unwrap();
        dir
    }

    #[test]
    fn documents_are_the_folders_markdown_with_their_text() {
        let dir = folder();
        let found = documents_in(dir.path());
        let rels: Vec<_> = found.documents.iter().map(|d| d.rel.as_str()).collect();
        assert_eq!(rels, ["sub/b.markdown", "a.md"]);
        assert!(found.documents[1].text.contains("[[B]]"));
        assert!(!found.truncated);
    }

    #[test]
    fn a_search_finds_lines_ignoring_case_and_stops_at_its_limit() {
        let dir = folder();
        let far = Instant::now() + SEARCH_TIME;
        let found = search_in(dir.path(), "CALL", 10, far);
        let lines: Vec<_> = found
            .hits
            .iter()
            .map(|h| (h.rel.as_str(), h.line))
            .collect();
        assert_eq!(lines, [("sub/b.markdown", 1), ("a.md", 4)]);
        assert_eq!(found.hits[1].text, "- [ ] Call Ann");
        assert!(!found.truncated);
        let one = search_in(dir.path(), "call", 1, far);
        assert_eq!(one.hits.len(), 1);
        assert!(one.truncated);
        assert!(search_in(dir.path(), "  ", 10, far).hits.is_empty());
    }
}
