//! The conversation sent with a request, kept under its budget: old tool
//! output shortened first, the oldest turns dropped after.

use super::*;

/// Tool output from an earlier exchange longer than this is cut to a stub
/// before being replayed: a file or section read three questions ago is
/// rarely needed again, and re-sending it with every request is most of what
/// made long conversations slow, expensive and finally too big to send.
pub(super) const OLD_TOOL_OUTPUT_LIMIT: usize = 1_500;
pub(super) const OLD_TOOL_OUTPUT_KEEP: usize = 400;
/// Past this much replayed history (characters), whole exchanges are dropped
/// oldest first, so a long session degrades into forgetting its beginning
/// instead of failing every send once it no longer fits the context window.
pub(super) const HISTORY_BUDGET: usize = 150_000;
/// Exchanges are dropped in blocks of at least this many characters, counted
/// from the start of the conversation. Dropping just enough for each send
/// moved the history's first message every turn once over budget, and with
/// it every byte of the prompt cache; a block boundary depends only on the
/// exchanges before it, so the start now stays put until the conversation
/// has grown by another block. Never more than two blocks beyond what the
/// budget needs, though (see compact_history).
pub(super) const HISTORY_DROP_STEP: usize = HISTORY_BUDGET / 3;

pub(super) fn turn_chars(turn: &AgentTurn) -> usize {
    match turn {
        AgentTurn::User { text, .. } | AgentTurn::Assistant { text, .. } => text.len(),
        AgentTurn::ToolCall { arguments, .. } => arguments.len(),
        AgentTurn::ToolResult { output, .. } => output.len(),
    }
}

/// What was remembered, as the chat records it for its chips (a remember
/// call and its result - memory::pass's, or the remember tool's before
/// 1.2.0-rc.6), isn't sent: the model has no remember tool to have called,
/// and what is remembered comes with every message.
pub(crate) fn without_memory_turns(history: Vec<AgentTurn>) -> Vec<AgentTurn> {
    let memory: std::collections::HashSet<String> = history
        .iter()
        .filter_map(|turn| match turn {
            AgentTurn::ToolCall { call_id, name, .. } if name == MEMORY_TURN => {
                Some(call_id.clone())
            }
            _ => None,
        })
        .collect();
    history
        .into_iter()
        .filter(|turn| match turn {
            AgentTurn::ToolCall { call_id, .. } | AgentTurn::ToolResult { call_id, .. } => {
                !memory.contains(call_id)
            }
            _ => true,
        })
        .collect()
}

/// The name a memory chip's turns go by (src/ai/chat/memory-pass.ts).
pub(crate) const MEMORY_TURN: &str = "remember";

/// Shrinks the replayed conversation (everything before the message being
/// sent) to what a writing agent still needs from it. propose_edit results
/// are never cut - they carry the accepted/rejected status notes the model
/// relies on. Edits nothing the user sees: the frontend keeps the full
/// history; only what goes to the provider is trimmed.
///
/// Both cuts are made the same way on every send, so a turn reads the same
/// from the first request that replays it to the last: a tool result is cut
/// to the same stub each time, and the oldest exchanges go in fixed blocks
/// (HISTORY_DROP_STEP). That is what lets the provider's prompt cache cover
/// the whole history (see anthropic.rs's cache breakpoints) - the only bytes
/// that change are the current message's, which carries the document.
pub(crate) fn compact_history(history: Vec<AgentTurn>) -> Vec<AgentTurn> {
    let history = without_memory_turns(history);
    let tool_names: std::collections::HashMap<String, String> = history
        .iter()
        .filter_map(|turn| match turn {
            AgentTurn::ToolCall { call_id, name, .. } => Some((call_id.clone(), name.clone())),
            _ => None,
        })
        .collect();
    let mut turns: Vec<AgentTurn> = history
        .into_iter()
        .map(|turn| match turn {
            AgentTurn::ToolResult {
                call_id,
                output,
                images,
            } if output.chars().count() > OLD_TOOL_OUTPUT_LIMIT
                    && tool_names.get(&call_id).map(String::as_str) != Some("propose_edit") =>
            {
                let omitted = output.chars().count() - OLD_TOOL_OUTPUT_KEEP;
                let output = format!(
                    "{}\n[... {omitted} more characters of this earlier result omitted to save space - call the tool again if you need them]",
                    char_prefix(&output, OLD_TOOL_OUTPUT_KEEP)
                );
                AgentTurn::ToolResult {
                    call_id,
                    output,
                    images,
                }
            }
            turn => turn,
        })
        .collect();

    let total: usize = turns.iter().map(turn_chars).sum();
    if total <= HISTORY_BUDGET {
        return turns;
    }
    // Cut only where an exchange starts (at a user turn): dropping whole
    // exchanges keeps every tool call paired with its result. Each start
    // with the characters before it.
    let mut starts = Vec::new();
    let mut before = 0;
    for (i, turn) in turns.iter().enumerate() {
        if i > 0 && matches!(turn, AgentTurn::User { .. }) {
            starts.push((i, before));
        }
        before += turn_chars(turn);
    }
    // The fewest exchanges that must go: up to the first start that leaves
    // the rest within budget, else all but the newest, as large as it is.
    let Some(&(needed, needed_before)) = starts
        .iter()
        .find(|&&(_, before)| total - before <= HISTORY_BUDGET)
        .or(starts.last())
    else {
        return turns;
    };
    // Rounded up to the end of its block, which drops under two blocks more
    // than must go while exchanges are small next to a block. One carrying
    // a long attachment (inlined into its message) can be bigger than a
    // block, and rounding past it would leave a fraction of the budget:
    // then just what must go, the way it was before blocks.
    let mut cut = needed;
    let mut block_start = 0;
    for &(i, before) in &starts {
        if before - block_start < HISTORY_DROP_STEP {
            continue;
        }
        block_start = before;
        if i >= needed {
            if before - needed_before <= 2 * HISTORY_DROP_STEP {
                cut = i;
            }
            break;
        }
    }
    turns.drain(..cut);
    turns
}
