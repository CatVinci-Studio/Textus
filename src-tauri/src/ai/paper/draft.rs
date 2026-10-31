//! A paper drafted from its approved outline: a writer per section, three at
//! a time, each with the thesis, what the other sections cover, and its own
//! notes and their sources. A writer hands its section over with
//! submit_section, which checks its length, its citations and its figures and
//! sends back what is wrong. Sections are handed on in the outline's order,
//! each as it and those before it are done.

use super::research::Model;
use super::{Dossier, FigureKind, FigurePlan, Outline, OutlineSection, Paper};
use aicompat::agent::{run_agent_loop, AgentTurn, ToolCall, ToolOutput, ToolRun, ToolSpec};
use futures_util::stream::{self, StreamExt};
use regex::Regex;
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};

pub(crate) const SUBMIT_SECTION_TOOL: &str = "submit_section";

/// Sections written at once.
const AT_ONCE: usize = 3;
/// A writer's tries at a section that holds.
const WRITER_STEPS: usize = 5;
/// How far a section's length may be from its target, as fractions of it.
const SHORTEST: f64 = 0.6;
const LONGEST: f64 = 1.5;

/// Where a web picture goes until one is found for it.
pub(crate) const WEB_FIGURE_MARK: &str = "<!-- textus-figure web:";

fn cited_link() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[(\d{1,3})\]\((https?://[^)\s]+)\)").unwrap())
}

/// `[n]` not followed by `(`: a citation without its link.
fn bare_number() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[(\d{1,3})\]($|[^(\d])").unwrap())
}

/// `markdown`'s fenced blocks, as (language, body).
fn fences(markdown: &str) -> Vec<(String, String)> {
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
fn prose(markdown: &str) -> String {
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

/// Whether a chart block's JSON has what the chart renderer needs.
fn chart_holds(body: &str) -> Result<(), String> {
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
    Ok(())
}

/// What is wrong with `markdown` as section `section` of `paper`, all at once.
/// `sources`: the numbers this section may cite, with their addresses.
pub(crate) fn problems(
    markdown: &str,
    section: &OutlineSection,
    sources: &[(u32, String)],
    language: &str,
) -> Vec<String> {
    let mut out = Vec::new();
    let length = length(&prose(markdown), language);
    let target = section.target_words as f64;
    if (length as f64) < target * SHORTEST || (length as f64) > target * LONGEST {
        out.push(format!(
            "It is {length} long; the section is to be about {}.",
            section.target_words
        ));
    }
    let mut cited = 0;
    for c in cited_link().captures_iter(markdown) {
        let n: u32 = c[1].parse().unwrap_or(0);
        match sources.iter().find(|(m, _)| *m == n) {
            Some((_, url)) if *url == c[2] => cited += 1,
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

/// How each kind of figure is written into the section.
fn figure_line(figure: &FigurePlan) -> String {
    let how = match figure.kind {
        FigureKind::Mermaid => "a ```mermaid block",
        FigureKind::Chart => "a ```chart block: JSON {\"type\": \"bar\"|\"line\"|\"area\"|\"pie\"|\"scatter\", \"title\", \"x\", \"y\", \"labels\": [...], \"series\": [{\"name\", \"data\": [numbers]}], \"caption\", \"source\"}, with the notes' own numbers only",
        FigureKind::Generated => "a line ![caption](textus-picture:16:9 what the picture shows, in detail)",
        FigureKind::Web => "a line <!-- textus-figure web: what picture to find --> where it goes; one is found for it later",
    };
    format!("- {} - as {how}", figure.spec)
}

/// The writer's message: its section, the rest of the paper in outline,
/// and its notes.
fn writer_message(paper: &Paper, outline: &Outline, index: usize, dossier: &Dossier) -> String {
    let section = &outline.sections[index];
    let others: Vec<String> = outline
        .sections
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let mark = if i == index { "  <- yours" } else { "" };
            format!("{}. {} - {}{mark}", i + 1, s.title, s.key_points.join("; "))
        })
        .collect();
    let notes: Vec<String> = dossier
        .notes
        .iter()
        .filter(|n| section.evidence.contains(&n.id))
        .map(|n| {
            let cite: Vec<String> = n
                .sources
                .iter()
                .filter_map(|s| dossier.sources.iter().find(|x| x.n == *s))
                .map(|s| format!("[{}]({})", s.n, s.url))
                .collect();
            let quote = n
                .quote
                .as_deref()
                .map(|q| format!(" Quote: \"{q}\""))
                .unwrap_or_default();
            format!(
                "- {} Evidence: {}{quote} Sources: {}",
                n.claim,
                n.evidence,
                cite.join(" ")
            )
        })
        .collect();
    let figures: Vec<String> = section.figures.iter().map(figure_line).collect();
    format!(
        "Paper: \"{}\"\nThesis: {}\n\nThe sections:\n{}\n\nYour section: \"{}\", about {} long.\nKey points:\n- {}\n\nYour notes:\n{}\n\nFigures to put where they belong:\n{}",
        paper.topic,
        outline.thesis,
        others.join("\n"),
        section.title,
        section.target_words,
        section.key_points.join("\n- "),
        if notes.is_empty() { "(none)".into() } else { notes.join("\n") },
        if figures.is_empty() { "(none)".into() } else { figures.join("\n") },
    )
}

fn submit_section_spec() -> ToolSpec {
    ToolSpec {
        name: SUBMIT_SECTION_TOOL.into(),
        description: "Hand over your section, whole, as Markdown without its own heading. It is checked - length, citations, figures - and if anything is wrong you are told what; send the whole section again, corrected.".into(),
        parameters: json!({
            "type": "object",
            "properties": {"markdown": {"type": "string"}},
            "required": ["markdown"]
        }),
    }
}

/// Section `index` written: its Markdown under its heading.
pub(crate) async fn write_section(
    model: &dyn Model,
    paper: &Paper,
    outline: &Outline,
    index: usize,
    dossier: &Dossier,
) -> Result<String, String> {
    let section = &outline.sections[index];
    let unit = if length("字", &paper.language) == 1 {
        "characters"
    } else {
        "words"
    };
    let instructions = format!(
        "You write one section of a paper, in the language tagged \"{}\": substantial, specific prose for an informed reader - the notes' figures, dates, names and findings, explained and connected into an argument that serves the thesis, not a list of facts. Say where sources disagree and what the evidence can't show. Don't repeat what the other sections cover; you may point to them. Mark every fact from a note with its source right after it as [n](address), exactly as the note gives it, and cite nothing else. Use ### subheadings if the section is long; don't write the section's own heading. Its length counts {unit}, figures and code aside. Put each planned figure where it belongs, with a sentence in the text that refers to it. Hand it over with submit_section.",
        paper.language
    );
    let sources: Vec<(u32, String)> = dossier
        .notes
        .iter()
        .filter(|n| section.evidence.contains(&n.id))
        .flat_map(|n| n.sources.iter())
        .filter_map(|s| dossier.sources.iter().find(|x| x.n == *s))
        .map(|s| (s.n, s.url.clone()))
        .collect();
    let kept: Mutex<Option<String>> = Mutex::new(None);
    let specs = vec![submit_section_spec()];
    let execute = |call: ToolCall| {
        let (kept, sources) = (&kept, &sources);
        async move {
            let args: Value = serde_json::from_str(&call.arguments).unwrap_or_default();
            let markdown = args["markdown"].as_str().unwrap_or("").trim().to_string();
            let wrong = problems(&markdown, section, sources, &paper.language);
            if !wrong.is_empty() {
                return ToolOutput::from(format!(
                    "Not kept - fix these and send the whole section again:\n- {}",
                    wrong.join("\n- ")
                ));
            }
            *kept.lock().unwrap() = Some(markdown);
            ToolOutput {
                text: "Kept. Reply with one short line.".into(),
                settled: true,
                ..ToolOutput::default()
            }
        }
    };
    run_agent_loop(
        Vec::new(),
        AgentTurn::User {
            text: writer_message(paper, outline, index, dossier),
            images: Vec::new(),
        },
        WRITER_STEPS,
        |turns: Vec<AgentTurn>| {
            let (instructions, specs) = (&instructions, &specs);
            async move { model.step(instructions, &turns, specs).await }
        },
        execute,
        |_| ToolRun::InOrder,
        |_| {},
    )
    .await?;
    let body = kept
        .into_inner()
        .unwrap()
        .ok_or_else(|| format!("\"{}\" wasn't written in a form that holds.", section.title))?;
    Ok(format!("## {}\n\n{body}", section.title))
}

/// Every section of `outline` written, three at a time, and handed to
/// `drafted` in order: section n once it and every one before it is done.
/// `started` hears of each as its writer begins. A section that fails stops
/// the ones after it from being handed on, since the paper would have a gap.
pub(crate) async fn draft(
    model: &dyn Model,
    paper: &Paper,
    outline: &Outline,
    dossier: &Dossier,
    started: &(dyn Fn(usize) + Sync),
    drafted: &mut (dyn FnMut(usize, &str) -> Result<(), String> + Send),
) -> Result<(), String> {
    let mut sections = stream::iter(0..outline.sections.len())
        .map(|i| async move {
            started(i);
            (i, write_section(model, paper, outline, i, dossier).await)
        })
        .buffered(AT_ONCE);
    while let Some((i, written)) = sections.next().await {
        drafted(i, &written?)?;
    }
    Ok(())
}
