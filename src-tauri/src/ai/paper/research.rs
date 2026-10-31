//! A paper's research: the topic split into questions, then a helper per
//! question - four at a time - searching the web and the literature and
//! keeping what it finds as notes with add_note. The helpers share one
//! WebPlan, so a source has one number for the whole paper and the paper's
//! budget is spent by all of them together.

use super::{Dossier, Lead, LeadKind, Note, Paper, PaperEvent, PaperPhase, SharedBudget};
use crate::ai::web::WebPlan;
use aicompat::agent::{
    run_agent_loop, AgentTurn, StepResult, ToolCall, ToolOutput, ToolRun, ToolSpec,
};
use futures_util::future::BoxFuture;
use futures_util::stream::{self, StreamExt};
use serde_json::{json, Value};
use std::sync::Mutex;

/// Helpers researching at once.
const AT_ONCE: usize = 4;
/// A helper's steps: a few searches and reads, and its notes.
const HELPER_STEPS: usize = 10;
/// Questions the topic is split into, at least and at most.
const MIN_QUESTIONS: usize = 4;
const MAX_QUESTIONS: usize = 10;

pub(crate) const ADD_NOTE_TOOL: &str = "add_note";

/// One step of a model: what a stage's run asks of it. A trait, so the
/// stages run on a scripted model in tests.
pub(crate) trait Model: Sync {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>>;
}

impl Model for aicompat::providers::AgentProvider {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        // A helper's text and thinking aren't shown: the progress card is.
        Box::pin(async move {
            aicompat::providers::AgentProvider::step(self, instructions, turns, tools, &|_| {})
                .await
                .map(|(step, _)| step)
        })
    }
}

fn user(text: String) -> AgentTurn {
    AgentTurn::User {
        text,
        images: Vec::new(),
    }
}

/// The questions that cover `paper`'s topic, from one tool-less step.
pub(crate) async fn plan_questions(
    model: &dyn Model,
    paper: &Paper,
) -> Result<Vec<String>, String> {
    let instructions = format!(
        "You plan the research for a paper of about {} characters, written in the language tagged \"{}\". Split its topic into {MIN_QUESTIONS}-{MAX_QUESTIONS} research questions that together cover it in breadth and depth: background and definitions, how it works, the state of the art, the evidence and data, disputes and limits, cases, and where it is heading - as fits the topic. Each question is one sentence, specific enough to search for, and none repeats another. Reply with a JSON array of the questions as strings and nothing else.",
        paper.target_chars, paper.language
    );
    let reply = match model
        .step(
            &instructions,
            &[user(format!("Topic: {}", paper.topic))],
            &[],
        )
        .await?
    {
        StepResult::Done(text) => text,
        StepResult::ToolCalls(_) => String::new(),
    };
    let questions = parse_questions(&reply);
    if questions.len() < 2 {
        return Err("The research plan came back empty - try again.".into());
    }
    Ok(questions)
}

/// The questions in a reply: its JSON array of strings, or failing that its
/// list lines ("1. …", "- …").
pub(crate) fn parse_questions(reply: &str) -> Vec<String> {
    let from_json = reply
        .find('[')
        .zip(reply.rfind(']'))
        .and_then(|(a, b)| serde_json::from_str::<Vec<String>>(reply.get(a..=b)?).ok());
    let questions = from_json.unwrap_or_else(|| {
        reply
            .lines()
            .map(|l| {
                l.trim()
                    .trim_start_matches(|c: char| c.is_ascii_digit() || "-*.) ".contains(c))
            })
            .filter(|l| l.chars().count() > 8)
            .map(str::to_string)
            .collect()
    });
    let mut out: Vec<String> = Vec::new();
    for q in questions.into_iter().map(|q| q.trim().to_string()) {
        if !q.is_empty() && !out.contains(&q) {
            out.push(q);
        }
    }
    out.truncate(MAX_QUESTIONS);
    out
}

/// What add_note looks like to the model.
fn add_note_spec() -> ToolSpec {
    ToolSpec {
        name: ADD_NOTE_TOOL.into(),
        description: "Keep one finding for the paper: a claim, the evidence for it, and the sources it rests on. Call it once per finding as you go - several calls in one step are fine. Only what you keep with add_note reaches the paper; your replies don't.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "claim": {"type": "string", "description": "The finding, in one or two sentences"},
                "evidence": {"type": "string", "description": "What supports it: figures, results, examples, with their dates"},
                "quote": {"type": "string", "description": "Words taken verbatim from a source, if worth quoting"},
                "sources": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Each source's number from the search or page results (\"3\"), or its full address when it has none"
                },
                "leads": {
                    "type": "array",
                    "description": "Pictures or data in the sources a figure could use",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["image", "data"]},
                            "description": {"type": "string"},
                            "url": {"type": "string"}
                        },
                        "required": ["kind", "description"]
                    }
                }
            },
            "required": ["claim", "evidence", "sources"]
        }),
    }
}

/// An add_note call as a note, or why it can't be one. Its sources must be
/// numbers the web plan has, or addresses (numbered here).
fn read_note(arguments: &str, question: &str, web: &WebPlan) -> Result<Note, String> {
    let args: Value = serde_json::from_str(arguments).map_err(|e| e.to_string())?;
    let text = |key: &str| args[key].as_str().unwrap_or("").trim().to_string();
    let (claim, evidence) = (text("claim"), text("evidence"));
    if claim.is_empty() || evidence.is_empty() {
        return Err("Pass `claim` and `evidence`.".into());
    }
    let cited: Vec<&str> = args["sources"]
        .as_array()
        .map(|list| list.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut sources = Vec::new();
    for c in &cited {
        match web.source_number(c) {
            Some(n) if !sources.contains(&n) => sources.push(n),
            Some(_) => {}
            None => return Err(format!("No source is numbered {c:?}: cite the number a search or page result has, or the page's full address.")),
        }
    }
    if sources.is_empty() {
        return Err("A note needs its sources: the numbers of the results it rests on. Search or read first.".into());
    }
    let leads = args["leads"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|l| {
            let kind = match l["kind"].as_str()? {
                "image" => LeadKind::Image,
                "data" => LeadKind::Data,
                _ => return None,
            };
            Some(Lead {
                kind,
                description: l["description"].as_str()?.trim().to_string(),
                url: l["url"].as_str().map(str::to_string),
            })
        })
        .collect();
    Ok(Note {
        id: String::new(),
        question: question.to_string(),
        claim,
        evidence,
        quote: Some(text("quote")).filter(|q| !q.is_empty()),
        sources,
        leads,
    })
}

/// One question's helper: its notes, in the order it kept them.
async fn research_question(
    model: &dyn Model,
    paper: &Paper,
    web: &WebPlan,
    question: &str,
) -> Result<Vec<Note>, String> {
    let instructions = format!(
        "You are one of several researchers gathering material for a paper on \"{}\", written in the language tagged \"{}\". Your part is one question. Search the web and the scholarly literature, read the best pages in full, and keep every finding that answers it with add_note - specific claims with figures, dates, names and results, not generalities; prefer primary and scholarly sources, and say where sources disagree. Aim for four to eight notes, written in the paper's language. Note pictures and data sets a figure could use as leads. When the question is covered, or the searches run out, reply with one short line.",
        paper.topic, paper.language
    );
    let mut specs: Vec<ToolSpec> = web.tools(question).iter().map(|t| t.spec.clone()).collect();
    specs.push(add_note_spec());
    let web_tools = web.tools(question);
    let notes = Mutex::new(Vec::new());
    let execute = |call: ToolCall| {
        let (web_tools, notes) = (&web_tools, &notes);
        async move {
            if call.name == ADD_NOTE_TOOL {
                return ToolOutput::from(match read_note(&call.arguments, question, web) {
                    Ok(note) => {
                        notes.lock().unwrap().push(note);
                        "Kept.".to_string()
                    }
                    Err(why) => why,
                });
            }
            match web_tools
                .iter()
                .find(|t| t.spec.name == call.name)
                .map(|t| &t.run)
            {
                Some(crate::ai::tools::Run::Async(run)) => run(call).await,
                _ => ToolOutput::from(format!("Unknown tool: {}", call.name)),
            }
        }
    };
    run_agent_loop(
        Vec::new(),
        user(format!("Your question: {question}")),
        HELPER_STEPS,
        |turns: Vec<AgentTurn>| {
            let (instructions, specs) = (&instructions, &specs);
            async move { model.step(instructions, &turns, specs).await }
        },
        execute,
        |name| {
            if name == ADD_NOTE_TOOL {
                ToolRun::InOrder
            } else {
                ToolRun::Concurrent
            }
        },
        |_| {},
    )
    .await?;
    Ok(notes.into_inner().unwrap())
}

/// The paper researched: its questions planned, then answered by helpers at
/// once. A helper that fails costs its question, not the paper; the paper
/// fails only when no helper kept a note.
pub(crate) async fn research(
    model: &dyn Model,
    paper: &Paper,
    web: &WebPlan,
    budget: &SharedBudget,
    send: &(dyn Fn(PaperEvent) + Sync),
) -> Result<Dossier, String> {
    send(PaperEvent::Phase {
        phase: PaperPhase::Planning,
    });
    let questions = plan_questions(model, paper).await?;
    send(PaperEvent::Phase {
        phase: PaperPhase::Researching,
    });
    let results: Vec<(String, Result<Vec<Note>, String>)> = stream::iter(questions)
        .map(|question| async move {
            let notes = research_question(model, paper, web, &question).await;
            let spent = budget.snapshot();
            send(PaperEvent::Budget {
                used: spent.used,
                remaining: spent.remaining(),
            });
            (question, notes)
        })
        .buffered(AT_ONCE)
        .collect()
        .await;
    let mut dossier = Dossier::default();
    for (question, result) in results {
        match result {
            Ok(notes) => dossier.notes.extend(notes),
            Err(message) => send(PaperEvent::Error {
                message: format!("{question}: {message}"),
                section: None,
            }),
        }
    }
    if dossier.notes.is_empty() {
        return Err("The research found nothing to write from - check the search service in Settings, or try a broader topic.".into());
    }
    for (i, note) in dossier.notes.iter_mut().enumerate() {
        note.id = format!("n{}", i + 1);
    }
    dossier.sources = web.sources();
    Ok(dossier)
}
