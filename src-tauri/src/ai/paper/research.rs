//! A paper's research: the topic split into questions, then a helper per
//! question - four at a time - searching the web and the literature and
//! keeping what it finds as notes with add_note, with the tools every mode
//! shares (the files, the reference library, plugins' and MCP servers'
//! tools) beside the web's. The helpers share one WebPlan, so a source has
//! one number for the whole paper and the paper's budget is spent by all of
//! them together.

use super::model::ask;
pub(crate) use super::model::{clip, Model, Watch};
use super::notes::NoteTaker;
pub(crate) use super::notes::ADD_NOTE_TOOL;
use super::sources::link_safe;
use super::stream::ThinkingTail;
use super::{Dossier, Note, Paper, PaperEvent, PaperPhase, SharedBudget};
use crate::ai::agent::AgentMode;
use crate::ai::tools::{Tool, ToolContext, ToolRegistry};
use crate::ai::web::WebPlan;
use aicompat::agent::{run_agent_loop, AgentTurn, ProviderEvent, ToolCall};
use futures_util::stream::{self, StreamExt};
use std::path::Path;
use std::sync::Mutex;

use super::tuning::{HELPER_STEPS, MAX_QUESTIONS, PLAN_GLIMPSE, RESEARCHERS_AT_ONCE as AT_ONCE};

/// The mode whose tools a researcher is offered: it reads, and changes
/// nothing of the user's.
const MODE: AgentMode = AgentMode::Review;

/// What the researchers work with besides the web and add_note: the tools
/// every mode shares - the files, the reference library, the plugins' and
/// MCP servers' tools - and what they work on. Its context's `scratch` is
/// the paper's folder, whose `attached/` holds the files the user attached.
pub(crate) struct Kit<'k, 't> {
    pub tools: &'k ToolRegistry<'t>,
    pub ctx: &'k ToolContext<'t>,
}

impl Kit<'_, '_> {
    /// The attached files, by the paths read_file reads them by.
    fn attached(&self) -> Vec<String> {
        let Some(folder) = self.ctx.scratch else {
            return Vec::new();
        };
        let attached = crate::ai::scratch::ATTACHED;
        crate::ai::project::walk_readable_files(&folder.join(attached), self.ctx.sees_images)
            .files
            .into_iter()
            .map(|rel| format!("{attached}/{rel}"))
            .collect()
    }

    /// What a researcher is told about the user's own material.
    fn prompt(&self) -> String {
        let mut out = String::new();
        let attached = self.attached();
        if !attached.is_empty() {
            out.push_str(&format!(
                " The user attached files of their own for this piece - {}: read what bears on your question with read_file before searching, and cite a file by its path in add_note's sources - it is the material the user chose.",
                attached.join("; ")
            ));
        }
        if self
            .tools
            .offers(crate::ai::tools::SEARCH_REFERENCES_TOOL_NAME)
        {
            out.push_str(" The user has a reference library of their own papers, books and notes: search it first with search_references, read around a passage with read_file, and cite a file from it by its path (references/...) in add_note's sources - it is the material the user chose.");
        }
        out
    }
}

/// The researchers' shared tools: the file tools while there is a project
/// folder or a file attached, the reference library's search while the
/// project has one, and `installed` - the plugins' and MCP servers' tools
/// ([`crate::ai::agent::installed_tools`]).
pub(crate) fn shared_tools<'t>(
    root: Option<&Path>,
    attached: bool,
    sees_images: bool,
    installed: Vec<Tool<'t>>,
) -> ToolRegistry<'t> {
    let mut tools = if root.is_some() || attached {
        ToolRegistry::files(MODE, sees_images)
    } else {
        ToolRegistry::new(MODE)
    };
    if let Some(tool) = crate::ai::tools::references_tool(root) {
        tools.add(tool);
    }
    for tool in installed {
        tools.add(tool);
    }
    tools
}

/// What the shared tools work on: no document, the project folder, and
/// the paper's folder, whose `attached/` they read beside it.
pub(crate) fn context<'t>(
    root: Option<&'t Path>,
    paper_folder: Option<&'t Path>,
    sees_images: bool,
) -> ToolContext<'t> {
    ToolContext {
        root,
        scratch: paper_folder,
        sees_images,
        ..ToolContext::without_document()
    }
}

/// The questions that cover `paper`'s topic, from one tool-less step.
pub(crate) async fn plan_questions(
    model: &dyn Model,
    paper: &Paper,
    kit: &Kit<'_, '_>,
    watch: Watch<'_>,
) -> Result<Vec<String>, String> {
    let profile = paper.genre.profile();
    let instructions = format!(
        "You plan the research for a {} of about {} characters, written in the language tagged \"{}\". Split its topic into {least}-{most} research questions that together cover it in breadth and depth: {} - as fits the topic. Each question is one sentence, specific enough to search for, and none repeats another. Reply with a JSON array of the questions as strings and nothing else.",
        profile.name,
        paper.target_chars,
        paper.language,
        profile.research_angles,
        least = profile.scale.questions.0,
        most = profile.scale.questions.1,
    );
    let mut message = format!("Topic: {}", paper.topic);
    for path in kit.attached() {
        // Enough of each to plan by; the helpers read them whole.
        let text = kit
            .ctx
            .scratch
            .and_then(|folder| crate::ai::project::read_text(folder, &path).ok())
            .unwrap_or_default();
        let opening: String = text.chars().take(PLAN_GLIMPSE).collect();
        message.push_str(&format!("\n\nThe user attached {path}:\n{opening}"));
    }
    let reply = ask(model, &instructions, message, watch).await?;
    let mut questions = parse_questions(&reply);
    questions.truncate(profile.scale.questions.1);
    if questions.len() < 2.min(profile.scale.questions.0) {
        return Err("The research plan came back empty - try again.".into());
    }
    Ok(questions)
}

/// The questions in a reply: its JSON array of strings, or failing that its
/// list lines ("1. …", "- …").
pub(crate) fn parse_questions(reply: &str) -> Vec<String> {
    let from_json = crate::ai::json_reply::array::<Vec<String>>(reply);
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

/// One question's helper: its notes, in the order it kept them. Its own
/// registry has the web tools, ranked by its question, and add_note; the
/// rest it shares with the other helpers through `kit`.
#[allow(clippy::too_many_arguments)]
async fn research_question(
    model: &dyn Model,
    paper: &Paper,
    web: &WebPlan,
    budget: &SharedBudget,
    kit: &Kit<'_, '_>,
    (index, question): (u32, &str),
    share: Share,
    send: &(dyn Fn(PaperEvent) + Sync),
) -> Result<Vec<Note>, String> {
    let instructions = format!(
        "You are one of several researchers gathering material for a {name} on \"{}\", written in the language tagged \"{}\". Your part is one question. {} Aim for four to eight notes, written in the {name}'s language. Note pictures and data sets a figure could use as leads. When the question is covered, or the searches run out, reply with one short line.{}",
        paper.topic,
        paper.language,
        paper.genre.profile().research_sources,
        kit.prompt(),
        name = paper.genre.profile().name,
    );
    let notes = Mutex::new(Vec::new());
    let taker = NoteTaker {
        question,
        index,
        web,
        ctx: kit.ctx,
        notes: &notes,
        send,
    };
    let mut own = ToolRegistry::new(MODE);
    for tool in web.tools(question) {
        own.add(tool);
    }
    own.add(taker.tool());
    let mut specs = own.specs();
    specs.extend(kit.tools.specs());
    let spent = Mutex::new([0usize; 3]);
    let execute = |call: ToolCall| {
        let (own, spent) = (&own, &spent);
        async move {
            if let Some(refused) = share.spend(&call.name, &mut spent.lock().unwrap()) {
                return refused.into();
            }
            let web_call = call.name != ADD_NOTE_TOOL && own.offers(&call.name);
            if web_call || kit.tools.offers(&call.name) {
                send(PaperEvent::Activity {
                    question: index,
                    tool: call.name.clone(),
                    arguments: call.arguments.clone(),
                });
            }
            if !own.offers(&call.name) {
                return kit.tools.execute(kit.ctx, call).await;
            }
            let output = own.execute(kit.ctx, call).await;
            if web_call {
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
        AgentTurn::user(format!("Your question: {question}")),
        HELPER_STEPS,
        |turns: Vec<AgentTurn>| {
            let (instructions, specs) = (&instructions, &specs);
            async move { model.step(instructions, &turns, specs).await }
        },
        execute,
        |name| {
            if own.offers(name) {
                own.how_to_run(name)
            } else {
                kit.tools.how_to_run(name)
            }
        },
        |_| {},
    )
    .await?;
    let kept = std::mem::take(&mut *notes.lock().unwrap());
    Ok(kept)
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
    kit: &Kit<'_, '_>,
) -> Result<Dossier, String> {
    send(PaperEvent::Phase {
        phase: PaperPhase::Planning,
    });
    let thinking = ThinkingTail::new(send);
    let questions = plan_questions(model, paper, kit, &|streamed| {
        if let ProviderEvent::Thinking(text) | ProviderEvent::Text(text) = streamed {
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
                kit,
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
