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
) -> (StepResult, Vec<&'static str>) {
    let (result, applied) = postfix_step(result, document, conventions);
    let result = match pictures {
        Some(pictures) => pictures.place(result),
        None => result,
    };
    (result, applied)
}
