//! check_conventions and measure_text: the rules engine and exact counts,
//! for grounding a proofread or a length in facts.

use super::*;

pub(super) const CHECK_CONVENTIONS_TOOL_NAME: &str = "check_conventions";

/// Most lines check_conventions returns.
pub(super) const MAX_CONVENTION_LINES: usize = 50;

/// Invisible characters spelled out, so a suggestion that only changes a
/// space can be read: the model can't see a no-break space.
pub(super) fn visible(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\u{00A0}' => "[no-break space]".to_string(),
            '\u{202F}' => "[narrow no-break space]".to_string(),
            '\u{3000}' => "[ideographic space]".to_string(),
            '\u{200B}' => "[zero-width space]".to_string(),
            '\u{200D}' => "[zero-width joiner]".to_string(),
            '\u{FEFF}' => "[BOM]".to_string(),
            '\n' => "\\n".to_string(),
            c => c.to_string(),
        })
        .collect()
}

/// Checks a passage against the document's writing conventions: a section, a
/// line range, the whole document, or a draft (`text`) judged against the
/// document's majority. Findings grouped by rule, at most 50 lines.
pub(super) fn check_conventions(ctx: &ToolContext, arguments: &str) -> String {
    use crate::ai::rules::{self, Level};
    let args: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let level = if args.get("strict").and_then(|v| v.as_bool()) == Some(true) {
        Level::Strict
    } else {
        Level::Standard
    };
    let text = args
        .get("text")
        .and_then(|t| t.as_str())
        .filter(|t| !t.trim().is_empty());
    let (report, scope, range) = if let Some(text) = text {
        // The draft as it will land, after the automatic fixes: checked raw, fixes the
        // app was about to make sent the model back to propose again.
        let (text, _) = rules::postfix::proposal_text(ctx.document, text, ctx.conventions);
        let report = rules::document::check_document_with(
            &text,
            Some(ctx.document),
            ctx.conventions,
            level,
            ctx.library,
        );
        (report, "the text you gave".to_string(), None)
    } else {
        let lines: Vec<&str> = ctx.document.lines().collect();
        let total = lines.len().max(1);
        let range = if let Some(heading) = args
            .get("heading")
            .and_then(|h| h.as_str())
            .map(str::trim)
            .filter(|h| !h.is_empty())
        {
            match section_range(&lines, heading) {
                Some((a, b)) => (a + 1, b),
                None => return format!("No heading matching \"{heading}\". The outline in the document section lists them."),
            }
        } else {
            let line_arg = |key: &str| args.get(key).and_then(|v| v.as_u64()).map(|n| n as usize);
            let start = line_arg("start_line").unwrap_or(1).clamp(1, total);
            let end = line_arg("end_line").unwrap_or(total).clamp(start, total);
            (start, end)
        };
        let report = rules::check_document(ctx.document, ctx.conventions, level, ctx.library);
        (
            report,
            format!("lines {}-{}", range.0, range.1),
            Some(range),
        )
    };
    let profile = report
        .profile
        .as_ref()
        .map(|p| p.describe())
        .unwrap_or_else(|| "none (too little prose to tell the language)".to_string());
    let findings: Vec<&rules::Finding> = report
        .findings
        .iter()
        .filter(|f| range.is_none_or(|(a, b)| f.line.is_some_and(|l| l >= a && l <= b)))
        .collect();
    let mut out = format!("Writing conventions: {profile}.\n");
    if findings.is_empty() {
        out.push_str(&format!("No convention issues found in {scope}."));
        return out;
    }
    out.push_str(&format!(
        "{} finding(s) in {scope}. \"fix\" lines are mechanical and safe; \"suggest\" lines need judgement; \"check\" lines only point at something to look at.\n",
        findings.len()
    ));
    // Grouped by rule, rules in order of first appearance.
    let mut order: Vec<&str> = Vec::new();
    for f in &findings {
        if !order.contains(&f.rule) {
            order.push(f.rule);
        }
    }
    let mut lines_out = 0;
    let mut shown = 0;
    'rules: for rule in order {
        let group: Vec<&&rules::Finding> = findings.iter().filter(|f| f.rule == rule).collect();
        if lines_out >= MAX_CONVENTION_LINES {
            break;
        }
        out.push_str(&format!("{rule} ({}): {}\n", group.len(), group[0].message));
        lines_out += 1;
        for f in group {
            if lines_out >= MAX_CONVENTION_LINES {
                break 'rules;
            }
            let line = f.line.map(|l| format!("L{l}")).unwrap_or_default();
            let kind = match (f.fix, &f.suggestion) {
                (rules::Fix::Safe, Some(_)) => "fix",
                (_, Some(_)) => "suggest",
                _ => "check",
            };
            let what = match &f.suggestion {
                Some(s) => format!("\"{}\" -> \"{}\"", visible(&f.original), visible(s)),
                None => format!("\"{}\"", visible(&f.original)),
            };
            let note = if f.message != findings.iter().find(|g| g.rule == rule).unwrap().message {
                format!(" ({})", f.message)
            } else {
                String::new()
            };
            out.push_str(&format!("  {line} {kind}: {what}{note}\n"));
            lines_out += 1;
            shown += 1;
        }
    }
    if shown < findings.len() {
        out.push_str(&format!(
            "... and {} more; check a smaller range to see them.\n",
            findings.len() - shown
        ));
    }
    // The bracketed names are for reading; told only those, the model believed
    // a plain space was a no-break one.
    let invisible = findings.iter().any(|f| {
        f.suggestion
            .as_deref()
            .is_some_and(|s| s.contains(['\u{00A0}', '\u{202F}']))
    });
    if invisible {
        out.push_str("A [no-break space] or [narrow no-break space] in a fix is that character, not an ordinary space: in propose_edit's JSON write it as \\u00a0 or \\u202f inside the string, and check the draft with `text` before proposing.\n");
    }
    out
}

pub(super) const MEASURE_TEXT_TOOL_NAME: &str = "measure_text";

/// Exact counts for a length limit (ai::rules::measure).
pub(super) fn measure_text(_ctx: &ToolContext, arguments: &str) -> String {
    use crate::ai::rules::measure;
    let args: serde_json::Value = serde_json::from_str(arguments).unwrap_or_default();
    let Some(text) = args.get("text").and_then(|t| t.as_str()) else {
        return "No `text` given - pass the exact text to count.".to_string();
    };
    match args
        .get("metric")
        .and_then(|m| m.as_str())
        .filter(|m| !m.is_empty() && *m != "all")
    {
        Some(metric) => match measure::measure(text, metric) {
            Some(m) => m.describe(),
            None => format!(
                "Unknown metric `{metric}`. Use one of: {}.",
                measure::METRICS.join(", ")
            ),
        },
        None => [
            "chars",
            "words",
            "cjk_chars",
            "utf8_bytes",
            "x_weighted",
            "bluesky",
        ]
        .iter()
        .filter_map(|m| measure::measure(text, m))
        .map(|m| m.describe())
        .collect::<Vec<_>>()
        .join("\n"),
    }
}
