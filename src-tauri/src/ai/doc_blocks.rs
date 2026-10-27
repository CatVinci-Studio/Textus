//! The document's blocks and their ids, as the model sees them: each block
//! starts with `[#k3f9] `, and an edit names its block instead of quoting it.
//! The blocks are the editor's top-level nodes, and the frontend places an edit
//! by its ids, never by searching for its text.

use serde::Deserialize;
use serde_json::{json, Map, Value};

/// An argument added to a run's rewrite that tried to swap a picture: how many
/// it took out. Not the model's to write.
pub const PICTURES_KEPT_KEY: &str = "pictures_kept";

/// An argument added to a run's rewrite with pictures in it: their blocks'
/// ids, which the rewrite keeps as they were. Not the model's to write.
pub const PICTURES_IN_RUN_KEY: &str = "pictures_in_run";

/// One block as the request carries it.
#[derive(Debug, Clone, Deserialize)]
pub struct SentBlock {
    pub id: String,
    pub markdown: String,
    /// What the editor reads it as (`BlockKind`): "paragraph", "picture",
    /// "table"…
    #[serde(default)]
    pub kind: String,
}

/// One block: its id, its kind and where its markdown is in the
/// document's text, in bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct Block {
    pub id: String,
    pub start: usize,
    pub end: usize,
    pub kind: String,
}

/// The document a request is about: its text and its blocks.
#[derive(Debug, Clone, Default)]
pub struct Document {
    pub text: String,
    pub blocks: Vec<Block>,
}

/// What blocks are joined with: one blank line.
const SEPARATOR: &str = "\n\n";

impl Document {
    /// The document from the editor's blocks, their markdown joined.
    pub fn from_blocks(sent: Vec<SentBlock>) -> Self {
        let mut text = String::new();
        let mut blocks = Vec::with_capacity(sent.len());
        for (i, block) in sent.into_iter().enumerate() {
            if i > 0 {
                text.push_str(SEPARATOR);
            }
            let start = text.len();
            text.push_str(&block.markdown);
            blocks.push(Block {
                id: block.id.trim_start_matches('#').to_string(),
                start,
                end: text.len(),
                kind: block.kind,
            });
        }
        Self { text, blocks }
    }

    /// A document no editor stands behind (a project file, a test's) in its
    /// paragraphs, a picture alone in one read as one.
    pub fn from_markdown(text: &str) -> Self {
        let spans = paragraphs(text);
        let ids = block_ids(spans.iter().map(|&(s, e)| &text[s..e]));
        let blocks = spans
            .into_iter()
            .zip(ids)
            .map(|((start, end), id)| Block {
                kind: if is_picture(&text[start..end]) {
                    "picture"
                } else {
                    "paragraph"
                }
                .into(),
                id,
                start,
                end,
            })
            .collect();
        Self {
            text: text.to_string(),
            blocks,
        }
    }

    /// A block's markdown.
    pub fn block_text(&self, block: &Block) -> &str {
        &self.text[block.start..block.end]
    }

    /// The run `block` (to `last_block`) names: its first and last index.
    /// None when an id names no block, or the run is backwards.
    pub fn run(&self, block: &str, last_block: Option<&str>) -> Option<(usize, usize)> {
        let find = |id: &str| {
            let id = clean_id(id);
            self.blocks.iter().position(|b| b.id == id)
        };
        let first = find(block)?;
        let last = match last_block {
            Some(id) => find(id).filter(|&i| i >= first)?,
            None => first,
        };
        Some((first, last))
    }

    /// The run's text, from its first block's start to its last's end.
    pub fn run_text(&self, (first, last): (usize, usize)) -> &str {
        &self.text[self.blocks[first].start..self.blocks[last].end]
    }

    /// Where a call that names its block points, in bytes: the run, or the
    /// words `anchor` quotes once inside it. None when the ids name no run,
    /// or the words aren't in it exactly once.
    pub fn target_span(&self, args: &Value) -> Option<(usize, usize)> {
        let block = args.get("block")?.as_str()?;
        let run = self.run(block, args.get("last_block").and_then(|v| v.as_str()))?;
        let start = self.blocks[run.0].start;
        let text = self.run_text(run);
        match args.get("anchor").and_then(|v| v.as_str()) {
            Some(quote) if !quote.is_empty() && quote != text => (text.matches(quote).count() == 1)
                .then(|| {
                    let at = start + text.find(quote).unwrap_or(0);
                    (at, at + quote.len())
                }),
            _ => Some((start, start + text.len())),
        }
    }
}

/// Whether a call's `block` (with `last_block` and `anchor`) names a place in
/// `document`, else the tool result telling the model how to fix it. The
/// frontend places the call by the same ids, so a call that passes here lands.
pub fn check_target(document: &Document, args: &Value) -> Result<(), String> {
    let Some(block) = args.get("block").and_then(|v| v.as_str()) else {
        return Err(NO_BLOCK.to_string());
    };
    let last = args.get("last_block").and_then(|v| v.as_str());
    if document.run(block, last).is_none() {
        return Err(match last {
            Some(last) => format!("Not proposed: `{block}` to `{last}` isn't a run of blocks the document has now - an id is from before a change or mistyped, or `last_block` comes before `block`. Use ids the document shows now, the first as `block`."),
            None => format!("Not proposed: no block has the id `{block}` - the document has changed since you saw it, or the id is mistyped. Use an id the document shows now, before the block (`[#k3f9]`)."),
        });
    }
    if document.target_span(args).is_none() {
        return Err("Not proposed: the words in `anchor` aren't in that block exactly once. Quote a few words exactly as the block has them - enough to occur once in it - or leave `anchor` out to mean the whole block.".to_string());
    }
    Ok(())
}

/// Told when a call names no block for document text.
pub const NO_BLOCK: &str = "Not proposed: name the passage by its block - `block` takes the id shown before it, like `k3f9` from `[#k3f9]` - and, for a few words inside it, quote them in `anchor`.";

/// An id as a model may write it (`k3f9`, `#k3f9` or `[#k3f9]`) as the id.
pub fn clean_id(id: &str) -> &str {
    id.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_start_matches('#')
        .trim()
}

impl std::ops::Deref for Document {
    type Target = str;
    fn deref(&self) -> &str {
        &self.text
    }
}

/// FNV-1a over the block's bytes, as base 36, matching the frontend's hashId.
fn hash_id(text: &str) -> String {
    let mut h: u32 = 0x811c_9dc5;
    for b in text.as_bytes() {
        h ^= *b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    let mut n = h;
    let mut out = Vec::new();
    for _ in 0..4 {
        let d = (n % 36) as u8;
        out.push(if d < 10 { b'0' + d } else { b'a' + d - 10 });
        n /= 36;
    }
    String::from_utf8(out).unwrap()
}

/// Each block's id: its hash, `-2`, `-3`… where the same text came before.
fn block_ids<'a>(texts: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut seen: std::collections::HashMap<String, usize> = Default::default();
    texts
        .map(|text| {
            let base = hash_id(text);
            let n = seen.entry(base.clone()).or_insert(0);
            *n += 1;
            if *n == 1 {
                base
            } else {
                format!("{base}-{n}")
            }
        })
        .collect()
}

/// A fence that opens a block blank lines don't end: ``` or ~~~ code, $$
/// maths. The marker that closes it.
fn fence_opening(line: &str) -> Option<&'static str> {
    let t = line.trim_start();
    if t.starts_with("```") {
        Some("```")
    } else if t.starts_with("~~~") {
        Some("~~~")
    } else if t.starts_with("$$") {
        Some("$$")
    } else {
        None
    }
}

/// Text with no editor behind it in its paragraphs: runs of lines between
/// blank lines, a fenced code or maths block whole, as byte spans.
pub fn paragraphs(text: &str) -> Vec<(usize, usize)> {
    let mut spans: Vec<(usize, usize)> = Vec::new();
    let mut start: Option<usize> = None;
    let mut end = 0;
    let mut fence: Option<&str> = None;
    let mut offset = 0;
    for raw in text.split_inclusive('\n') {
        let line = raw.trim_end_matches(['\n', '\r']);
        let line_end = offset + line.len();
        if let Some(close) = fence {
            end = line_end;
            if line.trim_start().starts_with(close) {
                fence = None;
            }
        } else if line.trim().is_empty() {
            if let Some(s) = start.take() {
                spans.push((s, end));
            }
        } else {
            if start.is_none() {
                start = Some(offset);
            }
            end = line_end;
            if let Some(close) = fence_opening(line) {
                // A one-line `$$x$$` closes itself.
                let rest = &line.trim_start()[close.len()..];
                if !(close == "$$" && rest.trim_end().ends_with("$$")) {
                    fence = Some(close);
                }
            }
        }
        offset += raw.len();
    }
    if let Some(s) = start {
        spans.push((s, end));
    }
    spans
}

/// `text` (the document's `[from, to)`) with each block that starts in it
/// marked with its id.
pub fn annotate(document: &Document, from: usize, to: usize) -> String {
    let blocks = &document.blocks;
    let mut out = String::with_capacity(to - from + blocks.len() * 9);
    let mut at = from;
    for block in blocks.iter().filter(|b| b.start >= from && b.start < to) {
        out.push_str(&document.text[at..block.start]);
        out.push_str("[#");
        out.push_str(&block.id);
        out.push_str("] ");
        at = block.start;
    }
    out.push_str(&document.text[at..to]);
    out
}

/// The id of the block a byte offset falls in.
pub fn id_at(blocks: &[Block], offset: usize) -> Option<&str> {
    blocks
        .iter()
        .find(|b| offset >= b.start && offset <= b.end)
        .map(|b| b.id.as_str())
}

/// Takes out `[#id] ` markers a model copied into quoted or new text.
fn strip_markers(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("[#") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        let id_len = after.find(']').filter(|&n| {
            (4..=8).contains(&n)
                && after[..n]
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-')
        });
        match id_len {
            Some(n) => {
                rest = &after[n + 1..];
                rest = rest.strip_prefix(' ').unwrap_or(rest);
            }
            None => {
                out.push_str("[#");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// A call's arguments as JSON, markers copied into `keys` taken out and
/// the fields a strict schema (OpenAI's) writes empty left out.
fn cleaned(arguments: &str, keys: &[&str]) -> Option<Map<String, Value>> {
    let Ok(Value::Object(mut args)) = serde_json::from_str::<Value>(arguments) else {
        return None;
    };
    for key in keys {
        if let Some(Value::String(s)) = args.get(*key) {
            if s.contains("[#") {
                let clean = strip_markers(s);
                args.insert((*key).into(), Value::String(clean));
            }
        }
    }
    for key in ["anchor", "block", "last_block"] {
        if args.get(key).and_then(|v| v.as_str()) == Some("") {
            args.remove(key);
        }
    }
    Some(args)
}

/// A propose_edit call's arguments with what its ids stand for filled in, the
/// ids kept. `block` alone names the run; with `anchor` and `replace`/`delete`
/// the whole run is replaced with those words changed; with an insert the words
/// stay the anchor. Ids or words that don't match are left for propose_edit to
/// report. Arguments that aren't JSON are returned as they were.
pub fn resolve_edit_arguments(document: &Document, arguments: &str) -> String {
    let Some(mut args) = cleaned(arguments, &["anchor", "text"]) else {
        return arguments.to_string();
    };
    let Some(block) = args.get("block").and_then(|v| v.as_str()) else {
        return Value::Object(args).to_string();
    };
    let last_block = args.get("last_block").and_then(|v| v.as_str());
    let Some(run) = document.run(block, last_block) else {
        return Value::Object(args).to_string();
    };
    let (first, last) = run;
    let whole = document.run_text(run).to_string();
    args.insert(
        "block".into(),
        Value::String(document.blocks[first].id.clone()),
    );
    if last > first {
        args.insert(
            "last_block".into(),
            Value::String(document.blocks[last].id.clone()),
        );
    } else {
        args.remove("last_block");
    }
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let quoted = args
        .get("anchor")
        .and_then(|v| v.as_str())
        .filter(|a| !a.is_empty() && *a != whole)
        .map(str::to_string);
    if let Some(part) = quoted {
        if whole.matches(part.as_str()).count() != 1 {
            // Not in the run as quoted: propose_edit says so.
            return reorder(args).to_string();
        }
        if action == "insert_after" || action == "insert_before" {
            return reorder(args).to_string();
        }
        if action == "replace" || action == "delete" {
            let with = args.get("text").and_then(|v| v.as_str()).unwrap_or("");
            let with = if action == "delete" { "" } else { with };
            let text = whole.replacen(part.as_str(), with, 1);
            args.insert("action".into(), Value::String("replace".into()));
            args.insert("text".into(), Value::String(text));
        }
    }
    if action == "replace" && last > first {
        if let Some(Value::String(text)) = args.get("text") {
            let run_blocks: Vec<&str> = document.blocks[first..=last]
                .iter()
                .map(|b| document.block_text(b))
                .collect();
            let (kept, swapped) = keep_pictures(&run_blocks, text, true);
            args.insert("text".into(), Value::String(kept));
            // For the tool's result: the model is told to use generate_image.
            if swapped > 0 {
                args.insert(PICTURES_KEPT_KEY.into(), json!(swapped));
            }
            let pictures: Vec<&str> = document.blocks[first..=last]
                .iter()
                .filter(|b| is_picture(document.block_text(b)))
                .map(|b| b.id.as_str())
                .collect();
            if !pictures.is_empty() {
                args.insert(PICTURES_IN_RUN_KEY.into(), json!(pictures));
            }
        }
    }
    args.insert("anchor".into(), Value::String(whole));
    reorder(args).to_string()
}

/// An add_comment or generate_image call's arguments with its block filled in:
/// an `anchor` the block holds once stays the anchor, otherwise the anchor is
/// the whole block. An id that names no block is left for the tool to report.
pub fn resolve_target_arguments(document: &Document, arguments: &str) -> String {
    let Some(mut args) = cleaned(arguments, &["anchor"]) else {
        return arguments.to_string();
    };
    let Some(index) = args
        .get("block")
        .and_then(|v| v.as_str())
        .and_then(|id| document.run(id, None))
        .map(|(first, _)| first)
    else {
        return Value::Object(args).to_string();
    };
    let block = &document.blocks[index];
    let whole = document.block_text(block).to_string();
    args.insert("block".into(), Value::String(block.id.clone()));
    let phrase = args
        .get("anchor")
        .and_then(|v| v.as_str())
        .filter(|a| *a != whole && whole.matches(*a).count() == 1)
        .is_some();
    if !phrase {
        args.insert("anchor".into(), Value::String(whole));
    }
    reorder(args).to_string()
}

/// Keys in the order the model writes them, so the call reads as before.
fn reorder(mut args: Map<String, Value>) -> Value {
    let mut out = Map::new();
    for key in ["action", "block", "last_block", "anchor", "text"] {
        if let Some(v) = args.remove(key) {
            out.insert(key.into(), v);
        }
    }
    out.extend(args);
    Value::Object(out)
}

mod pictures;
use pictures::is_picture;
pub(crate) use pictures::keep_pictures;

#[cfg(test)]
mod tests;
