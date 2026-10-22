//! The tools that read the document: search it, and read a section whole.

use super::*;

pub(crate) const SEARCH_TOOL_NAME: &str = "search_document";

pub(super) fn search_document(ctx: &ToolContext, arguments: &str) -> String {
    let query = serde_json::from_str::<serde_json::Value>(arguments)
        .ok()
        .and_then(|v| {
            v.get("query")
                .and_then(|q| q.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();

    if query.trim().is_empty() {
        return "No query provided.".to_string();
    }

    let query_lower = query.to_lowercase();
    let blocks = crate::ai::doc_blocks::split(ctx.document);
    let mut at = 0;
    let matches: Vec<String> = ctx
        .document
        .split_inclusive('\n')
        .enumerate()
        .filter_map(|(i, line)| {
            let start = at;
            at += line.len();
            let line = line.trim_end_matches(['\n', '\r']);
            line.to_lowercase().contains(&query_lower).then(|| {
                match crate::ai::doc_blocks::id_at(&blocks, start) {
                    Some(id) => format!("{} [#{id}]: {line}", i + 1),
                    None => format!("{}: {line}", i + 1),
                }
            })
        })
        .take(20)
        .collect();

    if matches.is_empty() {
        format!("No matches found for \"{query}\".")
    } else {
        matches.join("\n")
    }
}

pub(crate) const READ_DOCUMENT_TOOL_NAME: &str = "read_document";

/// Most a single read_document call returns; a longer range comes back cut
/// at a line boundary with a pointer to where to continue.
pub(super) const MAX_READ_DOCUMENT_CHARS: usize = 12_000;

/// The ATX heading level of a markdown line (`## Title` -> 2), or None.
pub(super) fn heading_level(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|&c| c == '#').count();
    ((1..=6).contains(&hashes) && trimmed.as_bytes().get(hashes) == Some(&b' ')).then_some(hashes)
}

/// Line indexes (0-based) of headings outside fenced code blocks - a `# `
/// comment in a shell snippet isn't a section.
pub(crate) fn heading_lines(lines: &[&str]) -> Vec<(usize, usize)> {
    let mut in_fence = false;
    let mut headings = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if !in_fence {
            if let Some(level) = heading_level(line) {
                headings.push((i, level));
            }
        }
    }
    headings
}

/// The line range `[start, end)` of the section under `heading`: from the
/// heading to the next one at its level or above, so "Methods" includes its
/// subsections. An exact title wins; otherwise the first heading containing
/// it, ignoring case. Shared by read_document and agent.rs's focus section,
/// so "section" means the same thing to the model and to the prompt.
pub(crate) fn section_range(lines: &[&str], heading: &str) -> Option<(usize, usize)> {
    let wanted = heading.trim().trim_start_matches('#').trim();
    if wanted.is_empty() {
        return None;
    }
    let headings = heading_lines(lines);
    let title = |i: usize| lines[i].trim_start().trim_start_matches('#').trim();
    let lower = wanted.to_lowercase();
    let pos = headings
        .iter()
        .position(|&(i, _)| title(i) == wanted)
        .or_else(|| {
            headings
                .iter()
                .position(|&(i, _)| title(i).to_lowercase().contains(&lower))
        })?;
    let (first, level) = headings[pos];
    let last = headings[pos + 1..]
        .iter()
        .find(|&&(_, l)| l <= level)
        .map_or(lines.len(), |&(i, _)| i);
    Some((first, last))
}

/// Reads part of the document verbatim - a section by its heading, or a
/// line range. The embedded document is only an outline plus excerpts once
/// it is long (agent.rs's document_section), and search_document only ever
/// shows single lines: without this the model had no way to see a whole
/// passage it was asked to revise, nor a multi-line anchor to quote.
pub(super) fn read_document(ctx: &ToolContext, arguments: &str) -> String {
    let args: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let lines: Vec<&str> = ctx.document.lines().collect();
    if lines.is_empty() {
        return "The document is empty.".to_string();
    }
    let total = lines.len();

    let (start, end) = if let Some(heading) = args
        .get("heading")
        .and_then(|h| h.as_str())
        .map(str::trim)
        .filter(|h| !h.is_empty())
    {
        match section_range(&lines, heading) {
            Some(range) => range,
            None => {
                return format!("No heading matching \"{heading}\". The outline in the document section lists them.")
            }
        }
    } else {
        let line_arg = |key: &str| args.get(key).and_then(|v| v.as_u64()).map(|n| n as usize);
        let start = line_arg("start_line").unwrap_or(1).clamp(1, total) - 1;
        let end = line_arg("end_line")
            .unwrap_or(total)
            .clamp(start + 1, total);
        (start, end)
    };

    let mut out = String::new();
    let mut shown_end = start;
    for line in &lines[start..end] {
        if !out.is_empty() && out.len() + line.len() + 1 > MAX_READ_DOCUMENT_CHARS {
            break;
        }
        out.push_str(line);
        out.push('\n');
        shown_end += 1;
    }
    let mut header = format!("Lines {}-{} of {total}:", start + 1, shown_end);
    if shown_end < end {
        header.push_str(&format!(
            " (cut for length - continue with start_line={})",
            shown_end + 1
        ));
    }
    // The blocks in it marked with their ids, as the document section is
    // (doc_blocks.rs), for an edit to name.
    let line_starts: Vec<usize> = std::iter::once(0)
        .chain(ctx.document.split_inclusive('\n').scan(0, |at, line| {
            *at += line.len();
            Some(*at)
        }))
        .collect();
    let from = line_starts[start];
    let to = line_starts
        .get(shown_end)
        .copied()
        .unwrap_or(ctx.document.len())
        .min(ctx.document.len());
    let blocks = crate::ai::doc_blocks::split(ctx.document);
    let marked = crate::ai::doc_blocks::annotate(ctx.document, &blocks, from, to);
    let out = if marked.ends_with('\n') {
        marked
    } else {
        format!("{marked}\n")
    };
    format!("{header}\n{out}")
}
