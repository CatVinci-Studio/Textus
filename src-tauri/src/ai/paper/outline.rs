//! A paper's outline, made from its dossier: a thesis, and per section its
//! key points, the notes it draws on, its length and its figures. The model
//! hands it over with submit_outline, which checks it and sends back what is
//! wrong until it holds; the user then edits and approves it.

use super::research::Model;
use super::{Dossier, FigureKind, Outline, Paper};
use aicompat::agent::{run_agent_loop, AgentTurn, ToolCall, ToolOutput, ToolRun, ToolSpec};
use serde_json::json;
use std::sync::Mutex;

pub(crate) const SUBMIT_OUTLINE_TOOL: &str = "submit_outline";

/// Sections a paper has, at least and at most.
const MIN_SECTIONS: usize = 3;
const MAX_SECTIONS: usize = 12;
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
/// nothing. `images_left`: the generated pictures the budget still allows.
pub(crate) fn problems(
    outline: &Outline,
    dossier: &Dossier,
    target: u32,
    images_left: u32,
) -> Vec<String> {
    let mut out = Vec::new();
    if outline.thesis.trim().is_empty() {
        out.push(
            "`thesis` is empty: state what the paper argues or explains in one or two sentences."
                .to_string(),
        );
    }
    let n = outline.sections.len();
    if !(MIN_SECTIONS..=MAX_SECTIONS).contains(&n) {
        out.push(format!(
            "{n} sections: a paper this long has {MIN_SECTIONS}-{MAX_SECTIONS}."
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
) -> Result<Outline, String> {
    let target = target_units(paper);
    let unit = if counts_characters(&paper.language) {
        "characters"
    } else {
        "words"
    };
    let images_left = paper.budget.remaining().images;
    let instructions = format!(
        "You outline a paper on \"{}\", written in the language tagged \"{}\", of about {target} {unit}, from the research notes the user's researchers gathered. Give it a thesis and {MIN_SECTIONS}-{MAX_SECTIONS} sections in an order that builds an argument: from context to mechanism, evidence, disputes and outlook, as the topic needs - not a list of the questions. Every section draws on the notes that support it, by id; use every strong note somewhere, and give no section points the notes can't support. Its `targetWords` is its length in {unit}; together about {target}. Plan figures that carry information, at least one for every two sections: `mermaid` for a process, structure, timeline or comparison (say what it shows); `chart` for numbers in the notes (name the notes and the numbers); `web` for a real photograph or figure a note's image lead points to (say which); `generated` for an illustration only a picture can give (describe it), at most {images_left} of them. Write titles, key points and specs in the paper's language. Hand it over with submit_outline.",
        paper.topic, paper.language
    );
    let message = format!(
        "Topic: {}\n\nThe research notes:\n{}",
        paper.topic,
        dossier_text(dossier)
    );
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
            let wrong = problems(&outline, dossier, target, images_left);
            if !wrong.is_empty() {
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
            async move { model.step(instructions, &turns, specs).await }
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
