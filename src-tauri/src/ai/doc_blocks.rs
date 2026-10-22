//! The document's blocks and their ids, as the model sees them: each block
//! (paragraph, heading, list item, table, code or maths block) starts with
//! `[#k3f9] `, and an edit names the block it changes instead of quoting
//! it. Quoting cost the whole passage again before anything could show - a
//! rewrite of a whole document began with the whole document, ten seconds
//! of nothing on a ChatGPT subscription (live_eval::latency) - and grew
//! with the document.
//!
//! An id is a hash of the block's markdown, so a block keeps its id from
//! one request to the next while it is unchanged, and an id from before a
//! change names nothing rather than the wrong block. Blocks are split the
//! same way in src/ai/doc-blocks.ts, which places a streaming edit as soon
//! as its block is named; the two are held to the same cases by
//! doc-blocks-cases.json.
//!
//! An edit by id becomes an edit by anchor before anything else sees it
//! (`resolve_edit_arguments`, called on each step's propose_edit calls), so
//! the rest - validation, joins into undecided proposals, the frontend's
//! placing and applying, saved conversations - works as it did.

use serde_json::{Map, Value};

/// One block: its id and where its markdown is, in bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct Block {
    pub id: String,
    pub start: usize,
    pub end: usize,
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

/// FNV-1a over the block's bytes, as base 36: short, and the same in
/// doc-blocks.ts.
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

/// The document's blocks: runs of lines between blank lines, a fenced code
/// or maths block whole.
pub fn split(document: &str) -> Vec<Block> {
    let mut spans: Vec<(usize, usize)> = Vec::new();
    let mut start: Option<usize> = None;
    let mut end = 0;
    let mut fence: Option<&str> = None;
    let mut offset = 0;
    for raw in document.split_inclusive('\n') {
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
    let mut seen: std::collections::HashMap<String, usize> = Default::default();
    spans
        .into_iter()
        .map(|(start, end)| {
            let base = hash_id(&document[start..end]);
            let n = seen.entry(base.clone()).or_insert(0);
            *n += 1;
            let id = if *n == 1 { base } else { format!("{base}-{n}") };
            Block { id, start, end }
        })
        .collect()
}

/// `text` (the document's `[from, to)`) with each block that starts in it
/// marked with its id.
pub fn annotate(document: &str, blocks: &[Block], from: usize, to: usize) -> String {
    let mut out = String::with_capacity(to - from + blocks.len() * 9);
    let mut at = from;
    for block in blocks.iter().filter(|b| b.start >= from && b.start < to) {
        out.push_str(&document[at..block.start]);
        out.push_str("[#");
        out.push_str(&block.id);
        out.push_str("] ");
        at = block.start;
    }
    out.push_str(&document[at..to]);
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

/// A propose_edit call's arguments with `block` turned into an anchor:
///
/// - `block` alone: the anchor is the block's whole text;
/// - `block` and `anchor` (a few words in it) with `replace` or `delete`: a
///   replacement of the whole block, those words changed in it - one edit
///   per block, as the card shows it;
/// - with `insert_after` / `insert_before`: next to the whole block.
///
/// A block that repeats word for word gets the block before it as
/// `context`. An id that names no block is left as `block`, for
/// propose_edit to say so. Markers copied into `anchor` or `text` come out
/// either way. Arguments that aren't JSON are returned as they were.
pub fn resolve_edit_arguments(document: &str, blocks: &[Block], arguments: &str) -> String {
    let Ok(Value::Object(mut args)) = serde_json::from_str::<Value>(arguments) else {
        return arguments.to_string();
    };
    for key in ["anchor", "text", "context"] {
        if let Some(Value::String(s)) = args.get(key) {
            if s.contains("[#") {
                let clean = strip_markers(s);
                args.insert(key.into(), Value::String(clean));
            }
        }
    }
    // A strict schema (OpenAI's) has every field written, the unused ones
    // empty.
    for key in ["anchor", "context", "block", "last_block"] {
        if args.get(key).and_then(|v| v.as_str()) == Some("") {
            args.remove(key);
        }
    }
    let Some(id) = args
        .get("block")
        .and_then(|v| v.as_str())
        .map(|s| s.trim_start_matches('#').to_string())
    else {
        return Value::Object(args).to_string();
    };
    let Some(index) = blocks.iter().position(|b| b.id == id) else {
        return Value::Object(args).to_string();
    };
    // `last_block`: a run of blocks, rewritten in one `text` - a model that
    // sends one call per reply (ChatGPT) rewrites a section or the whole
    // document this way, and the card still splits it by paragraph.
    let last = match args.get("last_block").and_then(|v| v.as_str()) {
        Some(to) => {
            let to = to.trim_start_matches('#');
            match blocks.iter().position(|b| b.id == to) {
                Some(i) if i >= index => i,
                // Unknown, or before `block`: left for propose_edit to refuse.
                _ => return Value::Object(args).to_string(),
            }
        }
        None => index,
    };
    args.remove("last_block");
    let block = &blocks[index];
    let whole = &document[block.start..blocks[last].end];
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
    // Inserting next to words inside the block (inside a sentence, after a
    // list item): those words stay the anchor - next to the whole block
    // would put the text after it - and the block pins down which of them
    // is meant.
    if let Some(part) = quoted
        .as_ref()
        .filter(|_| action == "insert_after" || action == "insert_before")
    {
        args.remove("block");
        if whole.matches(part.as_str()).count() == 1 && document.matches(part.as_str()).count() > 1
        {
            args.insert("context".into(), Value::String(whole.to_string()));
        }
        return reorder(args).to_string();
    }
    if let Some(part) = quoted.filter(|_| action == "replace" || action == "delete") {
        if whole.matches(part.as_str()).count() == 1 {
            let with = args.get("text").and_then(|v| v.as_str()).unwrap_or("");
            let with = if action == "delete" { "" } else { with };
            let text = whole.replacen(part.as_str(), with, 1);
            args.insert("action".into(), Value::String("replace".into()));
            args.insert("text".into(), Value::String(text));
        } else {
            // Not in that block as quoted: left as an anchor of its own.
            args.remove("block");
            return Value::Object(args).to_string();
        }
    }
    args.remove("block");
    if action == "replace" && last > index {
        if let Some(Value::String(text)) = args.get("text") {
            let kept = keep_pictures(document, &blocks[index..=last], text, true);
            args.insert("text".into(), Value::String(kept));
        }
    }
    args.insert("anchor".into(), Value::String(whole.to_string()));
    if document.matches(whole).count() > 1 && index > 0 {
        let before = &blocks[index - 1];
        args.insert(
            "context".into(),
            Value::String(document[before.start..block.end].to_string()),
        );
    }
    reorder(args).to_string()
}

/// An add_comment or generate_image call's arguments with `block` turned
/// into an anchor, as for an insertion by propose_edit: a phrase quoted in
/// `anchor` that the block holds once stays the anchor (a comment on a few
/// words, a picture after a sentence), pinned down by the whole block as
/// `context` where it repeats in the document; otherwise the anchor is the
/// whole block - a paragraph a comment is about or a picture goes next to,
/// or the picture a redo replaces. An id that names no block is left as
/// `block`, for the tool to say so.
pub fn resolve_target_arguments(document: &str, blocks: &[Block], arguments: &str) -> String {
    let Ok(Value::Object(mut args)) = serde_json::from_str::<Value>(arguments) else {
        return arguments.to_string();
    };
    for key in ["anchor", "context"] {
        if let Some(Value::String(s)) = args.get(key) {
            if s.contains("[#") {
                let clean = strip_markers(s);
                args.insert(key.into(), Value::String(clean));
            }
        }
    }
    for key in ["anchor", "context", "block"] {
        if args.get(key).and_then(|v| v.as_str()) == Some("") {
            args.remove(key);
        }
    }
    let Some(index) = args
        .get("block")
        .and_then(|v| v.as_str())
        .map(|s| s.trim_start_matches('#'))
        .and_then(|id| blocks.iter().position(|b| b.id == id))
    else {
        return Value::Object(args).to_string();
    };
    args.remove("block");
    let block = &blocks[index];
    let whole = &document[block.start..block.end];
    let phrase = args
        .get("anchor")
        .and_then(|v| v.as_str())
        .filter(|a| *a != whole && whole.matches(*a).count() == 1)
        .map(str::to_string);
    match phrase {
        Some(phrase) => {
            if document.matches(phrase.as_str()).count() > 1 {
                args.insert("context".into(), Value::String(whole.to_string()));
            }
        }
        None => {
            args.insert("anchor".into(), Value::String(whole.to_string()));
            args.remove("context");
            if document.matches(whole).count() > 1 && index > 0 {
                let before = &blocks[index - 1];
                args.insert(
                    "context".into(),
                    Value::String(document[before.start..block.end].to_string()),
                );
            }
        }
    }
    reorder(args).to_string()
}

/// Whether `block` is a picture and nothing else: `![alt](path)`, or an
/// `<img>` (a picture given a width). isPicture in src/ai/doc-blocks.ts;
/// both are held to keep-pictures-cases.json.
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

/// `text`, a rewrite of the run `run`, with the run's pictures it left out
/// put back: each after as many of the new text's blocks as there were
/// text blocks before it in the run - by the paragraph it stood by, as the
/// card pairs them. A rewrite of a section or the whole document rewrites
/// its words; a picture dropped from it was deleted with nothing said, and
/// the card had nothing to pair paragraph by paragraph (rc.6). A picture
/// the model means to remove it deletes by its block. `complete`: all of
/// `text` is there; while it streams in, a picture whose place it hasn't
/// reached is left out for now (keepPictures in src/ai/doc-blocks.ts).
fn keep_pictures(document: &str, run: &[Block], text: &str, complete: bool) -> String {
    let mut out = text.to_string();
    let mut words_before = 0;
    // Pictures in the new text so far: each moves the later places on by one.
    let mut put = 0;
    for block in run {
        let picture = document[block.start..block.end].trim();
        if !is_picture(picture) {
            words_before += 1;
            continue;
        }
        // Kept where the rewrite has it, it takes a place all the same.
        if out.contains(picture) {
            put += 1;
            continue;
        }
        let blocks = split(&out);
        let at = words_before + put;
        out = if at == 0 {
            format!("{picture}\n\n{}", out.trim_start())
        } else if at < blocks.len() {
            let end = blocks[at - 1].end;
            format!("{}\n\n{picture}\n\n{}", &out[..end], out[end..].trim_start())
        } else if complete && !blocks.is_empty() {
            format!("{}\n\n{picture}", out.trim_end())
        } else {
            continue;
        };
        put += 1;
    }
    out
}

/// Keys in the order the model writes them, so the call reads as before.
fn reorder(mut args: Map<String, Value>) -> Value {
    let mut out = Map::new();
    for key in ["action", "anchor", "context", "text"] {
        if let Some(v) = args.remove(key) {
            out.insert(key.into(), v);
        }
    }
    out.extend(args);
    Value::Object(out)
}

#[cfg(test)]
mod tests;
