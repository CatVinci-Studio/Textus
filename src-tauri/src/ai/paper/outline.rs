//! A paper's outline, made from its dossier: a thesis, and per section its
//! key points, the notes it draws on, its length and its figures. The model
//! hands it over with submit_outline, which checks it and sends back what is
//! wrong until it holds; the user then edits and approves it.

use super::checks::counts_characters;
use super::genre::Scale;
use super::handover::{hand_over, Checked, Task};
use super::prompts;
use super::stream::{after_key, AfterKey, LastSent, ThinkingTail};
use super::{Dossier, FigureKind, Outline, Paper, PaperEvent};
use crate::ai::agent::Model;
use aicompat::agent::{ProviderEvent, ToolSpec};
use serde_json::json;
use std::sync::Mutex;
use std::time::Duration;

pub(crate) const SUBMIT_OUTLINE_TOOL: &str = "submit_outline";

/// The outline a paper of a given length is to have: how many sections,
/// and how many figures in all and from the web.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Shape {
    pub min_sections: usize,
    pub max_sections: usize,
    /// At least one figure for every this many sections; None for none.
    pub figure_every: Option<usize>,
    pub max_figures: usize,
    /// Web pictures: each needs a match on Commons, and too many crowd out
    /// the figures that carry the paper's own data.
    pub max_web: usize,
    /// Generated pictures the budget still allows.
    pub images: u32,
}

impl Shape {
    /// The shape of a paper of `target_chars` characters with `images`
    /// generated pictures left.
    #[cfg(test)]
    pub(crate) fn new(target_chars: u32, images: u32) -> Self {
        Self::of(&super::Genre::Paper.profile().scale, target_chars, images)
    }

    /// The shape of a piece of `scale` and `target_chars` characters:
    /// about one section per its `chars_per_section` - fewer, longer
    /// sections read as an argument; many short ones as a list.
    pub(crate) fn of(scale: &Scale, target_chars: u32, images: u32) -> Self {
        let per = scale.chars_per_section;
        let n = (target_chars.saturating_add(per / 2) / per) as usize;
        let (least, most) = scale.sections;
        let max_sections = n.clamp(least, most);
        let figures = scale.figure_every.is_some();
        Shape {
            min_sections: max_sections.saturating_sub(SECTIONS_SLACK).max(least),
            max_sections,
            figure_every: scale.figure_every,
            max_figures: if figures {
                max_sections + FIGURES_BEYOND_SECTIONS
            } else {
                0
            },
            max_web: if figures {
                max_sections.div_ceil(SECTIONS_PER_WEB_PICTURE)
            } else {
                0
            },
            images: if figures { images } else { 0 },
        }
    }

    fn min_figures(&self, sections: usize) -> usize {
        self.figure_every
            .map_or(0, |every| sections.div_ceil(every))
    }
}
use super::tuning::{
    FIGURES_BEYOND_SECTIONS, OUTLINE_LENGTH, OUTLINE_STEPS, SECTIONS_PER_WEB_PICTURE,
    SECTIONS_SLACK,
};

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
    if figures.len() < shape.min_figures(n) {
        out.push(format!(
            "{} figures for {n} sections: plan at least {} - diagrams, charts of the dossier's data, pictures.",
            figures.len(),
            shape.min_figures(n)
        ));
    }
    if figures.len() > shape.max_figures {
        out.push(format!(
            "{} figures: at most {} for a piece this long - keep the ones that carry the most.",
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
    let (least, most) = OUTLINE_LENGTH;
    let ratio = total as f64 / target.max(1) as f64;
    if n > 0 && !(least..=most).contains(&ratio) {
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

/// What the outline's step is told, for an outline shaped as `shape`.
pub(crate) fn instructions(paper: &Paper, shape: &Shape) -> String {
    let profile = paper.genre.profile();
    let unit = if counts_characters(&paper.language) {
        "characters"
    } else {
        "words"
    };
    let figures = match shape.figure_every {
        None => prompts::get("outline.no-figures").to_string(),
        Some(every) => prompts::fill(
            "outline.figures",
            &[
                (
                    "every",
                    &match every {
                        2 => "two".to_string(),
                        3 => "three".to_string(),
                        n => n.to_string(),
                    },
                ),
                ("max_figures", &shape.max_figures),
                ("max_web", &shape.max_web),
                ("images", &shape.images),
            ],
        ),
    };
    prompts::fill(
        "outline.instructions",
        &[
            ("genre", &profile.name),
            ("topic", &paper.topic),
            ("language", &paper.language),
            ("target", &target_units(paper)),
            ("unit", &unit),
            ("thesis", &profile.thesis),
            ("least", &shape.min_sections),
            ("most", &shape.max_sections),
            ("order", &profile.outline_order),
            ("figures", &figures),
        ],
    )
}

/// The outline for `paper` from its dossier.
pub(crate) async fn make_outline(
    model: &dyn Model,
    paper: &Paper,
    dossier: &Dossier,
    send: &(dyn Fn(PaperEvent) + Sync),
) -> Result<Outline, String> {
    let profile = paper.genre.profile();
    let shape = Shape::of(
        &profile.scale,
        paper.target_chars,
        paper.budget.remaining().images,
    );
    let instructions = instructions(paper, &shape);
    let message = format!(
        "Topic: {}\n\nThe research notes:\n{}",
        paper.topic,
        dossier_text(dossier)
    );
    let watch = OutlineWatch::new(send);
    let push = |streamed: ProviderEvent<'_>| watch.push(streamed);
    let task = Task {
        instructions: &instructions,
        message,
        tool: submit_outline_spec(),
        steps: OUTLINE_STEPS,
        watch: Some(&push),
    };
    let (kept, _) = hand_over(model, task, |arguments| {
        let outline: Outline = match serde_json::from_str(arguments) {
            Ok(outline) => outline,
            Err(e) => {
                return Checked::Refused(format!(
                    "The outline couldn't be read: {e}. Send it again."
                ))
            }
        };
        let wrong = problems(&outline, dossier, target_units(paper), &shape);
        if wrong.is_empty() {
            return Checked::Kept(outline);
        }
        // Seen in a live run's output, never in the app's.
        if cfg!(test) {
            eprintln!("paper: outline not kept: {}", wrong.join(" | "));
        }
        Checked::not_kept("outline", &wrong)
    })
    .await?;
    kept.ok_or_else(|| "No outline that holds came back - try again.".to_string())
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
const DRAFT_EVERY: Duration = Duration::from_millis(250);

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
    last: LastSent,
}

impl<'a> OutlineWatch<'a> {
    pub(crate) fn new(send: &'a (dyn Fn(PaperEvent) + Sync)) -> Self {
        Self {
            send,
            thinking: ThinkingTail::new(send),
            state: Mutex::new(DraftState::default()),
        }
    }

    pub(crate) fn push(&self, streamed: ProviderEvent<'_>) {
        let event = {
            let mut state = self.state.lock().unwrap();
            match streamed {
                ProviderEvent::Thinking(text) | ProviderEvent::Text(text) => {
                    drop(state);
                    self.thinking.push(text);
                    return;
                }
                ProviderEvent::ToolStart { .. } => {
                    let attempt = state.attempt + 1;
                    *state = DraftState {
                        attempt,
                        ..DraftState::default()
                    };
                }
                ProviderEvent::ToolArgs { delta, .. } => state.args.push_str(delta),
                ProviderEvent::Citation { .. } => return,
            }
            state.scan();
            let changed = state.sent != (state.thesis.clone(), state.titles.len());
            if !changed || !state.last.due(DRAFT_EVERY) {
                return;
            }
            state.last.now();
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
            let end = match after_key(&self.args[start + key.len()..]) {
                // The value hasn't all arrived: wait for more from the key.
                AfterKey::Pending | AfterKey::Text { end: None, .. } => {
                    self.scanned = start;
                    return;
                }
                AfterKey::Other { at } => at,
                AfterKey::Text {
                    text,
                    end: Some(end),
                } => {
                    if key == "\"thesis\"" {
                        self.thesis = Some(text).filter(|t| !t.trim().is_empty());
                    } else {
                        self.titles.push(text);
                    }
                    end
                }
            };
            self.scanned = start + key.len() + end;
        }
    }
}
