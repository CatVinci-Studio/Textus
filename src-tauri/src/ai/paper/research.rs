//! A paper's research: the topic split into questions, then a helper per
//! question - four at a time - searching the web and the literature and
//! keeping what it finds as notes with add_note. The helpers share one
//! WebPlan, so a source has one number for the whole paper and the paper's
//! budget is spent by all of them together.

use super::{
    ActivityKind, Dossier, Lead, LeadKind, Note, Paper, PaperEvent, PaperPhase, SharedBudget,
};
use crate::ai::web::WebPlan;
use aicompat::agent::{
    run_agent_loop, AgentTurn, StepResult, ToolCall, ToolOutput, ToolRun, ToolSpec,
};
use futures_util::future::BoxFuture;
use futures_util::stream::{self, StreamExt};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Mutex;

/// Helpers researching at once.
const AT_ONCE: usize = 4;
/// A helper's steps: a few searches and reads, and its notes.
const HELPER_STEPS: usize = 10;
/// Questions the topic is split into, at least and at most.
const MIN_QUESTIONS: usize = 4;
const MAX_QUESTIONS: usize = 10;

pub(crate) const ADD_NOTE_TOOL: &str = "add_note";
pub(crate) const SEARCH_REFERENCES_TOOL: &str = "search_references";
pub(crate) const READ_REFERENCE_TOOL: &str = "read_reference";

/// What a path can't hold inside a Markdown link: spaces, brackets,
/// parentheses, `%` and control characters (and, as always, non-ASCII).
const LINK_UNSAFE: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
    .add(b' ')
    .add(b'(')
    .add(b')')
    .add(b'[')
    .add(b']')
    .add(b'<')
    .add(b'>')
    .add(b'%');

/// What a web address can't hold inside a Markdown link, `%` aside so an
/// escape already in it stays as it is: a DOI like 10.1061/40927(243)238
/// cut the citation short at its `)`.
const WEB_LINK_UNSAFE: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
    .add(b' ')
    .add(b'(')
    .add(b')')
    .add(b'<')
    .add(b'>');

/// A source's address as the paper's links carry it.
pub(crate) fn link_safe(url: &str) -> String {
    if reference_path(url).is_some() {
        return url.to_string();
    }
    percent_encoding::utf8_percent_encode(url, WEB_LINK_UNSAFE).to_string()
}

/// Where a file of the user's reference library is, as a source's address.
const LIBRARY: &str = "references/";

/// A reference file's address among the paper's sources: its path from the
/// project, each part percent-encoded so the address has no spaces.
pub(crate) fn reference_address(path: &str) -> String {
    let parts: Vec<String> = path
        .trim_start_matches(LIBRARY)
        .split('/')
        .map(|p| percent_encoding::utf8_percent_encode(p, LINK_UNSAFE).to_string())
        .collect();
    format!("{LIBRARY}{}", parts.join("/"))
}

/// The path of the reference file at a source's address, or None for a
/// web page.
pub(crate) fn reference_path(address: &str) -> Option<String> {
    address.starts_with(LIBRARY).then(|| {
        percent_encoding::percent_decode_str(address)
            .decode_utf8_lossy()
            .into_owned()
    })
}

/// The project's reference library: the project folder, when it has one.
fn library_file(root: &Path, cited: &str) -> Option<String> {
    let path = cited.trim().trim_start_matches("./");
    let inside = path.starts_with(LIBRARY) && !path.split('/').any(|p| p == "..");
    (inside && root.join(path).is_file()).then(|| path.to_string())
}

/// One step of a model: what a stage's run asks of it. A trait, so the
/// stages run on a scripted model in tests.
pub(crate) trait Model: Sync {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>>;

    /// `step`, with what it streams passed to `watch` as it comes. A model
    /// that doesn't stream just steps.
    fn step_watched<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
        _watch: Watch<'a>,
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        self.step(instructions, turns, tools)
    }
}

impl Model for aicompat::providers::AgentProvider {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        // A helper's text and thinking aren't shown: its activity is.
        self.step_watched(instructions, turns, tools, &|_| {})
    }

    fn step_watched<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
        watch: Watch<'a>,
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        use aicompat::agent::ProviderEvent;
        Box::pin(async move {
            let on_event = |event: ProviderEvent<'_>| match event {
                ProviderEvent::Thinking(text) => watch(Streamed::Thinking(text)),
                ProviderEvent::Text(text) => watch(Streamed::Text(text)),
                ProviderEvent::ToolStart { .. } => watch(Streamed::ToolStart),
                ProviderEvent::ToolArgs { delta, .. } => watch(Streamed::ToolArgs(delta)),
                ProviderEvent::Citation { .. } => {}
            };
            aicompat::providers::AgentProvider::step(self, instructions, turns, tools, &on_event)
                .await
                .map(|(step, _)| step)
        })
    }
}

/// A piece of what a step streams, as a stage watching it sees it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Streamed<'a> {
    /// A fragment of the model's thinking.
    Thinking(&'a str),
    /// A fragment of the model's reply.
    Text(&'a str),
    /// A tool call began: the arguments that follow are its own.
    ToolStart,
    /// A fragment of a tool call's JSON arguments.
    ToolArgs(&'a str),
}

pub(crate) type Watch<'a> = &'a (dyn Fn(Streamed<'_>) + Send + Sync);

/// How much of the planner's stream a Thinking event carries: its tail.
const THINKING_TAIL: usize = 160;
/// The least time between two Thinking events.
const THINKING_EVERY: std::time::Duration = std::time::Duration::from_millis(250);

/// Gathers a stream's fragments and sends their tail as Thinking, a few
/// times a second at most: the planner's tokens arrive far faster than a
/// card needs to redraw.
pub(crate) struct ThinkingTail<'a> {
    send: &'a (dyn Fn(PaperEvent) + Sync),
    state: Mutex<(String, Option<std::time::Instant>)>,
}

impl<'a> ThinkingTail<'a> {
    pub(crate) fn new(send: &'a (dyn Fn(PaperEvent) + Sync)) -> Self {
        Self {
            send,
            state: Mutex::new((String::new(), None)),
        }
    }

    pub(crate) fn push(&self, fragment: &str) {
        let text = {
            let mut state = self.state.lock().unwrap();
            let (text, last) = &mut *state;
            text.push_str(fragment);
            // Keep the buffer bounded: only its tail is ever sent.
            if text.len() > THINKING_TAIL * 8 {
                *text = tail(text, THINKING_TAIL * 2).to_string();
            }
            if last.is_some_and(|at| at.elapsed() < THINKING_EVERY) {
                return;
            }
            *last = Some(std::time::Instant::now());
            tail(text, THINKING_TAIL).to_string()
        };
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if !text.is_empty() {
            (self.send)(PaperEvent::Thinking { text });
        }
    }
}

/// The last `chars` characters of `text`.
pub(crate) fn tail(text: &str, chars: usize) -> &str {
    let skip = text.chars().count().saturating_sub(chars);
    text.char_indices()
        .nth(skip)
        .map_or(text, |(i, _)| &text[i..])
}

/// A helper's tool call as the card tells it, or None for one it doesn't.
pub(crate) fn activity(call: &ToolCall) -> Option<(ActivityKind, String)> {
    use crate::ai::web::{SEARCH_PAPERS_TOOL, WEB_FETCH_TOOL, WEB_SEARCH_TOOL};
    let args: Value = serde_json::from_str(&call.arguments).unwrap_or_default();
    let text = |key: &str| args[key].as_str().unwrap_or("").trim().to_string();
    let (kind, detail) = match call.name.as_str() {
        WEB_SEARCH_TOOL => {
            let queries: Vec<&str> = match &args["queries"] {
                Value::Array(list) => list.iter().filter_map(Value::as_str).collect(),
                Value::String(one) => vec![one.as_str()],
                _ => args["query"].as_str().into_iter().collect(),
            };
            (ActivityKind::Search, queries.join(" · "))
        }
        WEB_FETCH_TOOL => (ActivityKind::Read, text("url")),
        SEARCH_PAPERS_TOOL => (ActivityKind::Papers, text("query")),
        SEARCH_REFERENCES_TOOL => (ActivityKind::Library, text("query")),
        READ_REFERENCE_TOOL => (ActivityKind::Library, text("path")),
        _ => return None,
    };
    Some((kind, detail))
}

/// The longest an activity's detail is sent: the card shows one line.
const DETAIL_CHARS: usize = 120;

pub(crate) fn clip(text: &str) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= DETAIL_CHARS {
        return text;
    }
    let cut: String = text.chars().take(DETAIL_CHARS - 1).collect();
    format!("{cut}…")
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
    watch: Watch<'_>,
) -> Result<Vec<String>, String> {
    let instructions = format!(
        "You plan the research for a paper of about {} characters, written in the language tagged \"{}\". Split its topic into {MIN_QUESTIONS}-{MAX_QUESTIONS} research questions that together cover it in breadth and depth: background and definitions, how it works, the state of the art, the evidence and data, disputes and limits, cases, and where it is heading - as fits the topic. Each question is one sentence, specific enough to search for, and none repeats another. Reply with a JSON array of the questions as strings and nothing else.",
        paper.target_chars, paper.language
    );
    let reply = match model
        .step_watched(
            &instructions,
            &[user(format!("Topic: {}", paper.topic))],
            &[],
            watch,
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
fn read_note(
    arguments: &str,
    question: &str,
    web: &WebPlan,
    library: Option<&Path>,
) -> Result<Note, String> {
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
        let local = library.and_then(|root| library_file(root, c));
        let number = match local {
            Some(path) => {
                let name = path.rsplit('/').next().unwrap_or(&path).to_string();
                Some(web.add_source(&reference_address(&path), &name))
            }
            None => {
                let address = if c.trim().starts_with("http") {
                    Some(c.trim().to_string())
                } else {
                    c.trim_matches(['[', ']', ' '])
                        .parse()
                        .ok()
                        .and_then(|n| web.source_address(n))
                };
                if address.as_deref().is_some_and(is_search_page) {
                    return Err(format!("{c:?} is a search page, not a source: read the page or paper a result points to, and cite that."));
                }
                web.source_number(c)
            }
        };
        match number {
            Some(n) if !sources.contains(&n) => sources.push(n),
            Some(_) => {}
            None => return Err(format!("No source is numbered {c:?}: cite the number a search or page result has, the page's full address, or a reference file's path.")),
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
#[allow(clippy::too_many_arguments)]
async fn research_question(
    model: &dyn Model,
    paper: &Paper,
    web: &WebPlan,
    budget: &SharedBudget,
    library: Option<&Path>,
    (index, question): (u32, &str),
    share: Share,
    send: &(dyn Fn(PaperEvent) + Sync),
) -> Result<Vec<Note>, String> {
    let instructions = format!(
        "You are one of several researchers gathering material for a paper on \"{}\", written in the language tagged \"{}\". Your part is one question. Search the web and the scholarly literature, read the best pages in full, and keep every finding that answers it with add_note - specific claims with figures, dates, names and results, not generalities; prefer primary and scholarly sources, and say where sources disagree. Aim for four to eight notes, written in the paper's language. Note pictures and data sets a figure could use as leads. When the question is covered, or the searches run out, reply with one short line.{}",
        paper.topic,
        paper.language,
        if library.is_some() {
            " The user has a reference library of their own papers, books and notes: search it first with search_references, read around a passage with read_reference, and cite a file from it by its path (references/...) in add_note's sources - it is the material the user chose."
        } else {
            ""
        }
    );
    let mut specs: Vec<ToolSpec> = web.tools(question).iter().map(|t| t.spec.clone()).collect();
    specs.push(add_note_spec());
    if library.is_some() {
        specs.extend(library_specs());
    }
    let web_tools = web.tools(question);
    let notes = Mutex::new(Vec::new());
    let spent = Mutex::new([0usize; 3]);
    let execute = |call: ToolCall| {
        let (web_tools, notes, spent) = (&web_tools, &notes, &spent);
        async move {
            let tell = |kind, detail: &str| {
                send(PaperEvent::Activity {
                    question: index,
                    kind,
                    detail: clip(detail),
                })
            };
            if call.name == ADD_NOTE_TOOL {
                return ToolOutput::from(
                    match read_note(&call.arguments, question, web, library) {
                        Ok(note) => {
                            tell(ActivityKind::Note, &note.claim);
                            notes.lock().unwrap().push(note);
                            "Kept.".to_string()
                        }
                        Err(why) => why,
                    },
                );
            }
            let told = activity(&call);
            if let Some(root) = library {
                if let Some((kind, detail)) =
                    told.as_ref().filter(|(k, _)| *k == ActivityKind::Library)
                {
                    tell(*kind, detail);
                }
                if let Some(answer) = library_call(root, &call).await {
                    return ToolOutput::from(answer);
                }
            }
            if let Some(refused) = share.spend(&call.name, &mut spent.lock().unwrap()) {
                return ToolOutput::from(refused);
            }
            if let Some((kind, detail)) = &told {
                tell(*kind, detail);
            }
            let output = match web_tools
                .iter()
                .find(|t| t.spec.name == call.name)
                .map(|t| &t.run)
            {
                Some(crate::ai::tools::Run::Async(run)) => run(call).await,
                _ => ToolOutput::from(format!("Unknown tool: {}", call.name)),
            };
            if told.is_some() {
                let spent = budget.snapshot();
                send(PaperEvent::Budget {
                    used: spent.used,
                    remaining: spent.remaining(),
                });
            }
            output
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
    // The project folder, when it has a reference library.
    library: Option<&Path>,
) -> Result<Dossier, String> {
    send(PaperEvent::Phase {
        phase: PaperPhase::Planning,
    });
    let thinking = ThinkingTail::new(send);
    let questions = plan_questions(model, paper, &|streamed| {
        if let Streamed::Thinking(text) | Streamed::Text(text) = streamed {
            thinking.push(text)
        }
    })
    .await?;
    let share = Share::of(budget.snapshot().limits, questions.len());
    send(PaperEvent::Questions {
        questions: questions.clone(),
    });
    send(PaperEvent::Phase {
        phase: PaperPhase::Researching,
    });
    let results: Vec<(String, Result<Vec<Note>, String>)> = stream::iter(questions)
        .enumerate()
        .map(|(i, question)| async move {
            let notes = research_question(
                model,
                paper,
                web,
                budget,
                library,
                (i as u32, &question),
                share,
                send,
            )
            .await;
            let spent = budget.snapshot();
            send(PaperEvent::Budget {
                used: spent.used,
                remaining: spent.remaining(),
            });
            send(PaperEvent::QuestionDone {
                question: i as u32,
                notes: notes.as_ref().map_or(0, |n| n.len() as u32),
                failed: notes.is_err(),
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
    // Only what the notes cite: everything a search showed would bury them.
    let cited: std::collections::HashSet<u32> = dossier
        .notes
        .iter()
        .flat_map(|n| n.sources.iter().copied())
        .collect();
    dossier.sources = web
        .sources()
        .into_iter()
        .filter(|s| cited.contains(&s.n))
        .map(|s| aicompat::agent::Source {
            url: link_safe(&s.url),
            ..s
        })
        .collect();
    Ok(dossier)
}

/// What the reference library's tools look like to the model.
fn library_specs() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: SEARCH_REFERENCES_TOOL.into(),
            description: "Search the user's reference library - the papers, books and notes in the project's references/ folder - for the passages that best answer a question. Each result is `path:first-last` and the passage.".into(),
            parameters: json!({
                "type": "object",
                "properties": {"query": {"type": "string", "description": "What the passages should be about, in the sources' own words"}},
                "required": ["query"]
            }),
        },
        ToolSpec {
            name: READ_REFERENCE_TOOL.into(),
            description: "Read part of a file in the reference library, by the path and lines search_references gave.".into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "start_line": {"type": "integer"},
                    "end_line": {"type": "integer"}
                },
                "required": ["path"]
            }),
        },
    ]
}

/// A library tool's answer, or None for another tool. Run off the async
/// threads: a first search extracts and indexes the files.
async fn library_call(root: &Path, call: &ToolCall) -> Option<String> {
    let args: Value = serde_json::from_str(&call.arguments).unwrap_or_default();
    let root = root.to_path_buf();
    let answer = match call.name.as_str() {
        SEARCH_REFERENCES_TOOL => {
            let query = args["query"].as_str().unwrap_or("").to_string();
            tokio::task::spawn_blocking(move || {
                crate::ai::project::search_references(&root, &query)
            })
            .await
        }
        READ_REFERENCE_TOOL => {
            let path = args["path"].as_str().unwrap_or("").trim().to_string();
            if library_file(&root, &path).is_none() {
                return Some(format!(
                    "{path:?} isn't a file in references/: pass a path search_references gave."
                ));
            }
            let range = crate::ai::project::LineRange {
                start: args["start_line"].as_u64().map(|n| n as usize),
                end: args["end_line"].as_u64().map(|n| n as usize),
            };
            tokio::task::spawn_blocking(move || {
                crate::ai::project::read_part(&root, &path, range).unwrap_or_else(|why| why)
            })
            .await
        }
        _ => return None,
    };
    let text = answer.unwrap_or_else(|e| e.to_string());
    Some(format!(
        "<external-content source=\"reference library\">\n{text}\n</external-content>"
    ))
}

/// One question's share of the paper's searches, page reads and paper
/// lookups: an even split, so the helpers that run first can't leave the
/// last questions nothing to research with.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Share([usize; 3]);

impl Share {
    pub(crate) fn of(limits: super::BudgetCounts, questions: usize) -> Self {
        let each = |limit: u32| (limit as usize).div_ceil(questions.max(1)).max(1);
        Share([
            each(limits.searches),
            each(limits.fetches),
            each(limits.paper_lookups),
        ])
    }

    /// Counts a call against the share, in `spent`; why it is refused once
    /// its kind's share is used. Other tools are not counted.
    pub(crate) fn spend(&self, tool: &str, spent: &mut [usize; 3]) -> Option<String> {
        use crate::ai::web::{SEARCH_PAPERS_TOOL, WEB_FETCH_TOOL, WEB_SEARCH_TOOL};
        let (kind, what) = match tool {
            WEB_SEARCH_TOOL => (0, "web searches"),
            WEB_FETCH_TOOL => (1, "page reads"),
            SEARCH_PAPERS_TOOL => (2, "paper searches"),
            _ => return None,
        };
        if spent[kind] >= self.0[kind] {
            return Some(format!("That's this question's share of {what} ({}) - the other questions need the rest. Keep notes from what you have read, or use another kind of search.", self.0[kind]));
        }
        spent[kind] += 1;
        None
    }
}

/// Whether `url` is a search engine's results or a search API's answer: a
/// list of other pages, which a note cites instead of what they list.
pub(crate) fn is_search_page(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let host = parsed.host_str().unwrap_or("").trim_start_matches("www.");
    let path = parsed.path();
    let engine = [
        "duckduckgo.com",
        "html.duckduckgo.com",
        "lite.duckduckgo.com",
        "search.yahoo.com",
        "yandex.com",
        "search.brave.com",
    ]
    .contains(&host)
        || ((host.starts_with("google.") || host == "bing.com" || host == "cn.bing.com")
            && path.starts_with("/search"))
        || (host == "baidu.com" && path == "/s")
        || (host == "scholar.google.com");
    let api = [
        "api.crossref.org",
        "api.openalex.org",
        "api.semanticscholar.org",
        "export.arxiv.org",
    ]
    .contains(&host)
        || (host.ends_with("wikipedia.org") || host.ends_with("wikimedia.org"))
            && path.ends_with("/api.php");
    engine || api
}
