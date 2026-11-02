//! The user's reference library (`references/` in the project) as the
//! paper's research sees it: its tools, and how its files are cited.

use super::research::{READ_REFERENCE_TOOL, SEARCH_REFERENCES_TOOL};
use aicompat::agent::{ToolCall, ToolSpec};
use serde_json::{json, Value};
use std::path::Path;

/// What a path can't hold inside a Markdown link: spaces, brackets,
/// parentheses, `%` and control characters (and, as always, non-ASCII).
const LINK_UNSAFE: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
    .add(b' ')
    .add(b'(')
    .add(b')')
    .add(b'[')
    .add(b']')
    .add(b'<')
    .add(b'>')
    .add(b'%');

/// What a web address can't hold inside a Markdown link, `%` aside so an
/// escape already in it stays as it is: a DOI like 10.1061/40927(243)238
/// cut the citation short at its `)`.
const WEB_LINK_UNSAFE: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
    .add(b' ')
    .add(b'(')
    .add(b')')
    .add(b'<')
    .add(b'>');

/// A source's address as the paper's links carry it.
pub(crate) fn link_safe(url: &str) -> String {
    if reference_path(url).is_some() {
        return url.to_string();
    }
    percent_encoding::utf8_percent_encode(url, WEB_LINK_UNSAFE).to_string()
}

/// Where a file of the user's reference library is, as a source's address.
const LIBRARY: &str = "references/";

/// A reference file's address among the paper's sources: its path from the
/// project, each part percent-encoded so the address has no spaces.
pub(crate) fn reference_address(path: &str) -> String {
    let parts: Vec<String> = path
        .trim_start_matches(LIBRARY)
        .split('/')
        .map(|p| percent_encoding::utf8_percent_encode(p, LINK_UNSAFE).to_string())
        .collect();
    format!("{LIBRARY}{}", parts.join("/"))
}

/// The path of the reference file at a source's address, or None for a
/// web page.
pub(crate) fn reference_path(address: &str) -> Option<String> {
    address.starts_with(LIBRARY).then(|| {
        percent_encoding::percent_decode_str(address)
            .decode_utf8_lossy()
            .into_owned()
    })
}

/// The project's reference library: the project folder, when it has one.
pub(super) fn library_file(root: &Path, cited: &str) -> Option<String> {
    let path = cited.trim().trim_start_matches("./");
    let inside = path.starts_with(LIBRARY) && !path.split('/').any(|p| p == "..");
    (inside && root.join(path).is_file()).then(|| path.to_string())
}

/// What the reference library's tools look like to the model.
pub(super) fn library_specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: SEARCH_REFERENCES_TOOL.into(),
            description: "Search the user's reference library - the papers, books and notes in the project's references/ folder - for the passages that best answer a question. Each result is `path:first-last` and the passage.".into(),
            parameters: json!({
                "type": "object",
                "properties": {"query": {"type": "string", "description": "What the passages should be about, in the sources' own words"}},
                "required": ["query"]
            }),
        },
        ToolSpec {
            name: READ_REFERENCE_TOOL.into(),
            description: "Read part of a file in the reference library, by the path and lines search_references gave.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "start_line": {"type": "integer"},
                    "end_line": {"type": "integer"}
                },
                "required": ["path"]
            }),
        },
    ]
}

/// A library tool's answer, or None for another tool. Run off the async
/// threads: a first search extracts and indexes the files.
pub(super) async fn library_call(root: &Path, call: &ToolCall) -> Option<String> {
    let args: Value = serde_json::from_str(&call.arguments).unwrap_or_default();
    let root = root.to_path_buf();
    let answer = match call.name.as_str() {
        SEARCH_REFERENCES_TOOL => {
            let query = args["query"].as_str().unwrap_or("").to_string();
            tokio::task::spawn_blocking(move || {
                crate::ai::project::search_references(&root, &query)
            })
            .await
        }
        READ_REFERENCE_TOOL => {
            let path = args["path"].as_str().unwrap_or("").trim().to_string();
            if library_file(&root, &path).is_none() {
                return Some(format!(
                    "{path:?} isn't a file in references/: pass a path search_references gave."
                ));
            }
            let range = crate::ai::project::LineRange {
                start: args["start_line"].as_u64().map(|n| n as usize),
                end: args["end_line"].as_u64().map(|n| n as usize),
            };
            tokio::task::spawn_blocking(move || {
                crate::ai::project::read_part(&root, &path, range).unwrap_or_else(|why| why)
            })
            .await
        }
        _ => return None,
    };
    let text = answer.unwrap_or_else(|e| e.to_string());
    Some(format!(
        "<external-content source=\"reference library\">\n{text}\n</external-content>"
    ))
}
