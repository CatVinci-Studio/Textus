//! The built-in tools a request offers, by mode and by what it has to
//! work on (skills, a project folder, memory, sight), with what each tells
//! the model.

use super::*;

/// propose_edit as Revise mode offers it: every action.
pub(crate) const FIND_FILES_DESCRIPTION: &str = "Find files in the project folder by name - text files, and PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files (case-insensitive; every word must appear in the path, so \"chapter 3\" finds drafts/chapter-3.md). Markdown and plain-text documents come first. Use it whenever you know or can guess part of a file's name - a chapter, a character's notes, an outline - instead of listing every file; then read_file.";

pub(crate) const FIND_FILES_DESCRIPTION_WITH_IMAGES: &str = "Find files in the project folder by name - text files, PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files, and images, marked \"(image)\" (case-insensitive; every word must appear in the path, so \"chapter 3\" finds drafts/chapter-3.md). Markdown and plain-text documents come first. Use it whenever you know or can guess part of a file's name - a chapter, a character's notes, an outline, a map - instead of listing every file; then read_file, or view_image for an image.";

pub(crate) const LIST_FILES_DESCRIPTION: &str = "List the files in the project folder you can read - text files, and PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files (recursively, paths relative to it). Use it to see what reference material there is - notes, other chapters, data - when you have no name to look for; to find a file by name, use find_files instead.";

pub(crate) const LIST_FILES_DESCRIPTION_WITH_IMAGES: &str = "List the files in the project folder you can read - text files, PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files, and images, marked \"(image)\" (recursively, paths relative to it). Use it to see what reference material there is - notes, other chapters, data, pictures - when you have no name to look for; to find a file by name, use find_files instead.";

/// The tools available to an agent conversation. Skill and file tools are
/// only offered when there's something for them to work on - a tool that can
/// only report "nothing there" would just waste the model's steps. Append
/// here (or extend to merge in MCP-provided tools) as the toolset grows.
/// `can_remember`: Settings > Textus AI > Remember automatically is on.
/// `sees_images`: the provider takes images (ToolContext::sees_images).
pub fn builtin_tools<'a>(
    has_skills: bool,
    has_root: bool,
    mode: AgentMode,
    can_remember: bool,
    sees_images: bool,
) -> Vec<Tool<'a>> {
    let mut tools = vec![Tool {
            spec: ToolSpec {
                name: SEARCH_TOOL_NAME.into(),
                description: "Search the current document for a query string (case-insensitive). Returns matching lines with their line numbers.".into(),
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
                description: "Read part of the current document verbatim: a whole section by its heading (subsections included), or a range of lines. Use it before revising a passage you can't fully see, and to copy exact anchors. The text comes back without line-number prefixes, ready to quote.".into(),
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

    // Remembering writes memory, never the document, so every mode has it.
    if can_remember {
        tools.push(Tool {
            spec: ToolSpec {
                name: REMEMBER_TOOL_NAME.into(),
                description: "Remember something for later conversations: a requirement, preference or trait of the user's style that should hold beyond this request, or a fact about their work (a person, place or term). It is saved as a small file the user can see, undo, edit or delete; it never changes the document. To change something already remembered, pass its id as `replaces`.".into(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": ["requirement", "preference", "style", "fact"],
                            "description": "requirement: something always or never to do; preference: what they like in replies and edits; style: how they write; fact: what is true of a person, place or term in their work (needs `name`)"
                        },
                        "scope": {
                            "type": "string",
                            "enum": ["project", "personal"],
                            "description": "project: about this work; personal: the user's general habits. Ignored for a fact (always project) and with `replaces`."
                        },
                        "text": {
                            "type": "string",
                            "description": "The memory: one or a few plain sentences in the user's language, as an instruction to yourself; for a fact, what is true of it"
                        },
                        "name": {
                            "type": "string",
                            "description": "For a fact: the person, place or term"
                        },
                        "aliases": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "For a fact: other names it goes by"
                        },
                        "replaces": {
                            "type": "string",
                            "description": "The id of a memory to update instead of adding one, as listed in brackets"
                        }
                    },
                    "required": ["kind", "text"],
                }),
            },
            access: Access::Proposes,
            modes: EVERY_MODE,
            run: Run::Text(remember),
        });
    }

    // The edit tags in a reply run as propose_edit calls (edit_tags), in the
    // modes that have it. Review is structurally read-only: it has none, so
    // its tags propose nothing whatever the model writes. In Write the mode
    // section says it only adds text, which propose_insertion holds it to:
    // any other action is refused.
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
                // Never offered to the model (ToolRegistry::specs): an edit
                // is a tag in its reply, run as a call to this (edit_tags).
                description: "".into(),
                parameters: json!({ "type": "object" }),
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
                            "description": "Part of the file's name or path"
                        }
                    },
                    "required": ["name"],
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
                name: LIST_FILES_TOOL_NAME.into(),
                description: if sees_images {
                    LIST_FILES_DESCRIPTION_WITH_IMAGES.into()
                } else {
                    LIST_FILES_DESCRIPTION.into()
                },
                parameters: json!({"type": "object", "properties": {}}),
            },
            access: Access::ReadOnly,
            modes: EVERY_MODE,
            run: Run::Text(list_files),
        });
        tools.push(Tool {
            spec: ToolSpec {
                name: READ_FILE_TOOL_NAME.into(),
                description: "Read a text file, or the text of a PDF, Word, PowerPoint, spreadsheet, EPUB or RTF file (as Markdown), from the project folder. Use the relative path as shown by find_files, search_files or list_files. A long file comes back in parts: the answer says which lines of how many it shows and where to read on; pass start_line and end_line to read a part - say, a few dozen lines around a line search_files found.".into(),
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
            run: Run::Text(read_file),
        });
        if sees_images {
            tools.push(Tool {
                spec: ToolSpec {
                    name: VIEW_IMAGE_TOOL_NAME.into(),
                    description: "Look at an image in the project folder (PNG, JPEG, GIF or WebP, up to 6 MB) - a map, a photo, a chart, a scanned page. Use the relative path as list_files or find_files show it.".into(),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "Path relative to the project folder"
                            }
                        },
                        "required": ["path"],
                    }),
                },
                access: Access::ReadOnly,
                modes: EVERY_MODE,
                run: Run::Seeing(view_image),
            });
        }
    }

    tools.retain(|tool| tool.modes.contains(&mode));
    tools
}
