//! A paper drafted from its approved outline: a writer per section, three at
//! a time, each with the thesis, what the other sections cover, and its own
//! notes and their sources. A writer hands its section over with
//! submit_section, which checks its length, its citations and its figures and
//! sends back what is wrong. Sections are handed on in the outline's order,
//! each as it and those before it are done.

#[cfg(test)]
pub(crate) use super::checks::prose_length;
use super::checks::*;
pub(crate) use super::checks::{cited_link, is_soft, length, most, problems, WEB_FIGURE_MARK};
use super::research::{Model, Streamed};
use super::{Dossier, FigureKind, FigurePlan, Outline, OutlineSection, Paper, PaperEvent};
use aicompat::agent::{run_agent_loop, AgentTurn, ToolCall, ToolOutput, ToolRun, ToolSpec};
use futures_util::stream::{self, StreamExt};
use serde_json::{json, Value};
use std::sync::Mutex;

pub(crate) const SUBMIT_SECTION_TOOL: &str = "submit_section";

/// Sections written at once.
const AT_ONCE: usize = 3;
/// A writer's tries at a section that holds.
const WRITER_STEPS: usize = 5;
/// How each kind of figure is written into the section.
fn figure_line(figure: &FigurePlan) -> String {
    let how = match figure.kind {
        FigureKind::Mermaid => "a ```mermaid block narrow enough for a page's column: a flowchart top-down (TB) with at most four boxes side by side and short labels, a timeline as `timeline`, each period's further events on lines of their own starting with `:`",
        FigureKind::Chart => "a ```chart block: JSON {\"type\": \"bar\"|\"line\"|\"area\"|\"pie\"|\"scatter\", \"title\", \"x\", \"y\", \"labels\": [...], \"series\": [{\"name\", \"data\": [numbers]}], \"caption\", \"source\"}, with the notes' own numbers only - \"x\" and \"y\" are the axes' titles, \"labels\" one category per number, \"source\" the sources cited as [n](address), never the notes' ids",
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
        "You write one section of a paper, in the language tagged \"{}\": substantial, specific prose for an informed reader - the notes' figures, dates, names and findings, explained and connected into an argument that serves the thesis, not a list of facts. Say where sources disagree and what the evidence can't show. Don't repeat what the other sections cover; you may point to them. Mark every fact from a note with its source right after it as [n](address), exactly as the note gives it, and cite nothing else. Use ### subheadings if the section is long; don't write the section's own heading. Its length counts {unit}, figures and code aside. Put each planned figure where it belongs, with a sentence in the text that refers to it as the diagram, chart or picture below or above - never by a number, since the figures are numbered afterwards. Write only about the topic, never about how it was researched: no searches, budgets, sources that couldn't be read or checked, or keywords to look up; with few notes, write a shorter section rather than fill it. Hand it over by calling submit_section with the whole section - never write the section in your reply.",
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
    // The latest section handed over at all: kept, repaired, if no try
    // holds or is only soft - a paper with one weaker section beats one
    // that stops there.
    let last: Mutex<Option<String>> = Mutex::new(None);
    let specs = vec![submit_section_spec()];
    let execute = |call: ToolCall| {
        let (kept, soft, last, sources) = (&kept, &soft, &last, &sources);
        async move {
            let args: Value = serde_json::from_str(&call.arguments).unwrap_or_default();
            let markdown = args["markdown"].as_str().unwrap_or("").trim().to_string();
            let wrong = problems(&markdown, section, sources, &paper.language);
            if !markdown.is_empty() {
                *last.lock().unwrap() = Some(markdown.clone());
            }
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
        // A revision that never holds keeps the draft it would replace.
        .or_else(|| {
            revision.is_none().then_some(())?;
            let text = last
                .into_inner()
                .unwrap()
                .or_else(|| reply_body(&turns).map(str::to_string))?;
            if cfg!(test) {
                eprintln!("paper: \"{}\" kept repaired", section.title);
            }
            Some(repaired(&text, &sources))
        })
        .ok_or_else(|| format!("\"{}\" wasn't written in a form that holds.", section.title))?;
    Ok(format!(
        "## {}\n\n{}",
        section.title,
        super::timeline::upright_timelines(&body)
    ))
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
    let body = reply_body(turns)?;
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

/// The writer's last reply, without the heading it may have given it; None
/// when it wrote nothing.
fn reply_body(turns: &[AgentTurn]) -> Option<&str> {
    let reply = turns.iter().rev().find_map(|t| match t {
        AgentTurn::Assistant { text, .. } => Some(text.trim()),
        _ => None,
    })?;
    let body = match reply.split_once('\n') {
        Some((first, rest)) if first.trim_start().starts_with('#') => rest.trim(),
        _ => reply,
    };
    (!body.is_empty()).then_some(body)
}

/// A section whose writer never got it to hold, made safe to keep: each
/// citation linked to its source's address, or left out when it names no
/// source of the section, and each chart that can't be drawn taken out.
/// Its length and its figures stay as written.
pub(crate) fn repaired(markdown: &str, sources: &[(u32, String)]) -> String {
    let address = |n: &str| {
        let n: u32 = n.parse().ok()?;
        sources.iter().find(|(m, _)| *m == n).map(|(_, url)| url)
    };
    let linked = cited_link().replace_all(markdown, |c: &regex::Captures| match address(&c[1]) {
        Some(url) => format!("[{}]({url})", &c[1]),
        None => String::new(),
    });
    let mut out: Vec<String> = Vec::new();
    let mut chart: Option<Vec<String>> = None;
    let mut in_fence = false;
    for line in linked.split('\n') {
        let fence = line.trim_start().starts_with("```");
        if let Some(block) = chart.as_mut() {
            block.push(line.to_string());
            if fence {
                let body = block[1..block.len() - 1].join("\n");
                let block = chart.take().unwrap();
                if chart_holds(&body).is_ok() {
                    out.extend(block);
                }
            }
            continue;
        }
        if fence && !in_fence && line.trim_start().trim_start_matches('`').trim() == "chart" {
            chart = Some(vec![line.to_string()]);
            continue;
        }
        if fence {
            in_fence = !in_fence;
        }
        if in_fence || fence {
            out.push(line.to_string());
            continue;
        }
        out.push(
            bare_number()
                .replace_all(line, |c: &regex::Captures| match address(&c[1]) {
                    Some(url) => format!("[{}]({url}){}", &c[1], &c[2]),
                    None => c[2].to_string(),
                })
                .into_owned(),
        );
    }
    let mut text = out.join("\n");
    while text.contains("\n\n\n") {
        text = text.replace("\n\n\n", "\n\n");
    }
    text.trim().to_string()
}

/// Every section of `outline` written, three at a time, and handed to
/// `drafted` in order: section n once it and every one before it is done.
/// One `written` has already (by a run that stopped) is handed on as it is.
/// `started` hears of each as its writer begins. A section that fails stops
/// the ones after it from being handed on, since the paper would have a gap.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn draft(
    model: &dyn Model,
    paper: &Paper,
    outline: &Outline,
    dossier: &Dossier,
    written: &[Option<String>],
    started: &(dyn Fn(usize) + Sync),
    drafted: &mut (dyn FnMut(usize, &str) -> Result<(), String> + Send),
    send: &(dyn Fn(PaperEvent) + Sync),
) -> Result<(), String> {
    let mut sections = stream::iter(0..outline.sections.len())
        .map(|i| async move {
            if let Some(text) = written.get(i).cloned().flatten() {
                return (i, Ok(text));
            }
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

/// The least time between two SectionText events for one section.
const SECTION_EVERY: std::time::Duration = std::time::Duration::from_millis(300);

/// Watches a writer's stream and sends what it has written so far, whole,
/// as SectionText - the document shows it as it comes: the `markdown` of the submit_section call it is making, or
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
