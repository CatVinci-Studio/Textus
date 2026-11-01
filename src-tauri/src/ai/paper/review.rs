//! A drafted paper reviewed as a whole, before any of it is proposed: a
//! reader who sees every section at once reports what only the whole shows -
//! repetition, contradictions, a key point no section made, a figure the text
//! never mentions, a claim stronger than its notes. Each section with points
//! against it is revised once by its writer; a revision that doesn't hold
//! leaves the draft as it was.

use super::draft::write_section;
use super::research::Model;
use super::{Dossier, Outline, Paper, PaperEvent};
use aicompat::agent::{run_agent_loop, AgentTurn, ToolCall, ToolOutput, ToolRun, ToolSpec};
use futures_util::stream::{self, StreamExt};
use serde_json::{json, Value};
use std::sync::Mutex;

pub(crate) const REPORT_ISSUES_TOOL: &str = "report_issues";

/// Tries at a report that reads.
const REVIEW_STEPS: usize = 3;
/// Points kept against one section: the most important, as the reviewer
/// ordered them.
const MAX_PER_SECTION: usize = 3;
/// Sections revised at once.
const AT_ONCE: usize = 3;

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

/// The points against the drafted `sections` (each under its heading). A
/// reviewer that reports nothing it can read has no points: the drafts
/// passed their own checks.
pub(crate) async fn review(
    model: &dyn Model,
    paper: &Paper,
    outline: &Outline,
    sections: &[String],
) -> Result<Vec<Issue>, String> {
    let instructions = format!(
        "You review a drafted paper, in the language tagged \"{}\", before the author sees it. Each section was written apart and has passed checks of its length, its citations and its figures; find what only reading them together shows: the same material in two sections, sections that contradict each other, a key point of the outline that no section makes, a figure the text never refers to, a claim stronger than what it cites, a section that doesn't connect to the thesis or to the one before it. Report only what is worth a revision, most important first, with what its writer should do - not style preferences. Report with report_issues once; an empty list if the paper needs nothing.",
        paper.language
    );
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
    let message = format!(
        "Thesis: {}\n\nThe outline:\n{}\n\nThe drafts:\n{}",
        outline.thesis,
        outline_text.join("\n"),
        drafts.join("\n\n")
    );
    let found: Mutex<Option<Vec<Issue>>> = Mutex::new(None);
    let specs = vec![report_issues_spec()];
    let execute = |call: ToolCall| {
        let found = &found;
        async move {
            match read_issues(&call.arguments, sections.len()) {
                Ok(issues) => {
                    *found.lock().unwrap() = Some(issues);
                    ToolOutput {
                        text: "Reported. Reply with one short line.".into(),
                        settled: true,
                        ..ToolOutput::default()
                    }
                }
                Err(why) => ToolOutput::from(format!("Not read: {why} Report again.")),
            }
        }
    };
    run_agent_loop(
        Vec::new(),
        AgentTurn::User {
            text: message,
            images: Vec::new(),
        },
        REVIEW_STEPS,
        |turns: Vec<AgentTurn>| {
            let (instructions, specs) = (&instructions, &specs);
            async move { model.step(instructions, &turns, specs).await }
        },
        execute,
        |_| ToolRun::InOrder,
        |_| {},
    )
    .await?;
    Ok(found.into_inner().unwrap().unwrap_or_default())
}

/// `sections` with each one `issues` names revised once, three at a time.
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
                )
                .await,
            )
        })
        .buffer_unordered(AT_ONCE)
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
