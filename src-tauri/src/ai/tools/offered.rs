//! The built-in tools a request offers, by mode and by what it has to
//! work on (skills, a project folder, memory, sight), with what each tells
//! the model.

use super::*;

/// propose_edit as Revise mode offers it: every action.
pub(crate) const PROPOSE_EDIT_DESCRIPTION: &str = "Propose one edit to the document. Nothing is modified directly: the user reviews the proposal and applies it with one click. Call once per distinct edit. Pick the action that matches the intent: `replace` swaps `anchor` for `text`; `replace_selection` swaps the user's currently selected text (the <selected-text> block in their message; no `anchor` needed) for `text`; `insert_before`/`insert_after` add `text` around an untouched `anchor` - inside the paragraph when the anchor is a phrase or sentence within it (write `text` as words that read on from it - after a paragraph's last sentence, this continues the paragraph), as a new paragraph when the anchor is a whole block or `text` is block content (a heading, list, several paragraphs), and as a new line of the same table or list when the anchor is a whole row or list item line and `text` is another one; `delete` removes `anchor`; `append` adds `text` at the end of the document; `insert_at_cursor` adds `text` exactly where the user's cursor is (only when their message carries a <cursor> block showing it; no `anchor` needed). Name the target by its block: every block of the document (paragraph, heading, list item, table, code block) starts with its id, like `[#k3f9]`, and `block` takes that id - write it first, before anything else, so the user sees where the edit goes at once. With `block` alone, `replace` swaps the whole block for `text`, `delete` removes it, and `insert_before`/`insert_after` add `text` as a new block next to it. To change a few words inside a block, give `block` and, as `anchor`, just those words quoted from it - not the whole block; to add text inside a block (after a sentence, or a list item of a list), give `block` and, as `anchor`, the words or the item line it goes next to. To rewrite a run of consecutive blocks in one replace, give the first as `block` and the last as `last_block`, and the run rewritten as `text`: at most 5 blocks where the new text follows the old block by block (a longer one is several such replaces, all in one message), the whole run where it reorganises it. The user still decides on each paragraph by itself. The ids aren't part of the text: never write them in `text` or `anchor`. Without `block` (text you proposed earlier and the user hasn't decided on, which has no id), `anchor` must be copied verbatim and occur exactly once - if it appears more than once, also pass `context`.";

pub(crate) const FIND_FILES_DESCRIPTION: &str = "Find files in the project folder by name - text files, and PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files (case-insensitive; every word must appear in the path, so \"chapter 3\" finds drafts/chapter-3.md). Markdown and plain-text documents come first. Leave `name` out to list every file, to see what reference material there is; then read_file.";

pub(crate) const FIND_FILES_DESCRIPTION_WITH_IMAGES: &str = "Find files in the project folder by name - text files, PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files, and images, marked \"(image)\" (case-insensitive; every word must appear in the path, so \"chapter 3\" finds drafts/chapter-3.md). Markdown and plain-text documents come first. Leave `name` out to list every file, to see what reference material there is - notes, other chapters, pictures; then read_file.";

pub(crate) const READ_FILE_DESCRIPTION: &str = "Read a text file, or the text of a PDF, Word, PowerPoint, spreadsheet, EPUB or RTF file (as Markdown), from the project folder, by the relative path find_files or search_files shows. A long file comes back in parts: the answer says which lines of how many it shows and where to read on; pass start_line and end_line to read a part - say, a few dozen lines around a line search_files found.";

pub(crate) const READ_FILE_DESCRIPTION_WITH_IMAGES: &str = "Read a text file, or the text of a PDF, Word, PowerPoint, spreadsheet, EPUB or RTF file (as Markdown), from the project folder, by the relative path find_files or search_files shows - or look at an image there (PNG, JPEG, GIF or WebP, up to 6 MB: a map, a photo, a chart, a scanned page). A long file comes back in parts: the answer says which lines of how many it shows and where to read on; pass start_line and end_line to read a part - say, a few dozen lines around a line search_files found.";

/// The tools available to an agent conversation. Skill and file tools are
/// only offered when there's something for them to work on - a tool that can
/// only report "nothing there" would just waste the model's steps. Append
/// here (or extend to merge in MCP-provided tools) as the toolset grows.
/// `sees_images`: the provider takes images (ToolContext::sees_images).
pub fn builtin_tools<'a>(
    has_skills: bool,
    has_root: bool,
    mode: AgentMode,
    sees_images: bool,
) -> Vec<Tool<'a>> {
    let mut tools = vec![Tool {
            spec: ToolSpec {
                name: SEARCH_TOOL_NAME.into(),
                description: "Search the document for a word or phrase (case-insensitive). Returns each matching line with its line number and its block's id, for an edit to name.".into(),
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
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(search_document),
        }, Tool {
            spec: ToolSpec {
                name: READ_DOCUMENT_TOOL_NAME.into(),
                description: "Read part of the document verbatim: a whole section by its heading (subsections included), or a range of lines from the outline. Use it before revising a passage you can't see in full. Each block comes back after its `[#id]`, as in the document section.".into(),
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
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(read_document),
        }];

    // The rules engine's read-only tools: every mode has them.
    tools.push(Tool {
        spec: ToolSpec {
            name: CHECK_CONVENTIONS_TOOL_NAME.into(),
            description: "Check text against the document's writing conventions with a deterministic rules engine: punctuation and spacing (full-width marks in Chinese and Japanese, French no-break spaces, quotes, dashes, ellipses), numbers and dates, spelling lists, and consistency with the rest of the document, under the conventions profile in force (shown in the result). Pass `heading` or a line range for part of the document (default: all of it), or `text` to check a draft before you propose it. Returns findings grouped by rule with line numbers, the text, the fix and why. Use it to ground proofreading and convention fixes instead of guessing; it changes nothing.".into(),
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
        access: Access::ReadOnly,
        modes: EVERY_MODE,
        run: Run::Text(check_conventions),
    });
    tools.push(Tool {
        spec: ToolSpec {
            name: MEASURE_TEXT_TOOL_NAME.into(),
            description: "Count text exactly for a length limit - never estimate a count yourself. Metrics: x_weighted (X, limit 280: URLs count 23, CJK characters and emoji 2), bluesky (300 graphemes and 3,000 bytes), threads (500), instagram (2,200, at most 5 hashtags), mastodon (500 by default), linkedin (3,000, fold near 140), wechat_title (32), wechat_digest (120), wechat_content, xhs_title (20), xhs_body (1,000), weibo, govuk_title (65), govuk_summary (160), zh_academic_title (25 字), and plain chars, words, cjk_chars, utf8_bytes. Without `metric` it returns the basic counts. Use it on the exact text before proposing anything that must fit a platform's limit, and give the count in your reply. Not for new text with a length the user asked for: propose that directly - propose_edit's result gives its size.".into(),
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
        access: Access::ReadOnly,
        modes: EVERY_MODE,
        run: Run::Text(measure_text),
    });

    // Comments change nothing, so every mode has them - feedback is most
    // often asked for in Review mode.
    tools.push(Tool {
        spec: ToolSpec {
            name: ADD_COMMENT_TOOL_NAME.into(),
            description: "Pin a piece of feedback to a passage without changing it - for reviews and critique (\"what's weak here\", \"check this draft\"). One call per point; name the block it is about by its id as `block`, and quote `anchor` only for a few words inside that block it is about. The user sees each comment as a card that jumps to its passage, so keep your reply to a short overall summary.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "block": {
                        "type": "string",
                        "description": "The id shown before the block the comment is about, like `k3f9` from `[#k3f9]`"
                    },
                    "anchor": {
                        "type": "string",
                        "description": "Only for a few words inside that block: those words, verbatim. Left out, the comment is about the whole block."
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
                "required": ["block", "comment"],
            }),
        },
        access: Access::Proposes,
        modes: EVERY_MODE,
        run: Run::Text(add_comment),
    });

    // Review is structurally read-only: the model never receives the edit
    // tool, so a provider cannot accidentally ignore a prompt-only mode
    // instruction and create a proposal anyway. Write and Revise get the
    // same tool - one tool list, so switching between them keeps the
    // provider's cached prefix (docs/design/ai-tokens.md) - and in Write
    // the mode section says it only adds text, which propose_insertion
    // holds it to: any other action is refused.
    for (run, modes) in [
        (
            propose_edit as fn(&ToolContext, &str) -> String,
            &[AgentMode::Revise][..],
        ),
        (propose_insertion as _, &[AgentMode::Write][..]),
    ] {
        tools.push(Tool {
            spec: ToolSpec {
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
                            "description": "Only to rewrite a run of consecutive blocks in one replace: the id of the last of them, `block` being the first; `text` is then the run rewritten."
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
            },
            access: Access::Proposes,
            modes,
            run: Run::Text(run),
        });
    }

    if has_skills {
        tools.push(Tool {
            spec: ToolSpec {
                name: USE_SKILL_TOOL_NAME.into(),
                description: "Load the full instructions of one of the available skills (listed in the system prompt), or a reference pack a skill names. Call this before following a skill whenever the user's request matches its description, or when the user invokes it by name.".into(),
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
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(use_skill),
        });
    }

    if has_root {
        tools.push(Tool {
            spec: ToolSpec {
                name: FIND_FILES_TOOL_NAME.into(),
                description: if sees_images {
                    FIND_FILES_DESCRIPTION_WITH_IMAGES.into()
                } else {
                    FIND_FILES_DESCRIPTION.into()
                },
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Part of the file's name or path; left out, every file"
                        }
                    },
                }),
            },
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(find_files),
        });
        tools.push(Tool {
            spec: ToolSpec {
                name: SEARCH_FILES_TOOL_NAME.into(),
                description: "Search every text file and document (PDF, Word, PowerPoint, spreadsheet, EPUB, RTF) in the project folder for a word or phrase (case-insensitive), however long the file. Returns `path:line: text` matches - use it to find where a character, term or fact appears across chapters and notes, then read_file with start_line and end_line around the match for its context.".into(),
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
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(search_files),
        });
        tools.push(Tool {
            spec: ToolSpec {
                name: READ_FILE_TOOL_NAME.into(),
                description: if sees_images {
                    READ_FILE_DESCRIPTION_WITH_IMAGES.into()
                } else {
                    READ_FILE_DESCRIPTION.into()
                },
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path relative to the project folder"
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "First line to read, 1-based (as in search_files results)."
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "Last line to read, inclusive."
                        }
                    },
                    "required": ["path"],
                }),
            },
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Seeing(read_file),
        });
    }

    tools.retain(|tool| tool.modes.contains(&mode));
    tools
}
