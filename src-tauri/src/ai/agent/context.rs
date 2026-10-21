//! What a request carries of the document: the whole of it, or an outline
//! and the section in focus when it is long, and the user's message with it.

use super::*;

/// Up to this much the document is embedded in full; past it, the prompt
/// gets a line-numbered outline plus a head/tail excerpt (and the section
/// the user is working in), and the model reads what it needs through
/// read_document / search_document (tools.rs), which always work on the
/// full text. Raised from 16k: that cut ordinary chapters down to 3k
/// characters of visible text, and the Anthropic path now caches the
/// prompt across tool steps. Counted in characters with Chinese, Japanese
/// and Korean ones as 3 (project::char_units, as read_file counts) where
/// the model can read on: by characters, a Chinese chapter of 39,000 was
/// sent whole, about 40,000 tokens in every message (docs/design/ai-tokens.md,
/// item 3). Without tools there is no reading on, so characters it stays.
pub(super) const FULL_DOCUMENT_LIMIT: usize = 40_000;
pub(super) const EXCERPT_CHARS: usize = 2_000;
pub(super) const MAX_OUTLINE_HEADINGS: usize = 120;

/// The document's headings with the line each starts on (`L12 ## Methods`)
/// - the map read_document's line ranges and section names refer to.
pub(super) fn heading_outline(document: &str) -> Vec<String> {
    let lines: Vec<&str> = document.lines().collect();
    crate::ai::tools::heading_lines(&lines)
        .into_iter()
        .take(MAX_OUTLINE_HEADINGS)
        .map(|(i, _)| format!("L{} {}", i + 1, lines[i].trim()))
        .collect()
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

/// The `---document---` prompt section: the full text under
/// `FULL_DOCUMENT_LIMIT`, otherwise an outline plus start/end excerpts.
/// Most of a focus section embedded alongside a truncated document.
pub(super) const FOCUS_SECTION_CHARS: usize = 12_000;

/// The section headed `heading` (to the next heading at its level or above)
/// and the line it starts on - the part of a long document the user is
/// working in, which the truncated view would otherwise leave out.
pub(super) fn focus_section(document: &str, heading: &str) -> Option<(usize, String)> {
    let lines: Vec<&str> = document.lines().collect();
    let (first, last) = crate::ai::tools::section_range(&lines, heading)?;
    let text = lines[first..last].join("\n");
    Some((
        first + 1,
        char_prefix(&text, FOCUS_SECTION_CHARS).to_string(),
    ))
}

pub(crate) fn document_section(
    document: &str,
    with_tools: bool,
    focus_heading: Option<&str>,
) -> String {
    let len = document.chars().count();
    let size = if with_tools {
        document.chars().map(crate::ai::project::char_units).sum()
    } else {
        len
    };
    if size <= FULL_DOCUMENT_LIMIT {
        return format!("---document---\n{document}");
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
        "This document is long, so only an outline (with line numbers) and the start/end are shown below. Read any section in full with read_document (by heading or line range) before revising or quoting it, and use search_document to find where something is mentioned."
    } else {
        "This document is long, so only an outline and the start/end are shown below - some content in the middle isn't visible here."
    };
    format!(
        "---document (truncated, {len} chars, {} lines total)---\n{note}\n\n[outline]\n{outline_block}{focus}\n\n[start]\n{}\n\n[end]\n{}",
        document.lines().count(),
        char_prefix(document, EXCERPT_CHARS),
        char_suffix(document, EXCERPT_CHARS),
    )
}

/// The per-request context: the project's style profile and the library
/// entries this request touches, then the document (in full, or outlined
/// when long). Prepended to the CURRENT user message only, for the request;
/// what history keeps is the plain message (see ai_agent_message_inner), so
/// earlier turns never repeat an old copy of the document.
pub(crate) fn request_context(
    workspace: &AgentWorkspace,
    document: &str,
    with_tools: bool,
    focus: &str,
    // The heading of the section the cursor or selection is in, from the
    // editor - included in full when the document is too long to embed.
    focus_heading: Option<&str>,
) -> String {
    request_context_and_library(workspace, document, with_tools, focus, focus_heading).0
}

/// [`request_context`], and the library entries it carries and leaves out
/// - which the Memory tab marks (project::record_library_use).
pub(super) fn request_context_and_library<'a>(
    workspace: &'a AgentWorkspace,
    document: &str,
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

/// The current user message as sent: the request context, then what the
/// user wrote - under a header that names the language they wrote it in,
/// when that can be told. The rule "reply in the language of the user's
/// message" alone lost to the document's language whenever a short English
/// request came with a Chinese or Japanese document: the whole reply came
/// back in the document's language (round 4: cross/en-asks-ja-doc, and
/// Haiku replying in English to Chinese requests once a style profile was
/// in the context). Said right above the message, per turn, it holds.
pub(crate) fn request_user_text(context: &str, message: &str) -> String {
    match message_language(message) {
        Some(language) => format!(
            "{context}\n\n---the user's message (written in {language}: reply in {language}, unless the user instructions set a reply language)---\n{message}"
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
    let preamble = request_preamble(workspace, mode, ui_language);
    request_user_text(&format!("{preamble}\n\n{context}"), message)
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
    // The script is part of the language: asked in Simplified to convert a
    // report to Traditional, the reply came back in Traditional (round 4,
    // builtin/translate/hans-hant/report).
    if lang == crate::ai::rules::detect::Lang::ZhHans {
        return Some("Simplified Chinese");
    }
    let code = lang.ui_code();
    crate::ai::ui_language::UI_LANGUAGES
        .iter()
        .find(|l| l.code == code)
        .map(|l| l.english)
}
