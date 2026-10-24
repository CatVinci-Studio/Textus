//! A step's result made ready for the loop: what block ids name filled in, the
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
    document: &Document,
    conventions: &Conventions,
) -> (StepResult, Vec<&'static str>) {
    let StepResult::ToolCalls(calls) = result else {
        return (result, Vec::new());
    };
    let mut applied = Vec::new();
    // An edit naming its block (doc_blocks.rs) gets what the block says
    // filled in, its ids kept for the frontend to place it by.
    let calls = calls
        .into_iter()
        .map(|call| match call {
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                reasoning,
            } if name == tools::PROPOSE_EDIT_TOOL_NAME => {
                let arguments = doc_blocks::resolve_edit_arguments(document, &arguments);
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
            // Comments and a picture name their blocks too.
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                reasoning,
            } if name == tools::ADD_COMMENT_TOOL_NAME => AgentTurn::ToolCall {
                arguments: doc_blocks::resolve_comments_arguments(document, &arguments),
                call_id,
                name,
                reasoning,
            },
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                reasoning,
            } if name == crate::ai::images::GENERATE_IMAGE_TOOL_NAME => {
                AgentTurn::ToolCall {
                    arguments: doc_blocks::resolve_target_arguments(document, &arguments),
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
    document: &Document,
    conventions: &Conventions,
    pictures: Option<&InlinePictures<'_>>,
) -> (StepResult, Vec<&'static str>) {
    let (result, applied) = postfix_step(edits_before_comments(result), document, conventions);
    let result = match pictures {
        Some(pictures) => pictures.place(result),
        None => result,
    };
    (result, applied)
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
