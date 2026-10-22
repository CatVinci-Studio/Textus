//! A step's result made ready for the loop: block ids resolved, the
//! document's conventions applied to proposed text, pictures placed.

use super::*;

/// Proposal post-processing (rules::postfix, CATALOGUE.md §3.13): the
/// `text` of each propose_edit call in a step, made to follow the P0
/// conventions the document already follows (full-width punctuation in a
/// Chinese document that uses it, attached Korean particles...). Done here,
/// before the call reaches the tool, the history and the frontend - whose
/// proposal card takes the completed call's arguments as authoritative -
/// so the user sees the fixed text. Returns the rules applied (the live
/// eval records them, so prompt regressions stay visible).
pub(crate) fn postfix_step(
    result: StepResult,
    document: &str,
    conventions: &Conventions,
) -> (StepResult, Vec<&'static str>) {
    let StepResult::ToolCalls(calls) = result else {
        return (result, Vec::new());
    };
    let mut applied = Vec::new();
    // An edit naming its block (doc_blocks.rs) becomes one quoting it first,
    // so everything after - the tool, the history, the frontend - sees
    // anchors as before.
    let blocks = doc_blocks::split(document);
    let calls = calls
        .into_iter()
        .map(|call| match call {
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                reasoning,
            } if name == tools::PROPOSE_EDIT_TOOL_NAME => {
                let arguments = doc_blocks::resolve_edit_arguments(document, &blocks, &arguments);
                let arguments = match crate::ai::rules::postfix::proposal_arguments(
                    &arguments,
                    document,
                    conventions,
                ) {
                    Some((fixed, rules)) => {
                        applied.extend(rules);
                        fixed
                    }
                    None => arguments,
                };
                AgentTurn::ToolCall {
                    call_id,
                    name,
                    arguments,
                    reasoning,
                }
            }
            // A comment or a picture names its block too.
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                reasoning,
            } if name == tools::ADD_COMMENT_TOOL_NAME
                || name == crate::ai::images::GENERATE_IMAGE_TOOL_NAME =>
            {
                AgentTurn::ToolCall {
                    arguments: doc_blocks::resolve_target_arguments(document, &blocks, &arguments),
                    call_id,
                    name,
                    reasoning,
                }
            }
            other => other,
        })
        .collect();
    (StepResult::ToolCalls(calls), applied)
}

/// A step's result as the loop takes it, once its edit tags are calls:
/// [`postfix_step`] applied, and the pictures written into its text placed
/// (InlinePictures::place). The app and the live eval both settle each
/// step here; the rules applied are returned for the eval to record.
pub(crate) fn settle_step(
    result: StepResult,
    document: &str,
    conventions: &Conventions,
    pictures: Option<&InlinePictures<'_>>,
    ledger: &std::sync::Mutex<tools::ProposalLedger>,
) -> (StepResult, Vec<&'static str>) {
    let (result, applied) = postfix_step(edits_before_comments(result), document, conventions);
    let result = match pictures {
        Some(pictures) => pictures.place(result),
        None => result,
    };
    ledger.lock().unwrap_or_else(|e| e.into_inner()).open_run = open_run(&result, document);
    (result, applied)
}

/// The step's last edit, when it rewrites tools::EDIT_RUN_CAP blocks or
/// more and stops short of the document's end: a run rewritten in parts,
/// whose next part may not have come - its call id and the id of the block
/// after it. GPT sent the first part of a translation with "translated it
/// all" and nothing after (1.2.0-rc.6); a step that sends every part ends
/// with the last one, at the end.
pub(crate) fn open_run(result: &StepResult, document: &str) -> Option<(String, String)> {
    let StepResult::ToolCalls(calls) = result else {
        return None;
    };
    let (call_id, arguments) = calls.iter().rev().find_map(|t| match t {
        AgentTurn::ToolCall {
            call_id,
            name,
            arguments,
            ..
        } if name == tools::PROPOSE_EDIT_TOOL_NAME => Some((call_id, arguments)),
        _ => None,
    })?;
    let args: serde_json::Value = serde_json::from_str(arguments).ok()?;
    if args.get("action").and_then(|a| a.as_str()) != Some("replace") {
        return None;
    }
    let anchor = args
        .get("anchor")
        .and_then(|a| a.as_str())
        .filter(|a| !a.is_empty())?;
    let within = args
        .get("context")
        .and_then(|c| c.as_str())
        .and_then(|c| document.find(c).map(|at| (at, c)));
    let start = match within {
        Some((at, context)) => at + context.find(anchor)?,
        None => document.find(anchor)?,
    };
    let end = start + anchor.len();
    let blocks = doc_blocks::split(document);
    let covered = blocks
        .iter()
        .filter(|b| b.start < end && b.end > start)
        .count();
    let next = blocks.iter().find(|b| b.start >= end)?;
    (covered >= tools::EDIT_RUN_CAP).then(|| (call_id.clone(), next.id.clone()))
}

/// A step's edits run before its comments (calls run in order), so a
/// comment knows whether the request has proposed a change
/// (tools::settles), and a step of edits, comments and a sentence still ends
/// in one step. Everything else keeps its place; a step without an edit is
/// as it came.
fn edits_before_comments(result: StepResult) -> StepResult {
    let StepResult::ToolCalls(mut calls) = result else {
        return result;
    };
    let named =
        |t: &AgentTurn, tool: &str| matches!(t, AgentTurn::ToolCall { name, .. } if name == tool);
    let Some(last_edit) = calls
        .iter()
        .rposition(|t| named(t, tools::PROPOSE_EDIT_TOOL_NAME))
    else {
        return StepResult::ToolCalls(calls);
    };
    let early: Vec<usize> = (0..last_edit)
        .filter(|&i| named(&calls[i], tools::ADD_COMMENT_TOOL_NAME))
        .collect();
    let moved: Vec<AgentTurn> = early.iter().rev().map(|&i| calls.remove(i)).rev().collect();
    let at = last_edit + 1 - moved.len();
    calls.splice(at..at, moved);
    StepResult::ToolCalls(calls)
}
