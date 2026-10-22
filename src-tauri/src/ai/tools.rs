use crate::ai::agent::AgentMode;
use crate::ai::builtin;
use crate::ai::workspace::{AgentSkill, Invocation};
use aicompat::agent::{ToolCall, ToolOutput, ToolRun, ToolSpec};
use serde_json::json;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;

/// Everything a tool implementation needs to actually do its work. Grows as
/// more tools need more context (e.g. an MCP client handle) without changing
/// each tool's call signature.
pub struct ToolContext<'a> {
    /// Proposals from earlier requests the user hasn't accepted or
    /// rejected (images::undecided_edits): their text is part of the
    /// document as the user sees it, in place of what a rewrite replaces,
    /// so an edit may change it - the frontend puts that edit into the
    /// proposal (usePendingEdits's joinEdit).
    pub undecided: &'a [crate::ai::images::UndecidedEdit],
    pub document: &'a str,
    /// The merged skills: built-in, global config folder, project .textus/.
    pub skills: &'a [AgentSkill],
    /// The UI language (src/i18n/langs.ts) - which language's writing
    /// conventions a skill gets when the document is too short to tell.
    pub ui_language: &'a str,
    /// The project folder (workspace root) - the sandbox boundary for the
    /// file tools. The document's own folder by default, or the chosen
    /// project folder (see workspace::resolve_root). None for an unsaved
    /// draft with no folder chosen, or a folder too broad to use, in which
    /// case the file tools aren't offered at all.
    pub root: Option<&'a Path>,
    /// The provider takes images (catalog's `supports_vision`, the gate on
    /// the chat's image attachments): the file tools then list images and
    /// view_image shows them.
    pub sees_images: bool,
    /// The writing conventions (setting and style-profile front matter)
    /// check_conventions checks against.
    pub conventions: &'a crate::ai::rules::Conventions,
    /// Library names and aliases, for the library-name rule.
    pub library: &'a [String],
    /// Where the remember tool writes; None when it isn't offered.
    pub memory: Option<&'a crate::ai::memory::MemoryContext>,
    /// The passages this request's proposals already replace or delete
    /// (their `context`, else their anchor; "" for the selection). One
    /// context serves one request, every step of it.
    pub proposed: std::sync::Mutex<ProposalLedger>,
    /// How often this request has called each check tool (CHECK_BUDGETS).
    pub checks: std::sync::Mutex<std::collections::HashMap<&'static str, usize>>,
}

/// What this request's propose_edit calls have done so far.
#[derive(Debug, Default)]
pub struct ProposalLedger {
    /// The passages proposals already replace or delete.
    passages: Vec<ProposedPassage>,
    /// Replacements refused once as looking cut off (degenerate_replacement),
    /// as `anchor\0text`: the same call sent again is meant, and goes through.
    refused_short: Vec<String>,
    /// The new text of each proposal made: a picture may go next to a
    /// paragraph of it (ai::images), though it isn't in the document yet.
    texts: Vec<String>,
    /// The pictures this request wrote into its text (images::inline), by
    /// id.
    pictures: Vec<String>,
    /// Why pictures written into the text were left out of it (the limit
    /// reached), for propose_edit's result to say.
    unmade: Vec<String>,
}

impl ProposalLedger {
    /// A ledger that knows these pictures already: earlier requests',
    /// not decided yet, which this request's text may carry.
    pub fn with_pictures(pictures: Vec<String>) -> Self {
        Self {
            pictures,
            ..Self::default()
        }
    }

    /// A picture written into text this request proposes.
    pub fn add_picture(&mut self, id: String) {
        self.pictures.push(id);
    }

    /// The pictures written into this request's text, by id.
    #[cfg(test)]
    pub fn pictures(&self) -> &[String] {
        &self.pictures
    }

    /// A picture written into the text was left out, and why.
    pub fn note_unmade(&mut self, why: String) {
        if !self.unmade.contains(&why) {
            self.unmade.push(why);
        }
    }

    /// What the pictures left out of the text since last asked came to.
    pub fn take_unmade(&mut self) -> Option<String> {
        (!self.unmade.is_empty()).then(|| {
            format!(
                " A picture line was left out of the text: {}",
                std::mem::take(&mut self.unmade).join(" ")
            )
        })
    }

    /// Why `text`'s pictures can't stand: one put in twice, or one this
    /// request never asked for - a long id copied wrong drew one picture
    /// in two places. None when they can, or none were asked for.
    fn pictures_problem(&self, text: &str) -> Option<String> {
        if self.pictures.is_empty() {
            return None;
        }
        let mut used: Vec<&str> = Vec::new();
        for (at, _) in text.match_indices("textus-generated:") {
            let id: String = text[at + "textus-generated:".len()..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric())
                .collect();
            let Some(known) = self.pictures.iter().find(|p| **p == id) else {
                let missing: Vec<&str> = self.pictures.iter().map(String::as_str).collect();
                return Some(format!("Not proposed: `textus-generated:{id}` is no picture of this request. Its pictures are: {}.", missing.join(", ")));
            };
            if used.contains(&known.as_str()) {
                let left: Vec<&str> = self
                    .pictures
                    .iter()
                    .map(String::as_str)
                    .filter(|p| !used.contains(p) && *p != known)
                    .collect();
                return Some(format!(
                    "Not proposed: the picture `{id}` is in the text twice. Each picture goes in once{} - send the text again with each in its place.",
                    if left.is_empty() { String::new() } else { format!("; not placed yet: {}", left.join(", ")) }
                ));
            }
            used.push(known);
        }
        None
    }
    /// The new text of each proposal this request has made, in order.
    pub fn texts(&self) -> &[String] {
        &self.texts
    }

    /// A ledger whose proposals made these texts.
    #[cfg(test)]
    pub fn with_texts(texts: &[&str]) -> Self {
        Self {
            texts: texts.iter().map(|t| t.to_string()).collect(),
            ..Self::default()
        }
    }
}

/// A passage one of this request's proposals replaces or deletes: where it
/// sits in the document when the anchor (or its disambiguating context)
/// is found there verbatim, and the quoted text either way. Two proposals
/// overlap when their spans intersect - two fixes of the same repeated
/// word in one paragraph, pinned by overlapping contexts, are different
/// passages - and, where a span couldn't be placed, when one quote
/// contains the other.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProposedPassage {
    /// Byte range in the document.
    span: Option<(usize, usize)>,
    /// The context if it pins the anchor, else the anchor; "" for the
    /// selection.
    quote: String,
}

impl ProposedPassage {
    fn selection() -> Self {
        Self::default()
    }

    fn locate(document: &str, anchor: &str, context: Option<&str>) -> Self {
        let context = context.filter(|c| c.len() > anchor.len() && c.contains(anchor));
        let span = match context {
            Some(c) if document.matches(c).count() == 1 => document
                .find(c)
                .zip(c.find(anchor))
                .map(|(at, offset)| at + offset),
            _ if document.matches(anchor).count() == 1 => document.find(anchor),
            _ => None,
        }
        .map(|start| (start, start + anchor.len()));
        Self {
            span,
            quote: context.unwrap_or(anchor).to_string(),
        }
    }

    fn overlaps(&self, other: &Self) -> bool {
        if let (Some(a), Some(b)) = (self.span, other.span) {
            return a.0 < b.1 && b.0 < a.1;
        }
        let (p, q) = (self.quote.as_str(), other.quote.as_str());
        (p.is_empty() && q.is_empty())
            || (!p.is_empty() && !q.is_empty() && (p.contains(q) || q.contains(p)))
    }
}

/// A tool the agent can call: what the model is told (name, description,
/// JSON schema), what calling it does, the modes it is offered in, and its
/// implementation. Built-in tools (like `search_document` below) run here;
/// the web tools and generate_image are added per request
/// ([`ToolRegistry::add`]), and a plugin's or an MCP server's tools will be
/// too - a spec from the plugin or server, and an [`Run::Async`] that
/// forwards the call.
pub struct Tool<'a> {
    pub spec: ToolSpec,
    pub access: Access,
    pub modes: &'static [AgentMode],
    pub run: Run<'a>,
}

/// What calling a tool does, which decides how its calls run
/// ([`ToolRegistry::how_to_run`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// Only reads (the document, the project, the web): a step's reads run
    /// together.
    ReadOnly,
    /// Proposes a change the user reviews, or changes something of
    /// Textus AI's own (a memory): one call at a time, in call order.
    Proposes,
    /// Proposes, and records what it made in its own call (generate_image's
    /// picture), which is where the frontend reads the proposal from.
    ProposesInItsCall,
}

/// The modes a tool is offered in.
pub const EVERY_MODE: &[AgentMode] = &[AgentMode::Review, AgentMode::Revise, AgentMode::Write];
/// Write and Revise: the modes that change the document.
pub const EDITING_MODES: &[AgentMode] = &[AgentMode::Revise, AgentMode::Write];

pub type ToolFuture<'a> = Pin<Box<dyn Future<Output = ToolOutput> + Send + 'a>>;

/// A tool's implementation, by what it answers with.
pub enum Run<'a> {
    Text(fn(&ToolContext, &str) -> String),
    /// Text and images for the model to look at (view_image).
    Seeing(fn(&ToolContext, &str) -> ToolOutput),
    /// Awaited, with what it needs captured: a search, a page read, a
    /// picture being made - work that waits on the network, which Stop
    /// drops in flight.
    Async(Box<dyn Fn(ToolCall) -> ToolFuture<'a> + Send + Sync + 'a>),
}

const SEARCH_TOOL_NAME: &str = "search_document";

fn search_document(ctx: &ToolContext, arguments: &str) -> String {
    let query = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| {
            v.get("query")
                .and_then(|q| q.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();

    if query.trim().is_empty() {
        return "No query provided.".to_string();
    }

    let query_lower = query.to_lowercase();
    let matches: Vec<String> = ctx
        .document
        .lines()
        .enumerate()
        .filter(|(_, line)| line.to_lowercase().contains(&query_lower))
        .map(|(i, line)| format!("{}: {}", i + 1, line))
        .take(20)
        .collect();

    if matches.is_empty() {
        format!("No matches found for \"{query}\".")
    } else {
        matches.join("\n")
    }
}

const READ_DOCUMENT_TOOL_NAME: &str = "read_document";

/// Most a single read_document call returns; a longer range comes back cut
/// at a line boundary with a pointer to where to continue.
const MAX_READ_DOCUMENT_CHARS: usize = 12_000;

/// The ATX heading level of a markdown line (`## Title` -> 2), or None.
fn heading_level(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|&c| c == '#').count();
    ((1..=6).contains(&hashes) && trimmed.as_bytes().get(hashes) == Some(&b' ')).then_some(hashes)
}

/// Line indexes (0-based) of headings outside fenced code blocks - a `# `
/// comment in a shell snippet isn't a section.
pub(crate) fn heading_lines(lines: &[&str]) -> Vec<(usize, usize)> {
    let mut in_fence = false;
    let mut headings = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if !in_fence {
            if let Some(level) = heading_level(line) {
                headings.push((i, level));
            }
        }
    }
    headings
}

/// The line range `[start, end)` of the section under `heading`: from the
/// heading to the next one at its level or above, so "Methods" includes its
/// subsections. An exact title wins; otherwise the first heading containing
/// it, ignoring case. Shared by read_document and agent.rs's focus section,
/// so "section" means the same thing to the model and to the prompt.
pub(crate) fn section_range(lines: &[&str], heading: &str) -> Option<(usize, usize)> {
    let wanted = heading.trim().trim_start_matches('#').trim();
    if wanted.is_empty() {
        return None;
    }
    let headings = heading_lines(lines);
    let title = |i: usize| lines[i].trim_start().trim_start_matches('#').trim();
    let lower = wanted.to_lowercase();
    let pos = headings
        .iter()
        .position(|&(i, _)| title(i) == wanted)
        .or_else(|| {
            headings
                .iter()
                .position(|&(i, _)| title(i).to_lowercase().contains(&lower))
        })?;
    let (first, level) = headings[pos];
    let last = headings[pos + 1..]
        .iter()
        .find(|&&(_, l)| l <= level)
        .map_or(lines.len(), |&(i, _)| i);
    Some((first, last))
}

/// Reads part of the document verbatim - a section by its heading, or a
/// line range. The embedded document is only an outline plus excerpts once
/// it is long (agent.rs's document_section), and search_document only ever
/// shows single lines: without this the model had no way to see a whole
/// passage it was asked to revise, nor a multi-line anchor to quote.
fn read_document(ctx: &ToolContext, arguments: &str) -> String {
    let args: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let lines: Vec<&str> = ctx.document.lines().collect();
    if lines.is_empty() {
        return "The document is empty.".to_string();
    }
    let total = lines.len();

    let (start, end) = if let Some(heading) = args
        .get("heading")
        .and_then(|h| h.as_str())
        .map(str::trim)
        .filter(|h| !h.is_empty())
    {
        match section_range(&lines, heading) {
            Some(range) => range,
            None => {
                return format!("No heading matching \"{heading}\". The outline in the document section lists them.")
            }
        }
    } else {
        let line_arg = |key: &str| args.get(key).and_then(|v| v.as_u64()).map(|n| n as usize);
        let start = line_arg("start_line").unwrap_or(1).clamp(1, total) - 1;
        let end = line_arg("end_line")
            .unwrap_or(total)
            .clamp(start + 1, total);
        (start, end)
    };

    let mut out = String::new();
    let mut shown_end = start;
    for line in &lines[start..end] {
        if !out.is_empty() && out.len() + line.len() + 1 > MAX_READ_DOCUMENT_CHARS {
            break;
        }
        out.push_str(line);
        out.push('\n');
        shown_end += 1;
    }
    let mut header = format!("Lines {}-{} of {total}:", start + 1, shown_end);
    if shown_end < end {
        header.push_str(&format!(
            " (cut for length - continue with start_line={})",
            shown_end + 1
        ));
    }
    // The blocks in it marked with their ids, as the document section is
    // (doc_blocks.rs), for an edit to name.
    let line_starts: Vec<usize> = std::iter::once(0)
        .chain(ctx.document.split_inclusive('\n').scan(0, |at, line| {
            *at += line.len();
            Some(*at)
        }))
        .collect();
    let from = line_starts[start];
    let to = line_starts
        .get(shown_end)
        .copied()
        .unwrap_or(ctx.document.len())
        .min(ctx.document.len());
    let blocks = crate::ai::doc_blocks::split(ctx.document);
    let marked = crate::ai::doc_blocks::annotate(ctx.document, &blocks, from, to);
    let out = if marked.ends_with('\n') {
        marked
    } else {
        format!("{marked}\n")
    };
    format!("{header}\n{out}")
}

pub(crate) const PROPOSE_EDIT_TOOL_NAME: &str = "propose_edit";
/// How a valid proposal's result starts - and a valid comment's below:
/// such a call needs nothing more from the model (ToolOutput::settled).
const EDIT_PROPOSED: &str = "Edit proposed";

/// The edit operations the frontend knows how to apply. Kept in sync with
/// `EditAction` in src/ai/types.ts - adding one here without teaching
/// the frontend (usePendingEdits.ts, which resolves proposals, and
/// apply-edit.ts, which writes them) about it produces proposals that validate but
/// can't be applied.
const EDIT_ACTIONS: [&str; 7] = [
    "replace",
    "replace_selection",
    "insert_before",
    "insert_after",
    "delete",
    "append",
    "insert_at_cursor",
];

/// The actions that only add text - all Write mode's propose_edit offers
/// (agent::AgentMode).
pub(crate) const INSERT_ACTIONS: [&str; 4] = [
    "append",
    "insert_at_cursor",
    "insert_after",
    "insert_before",
];

fn needs_anchor(action: &str) -> bool {
    // replace_selection targets the user's captured selection, so there is
    // no anchor to locate (and the selection may not be unique in the
    // document anyway - that's the point of having the action).
    action != "append" && action != "replace_selection" && action != "insert_at_cursor"
}

fn needs_text(action: &str) -> bool {
    action != "delete"
}

/// Doesn't modify anything itself - the document only ever changes through
/// the user clicking Apply in the frontend. This validates the proposal
/// against the same rules the frontend applies with (known action, required
/// fields present, `anchor` matching the document exactly once) so the model
/// gets immediate feedback instead of the user getting a dead Apply button.
fn propose_edit(ctx: &ToolContext, arguments: &str) -> String {
    let parsed: serde_json::Value = match serde_json::from_str(arguments) {
        Ok(v) => v,
        Err(_) => return "Invalid arguments - expected JSON with an `action` string.".to_string(),
    };
    let action = parsed.get("action").and_then(|v| v.as_str()).unwrap_or("");
    if !EDIT_ACTIONS.contains(&action) {
        return format!(
            "Unknown action `{action}`. Use one of: {}.",
            EDIT_ACTIONS.join(", ")
        );
    }

    // A `block` still here named no block (doc_blocks::resolve_edit_arguments
    // turns every one it finds into an anchor): from an earlier request,
    // before the block changed, or made up.
    if let Some(block) = parsed.get("block").and_then(|v| v.as_str()) {
        let through = parsed.get("last_block").and_then(|v| v.as_str());
        return match through {
            Some(last) => format!("Not proposed: `{block}` to `{last}` isn't a run of blocks the document has now - an id is from before a change or mistyped, or `last_block` comes before `block`. Use ids the document shows now, the first as `block`."),
            None => format!("Not proposed: no block has the id `{block}` - the document has changed since you saw it, or the id is mistyped. Use an id the document shows now, before the block (`[#k3f9]`)."),
        };
    }
    let anchor = parsed.get("anchor").and_then(|v| v.as_str()).unwrap_or("");
    let has_text = parsed.get("text").and_then(|v| v.as_str()).is_some();
    if needs_text(action) && !has_text {
        return format!("`{action}` requires `text` - the new content.");
    }
    let mut joins = false;
    let mut again = false;
    if needs_anchor(action) {
        if anchor.is_empty() {
            return format!(
                "`{action}` requires `anchor` - the exact document text the edit targets."
            );
        }
        if let Err(problem) = check_anchor(ctx.document, &parsed, anchor) {
            // In text proposed and not decided yet - this request's or an
            // earlier one's - the edit goes into that proposal.
            if !quotes_undecided(ctx, anchor) {
                return problem;
            }
            joins = true;
        } else if let Some(rewrite) = ctx
            .undecided
            .iter()
            .find(|edit| !edit.replaced.is_empty() && edit.replaced.contains(anchor))
        {
            // Document text an undecided rewrite replaces: the user sees the
            // rewrite there, and an edit of the old text would overlap it
            // (Sonnet anchored a word of the original after a rewrite of
            // the paragraph, live_eval::continuing). Where the rewrite still
            // has those words the edit goes into it, and a new version of
            // the whole passage takes its place.
            again = action == "replace" && anchor == rewrite.replaced;
            if !again {
                if rewrite.text.matches(anchor).count() != 1 || !quotes_undecided(ctx, anchor) {
                    return "Not proposed: that passage is one you rewrote earlier and the user hasn't decided on yet - they see your rewrite in its place, and an edit of the old text can't be applied beside it. Anchor in the rewrite's text instead (quote it as you proposed it): the edit goes into that proposal.".to_string();
                }
                joins = true;
            }
        }
    }

    // On later requests the frontend appends a bracketed status note to this
    // result (accepted / rejected / still undecided) - see
    // annotateProposalStatuses in src/ai/revision/proposal-status.ts. The size of
    // the change is measured here so the reply can rest on it: replies
    // called a 20% cut "about 70% of the original" and an expansion that
    // shrank "expanded into two paragraphs" (docs/design/ai-eval.md, round 2).
    let text = parsed.get("text").and_then(|v| v.as_str()).unwrap_or("");
    if let Some(problem) = degenerate_replacement(action, anchor, text) {
        // Refused once; the identical call again means it ("replace this
        // sentence with TBD").
        let key = format!("{anchor}\0{text}");
        let mut ledger = ctx.proposed.lock().unwrap_or_else(|e| e.into_inner());
        if !ledger.refused_short.contains(&key) {
            ledger.refused_short.push(key);
            return problem;
        }
    }
    // A second proposal for a passage this reply already changes: the two
    // previews overlap and only one can ever be applied. Sonnet sent the
    // same French proofreading twice in one step (round 4); the first
    // stands, the copy is refused (and never shown - see proposal-status.ts).
    if !joins && matches!(action, "replace" | "delete" | "replace_selection") {
        let context = parsed.get("context").and_then(|v| v.as_str());
        let passage = match action {
            "replace_selection" => ProposedPassage::selection(),
            _ => ProposedPassage::locate(ctx.document, anchor, context),
        };
        let mut ledger = ctx.proposed.lock().unwrap_or_else(|e| e.into_inner());
        if ledger.passages.iter().any(|p| p.overlaps(&passage)) {
            return "Not proposed: an edit you already proposed in this reply covers this passage, and overlapping proposals can't both be applied. The first one stands - don't send another; describe it in your reply.".to_string();
        }
        ledger.passages.push(passage);
    }
    let size = match action {
        "replace" => {
            let (from, unit) = text_size(anchor);
            let (to, _) = text_size(text);
            format!(" It replaces {from} {unit} with {to}.")
        }
        "delete" => {
            let (n, unit) = text_size(anchor);
            format!(" It removes {n} {unit}.")
        }
        "replace_selection" => String::new(),
        _ => {
            let (n, unit) = text_size(text);
            format!(" It adds {n} {unit}.")
        }
    };
    // "Even if it falls short": told the size, the model sent a second,
    // shorter proposal for the same passage to meet a skill's 70% - two
    // overlapping previews, of which only one can be applied (round-2
    // integration, skill/zh/slash).
    let mut unmade = String::new();
    if !text.is_empty() {
        let mut ledger = ctx.proposed.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(problem) = ledger.pictures_problem(text) {
            return problem;
        }
        ledger.texts.push(text.to_string());
        unmade = ledger.take_unmade().unwrap_or_default();
    }
    let into = if joins {
        " It changes text you proposed that the user hasn't decided on yet: it goes into that proposal, which now reads with it."
    } else if again {
        " It takes the place of your earlier rewrite of that passage, which the user hadn't decided on."
    } else {
        ""
    };
    format!("{EDIT_PROPOSED} - the user now sees it with an Apply button.{into}{size}{unmade} (Counts here are for you, measured the way measure_text does; the user never sees this note, so don't refer to it.) This is your proposal for that passage in this reply - don't send another one for it, even if it falls short of a target: say so in your reply instead. In your reply, say in a sentence or two what you proposed and why; don't repeat the text or list what you kept.")
}

/// Whether `anchor` is quoted from exactly one place in text proposed and
/// not decided yet: this request's proposals and earlier ones'.
fn quotes_undecided(ctx: &ToolContext, anchor: &str) -> bool {
    let ledger = ctx.proposed.lock().unwrap_or_else(|e| e.into_inner());
    let found: usize = ledger
        .texts
        .iter()
        .chain(ctx.undecided.iter().map(|edit| &edit.text))
        .map(|text| text.matches(anchor).count())
        .sum();
    found == 1
}

/// Write mode's propose_edit. Its schema offers only INSERT_ACTIONS, but a
/// model may send another action anyway; it is refused here, so nothing
/// that changes or removes the user's text reaches the editor in this mode.
fn propose_insertion(ctx: &ToolContext, arguments: &str) -> String {
    let action = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| v.get("action")?.as_str().map(str::to_string))
        .unwrap_or_default();
    // Text it proposed and the user hasn't decided on isn't theirs yet:
    // that it may change.
    let own = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| v.get("anchor")?.as_str().map(str::to_string))
        .is_some_and(|anchor| {
            !anchor.is_empty() && !ctx.document.contains(&anchor) && quotes_undecided(ctx, &anchor)
        });
    if !INSERT_ACTIONS.contains(&action.as_str()) && !own {
        return format!(
            "Not proposed: Write mode only adds text, with {} - `{action}` would change or remove text that is already there. Add the new text instead, or tell the user that changing existing text needs Revise mode.",
            INSERT_ACTIONS.join(", ")
        );
    }
    propose_edit(ctx, arguments)
}

/// How long a stretch of text is, in the unit its language counts in:
/// characters for Chinese and Japanese, words otherwise - counted exactly
/// as measure_text's `chars` and `words` do. The note used to count only
/// ideographs while measure_text counted punctuation too, and a reply told
/// the user the two counts disagreed and to count again themselves
/// (round 4, social/zh/shorten-100).
fn text_size(text: &str) -> (usize, &'static str) {
    // A picture's line is no part of the text's length.
    let without_pictures: String = text
        .lines()
        .filter(|line| !line.trim_start().starts_with("!["))
        .collect::<Vec<_>>()
        .join("\n");
    let text = without_pictures.as_str();
    let cjk = text
        .chars()
        .filter(|c| matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}'))
        .count();
    let words = text
        .split_whitespace()
        .filter(|w| w.chars().any(|c| c.is_alphanumeric() && !matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}')))
        .count();
    if cjk > words {
        (
            crate::ai::rules::measure::graphemes(text.trim()),
            "characters",
        )
    } else {
        (crate::ai::rules::measure::words(text), "words")
    }
}

fn is_cjk_char(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{ac00}'..='\u{d7af}')
}

/// A replacement that can't be what the model meant: a whole clause of
/// Chinese, Japanese or Korean replaced by one short Latin token. Sonnet
/// once sent `"text": "due"` for a 26-character apology in a formal email
/// and, told the proposal stood, could only ask the user to reject it
/// (round 4, email/zh/formal). No translation or rewrite of a clause comes
/// out as a single short token, so the call is refused before it becomes
/// a proposal (the frontend drops refused calls too) and the model resends.
/// A user can still ask for exactly that ("replace the sentence with
/// TBD"): the identical call sent a second time goes through.
fn degenerate_replacement(action: &str, anchor: &str, text: &str) -> Option<String> {
    if action != "replace" {
        return None;
    }
    let anchor_cjk = anchor.chars().filter(|&c| is_cjk_char(c)).count();
    let text = text.trim();
    let latin_token = !text.is_empty()
        && text.chars().count() <= 12
        && !text.contains(char::is_whitespace)
        && !text.chars().any(is_cjk_char);
    (anchor_cjk >= 12 && latin_token).then(|| {
        format!("Not proposed: `text` is only \"{text}\", which looks cut off for a passage this long. Send the proposal again with the full new text - or, if the user really asked for exactly this text, send the same call again unchanged.")
    })
}

/// One character's matching form: typographic quotes, dash variants,
/// full-width ASCII and non-breaking spaces fold to their plain ASCII
/// equivalents - the usual differences between a model's quote and the
/// author's text. One char in, one char out, so positions stay aligned
/// (src/ai/doc-markdown.ts's normalizeForMatch mirrors this exactly).
pub(crate) fn normalize_char(c: char) -> char {
    match c {
        '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{2032}' => '\'',
        '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{2033}' => '"',
        '\u{2010}'..='\u{2015}' | '\u{2212}' => '-',
        '\u{00A0}' | '\u{2007}' | '\u{202F}' | '\u{3000}' => ' ',
        '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
        _ => c,
    }
}

fn normalize_for_match(text: &str) -> String {
    text.chars().map(normalize_char).collect()
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// How many places `anchor` matches, with the same fallbacks the frontend
/// resolves proposals with (findMarkdownMatch): exact first; only when that
/// finds nothing, typographic normalization; then, also folding whitespace
/// runs (a quote that turned a blank line into one newline). Agreeing here
/// matters: when only the frontend tolerated a folded blank line, the model
/// was told "no match", retried, and the user got the edit twice.
/// Whether `anchor` picks out one place in the document - directly, or, when
/// it repeats, through `context` (a longer verbatim quote containing it that
/// occurs once; the frontend resolves it the same way). The error is the
/// tool result that tells the model how to fix its quote.
pub(crate) fn check_anchor(
    document: &str,
    args: &serde_json::Value,
    anchor: &str,
) -> Result<(), String> {
    match anchor_match_count(document, anchor) {
        0 => Err("No exact match for `anchor` in the document. Quote it exactly as it appears, including punctuation and whitespace.".to_string()),
        1 => Ok(()),
        n => {
            let context = args.get("context").and_then(|v| v.as_str()).unwrap_or("");
            if context.contains(anchor)
                && context.len() > anchor.len()
                && anchor_match_count(document, context) == 1
            {
                Ok(())
            } else {
                Err(format!("`anchor` appears {n} times in the document. Add `context`: a longer quote copied verbatim from the document that contains this anchor and itself occurs exactly once (or extend the anchor)."))
            }
        }
    }
}

fn anchor_match_count(document: &str, anchor: &str) -> usize {
    let exact = document.matches(anchor).count();
    if exact > 0 {
        return exact;
    }
    let (doc, needle) = (normalize_for_match(document), normalize_for_match(anchor));
    let normalized = doc.matches(needle.as_str()).count();
    if normalized > 0 || needle.split_whitespace().count() < 2 {
        return normalized;
    }
    collapse_whitespace(&doc)
        .matches(collapse_whitespace(&needle).as_str())
        .count()
}

const ADD_COMMENT_TOOL_NAME: &str = "add_comment";
const COMMENT_ADDED: &str = "Comment added";

/// Feedback pinned to a passage instead of an edit to it - for "what's weak
/// here", "review this draft". Changes nothing; the anchor is validated
/// like propose_edit's so the card's "locate" button lands on it.
fn add_comment(ctx: &ToolContext, arguments: &str) -> String {
    let parsed: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let anchor = parsed.get("anchor").and_then(|v| v.as_str()).unwrap_or("");
    let comment = parsed.get("comment").and_then(|v| v.as_str()).unwrap_or("");
    if comment.trim().is_empty() {
        return "`comment` is required - the feedback itself.".to_string();
    }
    if anchor.is_empty() {
        return "`anchor` is required - the exact document text the comment is about.".to_string();
    }
    match check_anchor(ctx.document, &parsed, anchor) {
        Ok(()) => format!("{COMMENT_ADDED} - the user sees it with a button that jumps to the passage. Don't repeat it in your reply."),
        Err(problem) => problem,
    }
}

const USE_SKILL_TOOL_NAME: &str = "use_skill";

/// Dynamic skill loading: the system prompt only carries each skill's name
/// and description; this returns the full instructions on demand, with the
/// reference-pack sections the skill declares appended (builtin::
/// expand_skill). A reference pack loads by name too, whole or one section
/// (`standards-fr#dialogue`).
fn use_skill(ctx: &ToolContext, arguments: &str) -> String {
    let name = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| {
            v.get("name")
                .and_then(|n| n.as_str())
                .map(|s| s.trim().to_string())
        })
        .unwrap_or_default();

    let skill = ctx.skills.iter().find(|s| s.name == name && s.enabled);
    match skill {
        Some(skill) if skill.invocation == Invocation::UserOnly => format!(
            "The skill `{name}` runs only when the user types /{name}. Handle this request without it."
        ),
        Some(skill) => format!(
            "Instructions for skill `{name}` - follow them for this request:\n\n{}",
            builtin::expand_skill(
                skill,
                ctx.document,
                ctx.ui_language,
                "",
                builtin::chosen_profile(ctx.conventions, ctx.document).as_deref(),
            )
        ),
        None if name == crate::ai::agent::APP_GUIDE => format!(
            "The app guide - answer from it:\n\n{}",
            crate::ai::agent::app_guide()
        ),
        None => match builtin::load_reference(&name, ctx.document, ctx.ui_language) {
            Some(text) => format!("Reference `{name}` - apply it to this request:\n\n{text}"),
            None => {
                let available: Vec<&str> = ctx
                    .skills
                    .iter()
                    .filter(|s| s.offered_to_model())
                    .map(|s| s.name.as_str())
                    .collect();
                format!(
                    "No skill named `{name}`. Available skills: {}. Reference packs: {} (add #section for one section).",
                    available.join(", "),
                    builtin::reference_pack_names().join(", ")
                )
            }
        },
    }
}

const REMEMBER_TOOL_NAME: &str = "remember";

/// Keeps a memory for later conversations - ai::memory does the work.
fn remember(ctx: &ToolContext, arguments: &str) -> String {
    match ctx.memory {
        Some(memory) => crate::ai::memory::run_tool(memory, arguments),
        None => "Remembering is turned off.".to_string(),
    }
}

const LIST_FILES_TOOL_NAME: &str = "list_files";
const READ_FILE_TOOL_NAME: &str = "read_file";
const VIEW_IMAGE_TOOL_NAME: &str = "view_image";

/// How much of the project the listing shows: enough for reference
/// material next to the document, small enough that a huge folder can't
/// blow up the prompt.
const MAX_LISTED_FILES: usize = 200;
const SEARCH_FILES_TOOL_NAME: &str = "search_files";
const FIND_FILES_TOOL_NAME: &str = "find_files";

/// The project folder's files the tools can read (paths relative to it),
/// images marked. Hidden entries and build/dependency folders are skipped -
/// see ai::project.
fn list_files(ctx: &ToolContext, _arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document (it hasn't been saved, or its folder is too broad to use), so there are no files to list."
            .to_string();
    };
    let walked = crate::ai::project::walk_readable_files(root, ctx.sees_images);
    let files = walked.files;
    if files.is_empty() {
        return "The project folder has no files to read.".to_string();
    }
    let mut lines: Vec<String> = files
        .iter()
        .take(MAX_LISTED_FILES)
        .map(|rel| crate::ai::project::listed(rel))
        .collect();
    if files.len() > MAX_LISTED_FILES || walked.truncated {
        let more = files.len().saturating_sub(MAX_LISTED_FILES);
        let more = if walked.truncated {
            format!("{more} or more")
        } else {
            more.to_string()
        };
        lines.push(format!(
            "... ({more} more - use find_files for a file by name, search_files for words inside files)"
        ));
    }
    lines.join("\n")
}

fn path_argument(arguments: &str, key: &str) -> String {
    serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| v.get(key).and_then(|p| p.as_str()).map(str::to_string))
        .unwrap_or_default()
}

/// Reads a text file or a document from inside the project folder, whole
/// or a line range of it - containment, hidden files and size are enforced
/// by ai::project::read_part.
fn read_file(ctx: &ToolContext, arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document (it hasn't been saved, or its folder is too broad to use), so there are no files to read."
            .to_string();
    };
    let args: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let line = |key: &str| args.get(key).and_then(|v| v.as_u64()).map(|n| n as usize);
    let range = crate::ai::project::LineRange {
        start: line("start_line"),
        end: line("end_line"),
    };
    crate::ai::project::read_part(
        root,
        &path_argument(arguments, "path"),
        range,
        ctx.sees_images,
    )
    .unwrap_or_else(|err| err)
}

/// Shows the model an image from the project folder - offered only when the
/// provider takes images (ToolContext::sees_images).
fn view_image(ctx: &ToolContext, arguments: &str) -> ToolOutput {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document, so there are no images to look at."
            .to_string()
            .into();
    };
    // list_files and find_files mark images "(image)"; a model may copy it.
    let path = path_argument(arguments, "path");
    let path = path.trim().trim_end_matches("(image)").trim_end();
    match crate::ai::project::read_image(root, path) {
        Ok(image) => ToolOutput {
            text: format!("Here is `{}` ({}).", image.name, image.mime),
            images: vec![image],
            ..ToolOutput::default()
        },
        Err(err) => err.into(),
    }
}

/// Finds which project files mention something - the cross-file companion
/// to search_document.
fn search_files(ctx: &ToolContext, arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document (it hasn't been saved, or its folder is too broad to use), so there is nothing to search."
            .to_string();
    };
    crate::ai::project::search(root, &path_argument(arguments, "query"))
}

/// Finds project files by name - what the sidebar's file search does for
/// the writer, and cheaper for the model than listing everything.
fn find_files(ctx: &ToolContext, arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document (it hasn't been saved, or its folder is too broad to use), so there are no files to find."
            .to_string();
    };
    crate::ai::project::find(root, &path_argument(arguments, "name"), ctx.sees_images)
}

const CHECK_CONVENTIONS_TOOL_NAME: &str = "check_conventions";

/// Most lines check_conventions returns.
const MAX_CONVENTION_LINES: usize = 50;

/// Invisible characters spelled out, so a suggestion that only changes a
/// space can be read: the model can't see a no-break space.
fn visible(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\u{00A0}' => "[no-break space]".to_string(),
            '\u{202F}' => "[narrow no-break space]".to_string(),
            '\u{3000}' => "[ideographic space]".to_string(),
            '\u{200B}' => "[zero-width space]".to_string(),
            '\u{200D}' => "[zero-width joiner]".to_string(),
            '\u{FEFF}' => "[BOM]".to_string(),
            '\n' => "\\n".to_string(),
            c => c.to_string(),
        })
        .collect()
}

/// Checks a passage against the document's writing conventions with the
/// rules engine (ai::rules): a section, a line range, the whole document,
/// or a draft (`text`) not yet in it - judged against the rest of the
/// document's own majority. Findings grouped by rule, at most 50 lines.
fn check_conventions(ctx: &ToolContext, arguments: &str) -> String {
    use crate::ai::rules::{self, Level};
    let args: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let level = if args.get("strict").and_then(|v| v.as_bool()) == Some(true) {
        Level::Strict
    } else {
        Level::Standard
    };
    let text = args
        .get("text")
        .and_then(|t| t.as_str())
        .filter(|t| !t.trim().is_empty());
    let (report, scope, range) = if let Some(text) = text {
        // The draft as it will land: proposals go through the same
        // automatic fixes (rules::postfix) - checked raw, a draft whose
        // French spaces the app was about to fix made the model send its
        // proposal again and tell the user the spaces might be wrong
        // (round 4, builtin/proofread/fr/typography).
        let (text, _) = rules::postfix::proposal_text(ctx.document, text, ctx.conventions);
        let report = rules::document::check_document_with(
            &text,
            Some(ctx.document),
            ctx.conventions,
            level,
            ctx.library,
        );
        (report, "the text you gave".to_string(), None)
    } else {
        let lines: Vec<&str> = ctx.document.lines().collect();
        let total = lines.len().max(1);
        let range = if let Some(heading) = args
            .get("heading")
            .and_then(|h| h.as_str())
            .map(str::trim)
            .filter(|h| !h.is_empty())
        {
            match section_range(&lines, heading) {
                Some((a, b)) => (a + 1, b),
                None => return format!("No heading matching \"{heading}\". The outline in the document section lists them."),
            }
        } else {
            let line_arg = |key: &str| args.get(key).and_then(|v| v.as_u64()).map(|n| n as usize);
            let start = line_arg("start_line").unwrap_or(1).clamp(1, total);
            let end = line_arg("end_line").unwrap_or(total).clamp(start, total);
            (start, end)
        };
        let report = rules::check_document(ctx.document, ctx.conventions, level, ctx.library);
        (
            report,
            format!("lines {}-{}", range.0, range.1),
            Some(range),
        )
    };
    let profile = report
        .profile
        .as_ref()
        .map(|p| p.describe())
        .unwrap_or_else(|| "none (too little prose to tell the language)".to_string());
    let findings: Vec<&rules::Finding> = report
        .findings
        .iter()
        .filter(|f| range.is_none_or(|(a, b)| f.line.is_some_and(|l| l >= a && l <= b)))
        .collect();
    let mut out = format!("Writing conventions: {profile}.\n");
    if findings.is_empty() {
        out.push_str(&format!("No convention issues found in {scope}."));
        return out;
    }
    out.push_str(&format!(
        "{} finding(s) in {scope}. \"fix\" lines are mechanical and safe; \"suggest\" lines need judgement; \"check\" lines only point at something to look at.\n",
        findings.len()
    ));
    // Grouped by rule, rules in order of first appearance.
    let mut order: Vec<&str> = Vec::new();
    for f in &findings {
        if !order.contains(&f.rule) {
            order.push(f.rule);
        }
    }
    let mut lines_out = 0;
    let mut shown = 0;
    'rules: for rule in order {
        let group: Vec<&&rules::Finding> = findings.iter().filter(|f| f.rule == rule).collect();
        if lines_out >= MAX_CONVENTION_LINES {
            break;
        }
        out.push_str(&format!("{rule} ({}): {}\n", group.len(), group[0].message));
        lines_out += 1;
        for f in group {
            if lines_out >= MAX_CONVENTION_LINES {
                break 'rules;
            }
            let line = f.line.map(|l| format!("L{l}")).unwrap_or_default();
            let kind = match (f.fix, &f.suggestion) {
                (rules::Fix::Safe, Some(_)) => "fix",
                (_, Some(_)) => "suggest",
                _ => "check",
            };
            let what = match &f.suggestion {
                Some(s) => format!("\"{}\" -> \"{}\"", visible(&f.original), visible(s)),
                None => format!("\"{}\"", visible(&f.original)),
            };
            let note = if f.message != findings.iter().find(|g| g.rule == rule).unwrap().message {
                format!(" ({})", f.message)
            } else {
                String::new()
            };
            out.push_str(&format!("  {line} {kind}: {what}{note}\n"));
            lines_out += 1;
            shown += 1;
        }
    }
    if shown < findings.len() {
        out.push_str(&format!(
            "... and {} more; check a smaller range to see them.\n",
            findings.len() - shown
        ));
    }
    // The bracketed names are for reading; told only those, the model
    // proposed "Bonjour !" with a plain space and told the user it had put
    // in no-break spaces (round 4, builtin/proofread/fr/typography).
    let invisible = findings.iter().any(|f| {
        f.suggestion
            .as_deref()
            .is_some_and(|s| s.contains(['\u{00A0}', '\u{202F}']))
    });
    if invisible {
        out.push_str("A [no-break space] or [narrow no-break space] in a fix is that character, not an ordinary space: in propose_edit's JSON write it as \\u00a0 or \\u202f inside the string, and check the draft with `text` before proposing.\n");
    }
    out
}

const MEASURE_TEXT_TOOL_NAME: &str = "measure_text";

/// Exact counts for a length limit (ai::rules::measure).
fn measure_text(_ctx: &ToolContext, arguments: &str) -> String {
    use crate::ai::rules::measure;
    let args: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let Some(text) = args.get("text").and_then(|t| t.as_str()) else {
        return "No `text` given - pass the exact text to count.".to_string();
    };
    match args
        .get("metric")
        .and_then(|m| m.as_str())
        .filter(|m| !m.is_empty() && *m != "all")
    {
        Some(metric) => match measure::measure(text, metric) {
            Some(m) => m.describe(),
            None => format!(
                "Unknown metric `{metric}`. Use one of: {}.",
                measure::METRICS.join(", ")
            ),
        },
        None => [
            "chars",
            "words",
            "cjk_chars",
            "utf8_bytes",
            "x_weighted",
            "bluesky",
        ]
        .iter()
        .filter_map(|m| measure::measure(text, m))
        .map(|m| m.describe())
        .collect::<Vec<_>>()
        .join("\n"),
    }
}

/// propose_edit as Revise mode offers it: every action.
const PROPOSE_EDIT_DESCRIPTION: &str = "Propose one edit to the document. Nothing is modified directly: the user reviews the proposal and applies it with one click. Call once per distinct edit. Pick the action that matches the intent: `replace` swaps `anchor` for `text`; `replace_selection` swaps the user's currently selected text (the <selected-text> block in their message; no `anchor` needed) for `text`; `insert_before`/`insert_after` add `text` around an untouched `anchor` - inside the paragraph when the anchor is a phrase or sentence within it (write `text` as words that read on from it - after a paragraph's last sentence, this continues the paragraph), as a new paragraph when the anchor is a whole block or `text` is block content (a heading, list, several paragraphs), and as a new line of the same table or list when the anchor is a whole row or list item line and `text` is another one; `delete` removes `anchor`; `append` adds `text` at the end of the document; `insert_at_cursor` adds `text` exactly where the user's cursor is (only when their message carries a <cursor> block showing it; no `anchor` needed). Name the target by its block: every block of the document (paragraph, heading, list item, table, code block) starts with its id, like `[#k3f9]`, and `block` takes that id - write it first, before anything else, so the user sees where the edit goes at once. With `block` alone, `replace` swaps the whole block for `text`, `delete` removes it, and `insert_before`/`insert_after` add `text` as a new block next to it. To change a few words inside a block, give `block` and, as `anchor`, just those words quoted from it - not the whole block; to add text inside a block (after a sentence, or a list item of a list), give `block` and, as `anchor`, the words or the item line it goes next to. To rewrite a run of blocks - a section, or the whole document - in one replace, give its first block as `block` and its last as `last_block`, and the whole run rewritten as `text`; the user still decides on it paragraph by paragraph. The ids aren't part of the text: never write them in `text` or `anchor`. Without `block` (text you proposed earlier and the user hasn't decided on, which has no id), `anchor` must be copied verbatim and occur exactly once - if it appears more than once, also pass `context`. `text` must be valid markdown: `-` or `1.` for lists (never `•` or other bullet symbols), `#` for headings.";

const FIND_FILES_DESCRIPTION: &str = "Find files in the project folder by name - text files, and PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files (case-insensitive; every word must appear in the path, so \"chapter 3\" finds drafts/chapter-3.md). Markdown and plain-text documents come first. Use it whenever you know or can guess part of a file's name - a chapter, a character's notes, an outline - instead of listing every file; then read_file.";
const FIND_FILES_DESCRIPTION_WITH_IMAGES: &str = "Find files in the project folder by name - text files, PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files, and images, marked \"(image)\" (case-insensitive; every word must appear in the path, so \"chapter 3\" finds drafts/chapter-3.md). Markdown and plain-text documents come first. Use it whenever you know or can guess part of a file's name - a chapter, a character's notes, an outline, a map - instead of listing every file; then read_file, or view_image for an image.";
const LIST_FILES_DESCRIPTION: &str = "List the files in the project folder you can read - text files, and PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files (recursively, paths relative to it). Use it to see what reference material there is - notes, other chapters, data - when you have no name to look for; to find a file by name, use find_files instead.";
const LIST_FILES_DESCRIPTION_WITH_IMAGES: &str = "List the files in the project folder you can read - text files, PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files, and images, marked \"(image)\" (recursively, paths relative to it). Use it to see what reference material there is - notes, other chapters, data, pictures - when you have no name to look for; to find a file by name, use find_files instead.";

/// The tools available to an agent conversation. Skill and file tools are
/// only offered when there's something for them to work on - a tool that can
/// only report "nothing there" would just waste the model's steps. Append
/// here (or extend to merge in MCP-provided tools) as the toolset grows.
/// `can_remember`: Settings > Textus AI > Remember automatically is on.
/// `sees_images`: the provider takes images (ToolContext::sees_images).
pub fn builtin_tools<'a>(
    has_skills: bool,
    has_root: bool,
    mode: AgentMode,
    can_remember: bool,
    sees_images: bool,
) -> Vec<Tool<'a>> {
    let mut tools = vec![Tool {
            spec: ToolSpec {
                name: SEARCH_TOOL_NAME.into(),
                description: "Search the current document for a query string (case-insensitive). Returns matching lines with their line numbers.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Text to search for in the document"
                        }
                    },
                    "required": ["query"],
                }),
            },
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(search_document),
        }, Tool {
            spec: ToolSpec {
                name: READ_DOCUMENT_TOOL_NAME.into(),
                description: "Read part of the current document verbatim: a whole section by its heading (subsections included), or a range of lines. Use it before revising a passage you can't fully see, and to copy exact anchors. The text comes back without line-number prefixes, ready to quote.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "heading": {
                            "type": "string",
                            "description": "Heading text of the section to read (case-insensitive, partial match). Takes precedence over the line range."
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "First line to read, 1-based (as in the outline and search results)."
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "Last line to read, inclusive."
                        }
                    },
                }),
            },
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(read_document),
        }];

    // The rules engine's read-only tools: every mode has them.
    tools.push(Tool {
        spec: ToolSpec {
            name: CHECK_CONVENTIONS_TOOL_NAME.into(),
            description: "Check text against the document's writing conventions with a deterministic rules engine: punctuation and spacing (full-width marks in Chinese and Japanese, French no-break spaces, quotes, dashes, ellipses), numbers and dates, spelling lists, and consistency with the rest of the document, under the conventions profile in force (shown in the result). Pass `heading` or a line range for part of the document (default: all of it), or `text` to check a draft before you propose it. Returns findings grouped by rule with line numbers, the text, the fix and why. Use it to ground proofreading and convention fixes instead of guessing; it changes nothing.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "heading": {
                        "type": "string",
                        "description": "Heading text of the section to check (case-insensitive, partial match). Takes precedence over the line range."
                    },
                    "start_line": {
                        "type": "integer",
                        "description": "First line to check, 1-based."
                    },
                    "end_line": {
                        "type": "integer",
                        "description": "Last line to check, inclusive."
                    },
                    "text": {
                        "type": "string",
                        "description": "A draft (markdown) to check instead of the document, judged against the document's own conventions."
                    },
                    "strict": {
                        "type": "boolean",
                        "description": "Also report style hints (long sentences, wordy phrases, passive voice...). Default false."
                    }
                },
            }),
        },
        access: Access::ReadOnly,
        modes: EVERY_MODE,
        run: Run::Text(check_conventions),
    });
    tools.push(Tool {
        spec: ToolSpec {
            name: MEASURE_TEXT_TOOL_NAME.into(),
            description: "Count text exactly for a length limit - never estimate a count yourself. Metrics: x_weighted (X, limit 280: URLs count 23, CJK characters and emoji 2), bluesky (300 graphemes and 3,000 bytes), threads (500), instagram (2,200, at most 5 hashtags), mastodon (500 by default), linkedin (3,000, fold near 140), wechat_title (32), wechat_digest (120), wechat_content, xhs_title (20), xhs_body (1,000), weibo, govuk_title (65), govuk_summary (160), zh_academic_title (25 字), and plain chars, words, cjk_chars, utf8_bytes. Without `metric` it returns the basic counts. Use it on the exact text before proposing anything that must fit a platform's limit, and give the count in your reply. Not for new text with a length the user asked for: propose that directly - propose_edit's result gives its size.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The exact text to count, as it will be posted or used."
                    },
                    "metric": {
                        "type": "string",
                        "enum": crate::ai::rules::measure::METRICS,
                        "description": "What to count, and against which limit."
                    }
                },
                "required": ["text"],
            }),
        },
        access: Access::ReadOnly,
        modes: EVERY_MODE,
        run: Run::Text(measure_text),
    });

    // Comments change nothing, so every mode has them - feedback is most
    // often asked for in Review mode.
    tools.push(Tool {
        spec: ToolSpec {
            name: ADD_COMMENT_TOOL_NAME.into(),
            description: "Pin a piece of feedback to a passage without changing it - for reviews and critique (\"what's weak here\", \"check this draft\"). One call per point; quote the passage verbatim as `anchor` (unique in the document, or add `context`). The user sees each comment as a card that jumps to its passage, so keep your reply to a short overall summary.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "anchor": {
                        "type": "string",
                        "description": "Exact document text the comment is about"
                    },
                    "comment": {
                        "type": "string",
                        "description": "The feedback, in the user's language - specific and actionable"
                    },
                    "context": {
                        "type": "string",
                        "description": "Only when `anchor` repeats: a longer verbatim quote containing it that occurs once"
                    }
                },
                "required": ["anchor", "comment"],
            }),
        },
        access: Access::Proposes,
        modes: EVERY_MODE,
        run: Run::Text(add_comment),
    });

    // Remembering writes memory, never the document, so every mode has it.
    if can_remember {
        tools.push(Tool {
            spec: ToolSpec {
                name: REMEMBER_TOOL_NAME.into(),
                description: "Remember something for later conversations: a requirement, preference or trait of the user's style that should hold beyond this request, or a fact about their work (a person, place or term). It is saved as a small file the user can see, undo, edit or delete; it never changes the document. To change something already remembered, pass its id as `replaces`.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": ["requirement", "preference", "style", "fact"],
                            "description": "requirement: something always or never to do; preference: what they like in replies and edits; style: how they write; fact: what is true of a person, place or term in their work (needs `name`)"
                        },
                        "scope": {
                            "type": "string",
                            "enum": ["project", "personal"],
                            "description": "project: about this work; personal: the user's general habits. Ignored for a fact (always project) and with `replaces`."
                        },
                        "text": {
                            "type": "string",
                            "description": "The memory: one or a few plain sentences in the user's language, as an instruction to yourself; for a fact, what is true of it"
                        },
                        "name": {
                            "type": "string",
                            "description": "For a fact: the person, place or term"
                        },
                        "aliases": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "For a fact: other names it goes by"
                        },
                        "replaces": {
                            "type": "string",
                            "description": "The id of a memory to update instead of adding one, as listed in brackets"
                        }
                    },
                    "required": ["kind", "text"],
                }),
            },
            access: Access::Proposes,
            modes: EVERY_MODE,
            run: Run::Text(remember),
        });
    }

    // Review is structurally read-only: the model never receives the edit
    // tool, so a provider cannot accidentally ignore a prompt-only mode
    // instruction and create a proposal anyway. Write and Revise get the
    // same tool - one tool list, so switching between them keeps the
    // provider's cached prefix (docs/design/ai-tokens.md) - and in Write
    // the mode section says it only adds text, which propose_insertion
    // holds it to: any other action is refused.
    for (run, modes) in [
        (
            propose_edit as fn(&ToolContext, &str) -> String,
            &[AgentMode::Revise][..],
        ),
        (propose_insertion as _, &[AgentMode::Write][..]),
    ] {
        tools.push(Tool {
            spec: ToolSpec {
                name: PROPOSE_EDIT_TOOL_NAME.into(),
                description: PROPOSE_EDIT_DESCRIPTION.into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": EDIT_ACTIONS,
                            "description": "What kind of edit this is"
                        },
                        "block": {
                            "type": "string",
                            "description": "The id of the block the edit targets, as the document shows it before the block (`k3f9` for `[#k3f9]`). Write it first."
                        },
                        "last_block": {
                            "type": "string",
                            "description": "Only to rewrite a run of blocks in one replace (a section, or the whole document): the id of the last block of the run, `block` being the first; `text` is then the whole run rewritten."
                        },
                        "anchor": {
                            "type": "string",
                            "description": "With `block`: only the few words inside that block the edit changes, quoted verbatim - leave it out to change the whole block. Without `block`: the exact text the edit targets, quoted verbatim."
                        },
                        "text": {
                            "type": "string",
                            "description": "The new content (markdown). Required for every action except `delete`."
                        },
                        "context": {
                            "type": "string",
                            "description": "Only when `anchor` occurs more than once in the document: a longer quote copied verbatim from the document that contains the anchor and itself occurs exactly once - it pins down which occurrence is meant."
                        },
                        "reason": {
                            "type": "string",
                            "description": "One short sentence, in the language of your reply, on why this change - shown on the proposal card so the user can judge it at a glance (e.g. \"Cut the repeated point about cost\")."
                        }
                    },
                    "required": ["action"],
                }),
            },
            access: Access::Proposes,
            modes,
            run: Run::Text(run),
        });
    }

    if has_skills {
        tools.push(Tool {
            spec: ToolSpec {
                name: USE_SKILL_TOOL_NAME.into(),
                description: "Load the full instructions of one of the available skills (listed in the system prompt), or a reference pack a skill names. Call this before following a skill whenever the user's request matches its description, or when the user invokes it by name.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "The skill's name, exactly as listed, or a reference pack such as standards-fr or standards-fr#dialogue"
                        }
                    },
                    "required": ["name"],
                }),
            },
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(use_skill),
        });
    }

    if has_root {
        tools.push(Tool {
            spec: ToolSpec {
                name: FIND_FILES_TOOL_NAME.into(),
                description: if sees_images {
                    FIND_FILES_DESCRIPTION_WITH_IMAGES.into()
                } else {
                    FIND_FILES_DESCRIPTION.into()
                },
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Part of the file's name or path"
                        }
                    },
                    "required": ["name"],
                }),
            },
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(find_files),
        });
        tools.push(Tool {
            spec: ToolSpec {
                name: SEARCH_FILES_TOOL_NAME.into(),
                description: "Search every text file and document (PDF, Word, PowerPoint, spreadsheet, EPUB, RTF) in the project folder for a word or phrase (case-insensitive), however long the file. Returns `path:line: text` matches - use it to find where a character, term or fact appears across chapters and notes, then read_file with start_line and end_line around the match for its context.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Text to search for"
                        }
                    },
                    "required": ["query"],
                }),
            },
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(search_files),
        });
        tools.push(Tool {
            spec: ToolSpec {
                name: LIST_FILES_TOOL_NAME.into(),
                description: if sees_images {
                    LIST_FILES_DESCRIPTION_WITH_IMAGES.into()
                } else {
                    LIST_FILES_DESCRIPTION.into()
                },
                parameters: json!({"type": "object", "properties": {}}),
            },
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(list_files),
        });
        tools.push(Tool {
            spec: ToolSpec {
                name: READ_FILE_TOOL_NAME.into(),
                description: "Read a text file, or the text of a PDF, Word, PowerPoint, spreadsheet, EPUB or RTF file (as Markdown), from the project folder. Use the relative path as shown by find_files, search_files or list_files. A long file comes back in parts: the answer says which lines of how many it shows and where to read on; pass start_line and end_line to read a part - say, a few dozen lines around a line search_files found.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path relative to the project folder"
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "First line to read, 1-based (as in search_files results)."
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "Last line to read, inclusive."
                        }
                    },
                    "required": ["path"],
                }),
            },
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(read_file),
        });
        if sees_images {
            tools.push(Tool {
                spec: ToolSpec {
                    name: VIEW_IMAGE_TOOL_NAME.into(),
                    description: "Look at an image in the project folder (PNG, JPEG, GIF or WebP, up to 6 MB) - a map, a photo, a chart, a scanned page. Use the relative path as list_files or find_files show it.".into(),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "Path relative to the project folder"
                            }
                        },
                        "required": ["path"],
                    }),
                },
                access: Access::ReadOnly,
                modes: EVERY_MODE,
                run: Run::Seeing(view_image),
            });
        }
    }

    tools.retain(|tool| tool.modes.contains(&mode));
    tools
}

/// How often one request may call each check tool before it stops
/// answering. Asked for "800 字", a model drafted, measured, rewrote and
/// measured again until its steps ran out, and never proposed the text at
/// all; a check that keeps answering invites exactly that loop. Measuring
/// against a platform's limit is not counted (`measures_a_limit`): text
/// that must fit is worth trimming until it does, and a budget refused an
/// X post and headline options still over their limit in the live eval.
const CHECK_BUDGETS: &[(&str, usize)] = &[
    (MEASURE_TEXT_TOOL_NAME, 3),
    (CHECK_CONVENTIONS_TOOL_NAME, 4),
];

/// Whether a measure_text call measures against a platform's limit (a
/// metric with one, such as x_weighted), not a plain count.
fn measures_a_limit(arguments: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|args| crate::ai::rules::measure::measure("", args.get("metric")?.as_str()?))
        .is_some_and(|m| m.limit.is_some())
}

/// How long a `text` not in the document may be before a check of it is a
/// hidden draft (refuses_a_draft): a sentence or a short paragraph.
const DRAFT_CHARS: usize = 200;

/// A check of a draft - new text, long, not from the document, and not
/// measured against a platform's limit - refused. Asked for "1200 字" with
/// two pictures, a model wrote the whole piece into measure_text three
/// times before proposing it: over three minutes in which the user saw
/// nothing. Proposed instead, the text streams in where they watch, and
/// propose_edit's result gives its size.
fn refuses_a_draft(ctx: &ToolContext, name: &str, arguments: &str) -> Option<String> {
    if name != MEASURE_TEXT_TOOL_NAME && name != CHECK_CONVENTIONS_TOOL_NAME {
        return None;
    }
    if name == MEASURE_TEXT_TOOL_NAME && measures_a_limit(arguments) {
        return None;
    }
    let args: serde_json::Value = serde_json::from_str(arguments).ok()?;
    let text = args.get("text")?.as_str()?.trim();
    if text.chars().count() <= DRAFT_CHARS || ctx.document.contains(text) {
        return None;
    }
    Some(format!("Not run: {name} doesn't take a draft of new text. Propose the text with propose_edit now - the user sees it come in, its result tells you its size, and conventions are fixed on the way. If it misses a length the user asked for, say so in your reply."))
}

/// Counts a call to a check tool, and refuses it once the request has used
/// up that tool's budget - or when it checks a hidden draft
/// (refuses_a_draft). None for every other call, and within budget.
fn spend_check(ctx: &ToolContext, name: &str, arguments: &str) -> Option<String> {
    if let Some(refusal) = refuses_a_draft(ctx, name, arguments) {
        return Some(refusal);
    }
    let &(name, budget) = CHECK_BUDGETS.iter().find(|(tool, _)| *tool == name)?;
    if name == MEASURE_TEXT_TOOL_NAME && measures_a_limit(arguments) {
        return None;
    }
    let mut checks = ctx.checks.lock().unwrap_or_else(|e| e.into_inner());
    let used = checks.entry(name).or_default();
    *used += 1;
    (*used > budget).then(|| {
        format!("Not run: {name} was already called {budget} times in this request, which is all it gets. Stop checking and finish with what you have: propose your latest draft (when the request changes the document), then reply.")
    })
}

/// Whether `result` is a valid proposal or comment: the user's to decide
/// now, with nothing in it the model has to answer.
fn settles(name: &str, result: &str) -> bool {
    match name {
        PROPOSE_EDIT_TOOL_NAME => result.starts_with(EDIT_PROPOSED),
        ADD_COMMENT_TOOL_NAME => result.starts_with(COMMENT_ADDED),
        _ => false,
    }
}

/// The tools one request offers, assembled for its mode: the built-ins
/// that have something to work on ([`builtin_tools`]), then what the
/// request adds - the web tools, generate_image, and later plugin and MCP
/// tools. The one place a tool is looked up by name.
pub struct ToolRegistry<'a> {
    mode: AgentMode,
    tools: Vec<Tool<'a>>,
}

impl<'a> ToolRegistry<'a> {
    /// No tools yet: what `mode` offers is added to it.
    pub fn new(mode: AgentMode) -> Self {
        Self {
            mode,
            tools: Vec::new(),
        }
    }

    /// The built-in tools for `mode` (see [`builtin_tools`] for the rest).
    pub fn builtin(
        has_skills: bool,
        has_root: bool,
        mode: AgentMode,
        can_remember: bool,
        sees_images: bool,
    ) -> Self {
        let mut registry = Self::new(mode);
        registry.tools = builtin_tools(has_skills, has_root, mode, can_remember, sees_images);
        registry
    }

    /// Adds `tool` if this request's mode offers it.
    pub fn add(&mut self, tool: Tool<'a>) {
        if tool.modes.contains(&self.mode) {
            self.tools.push(tool);
        }
    }

    pub fn specs(&self) -> Vec<ToolSpec> {
        self.tools.iter().map(|t| t.spec.clone()).collect()
    }

    fn find(&self, name: &str) -> Option<&Tool<'a>> {
        self.tools.iter().find(|t| t.spec.name == name)
    }

    /// How the agent loop runs `name`'s calls (aicompat's ToolRun). A name
    /// the model made up runs on its own, and is told it doesn't exist.
    pub fn how_to_run(&self, name: &str) -> ToolRun {
        match self.find(name).map(|t| t.access) {
            Some(Access::ReadOnly) => ToolRun::Concurrent,
            Some(Access::ProposesInItsCall) => ToolRun::Amending,
            Some(Access::Proposes) | None => ToolRun::InOrder,
        }
    }

    pub async fn execute(&self, ctx: &ToolContext<'_>, call: ToolCall) -> ToolOutput {
        if let Some(refusal) = spend_check(ctx, &call.name, &call.arguments) {
            return refusal.into();
        }
        match self.find(&call.name).map(|t| &t.run) {
            Some(Run::Text(run)) => {
                let text = run(ctx, &call.arguments);
                ToolOutput {
                    settled: settles(&call.name, &text),
                    text,
                    ..ToolOutput::default()
                }
            }
            Some(Run::Seeing(run)) => run(ctx, &call.arguments),
            Some(Run::Async(run)) => run(call).await,
            None => format!("Unknown tool: {}", call.name).into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One call through the registry, as the agent loop makes it.
    fn execute(tools: &ToolRegistry, ctx: &ToolContext, name: &str, arguments: &str) -> ToolOutput {
        tauri::async_runtime::block_on(tools.execute(
            ctx,
            ToolCall {
                call_id: String::new(),
                name: name.into(),
                arguments: arguments.into(),
            },
        ))
    }

    fn names(tools: &[Tool]) -> Vec<String> {
        tools.iter().map(|t| t.spec.name.to_string()).collect()
    }

    /// A tool that arrives at run time, as a plugin's or an MCP server's
    /// will: an owned name and schema, and an async run.
    fn runtime_tool<'a>(name: &str, access: Access, modes: &'static [AgentMode]) -> Tool<'a> {
        Tool {
            spec: ToolSpec {
                name: name.to_string().into(),
                description: format!("{name}, from a plugin").into(),
                parameters: json!({"type": "object", "properties": {}}),
            },
            access,
            modes,
            run: Run::Async(Box::new(|call: ToolCall| {
                Box::pin(async move { format!("{} ran with {}", call.name, call.arguments).into() })
            })),
        }
    }

    #[test]
    fn a_runtime_tool_is_offered_and_run_through_the_registry() {
        let mut tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
        tools.add(runtime_tool("zotero_search", Access::ReadOnly, EVERY_MODE));
        assert!(tools.specs().iter().any(|s| s.name == "zotero_search"));
        let out = execute(&tools, &ctx("Doc."), "zotero_search", r#"{"q":"x"}"#);
        assert_eq!(out.text, r#"zotero_search ran with {"q":"x"}"#);
        assert_eq!(
            execute(&tools, &ctx("Doc."), "no_such_tool", "{}").text,
            "Unknown tool: no_such_tool"
        );
    }

    /// Only a valid proposal or comment ends the exchange early (the loop's
    /// ToolOutput::settled): a refused one needs the model again.
    #[test]
    fn valid_proposals_and_comments_are_settled_and_refusals_are_not() {
        let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
        let ctx = ctx("The cat sat on the mat.");
        let settled = |name: &str, args: &str| execute(&tools, &ctx, name, args).settled;
        assert!(settled(
            PROPOSE_EDIT_TOOL_NAME,
            r#"{"action":"append","text":"The dog ran."}"#
        ));
        assert!(!settled(
            PROPOSE_EDIT_TOOL_NAME,
            r#"{"action":"replace","anchor":"not in the document","text":"x"}"#
        ));
        assert!(settled(
            ADD_COMMENT_TOOL_NAME,
            r#"{"anchor":"The cat sat","comment":"Name the cat."}"#
        ));
        assert!(!settled(READ_DOCUMENT_TOOL_NAME, "{}"));
    }

    #[test]
    fn a_tool_is_offered_only_in_the_modes_it_names() {
        for (mode, offered) in [
            (AgentMode::Review, false),
            (AgentMode::Revise, true),
            (AgentMode::Write, true),
        ] {
            let mut tools = ToolRegistry::new(mode);
            tools.add(runtime_tool("make_figure", Access::Proposes, EDITING_MODES));
            assert_eq!(tools.specs().len() == 1, offered, "{mode}");
        }
    }

    #[test]
    fn reads_run_together_and_proposals_in_order() {
        let mut tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
        tools.add(runtime_tool(
            "make_figure",
            Access::ProposesInItsCall,
            EDITING_MODES,
        ));
        assert_eq!(
            tools.how_to_run(READ_DOCUMENT_TOOL_NAME),
            ToolRun::Concurrent
        );
        assert_eq!(tools.how_to_run(PROPOSE_EDIT_TOOL_NAME), ToolRun::InOrder);
        assert_eq!(tools.how_to_run(ADD_COMMENT_TOOL_NAME), ToolRun::InOrder);
        assert_eq!(tools.how_to_run("make_figure"), ToolRun::Amending);
        assert_eq!(tools.how_to_run("no_such_tool"), ToolRun::InOrder);
    }

    #[test]
    fn anchors_match_through_typography_and_folded_whitespace() {
        let doc = "He said “hello” — twice.\n\nThen left；quietly.";
        assert_eq!(anchor_match_count(doc, "He said \"hello\" - twice."), 1);
        assert_eq!(anchor_match_count(doc, "Then left;quietly."), 1);
        assert_eq!(anchor_match_count(doc, "twice.\nThen left"), 1);
        assert_eq!(anchor_match_count(doc, "not here"), 0);
    }

    #[test]
    fn a_section_runs_to_the_next_heading_at_its_level() {
        let doc = "# Intro\na\n## Intro details\nb\n# Methods\nc\n```sh\n# not a heading\n```";
        let lines: Vec<&str> = doc.lines().collect();
        // Exact title beats a heading that merely contains it.
        assert_eq!(section_range(&lines, "Intro"), Some((0, 4)));
        assert_eq!(section_range(&lines, "## intro DETAILS"), Some((2, 4)));
        // A `#` comment in a fence doesn't end the last section.
        assert_eq!(section_range(&lines, "methods"), Some((4, 9)));
        assert_eq!(section_range(&lines, "Results"), None);
        assert_eq!(section_range(&lines, "  "), None);
    }

    #[test]
    fn a_repeated_anchor_needs_a_longer_unique_context() {
        let doc = "the cat sat. the dog sat.";
        let args = |context: &str| serde_json::json!({ "context": context });
        assert!(check_anchor(doc, &args(""), "the cat").is_ok());
        assert!(check_anchor(doc, &args(""), "sat.").is_err());
        assert!(check_anchor(doc, &args("dog sat."), "sat.").is_ok());
        // The context must be longer than the anchor and occur once.
        assert!(check_anchor(doc, &args("sat."), "sat.").is_err());
        assert!(check_anchor(doc, &args("missing sat."), "sat.").is_err());
    }

    static NO_CONVENTIONS: std::sync::LazyLock<crate::ai::rules::Conventions> =
        std::sync::LazyLock::new(crate::ai::rules::Conventions::default);
    #[test]
    fn use_skill_expands_skills_and_loads_packs() {
        let ws = crate::ai::workspace::load_layers(None, None, None, &["describe".to_string()]);
        let doc = "雨はまだ降っていた。美咲は改札の前で、何度も時計を見た。";
        let ctx = ToolContext {
            undecided: &[],
            document: doc,
            skills: &ws.skills,
            ui_language: "en",
            root: None,
            sees_images: false,
            conventions: &NO_CONVENTIONS,
            library: &[],
            memory: None,
            proposed: Default::default(),
            checks: Default::default(),
        };
        let call = |name: &str| use_skill(&ctx, &json!({ "name": name }).to_string());
        let dialogue = call("dialogue");
        assert!(dialogue.starts_with("Instructions for skill `dialogue`"));
        assert!(
            dialogue.contains("### contract") && dialogue.contains("### standards-ja#dialogue")
        );
        assert!(call("tighten").contains("only when the user types /tighten"));
        assert!(
            call("describe").starts_with("No skill named `describe`"),
            "turned off"
        );
        let fr = call("standards-fr#dialogue");
        assert!(fr.starts_with("Reference `standards-fr#dialogue`") && fr.contains("guillemets"));
        let missing = call("nope");
        assert!(missing.contains("Reference packs: craft, standards-en"));
        assert!(
            !missing.contains("tighten"),
            "a /name-only skill isn't offered"
        );
    }

    fn ctx(document: &str) -> ToolContext<'_> {
        ToolContext {
            undecided: &[],
            document,
            skills: &[],
            ui_language: "en",
            root: None,
            sees_images: false,
            conventions: &NO_CONVENTIONS,
            library: &[],
            memory: None,
            proposed: Default::default(),
            checks: Default::default(),
        }
    }

    #[test]
    fn check_tools_stop_answering_once_their_budget_is_spent() {
        let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
        let context = ctx("草稿");
        let run = |name: &str, args: &str| execute(&tools, &context, name, args).text;
        let measure = |metric: &str| {
            run(
                MEASURE_TEXT_TOOL_NAME,
                &json!({ "text": "草稿", "metric": metric }).to_string(),
            )
        };
        for metric in ["", "chars", "cjk_chars"] {
            assert!(!measure(metric).starts_with("Not run"));
        }
        let refused = measure("words");
        assert!(
            refused.starts_with("Not run: measure_text was already called 3 times"),
            "{refused}"
        );
        // A platform's limit is measured as often as it takes.
        for _ in 0..10 {
            assert!(measure("x_weighted").starts_with("x_weighted: 4 of 280"));
        }
        // Each check has its own budget, and other tools have none.
        for _ in 0..4 {
            assert!(!run(CHECK_CONVENTIONS_TOOL_NAME, "{}").starts_with("Not run"));
        }
        assert!(run(CHECK_CONVENTIONS_TOOL_NAME, "{}").starts_with("Not run"));
        for _ in 0..5 {
            let out = run(SEARCH_TOOL_NAME, r#"{"query":"草"}"#);
            assert!(!out.starts_with("Not run"), "{out}");
        }
    }

    #[test]
    fn a_long_draft_of_new_text_is_proposed_not_checked() {
        let tools = ToolRegistry::builtin(false, false, AgentMode::Write, false, false);
        let paragraph = "港口不是海的终点，是陆地和浪涛握手的地方。".repeat(12);
        let context = ctx(&paragraph);
        let run = |name: &str, text: &str, metric: &str| {
            execute(
                &tools,
                &context,
                name,
                &json!({ "text": text, "metric": metric }).to_string(),
            )
            .text
        };
        let draft = format!("{paragraph}\n\n{paragraph}");
        for name in [MEASURE_TEXT_TOOL_NAME, CHECK_CONVENTIONS_TOOL_NAME] {
            let out = run(name, &draft, "cjk_chars");
            assert!(out.contains("doesn't take a draft"), "{name}: {out}");
        }
        // Text in the document, a short draft, and a platform's limit are
        // measured.
        assert!(!run(MEASURE_TEXT_TOOL_NAME, &paragraph, "cjk_chars").starts_with("Not run"));
        assert!(!run(MEASURE_TEXT_TOOL_NAME, "一句话。", "cjk_chars").starts_with("Not run"));
        assert!(!run(MEASURE_TEXT_TOOL_NAME, &draft, "weibo").starts_with("Not run"));
    }

    #[test]
    fn check_conventions_reports_by_rule_with_lines() {
        let doc = "# 周报\n\n本周完成了三项工作，进展顺利。\n\n下周继续推进,争取月底上线...\n";
        let out = check_conventions(&ctx(doc), "{}");
        assert!(
            out.starts_with("Writing conventions: zh-Hans-CN (Automatic"),
            "{out}"
        );
        assert!(
            out.contains("zh.punct.halfwidth (1): 中文句子里应使用全角标点。"),
            "{out}"
        );
        assert!(out.contains("L5 fix: \",\" -> \"，\""), "{out}");
        assert!(out.contains("zh.punct.ellipsis (1)"), "{out}");
        // A range or heading limits what is reported.
        let out = check_conventions(&ctx(doc), r#"{"start_line":1,"end_line":3}"#);
        assert!(
            out.contains("No convention issues found in lines 1-3."),
            "{out}"
        );
        let out = check_conventions(&ctx(doc), r#"{"heading":"没有"}"#);
        assert!(out.starts_with("No heading matching"), "{out}");
        // A draft is judged against the document.
        let out = check_conventions(&ctx(doc), r#"{"text":"我们还要测试,然后发布。"}"#);
        assert!(
            out.contains("in the text you gave") && out.contains("L1 fix"),
            "{out}"
        );
        // French no-break spaces are spelled out.
        let out = check_conventions(
            &ctx("Vraiment ? Nous avons fini le travail dans la maison avec les enfants."),
            "{}",
        );
        assert!(out.contains("[narrow no-break space]?"), "{out}");
        assert!(out.contains("write it as \\u00a0 or \\u202f"), "{out}");
    }

    #[test]
    fn measure_text_counts_exactly() {
        let out = measure_text(
            &ctx(""),
            r#"{"text":"你好 https://textus.app","metric":"x_weighted"}"#,
        );
        assert_eq!(out, "x_weighted: 28 of 280 weighted characters - within the limit (252 to spare). URLs count 23 each; CJK characters and emoji count 2.");
        let out = measure_text(&ctx(""), r#"{"text":"hi"}"#);
        assert!(
            out.contains("chars: 2 characters.") && out.contains("bluesky: 2 of 300"),
            "{out}"
        );
        assert!(measure_text(&ctx(""), r#"{"text":"hi","metric":"tiktok"}"#)
            .starts_with("Unknown metric"));
        assert!(measure_text(&ctx(""), "{}").starts_with("No `text`"));
    }

    #[test]
    fn the_rules_tools_are_in_every_mode() {
        for mode in [AgentMode::Review, AgentMode::Revise, AgentMode::Write] {
            let names = names(&builtin_tools(false, false, mode, false, false));
            assert!(
                names.iter().any(|n| n == "check_conventions")
                    && names.iter().any(|n| n == "measure_text"),
                "{names:?}"
            );
        }
    }

    #[test]
    fn the_project_file_tools_are_offered_only_with_a_project_folder() {
        let names = |has_root: bool| -> Vec<String> {
            names(&builtin_tools(
                false,
                has_root,
                AgentMode::Revise,
                false,
                false,
            ))
            .into_iter()
            .filter(|n| n.ends_with("_files") || n == READ_FILE_TOOL_NAME)
            .collect()
        };
        assert_eq!(
            names(true),
            ["find_files", "search_files", "list_files", "read_file"]
        );
        assert!(names(false).is_empty());
    }

    #[test]
    fn view_image_is_offered_only_to_a_model_that_can_see() {
        let offered = |has_root: bool, sees_images: bool| {
            builtin_tools(false, has_root, AgentMode::Review, false, sees_images)
                .iter()
                .any(|t| t.spec.name == VIEW_IMAGE_TOOL_NAME)
        };
        assert!(offered(true, true));
        assert!(!offered(true, false));
        assert!(!offered(false, true));
    }

    #[test]
    fn view_image_shows_the_image_and_the_listing_marks_it() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("map.png"), [0x89, b'P', b'N', b'G']).unwrap();
        std::fs::write(dir.path().join("notes.md"), "").unwrap();
        let tools = ToolRegistry::builtin(false, true, AgentMode::Review, false, true);
        let seeing = ToolContext {
            root: Some(dir.path()),
            sees_images: true,
            ..ctx("")
        };
        assert_eq!(list_files(&seeing, "{}"), "map.png (image)\nnotes.md");
        // The path as the listing shows it works too.
        let out = execute(
            &tools,
            &seeing,
            VIEW_IMAGE_TOOL_NAME,
            r#"{"path":"map.png (image)"}"#,
        );
        assert_eq!(out.text, "Here is `map.png` (image/png).");
        assert_eq!(out.images.len(), 1);
        let out = execute(
            &tools,
            &seeing,
            VIEW_IMAGE_TOOL_NAME,
            r#"{"path":"notes.md"}"#,
        );
        assert!(out.text.starts_with("`notes.md` isn't an image"));
        assert!(out.images.is_empty());
        let blind = ToolContext {
            root: Some(dir.path()),
            ..ctx("")
        };
        assert_eq!(list_files(&blind, "{}"), "notes.md");
    }

    #[test]
    fn read_file_takes_a_line_range() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "one\ntwo\nthree\n").unwrap();
        let in_project = ToolContext {
            root: Some(dir.path()),
            ..ctx("")
        };
        assert_eq!(
            read_file(
                &in_project,
                r#"{"path":"a.md","start_line":2,"end_line":2}"#
            ),
            "`a.md`, lines 2-2 of 3:\ntwo"
        );
        assert_eq!(
            read_file(&in_project, r#"{"path":"a.md"}"#),
            "one\ntwo\nthree\n"
        );
    }

    #[test]
    fn find_files_finds_project_files_by_name() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("notes")).unwrap();
        std::fs::write(dir.path().join("notes/Lin Wan.md"), "").unwrap();
        std::fs::write(dir.path().join("chapter-1.md"), "").unwrap();
        let tools = ToolRegistry::builtin(false, true, AgentMode::Revise, false, false);
        let in_project = ToolContext {
            root: Some(dir.path()),
            ..ctx("")
        };
        let run = |args: &str| execute(&tools, &in_project, FIND_FILES_TOOL_NAME, args).text;
        assert_eq!(run(r#"{"name":"lin_wan"}"#), "notes/Lin Wan.md");
        assert!(run(r#"{"name":"zebra"}"#).starts_with("No file in the project folder"));
        assert!(find_files(&ctx(""), r#"{"name":"lin"}"#).starts_with("There is no project folder"));
        assert!(list_files(&in_project, "{}").starts_with("notes/Lin Wan.md\nchapter-1.md"));
    }

    #[test]
    fn remember_is_offered_in_every_mode_only_while_the_setting_is_on() {
        let has = |mode: AgentMode, remember: bool| {
            builtin_tools(true, true, mode, remember, false)
                .iter()
                .any(|t| t.spec.name == REMEMBER_TOOL_NAME)
        };
        // It writes memory, not the document: Write and Review have it too.
        for mode in [AgentMode::Write, AgentMode::Review, AgentMode::Revise] {
            assert!(has(mode, true) && !has(mode, false), "{mode}");
        }
        assert_eq!(
            remember(&ctx(""), r#"{"kind":"style","text":"x"}"#),
            "Remembering is turned off."
        );
    }

    #[test]
    fn read_document_reads_a_section_with_its_subsections() {
        let doc = "# Title\nintro\n## Methods\nm1\n### Sampling\ns1\n```\n# not a heading\n```\n## Results\nr1";
        let out = read_document(&ctx(doc), r#"{"heading":"methods"}"#);
        assert!(out.starts_with("Lines 3-9 of 11:"), "{out}");
        assert!(out.contains("### Sampling") && out.contains("# not a heading"));
        assert!(!out.contains("## Results"));
    }

    #[test]
    fn read_document_reads_an_inclusive_line_range() {
        let out = read_document(&ctx("a\nb\nc\nd"), r#"{"start_line":2,"end_line":3}"#);
        assert_eq!(out, "Lines 2-3 of 4:\nb\nc\n");
    }

    #[test]
    fn review_mode_does_not_receive_the_edit_tool() {
        let edit_tool = |mode| {
            builtin_tools(true, true, mode, false, false)
                .into_iter()
                .find(|tool| tool.spec.name == PROPOSE_EDIT_TOOL_NAME)
        };
        assert!(edit_tool(AgentMode::Review).is_none());
        // Write and Revise share the tool as the model sees it (the cached
        // prefix); Write's run refuses what changes existing text (below).
        let spec = |mode| format!("{:?}", edit_tool(mode).unwrap().spec);
        assert_eq!(spec(AgentMode::Write), spec(AgentMode::Revise));
    }

    #[test]
    fn an_edit_of_text_an_undecided_rewrite_replaces_goes_into_the_rewrite() {
        let doc = "The lighthouse stood on the rock. Waves broke below.";
        let undecided = vec![crate::ai::images::UndecidedEdit {
            replaced: "The lighthouse stood on the rock.".into(),
            text: "The old lighthouse stood alone on its rock.".into(),
        }];
        let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
        let context = ToolContext {
            undecided: &undecided,
            ..ctx(doc)
        };
        let run = |args: &str| execute(&tools, &context, PROPOSE_EDIT_TOOL_NAME, args).text;
        // Words the rewrite kept: the edit goes into it.
        let out = run(r#"{"action":"replace","anchor":"lighthouse","text":"beacon"}"#);
        assert!(out.contains("goes into that proposal"), "{out}");
        // Words it no longer has: refused, pointed at the rewrite.
        let out =
            run(r#"{"action":"replace","anchor":"stood on the rock","text":"rose from the rock"}"#);
        assert!(out.starts_with("Not proposed"), "{out}");
        assert!(out.contains("Anchor in the rewrite's text"), "{out}");
        // A new version of the whole passage takes the rewrite's place.
        let out = run(
            r#"{"action":"replace","anchor":"The lighthouse stood on the rock.","text":"The beacon stood alone."}"#,
        );
        assert!(
            out.contains("takes the place of your earlier rewrite"),
            "{out}"
        );
        // Text beside it is the document's, as before.
        let out = run(
            r#"{"action":"replace","anchor":"Waves broke below.","text":"Waves crashed below."}"#,
        );
        assert!(out.starts_with("Edit proposed"), "{out}");
        assert!(!out.contains("goes into that proposal"), "{out}");
    }

    #[test]
    fn an_edit_may_change_text_proposed_and_not_decided_yet() {
        let doc = "The cat sat on the mat.";
        let undecided = vec![crate::ai::images::UndecidedEdit {
            replaced: String::new(),
            text: "It purred all night. Then it slept.".to_string(),
        }];
        for mode in [AgentMode::Write, AgentMode::Revise] {
            let tools = ToolRegistry::builtin(false, false, mode, false, false);
            let context = ToolContext {
                undecided: &undecided,
                ..ctx(doc)
            };
            let run = |args: &str| execute(&tools, &context, PROPOSE_EDIT_TOOL_NAME, args).text;
            for args in [
                r#"{"action":"replace","anchor":"It purred all night.","text":"It purred."}"#,
                r#"{"action":"delete","anchor":"Then it slept."}"#,
                r#"{"action":"insert_after","anchor":"Then it slept.","text":"At dawn it woke."}"#,
            ] {
                let out = run(args);
                assert!(out.starts_with("Edit proposed"), "{mode:?} {args}: {out}");
                assert!(out.contains("goes into that proposal"), "{out}");
            }
            // Text in neither is still refused.
            assert!(
                !run(r#"{"action":"replace","anchor":"A dog barked.","text":"x"}"#)
                    .starts_with("Edit proposed")
            );
        }
        // This request's own proposals count too.
        let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
        let context = ctx(doc);
        let run = |args: &str| execute(&tools, &context, PROPOSE_EDIT_TOOL_NAME, args).text;
        assert!(
            run(r#"{"action":"append","text":"A new line here."}"#).starts_with("Edit proposed")
        );
        assert!(
            run(r#"{"action":"replace","anchor":"A new line here.","text":"A newer line."}"#)
                .contains("goes into that proposal")
        );
    }

    #[test]
    fn write_mode_refuses_an_edit_that_changes_existing_text() {
        let doc = "The cat sat on the mat.";
        let tools = ToolRegistry::builtin(false, false, AgentMode::Write, false, false);
        let ctx = ctx(doc);
        let run = |args: &str| execute(&tools, &ctx, PROPOSE_EDIT_TOOL_NAME, args).text;
        for args in [
            r#"{"action":"replace","anchor":"The cat sat on the mat.","text":"A dog."}"#,
            r#"{"action":"replace_selection","text":"A dog."}"#,
            r#"{"action":"delete","anchor":"The cat sat on the mat."}"#,
            r#"{"action":"rewrite","text":"A dog."}"#,
        ] {
            let out = run(args);
            assert!(
                out.starts_with("Not proposed: Write mode only adds text"),
                "{out}"
            );
            assert!(out.contains("Revise mode"), "{out}");
        }
        for args in [
            r#"{"action":"insert_after","anchor":"The cat sat on the mat.","text":"It purred."}"#,
            r#"{"action":"append","text":"It purred."}"#,
        ] {
            assert!(run(args).starts_with("Edit proposed"), "{args}");
        }
        // Revise keeps every action.
        let revise = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
        assert!(execute(
            &revise,
            &ctx,
            PROPOSE_EDIT_TOOL_NAME,
            r#"{"action":"delete","anchor":"The cat sat on the mat."}"#
        )
        .text
        .starts_with("Edit proposed"));
    }

    #[test]
    fn propose_edit_refuses_a_clause_replaced_by_one_latin_token() {
        let doc = "会议照常。给您添麻烦了，如果周五上午不方便，请告诉我们您方便的时间。此致";
        let anchor = "给您添麻烦了，如果周五上午不方便，请告诉我们您方便的时间。";
        let args = |text: &str| {
            serde_json::json!({"action": "replace", "anchor": anchor, "text": text}).to_string()
        };
        let one = ctx(doc);
        let out = propose_edit(&one, &args("due"));
        assert!(out.starts_with("Not proposed"), "{out}");
        // Sent again unchanged, it is what the user asked for ("replace the
        // sentence with TBD") and stands.
        let out = propose_edit(&one, &args("due"));
        assert!(out.starts_with("Edit proposed"), "{out}");
        // A real translation and a short Chinese rewrite stand, and so does
        // a Latin name for a short Chinese one.
        for text in [
            "Sorry for the trouble - if Friday morning doesn't suit you, tell us what does.",
            "抱歉。",
        ] {
            let out = propose_edit(&ctx(doc), &args(text));
            assert!(out.starts_with("Edit proposed"), "{text}: {out}");
        }
        let out = propose_edit(
            &ctx("名称：乐维斯"),
            r#"{"action":"replace","anchor":"乐维斯","text":"Textus"}"#,
        );
        assert!(out.starts_with("Edit proposed"), "{out}");
    }

    #[test]
    fn a_second_proposal_for_the_same_passage_is_refused() {
        let doc = ctx("Textus is great. Textus is fast. It ships soon.");
        let ctx2 = ctx("Textus is great.");
        let ctx = doc;
        let first = r#"{"action":"replace","anchor":"Textus is great.","text":"Textus is good."}"#;
        assert!(propose_edit(&ctx, first).starts_with("Edit proposed"));
        assert!(propose_edit(&ctx, first).starts_with("Not proposed"));
        // Inside the first passage, too.
        let inner = r#"{"action":"delete","anchor":"great"}"#;
        assert!(propose_edit(&ctx, inner).starts_with("Not proposed"));
        // Another passage, an insertion beside the first, and the same
        // word picked out elsewhere by its context all stand.
        for args in [
            r#"{"action":"replace","anchor":"It ships soon.","text":"It ships in May."}"#,
            r#"{"action":"insert_after","anchor":"Textus is great.","text":" Really."}"#,
            r#"{"action":"replace","anchor":"Textus","context":"Textus is fast","text":"It"}"#,
        ] {
            assert!(
                propose_edit(&ctx, args).starts_with("Edit proposed"),
                "{args}"
            );
        }
        // Two fixes of a repeated word, pinned by overlapping contexts, are
        // two passages; the same occurrence pinned twice is one.
        let typos = super::tests::ctx("I think its fine and its late, its true.");
        for args in [
            r#"{"action":"replace","anchor":"its","context":"think its fine and its","text":"it's"}"#,
            r#"{"action":"replace","anchor":"its","context":"and its late, its true","text":"it's"}"#,
        ] {
            assert!(
                propose_edit(&typos, args).starts_with("Edit proposed"),
                "{args}"
            );
        }
        let again = r#"{"action":"replace","anchor":"its","context":"its late","text":"it is"}"#;
        assert!(propose_edit(&typos, again).starts_with("Not proposed"));
        // A refused call (no match) doesn't count as proposed.
        let missing = r#"{"action":"replace","anchor":"Textus is slow.","text":"x"}"#;
        assert!(propose_edit(&ctx2, missing).starts_with("No exact match"));
    }

    #[test]
    fn the_size_note_counts_like_measure_text() {
        let out = propose_edit(
            &ctx("周末带爸妈去了千岛湖，人很多。"),
            r#"{"action":"replace","anchor":"周末带爸妈去了千岛湖，人很多。","text":"周末去了千岛湖。"}"#,
        );
        // Punctuation counts, as in measure_text's chars.
        assert!(out.contains("replaces 15 characters with 8"), "{out}");
    }

    #[test]
    fn propose_edit_rejects_repeated_anchor_without_context() {
        let out = propose_edit(
            &ctx("Textus is great. Textus is fast."),
            r#"{"action":"replace","anchor":"Textus","text":"It"}"#,
        );
        assert!(out.contains("appears 2 times"), "{out}");
        assert!(out.contains("`context`"), "{out}");
    }

    #[test]
    fn propose_edit_accepts_repeated_anchor_with_unique_context() {
        let out = propose_edit(
            &ctx("Textus is great. Textus is fast."),
            r#"{"action":"replace","anchor":"Textus","text":"It","context":"Textus is fast"}"#,
        );
        assert!(out.starts_with("Edit proposed"), "{out}");
    }

    #[test]
    fn propose_edit_rejects_context_that_repeats_or_misses_the_anchor() {
        let doc = "Textus is great. Textus is great.";
        let repeated = propose_edit(
            &ctx(doc),
            r#"{"action":"replace","anchor":"Textus","text":"It","context":"Textus is great"}"#,
        );
        assert!(repeated.contains("`context`"), "{repeated}");
        let anchor_free = propose_edit(
            &ctx("Textus is great. Textus is fast."),
            r#"{"action":"replace","anchor":"Textus","text":"It","context":"is fast"}"#,
        );
        assert!(anchor_free.contains("`context`"), "{anchor_free}");
    }

    #[test]
    fn a_text_puts_each_picture_it_was_given_in_once() {
        let mut ledger = ProposalLedger::default();
        assert_eq!(ledger.pictures_problem("![a](textus-generated:zz)"), None);
        ledger.add_picture("k3f9qz".into());
        ledger.add_picture("p08mxa".into());
        let both = "One.\n\n![a](textus-generated:k3f9qz)\n\nTwo.\n\n![b](textus-generated:p08mxa)";
        assert_eq!(ledger.pictures_problem(both), None);
        let twice = "![a](textus-generated:k3f9qz)\n\n![b](textus-generated:k3f9qz)";
        let why = ledger.pictures_problem(twice).unwrap();
        assert!(why.contains("twice") && why.contains("p08mxa"), "{why}");
        let wrong = ledger
            .pictures_problem("![a](textus-generated:k3f9qy)")
            .unwrap();
        assert!(wrong.contains("no picture of this request"), "{wrong}");
    }
}
