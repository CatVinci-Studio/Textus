//! A drafted paper reviewed as a whole, before any of it is proposed: a
//! reader who sees every section at once reports what only the whole shows -
//! repetition, contradictions, a key point no section made, a figure the text
//! never mentions, a claim stronger than its notes. Each section with points
//! against it is revised once by its writer; a revision that doesn't hold
//! leaves the draft as it was.

use super::draft::write_section;
use super::handover::{hand_over, Checked, Task};
use super::prompts;
use super::{Dossier, Outline, Paper, PaperEvent};
use crate::ai::agent::Model;
use aicompat::agent::ToolSpec;
use futures_util::stream::{self, StreamExt};
use serde_json::{json, Value};

pub(crate) const REPORT_ISSUES_TOOL: &str = "report_issues";

use super::tuning::{MAX_POINTS_PER_SECTION as MAX_PER_SECTION, REVIEW_STEPS};

/// One point against a section.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Issue {
    /// The section's index in the outline, from 0.
    pub section: usize,
    pub problem: String,
    pub fix: String,
}

fn report_issues_spec() -> ToolSpec {
    ToolSpec {
        name: REPORT_ISSUES_TOOL.into(),
        description: "Report what needs fixing, once, as a list - empty if nothing does.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "issues": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "section": {"type": "integer", "description": "The section's number, from 1"},
                            "problem": {"type": "string"},
                            "fix": {"type": "string", "description": "What its writer should do"}
                        },
                        "required": ["section", "problem", "fix"]
                    }
                }
            },
            "required": ["issues"]
        }),
    }
}

/// A report_issues call's points, in the reviewer's order, at most
/// MAX_PER_SECTION a section; or why it can't be read.
pub(crate) fn read_issues(arguments: &str, sections: usize) -> Result<Vec<Issue>, String> {
    let args: Value = serde_json::from_str(arguments).map_err(|e| e.to_string())?;
    let list = args["issues"]
        .as_array()
        .ok_or("Pass `issues`, a list (empty if nothing needs fixing).")?;
    let mut out: Vec<Issue> = Vec::new();
    for item in list {
        let number = item["section"].as_u64().unwrap_or(0) as usize;
        if number == 0 || number > sections {
            return Err(format!(
                "There is no section {number}: they are numbered 1 to {sections}."
            ));
        }
        let text = |key: &str| item[key].as_str().unwrap_or("").trim().to_string();
        let (problem, fix) = (text("problem"), text("fix"));
        if problem.is_empty()
            || out.iter().filter(|i| i.section == number - 1).count() >= MAX_PER_SECTION
        {
            continue;
        }
        out.push(Issue {
            section: number - 1,
            problem,
            fix,
        });
    }
    Ok(out)
}

/// What the reviewer is told.
pub(crate) fn instructions(paper: &Paper) -> String {
    let profile = paper.genre.profile();
    prompts::fill(
        "review.instructions",
        &[
            ("genre", &profile.name),
            ("language", &paper.language),
            ("review_for", &profile.review_for),
        ],
    )
}

/// The reviewer's message: the thesis, the outline and the drafts.
pub(crate) fn message(outline: &Outline, sections: &[String]) -> String {
    let outline_text: Vec<String> = outline
        .sections
        .iter()
        .enumerate()
        .map(|(i, s)| format!("{}. {} - {}", i + 1, s.title, s.key_points.join("; ")))
        .collect();
    let drafts: Vec<String> = sections
        .iter()
        .enumerate()
        .map(|(i, s)| format!("<section number=\"{}\">\n{s}\n</section>", i + 1))
        .collect();
    prompts::fill(
        "review.message",
        &[
            ("thesis", &outline.thesis),
            ("outline", &outline_text.join("\n")),
            ("drafts", &drafts.join("\n\n")),
        ],
    )
}

/// The points against the drafted `sections` (each under its heading). A
/// reviewer that reports nothing it can read has no points: the drafts
/// passed their own checks.
pub(crate) async fn review(
    model: &dyn Model,
    paper: &Paper,
    outline: &Outline,
    sections: &[String],
) -> Result<Vec<Issue>, String> {
    let instructions = instructions(paper);
    let message = message(outline, sections);
    let task = Task {
        instructions: &instructions,
        message,
        tool: report_issues_spec(),
        steps: REVIEW_STEPS,
        watch: None,
    };
    let (issues, _) = hand_over(model, task, |arguments| {
        match read_issues(arguments, sections.len()) {
            Ok(issues) => Checked::Kept(issues),
            Err(why) => Checked::Refused(format!("Not read: {why} Report again.")),
        }
    })
    .await?;
    Ok(issues.unwrap_or_default())
}

/// The points against the drafted `sections`: the review's, and those of
/// the check of every cited sentence against its notes (`claims`), run at
/// once. A review that fails leaves the check's.
pub(crate) async fn review_all(
    model: &dyn Model,
    paper: &Paper,
    outline: &Outline,
    dossier: &Dossier,
    sections: &[String],
) -> Vec<Issue> {
    let (reviewed, checked) = futures_util::join!(
        review(model, paper, outline, sections),
        super::claims::check_claims(model, paper, dossier, sections)
    );
    let mut issues = checked;
    issues.extend(reviewed.unwrap_or_default());
    issues
}

/// `sections` with each one `issues` names revised once, as many at a time as
/// the model takes.
/// `revising` hears of each as it begins; a revision that fails leaves the
/// draft. Returns which sections changed.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn revise(
    model: &dyn Model,
    paper: &Paper,
    outline: &Outline,
    dossier: &Dossier,
    sections: &mut [String],
    issues: &[Issue],
    revising: &(dyn Fn(usize) + Sync),
    send: &(dyn Fn(PaperEvent) + Sync),
    draw: Option<super::figures::Draw<'_>>,
) -> Vec<usize> {
    let mut named: Vec<usize> = issues.iter().map(|i| i.section).collect();
    named.sort_unstable();
    named.dedup();
    let drafts: &[String] = sections;
    let revised: Vec<(usize, Result<String, String>)> = stream::iter(named)
        .map(|i| async move {
            revising(i);
            let points: Vec<String> = issues
                .iter()
                .filter(|x| x.section == i)
                .map(|x| format!("{} - {}", x.problem, x.fix))
                .collect();
            // The draft without its heading, as the writer handed it over.
            let body = drafts[i].split_once("\n\n").map_or("", |(_, b)| b);
            (
                i,
                write_section(
                    model,
                    paper,
                    outline,
                    i,
                    dossier,
                    Some((body, &points)),
                    send,
                    draw,
                )
                .await,
            )
        })
        .buffer_unordered(model.at_once())
        .collect()
        .await;
    let mut changed = Vec::new();
    for (i, result) in revised {
        if let Ok(text) = result {
            sections[i] = text;
            changed.push(i);
        }
    }
    changed.sort_unstable();
    changed
}
