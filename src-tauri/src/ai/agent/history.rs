//! The conversation sent with a request, kept under its budget: old tool
//! output shortened first, the oldest turns dropped after.

use super::*;

/// Tool output from an earlier exchange longer than this is cut to a stub
/// before being replayed; re-sending old reads made long conversations slow.
pub(super) const OLD_TOOL_OUTPUT_LIMIT: usize = 1_500;
pub(super) const OLD_TOOL_OUTPUT_KEEP: usize = 400;
/// Past this much replayed history (characters), whole exchanges are dropped
/// oldest first, so a long session forgets its start instead of failing.
pub(super) const HISTORY_BUDGET: usize = 150_000;
/// Exchanges are dropped in blocks of at least this many characters, counted
/// from the start, so the history's first message (and the prompt cache)
/// stays put until the conversation grows by another block.
pub(super) const HISTORY_DROP_STEP: usize = HISTORY_BUDGET / 3;

pub(super) fn turn_chars(turn: &AgentTurn) -> usize {
    match turn {
        AgentTurn::User { text, .. } | AgentTurn::Assistant { text, .. } => text.len(),
        AgentTurn::ToolCall { arguments, .. } => arguments.len(),
        AgentTurn::ToolResult { output, .. } => output.len(),
    }
}

/// Memory chips' turns (a remember call and its result) aren't sent: the model
/// has no remember tool, and what is remembered comes with every message. Nor
/// are a paper's card turns (PAPER_TURN): the paper's own proposal is.
pub(crate) fn without_memory_turns(history: Vec<AgentTurn>) -> Vec<AgentTurn> {
    let memory: std::collections::HashSet<String> = history
        .iter()
        .filter_map(|turn| match turn {
            AgentTurn::ToolCall { call_id, name, .. }
                if name == MEMORY_TURN || name == PAPER_TURN =>
            {
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

/// The name a memory chip's turns go by.
pub(crate) const MEMORY_TURN: &str = "remember";

/// The name a paper card's turns go by. Keep in step with the frontend's
/// `PAPER_TURN`.
pub(crate) const PAPER_TURN: &str = "write_paper";

/// Shrinks the replayed conversation to what a writing agent still needs;
/// propose_edit results are never cut. Both cuts come out the same on every
/// send, so the prompt cache can cover the whole history.
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
    // Rounded up to the end of its block. An exchange bigger than a block (a long
    // attachment) would leave a fraction of the budget, so then just what must go.
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
