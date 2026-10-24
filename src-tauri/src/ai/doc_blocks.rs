//! The document's blocks and their ids, as the model sees them: each block
//! starts with `[#k3f9] `, and an edit names the block it changes instead
//! of quoting it. Quoting cost the whole passage again before anything
//! could show - a rewrite of a whole document began with the whole
//! document, ten seconds of nothing on a ChatGPT subscription
//! (live_eval::latency) - and grew with the document.
//!
//! The blocks are the editor's: the request carries them, each top-level
//! node with its id and kind (src/ai/doc-blocks.ts), and the document is
//! their markdown joined. Nothing here splits the document, so the block a
//! model names is a node the editor has - a list or a quote of several
//! paragraphs is one block, as it is one node.
//!
//! An edit keeps the ids it names (`resolve_edit_arguments` only fills in
//! what they stand for), and the frontend places it by them - never by
//! searching the document for its text.

use serde::Deserialize;
use serde_json::{json, Map, Value};

/// An argument resolve_edit_arguments adds to a run's rewrite that tried
/// to swap a picture: how many it took out (tools/edits.rs tells the model
/// so). Not the model's to write.
pub const PICTURES_KEPT_KEY: &str = "pictures_kept";

/// An argument resolve_edit_arguments adds to a run's rewrite with
/// pictures in it: their blocks' ids, which the rewrite keeps as they were
/// (tools/edits.rs tells the model, which redoes one with generate_image
/// when the user asked for it to change). Not the model's to write.
pub const PICTURES_IN_RUN_KEY: &str = "pictures_in_run";

/// One block as the request carries it - `SentBlock` in doc-blocks.ts.
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

/// What blocks are joined with - one blank line, as documentMarkdown does.
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

    /// A document no editor stands behind - a project file, a test's - in
    /// its paragraphs (`paragraphs`), a picture alone in one read as one.
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

/// Whether a call's `block` (with `last_block` and `anchor`) names a place
/// in `document` - the tool result that tells the model how to fix it when
/// not. The frontend places the call by the same ids (matchTarget in
/// src/ai/doc-markdown.ts), so a call that passes here lands.
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

/// An id as a model may write it - `k3f9`, `#k3f9`, or the whole marker
/// `[#k3f9]` it was shown - as the id. cleanId in doc-blocks.ts.
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

/// FNV-1a over the block's bytes, as base 36 - doc-blocks.ts's hashId, for
/// a document that comes as text (`from_markdown`).
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

/// Text with no editor behind it - what the model wrote, a project file -
/// in its paragraphs: runs of lines between blank lines, a fenced code or
/// maths block whole, as byte spans. textParagraphs in doc-blocks.ts.
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

/// A propose_edit call's arguments with what its ids stand for filled in -
/// its ids kept, for the frontend to place it by:
///
/// - `block` alone (and `last_block`): `anchor` is the run's whole text;
/// - `block` and `anchor` (a few words in it) with `replace` or `delete`: a
///   replacement of the whole run, those words changed in it - one edit
///   per block, as the card shows it;
/// - with `insert_after` / `insert_before`: the words stay the anchor, the
///   block telling which of them is meant.
///
/// A run's rewrite keeps the run's pictures (keep_pictures). Ids that name
/// no run, or words not in it once, are left as they came, for
/// propose_edit to say so. Markers copied into `anchor` or `text` come out
/// either way. Arguments that aren't JSON are returned as they were.
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

/// A comment's or a generate_image call's arguments with what its block
/// stands for filled in, as for an insertion by propose_edit: a phrase
/// quoted in `anchor` that the block holds once stays the anchor (a
/// comment on a few words, a picture after a sentence); otherwise the
/// anchor is the whole block - a paragraph a comment is about or a picture
/// goes next to, or the picture a redo replaces. The id is kept, for the
/// frontend to place it by; one that names no block is left, for the tool
/// to say so.
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

/// An add_comment call's arguments with each of its `comments` resolved as
/// [`resolve_target_arguments`] resolves one target.
pub fn resolve_comments_arguments(document: &Document, arguments: &str) -> String {
    let Ok(Value::Object(mut args)) = serde_json::from_str::<Value>(arguments) else {
        return arguments.to_string();
    };
    let Some(Value::Array(items)) = args.remove("comments") else {
        return arguments.to_string();
    };
    let items = items
        .into_iter()
        .map(|item| {
            serde_json::from_str(&resolve_target_arguments(document, &item.to_string()))
                .unwrap_or(item)
        })
        .collect();
    args.insert("comments".into(), Value::Array(items));
    Value::Object(args).to_string()
}

/// Whether `block` is a picture and nothing else: `![alt](path)`, or an
/// `<img>` (a picture given a width) - for text the model wrote, which has
/// no node to ask. isPicture in src/ai/doc-blocks.ts; both are held to
/// keep-pictures-cases.json.
fn is_picture(block: &str) -> bool {
    let b = block.trim();
    if b.contains('\n') {
        return false;
    }
    if let Some(rest) = b.strip_prefix("![") {
        // `![alt](path)`: no `]` in the alt, no `)` in the path.
        return match rest.find(']') {
            Some(close) => rest[close + 1..]
                .strip_prefix('(')
                .and_then(|r| r.strip_suffix(')'))
                .is_some_and(|path| !path.contains(')')),
            None => false,
        };
    }
    b.strip_prefix("<img")
        .and_then(|r| r.strip_suffix('>'))
        .is_some_and(|attrs| attrs.starts_with(char::is_whitespace) && !attrs.contains('>'))
}

/// `text`, a rewrite of the run `run` (its blocks' markdown), with the
/// run's pictures as they were: a text edit never changes a picture -
/// generate_image does. A picture the rewrite left out goes back, after as
/// many of the new text's paragraphs as there were text blocks before it
/// in the run - by the paragraph it stood by, as the card pairs them. A
/// new picture the rewrite wrote where one was is taken out first, the
/// original going back in its place: the swap is the picture tool's to
/// propose, on a card of its own. Before, a picture dropped from a rewrite
/// was deleted with nothing said, a swapped one went with the words, and
/// either way the card had nothing to pair paragraph by paragraph (rc.6).
/// New pictures with every original kept stay. `complete`: all of `text`
/// is there; while it streams in, a picture whose place it hasn't reached
/// is left out for now (keepPictures in src/ai/doc-blocks.ts, held to the
/// same cases by keep-pictures-cases.json). Returns the text and how many
/// swapped pictures were taken out.
pub(crate) fn keep_pictures(run: &[&str], text: &str, complete: bool) -> (String, usize) {
    let originals: Vec<&str> = run
        .iter()
        .map(|b| b.trim())
        .filter(|t| is_picture(t))
        .collect();
    let missing = originals.iter().filter(|p| !text.contains(**p)).count();
    let mut swapped = 0;
    let mut out = if missing == 0 {
        text.to_string()
    } else {
        let kept: Vec<&str> = paragraphs(text)
            .into_iter()
            .map(|(s, e)| &text[s..e])
            .filter(|t| {
                let new = is_picture(t) && !originals.contains(&t.trim());
                if new && swapped < missing {
                    swapped += 1;
                    return false;
                }
                true
            })
            .collect();
        if swapped == 0 {
            text.to_string()
        } else {
            kept.join("\n\n")
        }
    };
    let mut words_before = 0;
    // Pictures in the new text so far: each moves the later places on by one.
    let mut put = 0;
    for block in run {
        let picture = block.trim();
        if !is_picture(picture) {
            words_before += 1;
            continue;
        }
        // Kept where the rewrite has it, it takes a place all the same.
        if out.contains(picture) {
            put += 1;
            continue;
        }
        let spans = paragraphs(&out);
        let at = words_before + put;
        out = if at == 0 {
            format!("{picture}\n\n{}", out.trim_start())
        } else if at < spans.len() {
            let end = spans[at - 1].1;
            format!(
                "{}\n\n{picture}\n\n{}",
                &out[..end],
                out[end..].trim_start()
            )
        } else if complete && !spans.is_empty() {
            format!("{}\n\n{picture}", out.trim_end())
        } else {
            continue;
        };
        put += 1;
    }
    (out, swapped)
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

#[cfg(test)]
mod tests;
