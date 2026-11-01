//! A paper drafted from its approved outline: a writer per section, three at
//! a time, each with the thesis, what the other sections cover, and its own
//! notes and their sources. A writer hands its section over with
//! submit_section, which checks its length, its citations and its figures and
//! sends back what is wrong. Sections are handed on in the outline's order,
//! each as it and those before it are done.

use super::research::{Model, Streamed};
use super::{Dossier, FigureKind, FigurePlan, Outline, OutlineSection, Paper, PaperEvent};
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
/// How far a section's length may be from its target, as fractions of it:
/// within PASS it holds; within SOFT it is kept if nothing else is wrong
/// (a writer's last try); beyond, it is sent back. The first real runs came
/// back at twice their targets.
const PASS: (f64, f64) = (0.7, 1.2);
const SOFT: (f64, f64) = (0.5, 1.4);

/// The most a section of `target` may run to, as writers are told.
pub(crate) fn most(target: u32) -> u32 {
    (target as f64 * PASS.1).round() as u32
}

/// Whether two addresses are one, written with or without percent-escapes
/// ("(" or "%28").
fn same_address(a: &str, b: &str) -> bool {
    let plain = |s: &str| {
        percent_encoding::percent_decode_str(s)
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

/// The length of `markdown`'s prose: its text without code, figures,
/// marks or citations' addresses - what a paper's length is measured by.
pub(crate) fn prose_length(markdown: &str, language: &str) -> u32 {
    length(&prose(markdown), language)
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
        FigureKind::Web => "a line <!-- textus-figure web: caption | a few English words to search Wikimedia Commons for --> where it goes; a real photograph or figure is found for it there later, so ask for something Commons would have (a place, an object, a species, a historical image), not an abstract idea",
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
        "Paper: \"{}\"\nThesis: {}\n\nThe sections:\n{}\n\nYour section: \"{}\", about {} long and at most {} - longer is sent back.\nKey points:\n- {}\n\nYour notes:\n{}\n\nFigures to put where they belong:\n{}",
        paper.topic,
        outline.thesis,
        others.join("\n"),
        section.title,
        section.target_words,
        most(section.target_words),
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
    // A revision: the earlier draft and the reviewer's points against it.
    revision: Option<(&str, &[String])>,
    send: &(dyn Fn(PaperEvent) + Sync),
) -> Result<String, String> {
    let watch = SectionWatch::new(index as u32, send);
    let section = &outline.sections[index];
    let unit = if length("字", &paper.language) == 1 {
        "characters"
    } else {
        "words"
    };
    let instructions = format!(
        "You write one section of a paper, in the language tagged \"{}\": substantial, specific prose for an informed reader - the notes' figures, dates, names and findings, explained and connected into an argument that serves the thesis, not a list of facts. Say where sources disagree and what the evidence can't show. Don't repeat what the other sections cover; you may point to them. Mark every fact from a note with its source right after it as [n](address), exactly as the note gives it, and cite nothing else. Use ### subheadings if the section is long; don't write the section's own heading. Its length counts {unit}, figures and code aside. Put each planned figure where it belongs, with a sentence in the text that refers to it. Hand it over by calling submit_section with the whole section - never write the section in your reply.",
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
    // The latest section handed over whose problems were all soft: kept at
    // the end if no try holds.
    let soft: Mutex<Option<String>> = Mutex::new(None);
    let specs = vec![submit_section_spec()];
    let execute = |call: ToolCall| {
        let (kept, soft, sources) = (&kept, &soft, &sources);
        async move {
            let args: Value = serde_json::from_str(&call.arguments).unwrap_or_default();
            let markdown = args["markdown"].as_str().unwrap_or("").trim().to_string();
            let wrong = problems(&markdown, section, sources, &paper.language);
            if !wrong.is_empty() {
                // Seen in a live run's output, never in the app's.
                if cfg!(test) {
                    eprintln!(
                        "paper: \"{}\" not kept: {}",
                        section.title,
                        wrong.join(" | ")
                    );
                }
                if !markdown.is_empty() && wrong.iter().all(|p| is_soft(p)) {
                    *soft.lock().unwrap() = Some(markdown);
                }
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
    let turns = run_agent_loop(
        Vec::new(),
        AgentTurn::User {
            text: match revision {
                None => writer_message(paper, outline, index, dossier),
                Some((earlier, points)) => format!(
                    "{}\n\nYou wrote this section before:\n<draft>\n{earlier}\n</draft>\n\nA reviewer who read the whole paper asks for these changes:\n- {}\n\nRevise the section to meet them, keeping what works and no longer than before, and hand over the whole section again.",
                    writer_message(paper, outline, index, dossier),
                    points.join("\n- ")
                ),
            },
            images: Vec::new(),
        },
        WRITER_STEPS,
        |turns: Vec<AgentTurn>| {
            let (instructions, specs) = (&instructions, &specs);
            let watch = &watch;
            async move {
                model
                    .step_watched(instructions, &turns, specs, &|s| watch.push(s))
                    .await
            }
        },
        execute,
        |_| ToolRun::InOrder,
        |_| {},
    )
    .await?;
    let body = kept
        .into_inner()
        .unwrap()
        .or(soft.into_inner().unwrap())
        .or_else(|| replied_section(&turns, section, &sources, &paper.language))
        .ok_or_else(|| format!("\"{}\" wasn't written in a form that holds.", section.title))?;
    Ok(format!("## {}\n\n{body}", section.title))
}

/// A writer that answered with its section as its reply instead of handing
/// it over (some models do): the reply, under the same checks - kept if
/// nothing is wrong with it but its length or a missing figure. Its own
/// heading, if it wrote one, is left off.
fn replied_section(
    turns: &[AgentTurn],
    section: &OutlineSection,
    sources: &[(u32, String)],
    language: &str,
) -> Option<String> {
    let reply = turns.iter().rev().find_map(|t| match t {
        AgentTurn::Assistant { text, .. } => Some(text.trim()),
        _ => None,
    })?;
    let body = match reply.split_once('\n') {
        Some((first, rest)) if first.trim_start().starts_with('#') => rest.trim(),
        _ => reply,
    };
    let wrong = problems(body, section, sources, language);
    if cfg!(test) {
        eprintln!(
            "paper: \"{}\" came as a reply ({} chars){}",
            section.title,
            body.chars().count(),
            if wrong.is_empty() {
                String::new()
            } else {
                format!(": {}", wrong.join(" | "))
            }
        );
    }
    wrong.iter().all(|p| is_soft(p)).then(|| body.to_string())
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
    send: &(dyn Fn(PaperEvent) + Sync),
) -> Result<(), String> {
    let mut sections = stream::iter(0..outline.sections.len())
        .map(|i| async move {
            started(i);
            (
                i,
                write_section(model, paper, outline, i, dossier, None, send).await,
            )
        })
        .buffered(AT_ONCE);
    while let Some((i, written)) = sections.next().await {
        drafted(i, &written?)?;
    }
    Ok(())
}

/// How much of a section a SectionText event carries: its tail.
const SECTION_TAIL: usize = 2000;
/// The least time between two SectionText events for one section.
const SECTION_EVERY: std::time::Duration = std::time::Duration::from_millis(300);

/// Watches a writer's stream and sends what it has written so far as
/// SectionText: the `markdown` of the submit_section call it is making, or
/// its reply when it writes the section there instead.
pub(crate) struct SectionWatch<'a> {
    index: u32,
    send: &'a (dyn Fn(PaperEvent) + Sync),
    state: Mutex<WatchState>,
}

#[derive(Default)]
struct WatchState {
    args: String,
    reply: String,
    sent: usize,
    last: Option<std::time::Instant>,
}

impl<'a> SectionWatch<'a> {
    pub(crate) fn new(index: u32, send: &'a (dyn Fn(PaperEvent) + Sync)) -> Self {
        Self {
            index,
            send,
            state: Mutex::new(WatchState::default()),
        }
    }

    pub(crate) fn push(&self, streamed: Streamed<'_>) {
        let text = {
            let mut state = self.state.lock().unwrap();
            match streamed {
                Streamed::Thinking(_) => return,
                Streamed::Text(text) => state.reply.push_str(text),
                Streamed::ToolStart => {
                    *state = WatchState {
                        last: state.last,
                        ..WatchState::default()
                    }
                }
                Streamed::ToolArgs(delta) => state.args.push_str(delta),
            }
            if state.last.is_some_and(|at| at.elapsed() < SECTION_EVERY) {
                return;
            }
            // Decoded only when due: a few times a second, not per token.
            let text = if state.args.is_empty() {
                state.reply.trim().to_string()
            } else {
                partial_string_value(&state.args, "\"markdown\"")
            };
            if text.len() == state.sent || text.trim().is_empty() {
                return;
            }
            state.sent = text.len();
            state.last = Some(std::time::Instant::now());
            text
        };
        let skip = text.chars().count().saturating_sub(SECTION_TAIL);
        let text = match text.char_indices().nth(skip) {
            Some((at, _)) if skip > 0 => text[at..].to_string(),
            _ => text,
        };
        (self.send)(PaperEvent::SectionText {
            index: self.index,
            text,
        });
    }
}

/// The string value of `key` in JSON that is still arriving, unescaped as
/// far as it has come: an escape cut in half is left for the next time.
pub(crate) fn partial_string_value(json: &str, key: &str) -> String {
    let Some(at) = json.find(key) else {
        return String::new();
    };
    let rest = json[at + key.len()..].trim_start();
    let Some(rest) = rest.strip_prefix(':').map(str::trim_start) else {
        return String::new();
    };
    let Some(body) = rest.strip_prefix('"') else {
        return String::new();
    };
    let mut out = String::with_capacity(body.len());
    let mut chars = body.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => break,
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => {}
                Some('u') => {
                    let hex: String = chars.by_ref().take(4).collect();
                    match u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                        Some(c) if hex.len() == 4 => out.push(c),
                        // A surrogate pair or a cut escape: left out.
                        _ => {}
                    }
                }
                Some(other) => out.push(other),
                None => break,
            },
            c => out.push(c),
        }
    }
    out
}
