//! Edits written in the reply itself, as `<textus-edit>` tags, for every
//! model. A tool call's arguments stream on some providers and not others
//! (ChatGPT's parallel calls, MiniMax M3 send them whole at the end); the
//! reply's text streams on all of them. Measured on four providers in
//! 1.2.0-rc.6, tags were as accurate as tool calls or more (docs/design/
//! ai-agent.md).
//!
//! Each tag becomes a propose_edit call the model never made - a virtual
//! call, its id `textus-edit-…` - so the rest of the way is the tool's:
//! block ids resolved, conventions fixed, pictures begun, the proposal
//! checked and shown as a card. Pure functions here; agent/ wires them to
//! the stream and the loop.

mod splitter;

#[cfg(test)]
mod tests;

use aicompat::agent::{AgentTurn, ProviderEvent, StepResult};
use serde_json::{Map, Value};
pub use splitter::{Attrs, Piece, TagSplitter};

/// How an edit is handed in, as the model is told it (agent/prompt.rs).
/// One text for every model: measured across four providers, the same
/// rules held for all of them (docs/design/ai-agent.md).
pub const RULES: &str = "Write each edit in your reply itself, after your sentence, as\n<textus-edit block=\"ID\">\nthe new Markdown, as it should read\n</textus-edit>\nwith ID the block's id as the document shows it (`k3f9` for `[#k3f9]`). `to=\"ID\"` makes it a run of blocks, from `block` through `to`, the tag holding the whole run rewritten. `action=\"after\"` or `action=\"before\"` adds the tag's text as new blocks after or before that block (after the run's last block, with `to`); an empty tag deletes the block or run; `quote=\"the exact words now there\"` changes only those words inside the block, the tag holding just their replacement - with `action=\"after\"` it adds the tag's text right after those words instead. Without a block: `action=\"append\"` adds at the end of the document, `action=\"cursor\"` where the user's cursor is (when their message has a <cursor> block), `action=\"selection\"` in place of the text they selected (when it has a <selected-text> block). Each tag on a line of its own; write the Markdown as it is - no escaping, and no block ids inside. Only text inside the tags reaches the document: an edit written any other way is not applied, and never repeat the new text outside the tags. In your thinking, decide only what to change and where; never write the new text out there or rehearse your reply - write it once, straight into its tag.";

/// The prefix of a virtual call's id.
const VIRTUAL: &str = "textus-edit-";

/// The tool a tag stands for.
pub const EDIT_TOOL: &str = "propose_edit";

/// The id of tag `index` of step `step`: the same while the step streams
/// and once it is done.
pub fn call_id(step: usize, index: usize) -> String {
    format!("{VIRTUAL}{step}-{index}")
}

#[cfg(test)]
pub fn is_virtual(call_id: &str) -> bool {
    call_id.starts_with(VIRTUAL)
}

/// A block id as a model may write it: `k3f9`, `#k3f9` or `[#k3f9]`.
fn block_id(raw: &str) -> String {
    raw.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_start_matches('#')
        .to_string()
}

/// propose_edit's action for a tag. `after="b4"` and `before="b4"` name
/// the block and the action at once.
fn action(attrs: &Attrs, empty: bool) -> &'static str {
    if attrs.contains_key("after") {
        return "insert_after";
    }
    if attrs.contains_key("before") {
        return "insert_before";
    }
    match attrs.get("action").map(|a| a.trim().to_ascii_lowercase()) {
        Some(a) if a == "after" || a == "insert_after" => "insert_after",
        Some(a) if a == "before" || a == "insert_before" => "insert_before",
        Some(a) if a == "append" || a == "end" => "append",
        Some(a) if a == "cursor" || a == "insert_at_cursor" => "insert_at_cursor",
        Some(a) if a == "selection" || a == "replace_selection" => "replace_selection",
        Some(a) if a == "delete" => "delete",
        _ if empty => "delete",
        _ => "replace",
    }
}

/// propose_edit's arguments for a tag, `text` left out. The tag itself is
/// kept under `tag`, for the model to be shown again as it wrote it.
pub fn edit_args(attrs: &Attrs, empty: bool) -> Map<String, Value> {
    let mut args = Map::new();
    let action = action(attrs, empty);
    args.insert("action".into(), action.into());
    let first = attrs
        .get("block")
        .or_else(|| attrs.get("after"))
        .or_else(|| attrs.get("before"))
        .map(|b| block_id(b))
        .filter(|b| !b.is_empty());
    let last = attrs
        .get("to")
        .map(|b| block_id(b))
        .filter(|b| !b.is_empty());
    match (action, first, last) {
        // After a run: after its last block.
        ("insert_after", Some(_), Some(last)) => {
            args.insert("block".into(), last.into());
        }
        (_, Some(first), last) => {
            args.insert("block".into(), first.clone().into());
            if let Some(last) = last.filter(|l| *l != first) {
                if matches!(action, "replace" | "delete") {
                    args.insert("last_block".into(), last.into());
                }
            }
        }
        _ => {}
    }
    if let Some(quote) = attrs.get("quote").filter(|q| !q.is_empty()) {
        args.insert("anchor".into(), quote.clone().into());
    }
    args.insert(
        "tag".into(),
        Value::Object(
            attrs
                .iter()
                .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                .collect(),
        ),
    );
    args
}

/// The two spaces a model can't type, as a tag spells them: `&nbsp;` and
/// `&#8239;` (check_conventions says so) - in a tool call's JSON they were
/// `\u00a0` and `\u202f`. No other entity is touched: Markdown may mean
/// one as written.
pub fn spaces(body: &str) -> String {
    body.replace("&nbsp;", "\u{a0}")
        .replace("&#160;", "\u{a0}")
        .replace("&#8239;", "\u{202f}")
        .replace("&#x202F;", "\u{202f}")
        .replace("&#x202f;", "\u{202f}")
}

/// A tag's arguments whole.
pub fn edit_call(attrs: &Attrs, body: &str) -> String {
    let body = &spaces(body);
    let mut args = edit_args(attrs, body.trim().is_empty());
    args.insert("text".into(), body.as_str().into());
    // A quoted change's own words: its `text` becomes the whole block
    // (doc_blocks::resolve_edit_arguments).
    if attrs.contains_key("quote") {
        args.insert(QUOTED_TEXT.into(), body.as_str().into());
    }
    Value::Object(args).to_string()
}

/// Where a quoted change keeps the words the model wrote.
const QUOTED_TEXT: &str = "tag_text";

/// A tag's arguments as they stream: the part before its text, a piece of
/// its text, and the end. Joined, they are `edit_call`'s JSON.
pub fn args_head(attrs: &Attrs) -> String {
    let head = Value::Object(edit_args(attrs, false)).to_string();
    let head = head.strip_suffix('}').unwrap_or(&head);
    if head == "{" {
        "{\"text\":\"".into()
    } else {
        format!("{head},\"text\":\"")
    }
}

pub fn args_piece(text: &str) -> String {
    let quoted = Value::String(text.into()).to_string();
    quoted[1..quoted.len() - 1].to_string()
}

pub const ARGS_TAIL: &str = "\"}";

/// What a streamed reply becomes on the way to the frontend: the reply's
/// text, and each tag as the start and arguments of its propose_edit call -
/// the events a streamed tool call sends, so the edit shows as it is
/// written whatever the provider streams.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outgoing {
    Text(String),
    ToolStart { call_id: String },
    ToolArgs { call_id: String, delta: String },
}

impl Outgoing {
    /// The provider event this piece stands for.
    pub fn event(&self) -> ProviderEvent<'_> {
        match self {
            Outgoing::Text(text) => ProviderEvent::Text(text),
            Outgoing::ToolStart { call_id } => ProviderEvent::ToolStart {
                call_id,
                name: EDIT_TOOL,
            },
            Outgoing::ToolArgs { call_id, delta } => ProviderEvent::ToolArgs { call_id, delta },
        }
    }
}

/// One step's edit tags: split from its reply as it streams when the
/// request takes edits, nothing when it takes none.
#[derive(Debug)]
pub struct StepTags {
    step: usize,
    open: Option<StreamTags>,
}

impl StepTags {
    pub fn new(edits: bool, step: usize) -> Self {
        Self {
            step,
            open: edits.then(|| StreamTags::new(step)),
        }
    }

    /// What a text delta becomes, or None when it passes as it is.
    pub fn text(&mut self, delta: &str) -> Option<Vec<Outgoing>> {
        self.open.as_mut().map(|open| open.text(delta))
    }

    /// What was still held when the step ended.
    pub fn finish(&mut self) -> Vec<Outgoing> {
        self.open
            .as_mut()
            .map(StreamTags::finish)
            .unwrap_or_default()
    }

    /// The step's result, its tags turned into propose_edit calls.
    pub fn settle(&self, result: StepResult) -> StepResult {
        match self.open {
            Some(_) => with_tag_edits(result, self.step),
            None => result,
        }
    }
}

/// One step's reply as it streams.
#[derive(Debug)]
pub struct StreamTags {
    splitter: TagSplitter,
    step: usize,
}

impl StreamTags {
    pub fn new(step: usize) -> Self {
        Self {
            splitter: TagSplitter::default(),
            step,
        }
    }

    pub fn text(&mut self, delta: &str) -> Vec<Outgoing> {
        let pieces = self.splitter.push(delta);
        self.outgoing(pieces)
    }

    /// What was still held when the step ended.
    pub fn finish(&mut self) -> Vec<Outgoing> {
        let pieces = self.splitter.finish();
        self.outgoing(pieces)
    }

    fn outgoing(&self, pieces: Vec<Piece>) -> Vec<Outgoing> {
        let id = |index| call_id(self.step, index);
        let mut out = Vec::new();
        for piece in pieces {
            match piece {
                Piece::Text(text) => out.push(Outgoing::Text(text)),
                Piece::Open { index, attrs } => {
                    out.push(Outgoing::ToolStart { call_id: id(index) });
                    out.push(Outgoing::ToolArgs {
                        call_id: id(index),
                        delta: args_head(&attrs),
                    });
                }
                Piece::Body { index, text } => out.push(Outgoing::ToolArgs {
                    call_id: id(index),
                    delta: args_piece(&text),
                }),
                Piece::Close { index } => out.push(Outgoing::ToolArgs {
                    call_id: id(index),
                    delta: ARGS_TAIL.into(),
                }),
            }
        }
        out
    }
}

/// A reply split whole: the text outside the tags, and each tag with its
/// body.
pub fn split_reply(text: &str) -> (String, Vec<(Attrs, String)>) {
    let mut splitter = TagSplitter::default();
    let mut pieces = splitter.push(text);
    pieces.extend(splitter.finish());
    let mut reply = String::new();
    let mut tags: Vec<(Attrs, String)> = Vec::new();
    for piece in pieces {
        match piece {
            Piece::Text(t) => reply.push_str(&t),
            Piece::Open { attrs, .. } => tags.push((attrs, String::new())),
            Piece::Body { text, .. } => {
                if let Some((_, body)) = tags.last_mut() {
                    body.push_str(&text);
                }
            }
            Piece::Close { .. } => {}
        }
    }
    (tidy_reply(&reply), tags)
}

/// The reply without the blank lines the tags stood on.
fn tidy_reply(reply: &str) -> String {
    let mut out = reply.trim().to_string();
    while out.contains("\n\n\n") {
        out = out.replace("\n\n\n", "\n\n");
    }
    out
}

/// What a reply that only proposed says, should it say nothing itself.
const SILENT_REPLY: &str = "✓";

/// A step with the tags in its reply turned into virtual propose_edit
/// calls, after the step's own calls, and its reply without them. A step
/// without tags is as it was.
pub fn with_tag_edits(result: StepResult, step: usize) -> StepResult {
    let virtual_calls = |tags: Vec<(Attrs, String)>| {
        tags.into_iter()
            .enumerate()
            .map(|(index, (attrs, body))| AgentTurn::ToolCall {
                call_id: call_id(step, index),
                name: EDIT_TOOL.into(),
                arguments: edit_call(&attrs, &body),
                reasoning: None,
            })
            .collect::<Vec<_>>()
    };
    match result {
        StepResult::Done(text) => {
            let (reply, tags) = split_reply(&text);
            if tags.is_empty() {
                return StepResult::Done(text);
            }
            let reply = if reply.is_empty() {
                SILENT_REPLY.to_string()
            } else {
                reply
            };
            let mut calls = vec![AgentTurn::assistant(reply)];
            calls.extend(virtual_calls(tags));
            StepResult::ToolCalls(calls)
        }
        StepResult::ToolCalls(mut calls) => {
            let mut found = Vec::new();
            for turn in &mut calls {
                if let AgentTurn::Assistant { text, .. } = turn {
                    let (reply, tags) = split_reply(text);
                    if !tags.is_empty() {
                        *text = reply;
                        found.extend(tags);
                    }
                }
            }
            calls.extend(virtual_calls(found));
            StepResult::ToolCalls(calls)
        }
    }
}

/// A virtual call's tag as the model wrote it, from its arguments - or,
/// for a propose_edit the model called itself (a conversation from before
/// tags), the tag it would have been.
fn tag_text(arguments: &str) -> String {
    let args: Value = serde_json::from_str(arguments).unwrap_or(Value::Null);
    let tag = match args.get("tag").and_then(Value::as_object) {
        Some(tag) => tag
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
            .collect::<Vec<_>>(),
        None => called_tag(&args),
    };
    let attrs: String = tag
        .iter()
        .map(|(k, v)| format!(" {k}=\"{}\"", v.replace('"', "&quot;")))
        .collect();
    let body = args
        .get(QUOTED_TEXT)
        .or_else(|| args.get("text"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if body.is_empty() {
        format!("<textus-edit{attrs}></textus-edit>")
    } else {
        format!("<textus-edit{attrs}>\n{body}\n</textus-edit>")
    }
}

/// A called propose_edit's arguments as tag attributes.
fn called_tag(args: &Value) -> Vec<(String, String)> {
    let field = |key: &str| {
        args.get(key)
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
    };
    let mut tag = Vec::new();
    if let Some(block) = field("block") {
        tag.push(("block".to_string(), block.to_string()));
    }
    if let Some(last) = field("last_block") {
        tag.push(("to".to_string(), last.to_string()));
    }
    let action = match field("action").unwrap_or("replace") {
        "insert_after" => Some("after"),
        "insert_before" => Some("before"),
        "insert_at_cursor" => Some("cursor"),
        "replace_selection" => Some("selection"),
        "append" => Some("append"),
        _ => None,
    };
    if let Some(action) = action {
        tag.push(("action".to_string(), action.to_string()));
    }
    if let Some(anchor) = field("anchor") {
        tag.push(("quote".to_string(), anchor.to_string()));
    }
    tag
}

/// The conversation as the model is shown it: each step's virtual calls
/// put back as the tags it wrote, after its reply, and what came of them
/// told at the start of the next user message - or in one of their own
/// when the request goes on without one (a tag to send again).
pub fn model_view(turns: Vec<AgentTurn>) -> Vec<AgentTurn> {
    let mut out: Vec<AgentTurn> = Vec::with_capacity(turns.len());
    let mut notes: Vec<String> = Vec::new();
    // Where this step's tags are being put back.
    let mut tags_at: Option<usize> = None;
    let mut numbered = 0;
    let mut edit_calls: std::collections::HashSet<String> = Default::default();
    for turn in turns {
        match turn {
            AgentTurn::ToolCall {
                ref call_id,
                ref name,
                ref arguments,
                ..
            } if name == EDIT_TOOL => {
                edit_calls.insert(call_id.clone());
                let tag = tag_text(arguments);
                match tags_at {
                    Some(at) => {
                        if let AgentTurn::Assistant { text, .. } = &mut out[at] {
                            text.push_str("\n\n");
                            text.push_str(&tag);
                        }
                    }
                    None => {
                        tags_at = Some(out.len());
                        out.push(AgentTurn::assistant(tag));
                    }
                }
            }
            AgentTurn::ToolResult {
                ref call_id,
                ref output,
                ..
            } if edit_calls.contains(call_id) => {
                numbered += 1;
                notes.push(format!("{numbered}. {output}"));
            }
            AgentTurn::Assistant { text, sources } => match tags_at.take() {
                // The step's reply: before its tags, as it was written.
                Some(at) => {
                    if let AgentTurn::Assistant { text: tags, .. } = &mut out[at] {
                        *tags = if text.trim().is_empty() || text == SILENT_REPLY {
                            std::mem::take(tags)
                        } else {
                            format!("{text}\n\n{tags}")
                        };
                    }
                }
                None => out.push(AgentTurn::Assistant { text, sources }),
            },
            AgentTurn::User { text, images } => {
                tags_at = None;
                let text = match take_notes(&mut notes, &mut numbered) {
                    Some(notes) => format!("{notes}\n\n{text}"),
                    None => text,
                };
                out.push(AgentTurn::User { text, images });
            }
            other => out.push(other),
        }
    }
    if let Some(notes) = take_notes(&mut notes, &mut numbered) {
        out.push(AgentTurn::User {
            text: notes,
            images: Vec::new(),
        });
    }
    out
}

fn take_notes(notes: &mut Vec<String>, numbered: &mut usize) -> Option<String> {
    if notes.is_empty() {
        return None;
    }
    *numbered = 0;
    Some(format!(
        "(Textus, on the edits in your last reply, in order:\n{})",
        std::mem::take(notes).join("\n")
    ))
}
