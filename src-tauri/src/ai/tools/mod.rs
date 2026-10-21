use crate::ai::agent::AgentMode;
use crate::ai::builtin;
use crate::ai::workspace::{AgentSkill, Invocation};
use aicompat::agent::{ToolCall, ToolOutput, ToolRun, ToolSpec};
use serde_json::json;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;

mod conventions;
mod document;
mod edits;
mod folder;
use conventions::*;
pub(crate) use document::*;
pub(crate) use edits::*;
use folder::*;

/// Everything a tool implementation needs to actually do its work. Grows as
/// more tools need more context (e.g. an MCP client handle) without changing
/// each tool's call signature.
pub struct ToolContext<'a> {
    pub document: &'a str,
    /// The merged skills: built-in, global config folder, project .textus/.
    pub skills: &'a [AgentSkill],
    /// The UI language (src/i18n/langs.ts) - which language's writing
    /// conventions a skill gets when the document is too short to tell.
    pub ui_language: &'a str,
    /// The project folder (workspace root) - the sandbox boundary for the
    /// file tools. The document's own folder by default, or the chosen
    /// project folder (see workspace::resolve_root). None for an unsaved
    /// draft with no folder chosen, or a folder too broad to use, in which
    /// case the file tools aren't offered at all.
    pub root: Option<&'a Path>,
    /// The provider takes images (catalog's `supports_vision`, the gate on
    /// the chat's image attachments): the file tools then list images and
    /// view_image shows them.
    pub sees_images: bool,
    /// The writing conventions (setting and style-profile front matter)
    /// check_conventions checks against.
    pub conventions: &'a crate::ai::rules::Conventions,
    /// Library names and aliases, for the library-name rule.
    pub library: &'a [String],
    /// Where the remember tool writes; None when it isn't offered.
    pub memory: Option<&'a crate::ai::memory::MemoryContext>,
    /// The passages this request's proposals already replace or delete
    /// (their `context`, else their anchor; "" for the selection). One
    /// context serves one request, every step of it.
    pub proposed: std::sync::Mutex<ProposalLedger>,
    /// How often this request has called each check tool (CHECK_BUDGETS).
    pub checks: std::sync::Mutex<std::collections::HashMap<&'static str, usize>>,
}

/// What this request's propose_edit calls have done so far.
#[derive(Debug, Default)]
pub struct ProposalLedger {
    /// The passages proposals already replace or delete.
    passages: Vec<ProposedPassage>,
    /// Replacements refused once as looking cut off (degenerate_replacement),
    /// as `anchor\0text`: the same call sent again is meant, and goes through.
    refused_short: Vec<String>,
}

/// A passage one of this request's proposals replaces or deletes: where it
/// sits in the document when the anchor (or its disambiguating context)
/// is found there verbatim, and the quoted text either way. Two proposals
/// overlap when their spans intersect - two fixes of the same repeated
/// word in one paragraph, pinned by overlapping contexts, are different
/// passages - and, where a span couldn't be placed, when one quote
/// contains the other.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProposedPassage {
    /// Byte range in the document.
    span: Option<(usize, usize)>,
    /// The context if it pins the anchor, else the anchor; "" for the
    /// selection.
    quote: String,
}

impl ProposedPassage {
    fn selection() -> Self {
        Self::default()
    }

    fn locate(document: &str, anchor: &str, context: Option<&str>) -> Self {
        let context = context.filter(|c| c.len() > anchor.len() && c.contains(anchor));
        let span = match context {
            Some(c) if document.matches(c).count() == 1 => document
                .find(c)
                .zip(c.find(anchor))
                .map(|(at, offset)| at + offset),
            _ if document.matches(anchor).count() == 1 => document.find(anchor),
            _ => None,
        }
        .map(|start| (start, start + anchor.len()));
        Self {
            span,
            quote: context.unwrap_or(anchor).to_string(),
        }
    }

    fn overlaps(&self, other: &Self) -> bool {
        if let (Some(a), Some(b)) = (self.span, other.span) {
            return a.0 < b.1 && b.0 < a.1;
        }
        let (p, q) = (self.quote.as_str(), other.quote.as_str());
        (p.is_empty() && q.is_empty())
            || (!p.is_empty() && !q.is_empty() && (p.contains(q) || q.contains(p)))
    }
}

/// A tool the agent can call: what the model is told (name, description,
/// JSON schema), what calling it does, the modes it is offered in, and its
/// implementation. Built-in tools (like `search_document` below) run here;
/// the web tools and generate_image are added per request
/// ([`ToolRegistry::add`]), and a plugin's or an MCP server's tools will be
/// too - a spec from the plugin or server, and an [`Run::Async`] that
/// forwards the call.
pub struct Tool<'a> {
    pub spec: ToolSpec,
    pub access: Access,
    pub modes: &'static [AgentMode],
    pub run: Run<'a>,
}

/// What calling a tool does, which decides how its calls run
/// ([`ToolRegistry::how_to_run`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// Only reads (the document, the project, the web): a step's reads run
    /// together.
    ReadOnly,
    /// Proposes a change the user reviews, or changes something of
    /// Textus AI's own (a memory): one call at a time, in call order.
    Proposes,
    /// Proposes, and records what it made in its own call (generate_image's
    /// picture), which is where the frontend reads the proposal from.
    ProposesInItsCall,
}

/// The modes a tool is offered in.
pub const EVERY_MODE: &[AgentMode] = &[AgentMode::Review, AgentMode::Revise, AgentMode::Write];
/// Write and Revise: the modes that change the document.
pub const EDITING_MODES: &[AgentMode] = &[AgentMode::Revise, AgentMode::Write];

pub type ToolFuture<'a> = Pin<Box<dyn Future<Output = ToolOutput> + Send + 'a>>;

/// A tool's implementation, by what it answers with.
pub enum Run<'a> {
    Text(fn(&ToolContext, &str) -> String),
    /// Text and images for the model to look at (view_image).
    Seeing(fn(&ToolContext, &str) -> ToolOutput),
    /// Awaited, with what it needs captured: a search, a page read, a
    /// picture being made - work that waits on the network, which Stop
    /// drops in flight.
    Async(Box<dyn Fn(ToolCall) -> ToolFuture<'a> + Send + Sync + 'a>),
}

/// propose_edit as Revise mode offers it: every action.
const PROPOSE_EDIT_DESCRIPTION: &str = "Propose one edit to the document. Nothing is modified directly: the user reviews the proposal and applies it with one click. Call once per distinct edit. Pick the action that matches the intent: `replace` swaps `anchor` for `text`; `replace_selection` swaps the user's currently selected text (the <selected-text> block in their message; no `anchor` needed) for `text`; `insert_before`/`insert_after` add `text` around an untouched `anchor` - inside the paragraph when the anchor is a phrase or sentence within it (write `text` as words that read on from it - after a paragraph's last sentence, this continues the paragraph), as a new paragraph when the anchor is a whole block or `text` is block content (a heading, list, several paragraphs), and as a new line of the same table or list when the anchor is a whole row or list item line and `text` is another one; `delete` removes `anchor`; `append` adds `text` at the end of the document; `insert_at_cursor` adds `text` exactly where the user's cursor is (only when their message carries a <cursor> block showing it; no `anchor` needed). `anchor` must be copied verbatim from the document and occur exactly once - if the text you need to target appears more than once, keep `anchor` as the exact text being edited and also pass `context`. `text` must be valid markdown: `-` or `1.` for lists (never `•` or other bullet symbols), `#` for headings.";

const FIND_FILES_DESCRIPTION: &str = "Find files in the project folder by name - text files, and PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files (case-insensitive; every word must appear in the path, so \"chapter 3\" finds drafts/chapter-3.md). Markdown and plain-text documents come first. Use it whenever you know or can guess part of a file's name - a chapter, a character's notes, an outline - instead of listing every file; then read_file.";
const FIND_FILES_DESCRIPTION_WITH_IMAGES: &str = "Find files in the project folder by name - text files, PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files, and images, marked \"(image)\" (case-insensitive; every word must appear in the path, so \"chapter 3\" finds drafts/chapter-3.md). Markdown and plain-text documents come first. Use it whenever you know or can guess part of a file's name - a chapter, a character's notes, an outline, a map - instead of listing every file; then read_file, or view_image for an image.";
const LIST_FILES_DESCRIPTION: &str = "List the files in the project folder you can read - text files, and PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files (recursively, paths relative to it). Use it to see what reference material there is - notes, other chapters, data - when you have no name to look for; to find a file by name, use find_files instead.";
const LIST_FILES_DESCRIPTION_WITH_IMAGES: &str = "List the files in the project folder you can read - text files, PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files, and images, marked \"(image)\" (recursively, paths relative to it). Use it to see what reference material there is - notes, other chapters, data, pictures - when you have no name to look for; to find a file by name, use find_files instead.";

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
            description: "Count text exactly for a length limit - never estimate a count yourself. Metrics: x_weighted (X, limit 280: URLs count 23, CJK characters and emoji 2), bluesky (300 graphemes and 3,000 bytes), threads (500), instagram (2,200, at most 5 hashtags), mastodon (500 by default), linkedin (3,000, fold near 140), wechat_title (32), wechat_digest (120), wechat_content, xhs_title (20), xhs_body (1,000), weibo, govuk_title (65), govuk_summary (160), zh_academic_title (25 字), and plain chars, words, cjk_chars, utf8_bytes. Without `metric` it returns the basic counts. Use it on the exact text before proposing anything that must fit a limit, and give the count in your reply.".into(),
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
            description: "Pin a piece of feedback to a passage without changing it - for reviews and critique (\"what's weak here\", \"check this draft\"). One call per point; quote the passage verbatim as `anchor` (unique in the document, or add `context`). The user sees each comment as a card that jumps to its passage, so keep your reply to a short overall summary.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "anchor": {
                        "type": "string",
                        "description": "Exact document text the comment is about"
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
                "required": ["anchor", "comment"],
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
                        "anchor": {
                            "type": "string",
                            "description": "Exact existing document text the edit targets, quoted verbatim. Required for every action except `append`."
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

/// How often one request may call each check tool before it stops
/// answering. Asked for "800 字", a model drafted, measured, rewrote and
/// measured again until its steps ran out, and never proposed the text at
/// all; a check that keeps answering invites exactly that loop. Measuring
/// against a platform's limit is not counted (`measures_a_limit`): text
/// that must fit is worth trimming until it does, and a budget refused an
/// X post and headline options still over their limit in the live eval.
const CHECK_BUDGETS: &[(&str, usize)] = &[
    (MEASURE_TEXT_TOOL_NAME, 3),
    (CHECK_CONVENTIONS_TOOL_NAME, 4),
];

/// Whether a measure_text call measures against a platform's limit (a
/// metric with one, such as x_weighted), not a plain count.
fn measures_a_limit(arguments: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|args| crate::ai::rules::measure::measure("", args.get("metric")?.as_str()?))
        .is_some_and(|m| m.limit.is_some())
}

/// Counts a call to a check tool, and refuses it once the request has used
/// up that tool's budget. None for every other call, and within budget.
fn spend_check(ctx: &ToolContext, name: &str, arguments: &str) -> Option<String> {
    let &(name, budget) = CHECK_BUDGETS.iter().find(|(tool, _)| *tool == name)?;
    if name == MEASURE_TEXT_TOOL_NAME && measures_a_limit(arguments) {
        return None;
    }
    let mut checks = ctx.checks.lock().unwrap_or_else(|e| e.into_inner());
    let used = checks.entry(name).or_default();
    *used += 1;
    (*used > budget).then(|| {
        format!("Not run: {name} was already called {budget} times in this request, which is all it gets. Stop checking and finish with what you have: propose your latest draft (when the request changes the document), then reply.")
    })
}

/// Whether `result` is a valid proposal or comment: the user's to decide
/// now, with nothing in it the model has to answer.
fn settles(name: &str, result: &str) -> bool {
    match name {
        PROPOSE_EDIT_TOOL_NAME => result.starts_with(EDIT_PROPOSED),
        ADD_COMMENT_TOOL_NAME => result.starts_with(COMMENT_ADDED),
        _ => false,
    }
}

/// The tools one request offers, assembled for its mode: the built-ins
/// that have something to work on ([`builtin_tools`]), then what the
/// request adds - the web tools, generate_image, and later plugin and MCP
/// tools. The one place a tool is looked up by name.
pub struct ToolRegistry<'a> {
    mode: AgentMode,
    tools: Vec<Tool<'a>>,
}

impl<'a> ToolRegistry<'a> {
    /// No tools yet: what `mode` offers is added to it.
    pub fn new(mode: AgentMode) -> Self {
        Self {
            mode,
            tools: Vec::new(),
        }
    }

    /// The built-in tools for `mode` (see [`builtin_tools`] for the rest).
    pub fn builtin(
        has_skills: bool,
        has_root: bool,
        mode: AgentMode,
        can_remember: bool,
        sees_images: bool,
    ) -> Self {
        let mut registry = Self::new(mode);
        registry.tools = builtin_tools(has_skills, has_root, mode, can_remember, sees_images);
        registry
    }

    /// Adds `tool` if this request's mode offers it.
    pub fn add(&mut self, tool: Tool<'a>) {
        if tool.modes.contains(&self.mode) {
            self.tools.push(tool);
        }
    }

    pub fn specs(&self) -> Vec<ToolSpec> {
        self.tools.iter().map(|t| t.spec.clone()).collect()
    }

    fn find(&self, name: &str) -> Option<&Tool<'a>> {
        self.tools.iter().find(|t| t.spec.name == name)
    }

    /// How the agent loop runs `name`'s calls (aicompat's ToolRun). A name
    /// the model made up runs on its own, and is told it doesn't exist.
    pub fn how_to_run(&self, name: &str) -> ToolRun {
        match self.find(name).map(|t| t.access) {
            Some(Access::ReadOnly) => ToolRun::Concurrent,
            Some(Access::ProposesInItsCall) => ToolRun::Amending,
            Some(Access::Proposes) | None => ToolRun::InOrder,
        }
    }

    pub async fn execute(&self, ctx: &ToolContext<'_>, call: ToolCall) -> ToolOutput {
        if let Some(refusal) = spend_check(ctx, &call.name, &call.arguments) {
            return refusal.into();
        }
        match self.find(&call.name).map(|t| &t.run) {
            Some(Run::Text(run)) => {
                let text = run(ctx, &call.arguments);
                ToolOutput {
                    settled: settles(&call.name, &text),
                    text,
                    ..ToolOutput::default()
                }
            }
            Some(Run::Seeing(run)) => run(ctx, &call.arguments),
            Some(Run::Async(run)) => run(call).await,
            None => format!("Unknown tool: {}", call.name).into(),
        }
    }
}

#[cfg(test)]
mod tests;
