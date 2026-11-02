//! What a drafted section must hold - its length, its citations, its
//! figures and their data - and the checks that send it back to its writer
//! when it doesn't.

use super::{FigureKind, OutlineSection};
use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

/// How far a section's length may be from its target, as fractions of it:
/// within PASS it holds; within SOFT it is kept if nothing else is wrong
/// (a writer's last try); beyond, it is sent back. The first real runs came
/// back at twice their targets.
pub(super) const PASS: (f64, f64) = (0.7, 1.2);
pub(super) const SOFT: (f64, f64) = (0.5, 1.4);

/// The most a section of `target` may run to, as writers are told.
pub(crate) fn most(target: u32) -> u32 {
    (target as f64 * PASS.1).round() as u32
}

/// Whether two addresses are one, written with or without percent-escapes
/// ("(" or "%28") or a trailing slash.
pub(super) fn same_address(a: &str, b: &str) -> bool {
    let plain = |s: &str| {
        percent_encoding::percent_decode_str(s.trim_end_matches('/'))
            .decode_utf8_lossy()
            .into_owned()
    };
    a == b || plain(a) == plain(b)
}

/// Where a web picture goes until one is found for it.
pub(crate) const WEB_FIGURE_MARK: &str = "<!-- textus-figure web:";

/// A citation as the paper writes it, `[n](address)`: a web page's address,
/// or a file in the user's reference library (`references/…`).
pub(crate) fn cited_link() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[(\d{1,3})\]\(((?:https?://|references/)[^)\s]+)\)").unwrap())
}

/// A figure named by a number, "图 2" or "Figure 2": the writers' own
/// numbers, which the paper's numbering would contradict.
pub(super) fn numbered_figure() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?:图|圖|図|Figure|Fig\.|Abbildung|Figura|Рисунок|그림)\s*\d+").unwrap()
    })
}

/// `[n]` not followed by `(`: a citation without its link.
pub(super) fn bare_number() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[(\d{1,3})\]($|[^(\d])").unwrap())
}

/// `markdown`'s fenced blocks, as (language, body).
pub(super) fn fences(markdown: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut open: Option<(String, String)> = None;
    for line in markdown.lines() {
        let trimmed = line.trim_start();
        match open.take() {
            None if trimmed.starts_with("```") => {
                open = Some((
                    trimmed.trim_start_matches('`').trim().to_lowercase(),
                    String::new(),
                ));
            }
            None => {}
            Some(block) if trimmed.starts_with("```") => out.push(block),
            Some((lang, mut body)) => {
                body.push_str(line);
                body.push('\n');
                open = Some((lang, body));
            }
        }
    }
    out
}

/// The section's prose, without its fences, pictures and marks: what its
/// length counts.
pub(super) fn prose(markdown: &str) -> String {
    let mut out = String::new();
    let mut in_fence = false;
    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || trimmed.starts_with("![") || trimmed.starts_with("<!--") {
            continue;
        }
        out.push_str(&cited_link().replace_all(line, ""));
        out.push('\n');
    }
    out
}

/// `text`'s length: its characters (not spaces) for a language written
/// without spaces, else its words.
pub(crate) fn length(text: &str, language: &str) -> u32 {
    if ["zh", "ja", "ko"].iter().any(|l| language.starts_with(l)) {
        text.chars().filter(|c| !c.is_whitespace()).count() as u32
    } else {
        text.split_whitespace().count() as u32
    }
}

/// The length of `markdown`'s prose: its text without code, figures,
/// marks or citations' addresses - what a paper's length is measured by.
#[cfg(test)]
pub(crate) fn prose_length(markdown: &str, language: &str) -> u32 {
    length(&prose(markdown), language)
}

/// Whether a chart block's JSON has what the chart renderer needs.
pub(super) fn chart_holds(body: &str) -> Result<(), String> {
    let spec: Value =
        serde_json::from_str(body).map_err(|e| format!("its JSON doesn't parse ({e})"))?;
    let kind = spec["type"].as_str().unwrap_or("bar");
    if !["bar", "line", "area", "pie", "scatter"].contains(&kind) {
        return Err(format!(
            "\"type\" {kind:?} isn't bar, line, area, pie or scatter"
        ));
    }
    let series = spec["series"]
        .as_array()
        .filter(|s| !s.is_empty())
        .ok_or("it needs a non-empty \"series\"")?;
    if series
        .iter()
        .any(|s| s["data"].as_array().is_none_or(|d| d.is_empty()))
    {
        return Err("every series needs a non-empty \"data\" list".into());
    }
    if spec["x"].is_array() {
        return Err("\"x\" is the x axis' title, one text; the categories go in \"labels\"".into());
    }
    for key in ["title", "x", "y", "caption", "source"] {
        if !spec[key].is_null() && !spec[key].is_string() {
            return Err(format!("\"{key}\" must be text"));
        }
    }
    let points = series
        .iter()
        .filter_map(|s| s["data"].as_array().map(Vec::len))
        .max()
        .unwrap_or(0);
    if kind != "scatter" {
        if let Some(labels) = spec["labels"].as_array() {
            if labels.len() < points {
                return Err(format!(
                    "{} \"labels\" for {points} data points: one label each",
                    labels.len()
                ));
            }
        }
    }
    if spec["source"]
        .as_str()
        .is_some_and(|s| note_id().is_match(s))
    {
        return Err("\"source\" names notes by their ids; name the sources by their numbers, as [3](address)".into());
    }
    Ok(())
}

/// A note's id, as the dossier numbers them ("n12"): for the reader, the
/// sources are what is cited, never the notes.
pub(super) fn note_id() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:^|[^A-Za-z0-9])n\d+(?:$|[^A-Za-z0-9])").unwrap())
}

/// What is wrong with `markdown` as section `section` of `paper`, all at once.
/// `sources`: the numbers this section may cite, with their addresses.
/// Whether a problem `problems` found is soft: the length off its target,
/// or a planned figure missing. A section with only these is kept rather
/// than lose the paper; a wrong citation or a chart that can't be drawn is
/// never kept.
pub(crate) fn is_soft(problem: &str) -> bool {
    problem.starts_with("It is ") || problem.contains(" planned ")
}

pub(crate) fn problems(
    markdown: &str,
    section: &OutlineSection,
    sources: &[(u32, String)],
    language: &str,
) -> Vec<String> {
    let mut out = Vec::new();
    let length = length(&prose(markdown), language);
    let target = section.target_words as f64;
    let ratio = length as f64 / target.max(1.0);
    let most = most(section.target_words);
    if ratio > SOFT.1 {
        out.push(format!(
            "Far too long: {length} against about {} - cut it to at most {most}, keeping the strongest evidence.",
            section.target_words
        ));
    } else if ratio < SOFT.0 {
        out.push(format!(
            "Far too short: {length} against about {} - develop the key points with the notes' evidence.",
            section.target_words
        ));
    } else if ratio < PASS.0 || ratio > PASS.1 {
        out.push(format!(
            "It is {length} long; the section is to be about {} (at most {most}).",
            section.target_words
        ));
    }
    let mut cited = 0;
    for c in cited_link().captures_iter(markdown) {
        let n: u32 = c[1].parse().unwrap_or(0);
        match sources.iter().find(|(m, _)| *m == n) {
            Some((_, url)) if same_address(url, &c[2]) => cited += 1,
            Some((_, url)) => {
                out.push(format!("[{n}] links to {} but source {n} is {url}.", &c[2]))
            }
            None => out.push(format!("[{n}] isn't one of this section's sources.")),
        }
    }
    if bare_number().is_match(&prose(markdown)) {
        out.push(
            "A citation is written as [n] alone: write it [n](address), with the source's address."
                .into(),
        );
    }
    if let Some(found) = numbered_figure().find(&prose(markdown)) {
        out.push(format!(
            "\"{}\" names a figure by a number: the figures are numbered afterwards - call it the diagram, chart or picture below or above.",
            found.as_str()
        ));
    }
    if cited == 0 && !sources.is_empty() {
        out.push(
            "Nothing is cited: mark each fact from the notes with its source, [n](address).".into(),
        );
    }
    let blocks = fences(markdown);
    let count = |kind: FigureKind| section.figures.iter().filter(|f| f.kind == kind).count();
    let mermaid = blocks
        .iter()
        .filter(|(lang, body)| lang == "mermaid" && !body.trim().is_empty())
        .count();
    if mermaid < count(FigureKind::Mermaid) {
        out.push(format!(
            "{} planned diagram(s), {mermaid} ```mermaid block(s).",
            count(FigureKind::Mermaid)
        ));
    }
    let charts: Vec<&String> = blocks
        .iter()
        .filter(|(lang, _)| lang == "chart")
        .map(|(_, body)| body)
        .collect();
    for (i, body) in charts.iter().enumerate() {
        if let Err(why) = chart_holds(body) {
            out.push(format!("Chart {}: {why}.", i + 1));
        }
    }
    if charts.len() < count(FigureKind::Chart) {
        out.push(format!(
            "{} planned chart(s), {} ```chart block(s).",
            count(FigureKind::Chart),
            charts.len()
        ));
    }
    let pictures = markdown.matches("](textus-picture:").count();
    if pictures < count(FigureKind::Generated) {
        out.push(format!(
            "{} planned picture(s), {pictures} textus-picture line(s).",
            count(FigureKind::Generated)
        ));
    }
    let web = markdown.matches(WEB_FIGURE_MARK).count();
    if web < count(FigureKind::Web) {
        out.push(format!(
            "{} planned web picture(s), {web} mark(s).",
            count(FigureKind::Web)
        ));
    }
    out
}
