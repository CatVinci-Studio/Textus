//! propose_edit: an edit the writer accepts or rejects, its anchor checked
//! against the document before it is offered.

use super::*;

pub(crate) const PROPOSE_EDIT_TOOL_NAME: &str = "propose_edit";
/// How a valid proposal's result starts - and a valid comment's below:
/// such a call needs nothing more from the model (ToolOutput::settled).
pub(super) const EDIT_PROPOSED: &str = "Edit proposed";

/// The edit operations the frontend knows how to apply. Kept in sync with
/// `EditAction` in src/ai/types.ts - adding one here without teaching
/// the frontend (usePendingEdits.ts, which resolves proposals, and
/// apply-edit.ts, which writes them) about it produces proposals that validate but
/// can't be applied.
pub(super) const EDIT_ACTIONS: [&str; 7] = [
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

pub(super) fn needs_anchor(action: &str) -> bool {
    // replace_selection targets the user's captured selection, so there is
    // no anchor to locate (and the selection may not be unique in the
    // document anyway - that's the point of having the action).
    action != "append" && action != "replace_selection" && action != "insert_at_cursor"
}

pub(super) fn needs_text(action: &str) -> bool {
    action != "delete"
}

/// Doesn't modify anything itself - the document only ever changes through
/// the user clicking Apply in the frontend. This validates the proposal
/// against the same rules the frontend applies with (known action, required
/// fields present, `anchor` matching the document exactly once) so the model
/// gets immediate feedback instead of the user getting a dead Apply button.
pub(super) fn propose_edit(ctx: &ToolContext, arguments: &str) -> String {
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
    format!("{EDIT_PROPOSED} - the user now sees it with an Apply button.{size} (Counts here are for you, measured the way measure_text does; the user never sees this note, so don't refer to it.) This is your proposal for that passage in this reply - don't send another one for it, even if it falls short of a target: say so in your reply instead. In your reply, say in a sentence or two what you proposed and why; don't repeat the text or list what you kept.")
}

/// Write mode's propose_edit. Its schema offers only INSERT_ACTIONS, but a
/// model may send another action anyway; it is refused here, so nothing
/// that changes or removes the user's text reaches the editor in this mode.
pub(super) fn propose_insertion(ctx: &ToolContext, arguments: &str) -> String {
    let action = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| v.get("action")?.as_str().map(str::to_string))
        .unwrap_or_default();
    if !INSERT_ACTIONS.contains(&action.as_str()) {
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
pub(super) fn text_size(text: &str) -> (usize, &'static str) {
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

pub(super) fn is_cjk_char(c: char) -> bool {
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
pub(super) fn degenerate_replacement(action: &str, anchor: &str, text: &str) -> Option<String> {
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

pub(super) fn normalize_for_match(text: &str) -> String {
    text.chars().map(normalize_char).collect()
}

pub(super) fn collapse_whitespace(text: &str) -> String {
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

pub(super) fn anchor_match_count(document: &str, anchor: &str) -> usize {
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
