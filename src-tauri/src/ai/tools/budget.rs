//! The checks a request may make and how often, a draft refused where it
//! should be an edit, and which results settle a request.

use super::*;

/// How often one request may call each check tool before it stops
/// answering. Asked for "800 字", a model drafted, measured, rewrote and
/// measured again until its steps ran out, and never proposed the text at
/// all; a check that keeps answering invites exactly that loop. Measuring
/// against a platform's limit is not counted (`measures_a_limit`): text
/// that must fit is worth trimming until it does, and a budget refused an
/// X post and headline options still over their limit in the live eval.
pub(crate) const CHECK_BUDGETS: &[(&str, usize)] = &[
    (MEASURE_TEXT_TOOL_NAME, 3),
    (CHECK_CONVENTIONS_TOOL_NAME, 4),
];

/// Whether a measure_text call measures against a platform's limit (a
/// metric with one, such as x_weighted), not a plain count.
pub(crate) fn measures_a_limit(arguments: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|args| crate::ai::rules::measure::measure("", args.get("metric")?.as_str()?))
        .is_some_and(|m| m.limit.is_some())
}

/// How long a `text` not in the document may be before a check of it is a
/// hidden draft (refuses_a_draft): a sentence or a short paragraph.
pub(crate) const DRAFT_CHARS: usize = 200;

/// A check of a draft - new text, long, not from the document, and not
/// measured against a platform's limit - refused. Asked for "1200 字" with
/// two pictures, a model wrote the whole piece into measure_text three
/// times before proposing it: over three minutes in which the user saw
/// nothing. Proposed instead, the text streams in where they watch, and
/// propose_edit's result gives its size.
pub(crate) fn refuses_a_draft(ctx: &ToolContext, name: &str, arguments: &str) -> Option<String> {
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
    Some(format!("Not run: {name} doesn't take a draft of new text. Write the text as an edit now - the user sees it come in, and conventions are fixed on the way. If it misses a length the user asked for, say so in your reply."))
}

/// Counts a call to a check tool, and refuses it once the request has used
/// up that tool's budget - or when it checks a hidden draft
/// (refuses_a_draft). None for every other call, and within budget.
pub(crate) fn spend_check(ctx: &ToolContext, name: &str, arguments: &str) -> Option<String> {
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
        format!("Not run: {name} was already called {budget} times in this request, which is all it gets. Stop checking and finish with what you have: write your latest draft as an edit (when the request changes the document), and reply.")
    })
}

/// Whether `result` is a valid proposal or comment: the user's to decide
/// now, with nothing in it the model has to answer. A comment settles only
/// once the request can't change the document or has proposed a change
/// (`edited`): where it can, comments and a sentence may be the model about
/// to write its edits next - in 1.2.0-rc.6's live eval DeepSeek ended two
/// translations of three that way, the translation never written.
pub(crate) fn settles(name: &str, result: &str, edited: bool) -> bool {
    match name {
        PROPOSE_EDIT_TOOL_NAME => result.starts_with(EDIT_PROPOSED),
        ADD_COMMENT_TOOL_NAME => edited && result.starts_with(COMMENT_ADDED),
        _ => false,
    }
}
