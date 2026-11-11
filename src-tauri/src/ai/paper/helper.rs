//! One question's research: its helper, searching and keeping notes with
//! add_note, and - when the user lets it - the helpers it hands narrower
//! parts of its question to with delegate_task.

use super::delegate::{self, DELEGATE_TOOL};
use super::notes::NoteTaker;
use super::notes::ADD_NOTE_TOOL;
use super::prompts;
use super::research::{Kit, Share};
use super::tuning::{HELPER_STEPS, MAX_HANDED, SUB_STEPS};
use super::{Note, Paper, PaperEvent, SharedBudget};
use crate::ai::agent::Model;
use crate::ai::tools::ToolRegistry;
use crate::ai::web::WebPlan;
use aicompat::agent::{run_agent_loop, AgentTurn, ToolCall};
use std::sync::Mutex;

/// What a question's helper is told; `own` is what it is told about the
/// user's own material, and `delegates` whether it may hand parts over.
pub(crate) fn helper_instructions(paper: &Paper, own: &str, delegates: bool) -> String {
    let profile = paper.genre.profile();
    let handing = if delegates {
        prompts::fill("research.delegate", &[("tool", &DELEGATE_TOOL)]) + " "
    } else {
        String::new()
    };
    prompts::fill(
        "research.helper",
        &[
            ("genre", &profile.name),
            ("topic", &paper.topic),
            ("language", &paper.language),
            ("sources", &profile.research_sources),
            ("delegate", &handing),
            ("material", &own),
        ],
    )
}

/// What the helper of a part handed over is told: `of` is the question
/// the part belongs to.
pub(crate) fn part_instructions(paper: &Paper, own: &str, of: &str) -> String {
    let profile = paper.genre.profile();
    prompts::fill(
        "research.part",
        &[
            ("genre", &profile.name),
            ("topic", &paper.topic),
            ("language", &paper.language),
            ("of", &of),
            ("sources", &profile.research_sources),
            ("material", &own),
        ],
    )
}

/// One question's helper: its notes, in the order it kept them - with
/// those of the helpers it handed sub-questions to.
#[allow(clippy::too_many_arguments)]
pub(super) async fn research_question(
    model: &dyn Model,
    paper: &Paper,
    web: &WebPlan,
    budget: &SharedBudget,
    kit: &Kit<'_, '_>,
    (index, question): (u32, &str),
    share: Share,
    send: &(dyn Fn(PaperEvent) + Sync),
) -> Result<Vec<Note>, String> {
    let desk = Desk {
        index,
        share,
        spent: Mutex::new([0; 3]),
        notes: Mutex::new(Vec::new()),
        handed: Mutex::new(0),
        delegates: paper.sub_helpers,
    };
    let env = Env {
        model,
        paper,
        web,
        budget,
        kit,
        send,
    };
    helper(&env, &desk, question, Role::Question).await?;
    let kept = std::mem::take(&mut *desk.notes.lock().unwrap());
    Ok(kept)
}

/// What every helper of the paper works with.
struct Env<'e, 'k, 't> {
    model: &'e dyn Model,
    paper: &'e Paper,
    web: &'e WebPlan,
    budget: &'e SharedBudget,
    kit: &'e Kit<'k, 't>,
    send: &'e (dyn Fn(PaperEvent) + Sync),
}

/// What one question's helper and the helpers it hands sub-questions to
/// share: the question's notes, and its share of the budget and what of it
/// is spent.
struct Desk {
    index: u32,
    share: Share,
    spent: Mutex<[usize; 3]>,
    notes: Mutex<Vec<Note>>,
    /// Sub-questions handed over so far.
    handed: Mutex<usize>,
    /// Whether the question's helper may hand parts over: the user's choice.
    delegates: bool,
}

/// Who a helper is: a question's own, which may hand parts of it over with
/// delegate_task, or the helper of a part handed over, which hands nothing on.
#[derive(Clone, Copy)]
enum Role<'q> {
    Question,
    Part {
        of: &'q str,
        handed: &'q delegate::Handed,
    },
}

/// One helper's run: its own registry has the web tools, ranked by its
/// question, and add_note - and delegate_task for a question's own helper;
/// the rest it shares with the other helpers through `env.kit`. What it
/// keeps goes on `desk`.
async fn helper(
    env: &Env<'_, '_, '_>,
    desk: &Desk,
    question: &str,
    role: Role<'_>,
) -> Result<(), String> {
    let Env {
        model,
        paper,
        web,
        budget,
        kit,
        send,
    } = *env;
    let (instructions, first, steps) = match role {
        Role::Question => (
            helper_instructions(paper, &kit.prompt(), desk.delegates),
            format!("Your question: {question}"),
            HELPER_STEPS,
        ),
        Role::Part { of, handed } => (
            part_instructions(paper, &kit.prompt(), of),
            delegate::brief(handed),
            SUB_STEPS,
        ),
    };
    let taker = NoteTaker {
        question,
        index: desk.index,
        web,
        ctx: kit.ctx,
        notes: &desk.notes,
        send,
        sent_back: Default::default(),
    };
    let mut own = ToolRegistry::shared();
    own.extend(web.tools(question));
    own.add(taker.tool());
    let mut specs = own.specs();
    let delegates = desk.delegates && matches!(role, Role::Question);
    if delegates {
        specs.push(delegate::spec());
    }
    specs.extend(kit.tools.specs());
    let execute = |call: ToolCall| {
        let own = &own;
        async move {
            if delegates && call.name == DELEGATE_TOOL {
                return hand_over(env, desk, question, call).await.into();
            }
            if let Some(refused) = desk
                .share
                .spend(&call.name, &mut desk.spent.lock().unwrap())
            {
                return refused.into();
            }
            let web_call = call.name != ADD_NOTE_TOOL && own.offers(&call.name);
            if web_call || kit.tools.offers(&call.name) {
                send(PaperEvent::Activity {
                    question: desk.index,
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
        AgentTurn::user(first),
        steps,
        |turns: Vec<AgentTurn>| {
            let (instructions, specs) = (&instructions, &specs);
            async move { model.step(instructions, &turns, specs).await }
        },
        execute,
        |name| {
            if own.offers(name) {
                own.how_to_run(name)
            } else {
                // delegate_task, too: one helper at a time, in call order.
                kit.tools.how_to_run(name)
            }
        },
        |_| {},
    )
    .await?;
    Ok(())
}

/// A delegate_task call run: the part handed to a helper of its own, and
/// what it kept told back - or why it wasn't handed over. A helper that
/// fails costs the part, not the question.
async fn hand_over(env: &Env<'_, '_, '_>, desk: &Desk, question: &str, call: ToolCall) -> String {
    let handed = match delegate::read(&call.arguments, question) {
        Ok(handed) => handed,
        Err(why) => return why,
    };
    if desk.share.used_up(&desk.spent.lock().unwrap()) {
        return "Your question's share of searches and page reads is used up: there is nothing left for a helper to search with. Keep notes from what you have.".into();
    }
    {
        let mut handed_over = desk.handed.lock().unwrap();
        if *handed_over >= MAX_HANDED {
            return format!(
                "You have handed over {} parts already: research the rest yourself.",
                MAX_HANDED
            );
        }
        *handed_over += 1;
    }
    (env.send)(PaperEvent::Activity {
        question: desk.index,
        tool: DELEGATE_TOOL.to_string(),
        arguments: call.arguments.clone(),
    });
    let before = desk.notes.lock().unwrap().len();
    let part = Box::pin(helper(
        env,
        desk,
        &handed.question,
        Role::Part {
            of: question,
            handed: &handed,
        },
    ))
    .await;
    let kept: Vec<Note> = desk.notes.lock().unwrap()[before..].to_vec();
    match part {
        Ok(()) => delegate::answer(&handed.question, &kept),
        Err(why) if kept.is_empty() => format!("The helper stopped before keeping anything: {why}. Cover the part yourself if it matters."),
        Err(_) => delegate::answer(&handed.question, &kept),
    }
}
