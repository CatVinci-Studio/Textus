use crate::ai::builtin;
use crate::ai::workspace::{AgentSkill, Invocation};
use aicompat::agent::ToolSpec;
use serde_json::json;
use std::path::Path;

/// Everything a tool implementation needs to actually do its work. Grows as
/// more tools need more context (e.g. an MCP client handle) without changing
/// each tool's call signature.
pub struct ToolContext<'a> {
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
    /// The writing conventions (setting and style-profile front matter)
    /// check_conventions checks against.
    pub conventions: &'a crate::ai::rules::Conventions,
    /// Library names and aliases, for the library-name rule.
    pub library: &'a [String],
    /// The passages this request's proposals already replace or delete
    /// (their `context`, else their anchor; "" for the selection). One
    /// context serves one request, every step of it.
    pub proposed: std::sync::Mutex<ProposalLedger>,
    pub image: Option<&'a crate::media::jobs::ImageTaskContext>,
}

/// What this request's propose_edit calls have done so far.
#[derive(Debug, Default)]
pub struct ProposalLedger {
    /// The passages proposals already replace or delete.
    passages: Vec<ProposedPassage>,
    /// Replacements refused once as looking cut off (degenerate_replacement),
    /// as `anchor\0text`: the same call sent again is meant, and goes through.
    refused_short: Vec<String>,
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

/// A tool the agent can call, paired with its local implementation. Built-in
/// tools (like `search_document` below) implement `run` directly; a future
/// MCP integration would instead build this list by asking a connected MCP
/// server for its tool specs and forwarding `run` to an MCP `tools/call`
/// request - the registry and dispatch below don't need to change either way.
pub struct Tool {
    pub spec: ToolSpec,
    pub run: fn(&ToolContext, &str) -> String,
}

pub fn image_tool() -> Tool {
    Tool {
        spec: ToolSpec {
            name: "generate_image",
            description: "Generate one proposed illustration only when the user requested an image. Returns a background job immediately: continue drafting text without waiting. The UI reviews the image before insertion. `anchor` is a verbatim unique section heading or passage at the intended insertion point, including a heading you proposed in this task. Never insert a temporary URL into Markdown. Maximum two image requests per task, including retries.",
            parameters: json!({"type":"object", "properties": {
                "prompt":{"type":"string"}, "anchor":{"type":"string"}, "alt":{"type":"string"}, "caption":{"type":"string"},
                "size":{"type":"string","enum":["1024x1024","1536x1024","1024x1536"]},
                "quality":{"type":"string","enum":["auto","low","medium","high","standard","hd"]}
            }, "required":["prompt","anchor","alt"]}),
        },
        run: |ctx, arguments| {
            let Some(context) = ctx.image.filter(|c| c.allowed()) else { return "Image generation denied: no task authorization or a read-only mode.".into(); };
            let request = match serde_json::from_str(arguments) { Ok(request) => request, Err(_) => return "Image generation refused: invalid request arguments.".into() };
            match crate::media::jobs::start_job(context, request) {
                Ok(job) => serde_json::to_string(&job).unwrap_or_else(|_| "Image job serialization failed.".into()),
                Err(error) => format!("Image not generated ({}): {}", error.code, error.message),
            }
        },
    }
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
    format!("{header}\n{out}")
}

pub(crate) const PROPOSE_EDIT_TOOL_NAME: &str = "propose_edit";

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

    let anchor = parsed.get("anchor").and_then(|v| v.as_str()).unwrap_or("");
    let has_text = parsed.get("text").and_then(|v| v.as_str()).is_some();
    if needs_text(action) && !has_text {
        return format!("`{action}` requires `text` - the new content.");
    }
    if needs_anchor(action) {
        if anchor.is_empty() {
            return format!(
                "`{action}` requires `anchor` - the exact document text the edit targets."
            );
        }
        if let Err(problem) = check_anchor(ctx.document, &parsed, anchor) {
            return problem;
        }
    }

    // On later requests the frontend appends a bracketed status note to this
    // result (accepted / rejected / still undecided) - see
    // annotateProposalStatuses in src/ai/revision/proposal-status.ts. The size of
    // the change is measured here so the reply can rest on it: replies
    // called a 20% cut "about 70% of the original" and an expansion that
    // shrank "expanded into two paragraphs" (docs/AI-EVAL.md, round 2).
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
    if matches!(action, "replace" | "delete" | "replace_selection") {
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
    format!("Edit proposed - the user now sees it with an Apply button.{size} (Counts here are for you, measured the way measure_text does; the user never sees this note, so don't refer to it.) This is your proposal for that passage in this reply - don't send another one for it, even if it falls short of a target: say so in your reply instead. In your reply, say in a sentence or two what you proposed and why; don't repeat the text or list what you kept.")
}

/// How long a stretch of text is, in the unit its language counts in:
/// characters for Chinese and Japanese, words otherwise - counted exactly
/// as measure_text's `chars` and `words` do. The note used to count only
/// ideographs while measure_text counted punctuation too, and a reply told
/// the user the two counts disagreed and to count again themselves
/// (round 4, social/zh/shorten-100).
fn text_size(text: &str) -> (usize, &'static str) {
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
fn check_anchor(document: &str, args: &serde_json::Value, anchor: &str) -> Result<(), String> {
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
        Ok(()) => "Comment added - the user sees it with a button that jumps to the passage. Don't repeat it in your reply.".to_string(),
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

const LIST_FILES_TOOL_NAME: &str = "list_files";
const READ_FILE_TOOL_NAME: &str = "read_file";

/// How much of the project the listing shows: enough for reference
/// material next to the document, small enough that a huge folder can't
/// blow up the prompt.
const MAX_LISTED_FILES: usize = 200;
const SEARCH_FILES_TOOL_NAME: &str = "search_files";

/// The project folder's text files (paths relative to it). Hidden entries
/// and build/dependency folders are skipped - see ai::project.
fn list_files(ctx: &ToolContext, _arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document (it hasn't been saved, or its folder is too broad to use), so there are no files to list."
            .to_string();
    };
    let files = crate::ai::project::walk_text_files(root);
    if files.is_empty() {
        return "The project folder has no text files.".to_string();
    }
    let mut lines: Vec<String> = files.iter().take(MAX_LISTED_FILES).cloned().collect();
    if files.len() > MAX_LISTED_FILES {
        lines.push(format!(
            "... ({} more - use search_files to find something specific)",
            files.len() - MAX_LISTED_FILES
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

/// Reads a text file from inside the project folder - containment, hidden
/// files and size are enforced by ai::project::read_text.
fn read_file(ctx: &ToolContext, arguments: &str) -> String {
    let Some(root) = ctx.root else {
        return "There is no project folder for this document (it hasn't been saved, or its folder is too broad to use), so there are no files to read."
            .to_string();
    };
    crate::ai::project::read_text(root, &path_argument(arguments, "path")).unwrap_or_else(|err| err)
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

/// The tools available to an agent conversation. Skill and file tools are
/// only offered when there's something for them to work on - a tool that can
/// only report "nothing there" would just waste the model's steps. Append
/// here (or extend to merge in MCP-provided tools) as the toolset grows.
pub fn builtin_tools(has_skills: bool, has_root: bool, allow_edits: bool) -> Vec<Tool> {
    let mut tools = vec![Tool {
            spec: ToolSpec {
                name: SEARCH_TOOL_NAME,
                description: "Search the current document for a query string (case-insensitive). Returns matching lines with their line numbers.",
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
            run: search_document,
        }, Tool {
            spec: ToolSpec {
                name: READ_DOCUMENT_TOOL_NAME,
                description: "Read part of the current document verbatim: a whole section by its heading (subsections included), or a range of lines. Use it before revising a passage you can't fully see, and to copy exact anchors. The text comes back without line-number prefixes, ready to quote.",
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
            run: read_document,
        }];

    // The rules engine's read-only tools: every mode has them.
    tools.push(Tool {
        spec: ToolSpec {
            name: CHECK_CONVENTIONS_TOOL_NAME,
            description: "Check text against the document's writing conventions with a deterministic rules engine: punctuation and spacing (full-width marks in Chinese and Japanese, French no-break spaces, quotes, dashes, ellipses), numbers and dates, spelling lists, and consistency with the rest of the document, under the conventions profile in force (shown in the result). Pass `heading` or a line range for part of the document (default: all of it), or `text` to check a draft before you propose it. Returns findings grouped by rule with line numbers, the text, the fix and why. Use it to ground proofreading and convention fixes instead of guessing; it changes nothing.",
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
        run: check_conventions,
    });
    tools.push(Tool {
        spec: ToolSpec {
            name: MEASURE_TEXT_TOOL_NAME,
            description: "Count text exactly for a length limit - never estimate a count yourself. Metrics: x_weighted (X, limit 280: URLs count 23, CJK characters and emoji 2), bluesky (300 graphemes and 3,000 bytes), threads (500), instagram (2,200, at most 5 hashtags), mastodon (500 by default), linkedin (3,000, fold near 140), wechat_title (32), wechat_digest (120), wechat_content, xhs_title (20), xhs_body (1,000), weibo, govuk_title (65), govuk_summary (160), zh_academic_title (25 字), and plain chars, words, cjk_chars, utf8_bytes. Without `metric` it returns the basic counts. Use it on the exact text before proposing anything that must fit a limit, and give the count in your reply.",
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
        run: measure_text,
    });

    // Comments change nothing, so every mode has them - feedback is most
    // often asked for in Ask mode.
    tools.push(Tool {
        spec: ToolSpec {
            name: ADD_COMMENT_TOOL_NAME,
            description: "Pin a piece of feedback to a passage without changing it - for reviews and critique (\"what's weak here\", \"check this draft\"). One call per point; quote the passage verbatim as `anchor` (unique in the document, or add `context`). The user sees each comment as a card that jumps to its passage, so keep your reply to a short overall summary.",
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
        run: add_comment,
    });

    // Ask and Plan are structurally read-only: the model never receives the
    // edit tool, so a provider cannot accidentally ignore a prompt-only mode
    // instruction and create a proposal anyway.
    if allow_edits {
        tools.push(Tool {
            spec: ToolSpec {
                name: PROPOSE_EDIT_TOOL_NAME,
                description: "Propose one edit to the document. Nothing is modified directly: the user reviews the proposal and applies it with one click. Call once per distinct edit. Pick the action that matches the intent: `replace` swaps `anchor` for `text`; `replace_selection` swaps the user's currently selected text (the <selected-text> block in their message; no `anchor` needed) for `text`; `insert_before`/`insert_after` add `text` around an untouched `anchor` - inside the paragraph when the anchor is a phrase or sentence within it (write `text` as words that read on from it - after a paragraph's last sentence, this continues the paragraph), as a new paragraph when the anchor is a whole block or `text` is block content (a heading, list, several paragraphs), and as a new line of the same table or list when the anchor is a whole row or list item line and `text` is another one; `delete` removes `anchor`; `append` adds `text` at the end of the document; `insert_at_cursor` adds `text` exactly where the user's cursor is (only when their message carries a <cursor> block showing it; no `anchor` needed). `anchor` must be copied verbatim from the document and occur exactly once - if the text you need to target appears more than once, keep `anchor` as the exact text being edited and also pass `context`. `text` must be valid markdown: `-` or `1.` for lists (never `•` or other bullet symbols), `#` for headings.",
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": EDIT_ACTIONS,
                            "description": "What kind of edit this is"
                        },
                        "anchor": {
                            "type": "string",
                            "description": "Exact existing document text the edit targets, quoted verbatim. Required for every action except `append`."
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
            run: propose_edit,
        });
    }

    if has_skills {
        tools.push(Tool {
            spec: ToolSpec {
                name: USE_SKILL_TOOL_NAME,
                description: "Load the full instructions of one of the available skills (listed in the system prompt), or a reference pack a skill names. Call this before following a skill whenever the user's request matches its description, or when the user invokes it by name.",
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
            run: use_skill,
        });
    }

    if has_root {
        tools.push(Tool {
            spec: ToolSpec {
                name: SEARCH_FILES_TOOL_NAME,
                description: "Search every text file in the project folder for a word or phrase (case-insensitive). Returns `path:line: text` matches - use it to find where a character, term or fact appears across chapters and notes, then read_file for the full context.",
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
            run: search_files,
        });
        tools.push(Tool {
            spec: ToolSpec {
                name: LIST_FILES_TOOL_NAME,
                description: "List the text files in the project folder (recursively, paths relative to it). Use it to discover reference material - notes, other chapters, data - before reading one.",
                parameters: json!({"type": "object", "properties": {}}),
            },
            run: list_files,
        });
        tools.push(Tool {
            spec: ToolSpec {
                name: READ_FILE_TOOL_NAME,
                description: "Read a text file from the project folder. Use the relative path as shown by list_files or search_files.",
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
            run: read_file,
        });
    }

    tools
}

pub fn tool_specs(tools: &[Tool]) -> Vec<ToolSpec> {
    tools.iter().map(|t| t.spec.clone()).collect()
}

pub fn execute(tools: &[Tool], ctx: &ToolContext, name: &str, arguments: &str) -> String {
    match tools.iter().find(|t| t.spec.name == name) {
        Some(tool) => (tool.run)(ctx, arguments),
        None => format!("Unknown tool: {name}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            document: doc,
            skills: &ws.skills,
            ui_language: "en",
            root: None,
            conventions: &NO_CONVENTIONS,
            library: &[],
            proposed: Default::default(),
            image: None,
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
            document,
            skills: &[],
            ui_language: "en",
            root: None,
            conventions: &NO_CONVENTIONS,
            library: &[],
            proposed: Default::default(),
            image: None,
        }
    }

    #[test]
    fn image_tool_cannot_authorize_itself() {
        let tool = image_tool();
        let result = (tool.run)(
            &ctx("## Section"),
            r###"{"prompt":"a diagram","anchor":"## Section","alt":"diagram","allowAutomatic":true}"###,
        );
        assert!(result.contains("denied"));
        for read_only in [builtin_tools(false, false, false)] {
            assert!(!read_only.iter().any(|t| t.spec.name == "generate_image"));
        }
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
        for edits in [false, true] {
            let names: Vec<&str> = builtin_tools(false, false, edits)
                .iter()
                .map(|t| t.spec.name)
                .collect();
            assert!(
                names.contains(&"check_conventions") && names.contains(&"measure_text"),
                "{names:?}"
            );
        }
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
    fn read_only_modes_do_not_receive_the_edit_tool() {
        let read_only = builtin_tools(true, true, false);
        assert!(!read_only
            .iter()
            .any(|tool| tool.spec.name == PROPOSE_EDIT_TOOL_NAME));

        let editing = builtin_tools(true, true, true);
        assert!(editing
            .iter()
            .any(|tool| tool.spec.name == PROPOSE_EDIT_TOOL_NAME));
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
}
