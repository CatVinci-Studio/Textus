//! What a request carries of the document: the whole of it, or an outline
//! and the section in focus when it is long, and the user's message with it.

use super::*;

/// Up to this much the document is embedded in full; past it, an outline and
/// excerpts, and the model reads on through the document tools. Counted in char
/// units (CJK as 3) when tools can read on, else in characters.
pub(super) const FULL_DOCUMENT_LIMIT: usize = 40_000;

/// Whether a request shows the whole document - else an outline and
/// excerpts, which the document tools read on from (search_document,
/// read_document: offered only then).
pub(super) fn shown_whole(document: &str, with_tools: bool) -> bool {
    let size = if with_tools {
        document.chars().map(crate::ai::project::char_units).sum()
    } else {
        document.chars().count()
    };
    size <= FULL_DOCUMENT_LIMIT
}
pub(super) const EXCERPT_CHARS: usize = 2_000;
pub(super) const MAX_OUTLINE_HEADINGS: usize = 120;

/// The document's headings with their line and block id
/// (`L12 [#k3f9] ## Methods`), the map read ranges and edits refer to.
fn heading_outline(document: &Document) -> Vec<String> {
    let lines: Vec<&str> = document.lines().collect();
    let mut starts = Vec::with_capacity(lines.len());
    let mut at = 0;
    for line in document.split_inclusive('\n') {
        starts.push(at);
        at += line.len();
    }
    crate::ai::tools::heading_lines(&lines)
        .into_iter()
        .take(MAX_OUTLINE_HEADINGS)
        .map(|(i, _)| {
            let id = starts
                .get(i)
                .and_then(|&s| doc_blocks::id_at(&document.blocks, s))
                .map(|id| format!("[#{id}] "))
                .unwrap_or_default();
            format!("L{} {id}{}", i + 1, lines[i].trim())
        })
        .collect()
}

/// The byte where the first `n` chars of `s` end.
fn char_end(s: &str, n: usize) -> usize {
    s.char_indices().nth(n).map_or(s.len(), |(i, _)| i)
}

/// Char-count (not byte) prefix/suffix - document content is arbitrary
/// UTF-8 (CJK text especially), so a naive byte slice could land mid-char.
pub(super) fn char_prefix(s: &str, n: usize) -> &str {
    s.char_indices().nth(n).map_or(s, |(i, _)| &s[..i])
}

pub(super) fn char_suffix(s: &str, n: usize) -> &str {
    let total = s.chars().count();
    if total <= n {
        return s;
    }
    s.char_indices().nth(total - n).map_or(s, |(i, _)| &s[i..])
}

/// Most of a focus section embedded alongside a truncated document.
pub(super) const FOCUS_SECTION_CHARS: usize = 12_000;

/// The section headed `heading` (to the next heading at its level or above)
/// and the line it starts on.
pub(super) fn focus_section(document: &Document, heading: &str) -> Option<(usize, String)> {
    let lines: Vec<&str> = document.lines().collect();
    let (first, last) = crate::ai::tools::section_range(&lines, heading)?;
    let from: usize = document
        .split_inclusive('\n')
        .take(first)
        .map(str::len)
        .sum();
    let text = lines[first..last].join("\n");
    let to = from + char_end(&text, FOCUS_SECTION_CHARS);
    Some((first + 1, doc_blocks::annotate(document, from, to)))
}

/// The `---document---` section, each block marked with its id.
pub(crate) fn document_section(
    document: &Document,
    with_tools: bool,
    focus_heading: Option<&str>,
) -> String {
    let len = document.chars().count();
    if shown_whole(document, with_tools) {
        return format!(
            "---document---\n{}",
            doc_blocks::annotate(document, 0, document.len())
        );
    }
    let focus = focus_heading
        .and_then(|h| focus_section(document, h))
        .map(|(line, text)| {
            format!("\n\n[the section the user is working in, from line {line}]\n{text}")
        })
        .unwrap_or_default();
    let outline = heading_outline(document);
    let outline_block = if outline.is_empty() {
        "(no headings)".to_string()
    } else {
        outline.join("\n")
    };
    let note = if with_tools {
        "This document is long, so only an outline (with line numbers) and the start/end are shown below. Read any section in full with read_document (by heading or line range) before revising or quoting it - never guess at text you haven't seen, and never propose an edit in the same step as the read it depends on - and use search_document to find where something is mentioned. Read the sections a change needs side by side in one step (several read_document calls), then propose their edits together in the next; a change through the whole document goes a few sections per step, each step's edits sent with the next step's reads."
    } else {
        "This document is long, so only an outline and the start/end are shown below - some content in the middle isn't visible here."
    };
    let head = char_prefix(document, EXCERPT_CHARS).len();
    let tail = document.len() - char_suffix(document, EXCERPT_CHARS).len();
    format!(
        "---document (truncated, {len} chars, {} lines total)---\n{note}\n\n[outline]\n{outline_block}{focus}\n\n[start]\n{}\n\n[end]\n{}",
        document.lines().count(),
        doc_blocks::annotate(document, 0, head),
        doc_blocks::annotate(document, tail, document.len()),
    )
}

/// The per-request context: style profile, the library entries this request
/// touches, then the document. Prepended to the current user message only, so
/// earlier turns never repeat an old copy of the document.
pub(crate) fn request_context(
    workspace: &AgentWorkspace,
    document: &Document,
    with_tools: bool,
    focus: &str,
    // The heading of the section the cursor or selection is in, from the
    // editor - included in full when the document is too long to embed.
    focus_heading: Option<&str>,
) -> String {
    request_context_and_library(workspace, document, with_tools, focus, focus_heading).0
}

/// [`request_context`], and the library entries it carries and leaves out.
pub(super) fn request_context_and_library<'a>(
    workspace: &'a AgentWorkspace,
    document: &Document,
    with_tools: bool,
    focus: &str,
    focus_heading: Option<&str>,
) -> (String, crate::ai::project::LibraryPick<'a>) {
    let document_text = document_section(document, with_tools, focus_heading);
    let pick =
        crate::ai::project::pick_library(&workspace.library, &format!("{focus}\n{document_text}"));
    let mut parts: Vec<String> =
        crate::ai::project::writing_context_section(workspace.style.as_deref(), &pick.included)
            .into_iter()
            .collect();
    parts.push(document_text);
    (parts.join("\n\n"), pick)
}

/// The current user message as sent: the request context, then what the user
/// wrote, under a header naming its language. Without that header, a short
/// English request with a CJK document got its reply in the document's language.
pub(crate) fn request_user_text(context: &str, message: &str) -> String {
    match message_language(message) {
        Some(language) => format!(
            "{context}\n\n---the user's message (written in {language}: reply in {language}, unless the user instructions or what you remember set a reply language)---\n{message}"
        ),
        None => format!("{context}\n\n---the user's message---\n{message}"),
    }
}

/// The current user message on the tool path: the preamble (the mode, what
/// Textus AI remembers), the request context, then what the user wrote.
pub(crate) fn request_message(
    workspace: &AgentWorkspace,
    mode: AgentMode,
    ui_language: &str,
    context: &str,
    message: &str,
) -> String {
    let mut preamble = request_preamble(workspace, mode, ui_language);
    if mode != AgentMode::Review && asks_for_a_length(message) {
        preamble.push_str("\n\n");
        preamble.push_str(LENGTH_TARGET_NOTE);
    }
    request_user_text(&format!("{preamble}\n\n{context}"), message)
}

/// Said with a request that asks for a length: told only in the system prompt,
/// models wrote the piece out unseen in measure_text before proposing it.
const LENGTH_TARGET_NOTE: &str = "This request asks for a length: write the text straight into propose_edit, where the user watches it come in - don't write it out first in measure_text or check_conventions. propose_edit's result says how long it came out; if that misses the length, say so in your reply.";

/// Whether the user's own words ask for a length: a number and a unit of
/// text ("1200 字", "500 words", "三千字", "2,000 characters").
pub(super) fn asks_for_a_length(message: &str) -> bool {
    static LENGTH: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(
            r"(?i)([0-9][0-9,]*|[一二两三四五六七八九十百千万]+)\s*(?:个)?\s*(?:字|词|words?\b|characters?\b|chars?\b|文字|語|단어|자\b|mots?\b|palabras?\b|wörter\b|слов)",
        )
        .expect("a valid pattern")
    });
    LENGTH.is_match(message)
}

/// The language of what the user typed, in English ("Chinese"), or None
/// when there is too little of it to tell. Text the message carries but the
/// user didn't write - a selection, the text around the cursor, attached
/// files, an expanded skill's instructions - is left out.
pub(crate) fn message_language(message: &str) -> Option<&'static str> {
    let mut typed = message.to_string();
    for (open, close) in [
        ("<skill name=", "</skill>"),
        ("<selected-text>", "</selected-text>"),
        ("<cursor>", "</cursor>"),
        ("<attached-file", "</attached-file>"),
    ] {
        while let Some(start) = typed.find(open) {
            let Some(end) = typed[start..].find(close).map(|i| start + i + close.len()) else {
                typed.truncate(start);
                break;
            };
            typed.replace_range(start..end, " ");
        }
    }
    let lang = crate::ai::rules::detect::guess(&typed)?;
    // The script is part of the language: otherwise a Simplified request to
    // convert to Traditional got its reply in Traditional.
    if lang == crate::ai::rules::detect::Lang::ZhHans {
        return Some("Simplified Chinese");
    }
    let code = lang.ui_code();
    crate::ai::ui_language::UI_LANGUAGES
        .iter()
        .find(|l| l.code == code)
        .map(|l| l.english)
}
