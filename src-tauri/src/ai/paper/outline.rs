//! A paper's outline, made from its dossier: a thesis, and per section its
//! key points, the notes it draws on, its length and its figures. The model
//! hands it over with submit_outline, which checks it and sends back what is
//! wrong until it holds; the user then edits and approves it.

use super::research::{Model, Streamed, ThinkingTail};
use super::{Dossier, FigureKind, Outline, Paper, PaperEvent};
use aicompat::agent::{run_agent_loop, AgentTurn, ToolCall, ToolOutput, ToolRun, ToolSpec};
use serde_json::json;
use std::sync::Mutex;

pub(crate) const SUBMIT_OUTLINE_TOOL: &str = "submit_outline";

/// Sections a paper has, at least and at most, whatever its length.
const MIN_SECTIONS: usize = 3;
const MAX_SECTIONS: usize = 12;
/// About this many characters a section: fewer, longer sections read as an
/// argument; many short ones as a list.
const CHARS_PER_SECTION: u32 = 800;

/// The outline a paper of a given length is to have: how many sections,
/// and how many figures in all and from the web.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Shape {
    pub min_sections: usize,
    pub max_sections: usize,
    pub max_figures: usize,
    /// Web pictures: each needs a match on Commons, and too many crowd out
    /// the figures that carry the paper's own data.
    pub max_web: usize,
    /// Generated pictures the budget still allows.
    pub images: u32,
}

impl Shape {
    /// The shape of a paper of `target_chars` characters with `images`
    /// generated pictures left: about one section per CHARS_PER_SECTION.
    pub(crate) fn new(target_chars: u32, images: u32) -> Self {
        let n = ((target_chars + CHARS_PER_SECTION / 2) / CHARS_PER_SECTION) as usize;
        let max_sections = n.clamp(MIN_SECTIONS, MAX_SECTIONS);
        Shape {
            min_sections: max_sections.saturating_sub(2).max(MIN_SECTIONS),
            max_sections,
            max_figures: max_sections + 1,
            max_web: max_sections.div_ceil(3),
            images,
        }
    }
}
/// Tries at an outline that holds.
const OUTLINE_STEPS: usize = 5;

/// Whether `language` is written without spaces, so its length is counted
/// in characters rather than words.
fn counts_characters(language: &str) -> bool {
    ["zh", "ja", "ko"].iter().any(|l| language.starts_with(l))
}

/// The paper's length in the unit its sections' `targetWords` use: its
/// characters for Chinese, Japanese and Korean, else about a sixth of them
/// in words.
pub(crate) fn target_units(paper: &Paper) -> u32 {
    if counts_characters(&paper.language) {
        paper.target_chars
    } else {
        paper.target_chars / 6
    }
}

/// What is wrong with `outline` for this paper, every problem at once, or
/// nothing, for a paper of `target` units shaped as `shape` says.
pub(crate) fn problems(
    outline: &Outline,
    dossier: &Dossier,
    target: u32,
    shape: &Shape,
) -> Vec<String> {
    let images_left = shape.images;
    let mut out = Vec::new();
    if outline.thesis.trim().is_empty() {
        out.push(
            "`thesis` is empty: state what the paper argues or explains in one or two sentences."
                .to_string(),
        );
    }
    let n = outline.sections.len();
    if !(shape.min_sections..=shape.max_sections).contains(&n) {
        out.push(format!(
            "{n} sections: a paper this long has {}-{}, each long enough to develop its point.",
            shape.min_sections, shape.max_sections
        ));
    }
    let known = |id: &String| dossier.notes.iter().any(|note| &note.id == id);
    for (i, section) in outline.sections.iter().enumerate() {
        let name = format!("Section {} (\"{}\")", i + 1, section.title.trim());
        if section.title.trim().is_empty() {
            out.push(format!("Section {} has no title.", i + 1));
        }
        if section.key_points.iter().all(|p| p.trim().is_empty()) {
            out.push(format!("{name} has no key points."));
        }
        if section.target_words == 0 {
            out.push(format!("{name} has no length (`targetWords`)."));
        }
        let unknown: Vec<&String> = section.evidence.iter().filter(|id| !known(id)).collect();
        if !unknown.is_empty() {
            out.push(format!(
                "{name} draws on notes that don't exist: {unknown:?}. Use the ids in the dossier."
            ));
        }
        for figure in &section.figures {
            if figure.spec.trim().is_empty() {
                out.push(format!("{name} has a figure with no `spec`."));
            }
        }
    }
    let figures: Vec<_> = outline.sections.iter().flat_map(|s| &s.figures).collect();
    if figures.len() < n.div_ceil(2) {
        out.push(format!(
            "{} figures for {n} sections: plan at least {} - diagrams, charts of the dossier's data, pictures.",
            figures.len(),
            n.div_ceil(2)
        ));
    }
    if figures.len() > shape.max_figures {
        out.push(format!(
            "{} figures: at most {} for a paper this long - keep the ones that carry the most.",
            figures.len(),
            shape.max_figures
        ));
    }
    let web = figures.iter().filter(|f| f.kind == FigureKind::Web).count();
    if web > shape.max_web {
        out.push(format!(
            "{web} web pictures: at most {} - make the rest diagrams or charts of the notes' data.",
            shape.max_web
        ));
    }
    let generated = figures
        .iter()
        .filter(|f| f.kind == FigureKind::Generated)
        .count() as u32;
    if generated > images_left {
        out.push(format!(
            "{generated} generated pictures, but only {images_left} can be made: use Mermaid diagrams, charts or web pictures for the rest."
        ));
    }
    let total: u32 = outline.sections.iter().map(|s| s.target_words).sum();
    if n > 0 && (total < target / 2 || total > target * 8 / 5) {
        out.push(format!(
            "The sections' lengths add up to {total}; the paper is about {target}."
        ));
    }
    out
}

/// The dossier as the outline's model reads it: one note a line.
pub(crate) fn dossier_text(dossier: &Dossier) -> String {
    dossier
        .notes
        .iter()
        .map(|note| {
            let sources: Vec<String> = note.sources.iter().map(|n| format!("[{n}]")).collect();
            let leads: Vec<String> = note
                .leads
                .iter()
                .map(|l| format!("{:?} lead: {}", l.kind, l.description).to_lowercase())
                .collect();
            let mut line = format!(
                "{} - {} {} Evidence: {}",
                note.id,
                note.claim,
                sources.join(""),
                note.evidence
            );
            if !leads.is_empty() {
                line.push_str(&format!(" ({})", leads.join("; ")));
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn submit_outline_spec() -> ToolSpec {
    ToolSpec {
        name: SUBMIT_OUTLINE_TOOL.into(),
        description: "Hand over the paper's outline. It is checked: if anything is wrong you are told what, and call this again with the whole outline corrected.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "thesis": {"type": "string", "description": "What the paper argues or explains, in one or two sentences"},
                "sections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "keyPoints": {"type": "array", "items": {"type": "string"}},
                            "evidence": {"type": "array", "items": {"type": "string"}, "description": "The ids of the dossier notes it draws on, like \"n3\""},
                            "targetWords": {"type": "integer", "description": "Its length"},
                            "figures": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "kind": {"type": "string", "enum": ["generated", "mermaid", "chart", "web"]},
                                        "spec": {"type": "string"}
                                    },
                                    "required": ["kind", "spec"]
                                }
                            }
                        },
                        "required": ["title", "keyPoints", "evidence", "targetWords", "figures"]
                    }
                }
            },
            "required": ["thesis", "sections"]
        }),
    }
}

/// The outline for `paper` from its dossier.
pub(crate) async fn make_outline(
    model: &dyn Model,
    paper: &Paper,
    dossier: &Dossier,
    send: &(dyn Fn(PaperEvent) + Sync),
) -> Result<Outline, String> {
    let target = target_units(paper);
    let unit = if counts_characters(&paper.language) {
        "characters"
    } else {
        "words"
    };
    let shape = Shape::new(paper.target_chars, paper.budget.remaining().images);
    let (images_left, min_sections, max_sections, max_figures, max_web) = (
        shape.images,
        shape.min_sections,
        shape.max_sections,
        shape.max_figures,
        shape.max_web,
    );
    let instructions = format!(
        "You outline a paper on \"{}\", written in the language tagged \"{}\", of about {target} {unit}, from the research notes the user's researchers gathered. Give it a thesis and {min_sections}-{max_sections} sections, each long enough to develop its point, in an order that builds an argument: from context to mechanism, evidence, disputes and outlook, as the topic needs - not a list of the questions. Every section draws on the notes that support it, by id; use every strong note somewhere, and give no section points the notes can't support. Its `targetWords` is its length in {unit}; together about {target}. Plan figures that carry information - at least one for every two sections and at most {max_figures} in all: `mermaid` for a process, structure, timeline or comparison (say what it shows); `chart` for numbers in the notes (name the notes and the numbers); `web` for a real photograph of something Wikimedia Commons would have, at most {max_web}; `generated` for an illustration only a picture can give (describe it), at most {images_left} of them. Write titles, key points and specs in the paper's language. Hand it over with submit_outline.",
        paper.topic, paper.language
    );
    let message = format!(
        "Topic: {}\n\nThe research notes:\n{}",
        paper.topic,
        dossier_text(dossier)
    );
    let watch = OutlineWatch::new(send);
    let kept: Mutex<Option<Outline>> = Mutex::new(None);
    let specs = vec![submit_outline_spec()];
    let execute = |call: ToolCall| {
        let kept = &kept;
        async move {
            let outline: Outline = match serde_json::from_str(&call.arguments) {
                Ok(outline) => outline,
                Err(e) => {
                    return ToolOutput::from(format!(
                        "The outline couldn't be read: {e}. Send it again."
                    ))
                }
            };
            let wrong = problems(&outline, dossier, target, &shape);
            if !wrong.is_empty() {
                // Seen in a live run's output, never in the app's.
                if cfg!(test) {
                    eprintln!("paper: outline not kept: {}", wrong.join(" | "));
                }
                return ToolOutput::from(format!(
                    "Not kept - fix these and send the whole outline again:\n- {}",
                    wrong.join("\n- ")
                ));
            }
            *kept.lock().unwrap() = Some(outline);
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
            text: message,
            images: Vec::new(),
        },
        OUTLINE_STEPS,
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
    kept.into_inner()
        .unwrap()
        .ok_or_else(|| "No outline that holds came back - try again.".to_string())
}

/// The user's edit of an outline, made safe to draft from: blank key points
/// and notes the dossier doesn't have dropped. Refused without a section, or
/// with a section without a title.
pub(crate) fn as_edited(mut outline: Outline, dossier: &Dossier) -> Result<Outline, String> {
    if outline.sections.is_empty() {
        return Err("The outline needs at least one section.".into());
    }
    for section in &mut outline.sections {
        section.title = section.title.trim().to_string();
        if section.title.is_empty() {
            return Err("Every section needs a title.".into());
        }
        section.key_points.retain(|p| !p.trim().is_empty());
        section
            .evidence
            .retain(|id| dossier.notes.iter().any(|n| &n.id == id));
        section.figures.retain(|f| !f.spec.trim().is_empty());
    }
    Ok(outline)
}

/// The least time between two OutlineDraft events.
const DRAFT_EVERY: std::time::Duration = std::time::Duration::from_millis(250);

/// Watches the outliner's stream: its thinking sent as Thinking, and the
/// outline it is writing as OutlineDraft - read from submit_outline's
/// arguments as they stream, a few times a second at most.
pub(crate) struct OutlineWatch<'a> {
    send: &'a (dyn Fn(PaperEvent) + Sync),
    thinking: ThinkingTail<'a>,
    state: Mutex<DraftState>,
}

#[derive(Default)]
struct DraftState {
    attempt: u32,
    args: String,
    /// Where scanning `args` picks up: everything before it is read.
    scanned: usize,
    thesis: Option<String>,
    titles: Vec<String>,
    sent: (Option<String>, usize),
    last: Option<std::time::Instant>,
}

impl<'a> OutlineWatch<'a> {
    pub(crate) fn new(send: &'a (dyn Fn(PaperEvent) + Sync)) -> Self {
        Self {
            send,
            thinking: ThinkingTail::new(send),
            state: Mutex::new(DraftState::default()),
        }
    }

    pub(crate) fn push(&self, streamed: Streamed<'_>) {
        let event = {
            let mut state = self.state.lock().unwrap();
            match streamed {
                Streamed::Thought(text) => {
                    drop(state);
                    self.thinking.push(text);
                    return;
                }
                Streamed::ToolStart => {
                    let attempt = state.attempt + 1;
                    *state = DraftState {
                        attempt,
                        ..DraftState::default()
                    };
                }
                Streamed::ToolArgs(delta) => state.args.push_str(delta),
            }
            state.scan();
            let changed = state.sent != (state.thesis.clone(), state.titles.len());
            let due = state.last.is_none_or(|at| at.elapsed() >= DRAFT_EVERY);
            if !changed || !due {
                return;
            }
            state.last = Some(std::time::Instant::now());
            state.sent = (state.thesis.clone(), state.titles.len());
            PaperEvent::OutlineDraft {
                attempt: state.attempt,
                thesis: state.thesis.clone(),
                titles: state.titles.clone(),
            }
        };
        (self.send)(event);
    }
}

impl DraftState {
    /// Reads the whole `"thesis"` and `"title"` strings that arrived since
    /// the last scan. Each fragment is scanned once, from the last key on,
    /// so a long outline costs no more than its length.
    fn scan(&mut self) {
        loop {
            let rest = &self.args[self.scanned..];
            let Some((key, at)) = ["\"thesis\"", "\"title\""]
                .iter()
                .filter_map(|k| rest.find(k).map(|i| (*k, i)))
                .min_by_key(|(_, i)| *i)
            else {
                // Keep the tail that may be a key cut in half.
                self.scanned = self.args.len().saturating_sub(8);
                while !self.args.is_char_boundary(self.scanned) {
                    self.scanned -= 1;
                }
                return;
            };
            let start = self.scanned + at;
            let Some((value, end)) = json_string_after(&self.args[start + key.len()..]) else {
                // The value hasn't all arrived: wait for more from the key.
                self.scanned = start;
                return;
            };
            match value {
                Some(thesis) if key == "\"thesis\"" => {
                    self.thesis = Some(thesis).filter(|t| !t.trim().is_empty());
                }
                Some(title) => self.titles.push(title),
                None => {}
            }
            self.scanned = start + key.len() + end;
        }
    }
}

/// The value after a key at the start of `text`: Some((Some(string),
/// end)) for a whole string, unescaped; Some((None, end)) for anything
/// else, skipped; None while the string is still arriving.
fn json_string_after(text: &str) -> Option<(Option<String>, usize)> {
    let colon = text.find(|c: char| !c.is_whitespace())?;
    if !text[colon..].starts_with(':') {
        return Some((None, colon));
    }
    let open = colon + 1 + text[colon + 1..].find(|c: char| !c.is_whitespace())?;
    if !text[open..].starts_with('"') {
        return Some((None, open));
    }
    let mut escaped = false;
    for (i, c) in text[open + 1..].char_indices() {
        match c {
            _ if escaped => escaped = false,
            '\\' => escaped = true,
            '"' => {
                let end = open + 1 + i + 1;
                return Some((serde_json::from_str(&text[open..end]).ok(), end));
            }
            _ => {}
        }
    }
    None
}
