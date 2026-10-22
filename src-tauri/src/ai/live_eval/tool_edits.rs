//! Edits as a propose_edit tool call, the way Textus made them before
//! 1.2.0-rc.6 moved them into the reply as tags - kept for the live eval
//! alone (TEXTUS_EVAL_EDITS=tool), to measure one way against the other on
//! the same cases.

use crate::ai::tools::{EDIT_ACTIONS, PROPOSE_EDIT_TOOL_NAME};
use aicompat::agent::ToolSpec;
use serde_json::json;

/// Whether this run hands edits in as tool calls.
pub fn on() -> bool {
    std::env::var("TEXTUS_EVAL_EDITS").is_ok_and(|v| v == "tool")
}

/// What the prompt says in place of the tag rules.
pub const RULE: &str = "Call propose_edit for each edit, as its description says; the new text goes in its `text`, never in your reply.";

const PROPOSE_EDIT_DESCRIPTION: &str = "Propose one edit to the document. Nothing is modified directly: the user reviews the proposal and applies it with one click. Call once per distinct edit. Pick the action that matches the intent: `replace` swaps `anchor` for `text`; `replace_selection` swaps the user's currently selected text (the <selected-text> block in their message; no `anchor` needed) for `text`; `insert_before`/`insert_after` add `text` around an untouched `anchor` - inside the paragraph when the anchor is a phrase or sentence within it (write `text` as words that read on from it - after a paragraph's last sentence, this continues the paragraph), as a new paragraph when the anchor is a whole block or `text` is block content (a heading, list, several paragraphs), and as a new line of the same table or list when the anchor is a whole row or list item line and `text` is another one; `delete` removes `anchor`; `append` adds `text` at the end of the document; `insert_at_cursor` adds `text` exactly where the user's cursor is (only when their message carries a <cursor> block showing it; no `anchor` needed). Name the target by its block: every block of the document (paragraph, heading, list item, table, code block) starts with its id, like `[#k3f9]`, and `block` takes that id - write it first, before anything else, so the user sees where the edit goes at once. With `block` alone, `replace` swaps the whole block for `text`, `delete` removes it, and `insert_before`/`insert_after` add `text` as a new block next to it. To change a few words inside a block, give `block` and, as `anchor`, just those words quoted from it - not the whole block; to add text inside a block (after a sentence, or a list item of a list), give `block` and, as `anchor`, the words or the item line it goes next to. To rewrite a run of blocks - a section, or the whole document - in one replace, give its first block as `block` and its last as `last_block`, and the whole run rewritten as `text`; the user still decides on it paragraph by paragraph. The ids aren't part of the text: never write them in `text` or `anchor`. Without `block` (text you proposed earlier and the user hasn't decided on, which has no id), `anchor` must be copied verbatim and occur exactly once - if it appears more than once, also pass `context`. `text` must be valid markdown: `-` or `1.` for lists (never `•` or other bullet symbols), `#` for headings.";

/// The propose_edit tool as it was offered.
pub fn spec() -> ToolSpec {
    ToolSpec {
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
    }
}
