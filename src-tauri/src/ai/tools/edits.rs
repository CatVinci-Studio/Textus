//! propose_edit: an edit the writer accepts or rejects, the blocks it
//! names checked against the document before it is offered.

use super::*;

pub(crate) const PROPOSE_EDIT_TOOL_NAME: &str = "propose_edit";
/// How a valid proposal's result starts - and a valid comment's below:
/// such a call needs nothing more from the model (ToolOutput::settled).
pub(super) const EDIT_PROPOSED: &str = "Edit proposed";

/// Told after a rewrite whose text swapped a document's picture for a new
/// one: the original stays in it, and the new one is the picture tool's.
const PICTURE_KEPT_NOTE: &str = " A picture of the document you rewrote is kept as it was in it: text edits never change a picture. To change that picture, call generate_image with its block, in this reply.";

/// The edit operations the frontend knows how to apply. Keep in step with the
/// frontend's `EditAction`, or proposals validate but can't be applied.
pub(crate) const EDIT_ACTIONS: [&str; 7] = [
    "replace",
    "replace_selection",
    "insert_before",
    "insert_after",
    "delete",
    "append",
    "insert_at_cursor",
];

pub(super) fn needs_anchor(action: &str) -> bool {
    // replace_selection targets the user's captured selection, so there is no
    // anchor to locate (and the selection may not be unique in the document).
    action != "append" && action != "replace_selection" && action != "insert_at_cursor"
}

pub(super) fn needs_text(action: &str) -> bool {
    action != "delete"
}

/// Changes nothing itself: the document only changes when the user accepts.
/// Validates the proposal by the frontend's rules, so the model gets feedback
/// instead of the user getting a dead Apply button.
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

    // What the edit is about: what its blocks name, else the words it quotes.
    let anchor = match ctx.document.target_span(&parsed) {
        Some((from, to)) => &ctx.document.text[from..to],
        None => parsed.get("anchor").and_then(|v| v.as_str()).unwrap_or(""),
    };
    // A block it names that isn't there is said as that. Words its block doesn't
    // hold but undecided proposed text does (a rewrite of that block, quoted as
    // written) go into that proposal.
    let mut quote_joins = false;
    if needs_anchor(action) && parsed.get("block").is_some() {
        if let Err(problem) = crate::ai::doc_blocks::check_target(ctx.document, &parsed) {
            let block = parsed.get("block").and_then(|v| v.as_str()).unwrap_or("");
            let last = parsed.get("last_block").and_then(|v| v.as_str());
            let in_run = ctx.document.run(block, last).is_some();
            if !(in_run && !anchor.is_empty() && quotes_undecided(ctx, anchor)) {
                return problem;
            }
            quote_joins = true;
        }
    }
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
        let named = parsed.get("block").is_some() && !quote_joins;
        if !named {
            // Text proposed and not decided yet - this request's or an
            // earlier one's - has no block: the edit quotes it, and goes
            // into that proposal.
            if !quotes_undecided(ctx, anchor) {
                return crate::ai::doc_blocks::NO_BLOCK.to_string();
            }
            joins = true;
        } else if let Err(problem) = crate::ai::doc_blocks::check_target(ctx.document, &parsed) {
            return problem;
        } else if let Some(rewrite) = ctx
            .undecided
            .iter()
            .find(|edit| !edit.replaced.is_empty() && edit.replaced.contains(anchor))
        {
            // Document text an undecided rewrite replaces: the user sees the rewrite
            // there. Where the rewrite still has those words the edit goes into it, and
            // a new version of the whole passage takes its place.
            again = action == "replace" && anchor == rewrite.replaced;
            if !again {
                if rewrite.text.matches(anchor).count() != 1 || !quotes_undecided(ctx, anchor) {
                    return "Not proposed: that passage is one you rewrote earlier and the user hasn't decided on yet - they see your rewrite in its place, and an edit of the old text can't be applied beside it. Anchor in the rewrite's text instead (quote it as you proposed it): the edit goes into that proposal.".to_string();
                }
                joins = true;
            }
        }
    }

    // The frontend later appends a status note to this result. The size of the
    // change is measured here so the reply can rest on it instead of guessing.
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
    // A second proposal for a passage this reply already changes: only one could
    // ever be applied, so the first stands and the copy is refused.
    if !joins && matches!(action, "replace" | "delete" | "replace_selection") {
        let passage = match action {
            "replace_selection" => ProposedPassage::selection(),
            _ => ProposedPassage::at(ctx.document.target_span(&parsed), anchor),
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
    // "Even if it falls short": told the size, the model sent a second, shorter
    // overlapping proposal to meet a target.
    let mut unmade = String::new();
    if !text.is_empty() {
        let mut ledger = ctx.proposed.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(problem) = ledger.pictures_problem(text) {
            return problem;
        }
        ledger.texts.push(text.to_string());
        unmade = ledger.take_unmade().unwrap_or_default();
        unmade.push_str(&ledger.pictures_placed(text));
    }
    // A rewrite that swapped a picture keeps the original: the swap is
    // generate_image's. One that kept its pictures says so too, with their ids,
    // or the model thought the picture already changed.
    if parsed
        .get(crate::ai::doc_blocks::PICTURES_KEPT_KEY)
        .is_some()
    {
        unmade.push_str(PICTURE_KEPT_NOTE);
    }
    // Said last, after what to reply: said before it, the reply came first
    // and the turn ended there.
    let pictures = parsed
        .get(crate::ai::doc_blocks::PICTURES_IN_RUN_KEY)
        .and_then(|v| v.as_array())
        .filter(|ids| !ids.is_empty() && parsed.get(crate::ai::doc_blocks::PICTURES_KEPT_KEY).is_none())
        .map(|ids| {
            let ids: Vec<String> = ids
                .iter()
                .filter_map(|id| id.as_str().map(|id| format!("[#{id}]")))
                .collect();
            format!(
                " Its pictures ({}) are kept in it as they were. If the user asked for a picture to change too, it hasn't yet: before you reply, redo it with generate_image, `replace` with its block.",
                ids.join(", ")
            )
        })
        .unwrap_or_default();
    let into = if joins {
        " It changes text you proposed that the user hasn't decided on yet: it goes into that proposal, which now reads with it."
    } else if again {
        " It takes the place of your earlier rewrite of that passage, which the user hadn't decided on."
    } else {
        ""
    };
    format!("{EDIT_PROPOSED} - the user now sees it with an Apply button.{into}{size}{unmade} (Counts here are for you, measured the way measure_text does; the user never sees this note, so don't refer to it.) This is your proposal for that passage in this reply - don't send another one for it, even if it falls short of a target: say so in your reply instead. In your reply, say in a sentence or two what you proposed and why; don't repeat the text or list what you kept.{pictures}")
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

/// How long a stretch of text is, in the unit its language counts in:
/// characters for Chinese and Japanese, words otherwise, exactly as
/// measure_text counts.
pub(super) fn text_size(text: &str) -> (usize, &'static str) {
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

pub(super) fn is_cjk_char(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{ac00}'..='\u{d7af}')
}

/// A replacement that can't be what the model meant: a whole CJK clause
/// replaced by one short Latin token. Refused so the model resends; the
/// identical call sent again goes through ("replace the sentence with TBD").
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

/// One character's plain form: typographic quotes, dashes, full-width ASCII and
/// non-breaking spaces folded to ASCII. One char in, one out, so positions align.
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
