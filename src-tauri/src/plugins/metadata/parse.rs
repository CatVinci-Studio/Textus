//! One document's metadata, read from its text: front matter, headings,
//! links, tags, tasks and block ids, outside code and comments.

use crate::ai::doc_blocks::Document as DocBlocks;
use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::sync::OnceLock;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct HeadingMeta {
    pub(crate) level: u8,
    pub(crate) text: String,
    pub(crate) line: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct LinkMeta {
    /// As written: a path, a URL, or a [[wiki link]]'s name.
    pub(crate) target: String,
    pub(crate) text: String,
    pub(crate) line: u32,
    pub(crate) wiki: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct TaskMeta {
    pub(crate) text: String,
    pub(crate) done: bool,
    /// The character in its brackets: " ", "x", "-", "/" and the like.
    pub(crate) status: String,
    pub(crate) due: Option<String>,
    pub(crate) tags: Vec<String>,
    pub(crate) line: u32,
}

/// An Obsidian block id (`^abc123`), the line it marks, and that block's
/// first words.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct BlockIdMeta {
    pub(crate) id: String,
    pub(crate) line: u32,
    pub(crate) text: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct BlockMeta {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) line: u32,
}

/// One document as the index knows it.
#[derive(Serialize, Clone, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub(crate) path: String,
    pub(crate) rel: String,
    pub(crate) title: String,
    /// The YAML of its front matter as written; the window reads it.
    pub(crate) frontmatter: Option<String>,
    pub(crate) headings: Vec<HeadingMeta>,
    pub(crate) links: Vec<LinkMeta>,
    pub(crate) tags: Vec<String>,
    pub(crate) tasks: Vec<TaskMeta>,
    pub(crate) block_ids: Vec<BlockIdMeta>,
    pub(crate) blocks: Option<Vec<BlockMeta>>,
    pub(crate) modified_ms: Option<f64>,
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
pub(super) fn front_matter(text: &str) -> (Option<String>, usize) {
    crate::frontmatter::split(text)
        .map(|front| (Some(front.yaml()), front.body_line))
        .unwrap_or((None, 0))
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
                status: t[1].to_string(),
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
pub(crate) fn blocks_of(text: &str) -> Vec<BlockMeta> {
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
