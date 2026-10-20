//! Shared machinery for the live evaluation: credentials and model choice,
//! a bounded worker pool, the agent conversation runner (the app's real
//! prompts, tools and loop, plus the frontend's accept/annotate steps), the
//! Opus judge, and the recorder that writes every case's output and scores
//! to disk.

use super::checks::{self, Caret, Proposal};
use crate::ai::agent::{
    build_instructions, compact_history, request_context, request_user_text, AgentMode, MAX_STEPS,
};
use crate::ai::tools::{self, ToolContext};
use crate::ai::workspace::AgentWorkspace;
use aicompat::agent::{run_agent_loop, AgentTurn, StepResult};
use aicompat::providers::anthropic::{self, AnthropicAuth, StepUsage};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

// ------------------------------------------------------------- environment

pub fn auth() -> Option<AnthropicAuth> {
    let path = std::env::var("TEXTUS_ANTHROPIC_KEY_FILE")
        .unwrap_or_else(|_| format!("{}/../.anthropic-api-key.local", env!("CARGO_MANIFEST_DIR")));
    match std::fs::read_to_string(&path) {
        Ok(key) if !key.trim().is_empty() => Some(AnthropicAuth::ApiKey(key.trim().to_string())),
        _ => {
            eprintln!("live_eval: no API key at {path} - skipping");
            None
        }
    }
}

pub fn block_on<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

/// The shipped agent default, unless TEXTUS_EVAL_AGENT_MODEL overrides it
/// (how the matrix is re-run against another model).
pub fn agent_model() -> String {
    std::env::var("TEXTUS_EVAL_AGENT_MODEL").unwrap_or_else(|_| {
        crate::ai::catalog::find("anthropic")
            .and_then(|e| e.agent_default_model)
            .expect("anthropic has an agent default")
            .to_string()
    })
}

/// The shipped writing (completion + grammar) model, unless
/// TEXTUS_EVAL_WRITING_MODEL overrides it.
pub fn writing_model() -> String {
    std::env::var("TEXTUS_EVAL_WRITING_MODEL")
        .unwrap_or_else(|_| anthropic::COMPLETION_MODEL.to_string())
}

/// The writing model as `call_completion` takes it: None is the default
/// path (thinking disabled), exactly what a fresh install sends.
pub fn writing_model_arg(model: &str) -> Option<&str> {
    (model != anthropic::COMPLETION_MODEL).then_some(model)
}

pub const JUDGE_MODEL: &str = "claude-opus-5-5";

fn judge_enabled() -> bool {
    std::env::var("TEXTUS_EVAL_JUDGE").map_or(true, |v| v != "0")
}

/// TEXTUS_EVAL_FILTER: run only cases whose id contains this substring.
pub fn selected(id: &str) -> bool {
    std::env::var("TEXTUS_EVAL_FILTER")
        .map_or(true, |f| f.split(',').any(|f| id.contains(f.trim())))
}

/// Runs `f` over `items` on TEXTUS_EVAL_JOBS worker threads (default 6),
/// keeping the input order in the output. The API is the bottleneck, not
/// the CPU - this is what keeps a 150-case matrix to minutes.
pub fn par_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let jobs: usize = std::env::var("TEXTUS_EVAL_JOBS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(6);
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<Option<R>>> = Mutex::new((0..items.len()).map(|_| None).collect());
    std::thread::scope(|scope| {
        for _ in 0..jobs.max(1) {
            scope.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= items.len() {
                    break;
                }
                let r = f(&items[i]);
                results.lock().unwrap()[i] = Some(r);
            });
        }
    });
    results
        .into_inner()
        .unwrap()
        .into_iter()
        .map(|r| r.expect("every item ran"))
        .collect()
}

fn transient(err: &str) -> bool {
    [
        "429",
        "529",
        "500",
        "502",
        "503",
        "overloaded",
        "timed out",
        "connection",
        "error sending",
    ]
    .iter()
    .any(|m| err.to_lowercase().contains(m))
}

/// Retries rate limits and overloads with backoff - a matrix run fires
/// hundreds of requests, and one 529 shouldn't count as a quality failure.
pub fn with_retry<T>(mut attempt: impl FnMut() -> Result<T, String>) -> Result<T, String> {
    let mut last = String::new();
    for wait in [0u64, 3, 10, 30] {
        if wait > 0 {
            std::thread::sleep(std::time::Duration::from_secs(wait));
        }
        match attempt() {
            Ok(v) => return Ok(v),
            Err(e) if transient(&e) => last = e,
            Err(e) => return Err(e),
        }
    }
    Err(last)
}

// ------------------------------------------------------------ cost and budget

/// Dollars per million tokens: (input, 5-minute cache write, cache read,
/// output) - Anthropic's first-party prices for the models the eval runs
/// (Haiku 5.5 at the up-to-100K-token prompt rate, which every completion
/// and grammar request is under). An unknown model is priced as Opus, so
/// the budget guard errs on the side of stopping early.
pub fn price(model: &str) -> [f64; 4] {
    match model {
        "claude-haiku-5-5" => [0.10, 0.125, 0.01, 0.50],
        "claude-sonnet-5-5" => [2.0, 2.5, 0.20, 10.0],
        _ => [4.0, 5.0, 0.20, 20.0],
    }
}

pub fn cost_usd(model: &str, u: &StepUsage) -> f64 {
    let [i, w, r, o] = price(model);
    (u.input_tokens as f64 * i
        + u.cache_creation_input_tokens as f64 * w
        + u.cache_read_input_tokens as f64 * r
        + u.output_tokens as f64 * o)
        / 1_000_000.0
}

/// Token and dollar totals for a case or a suite.
#[derive(Clone, Debug, Default)]
pub struct Usage {
    pub requests: u64,
    pub input: u64,
    pub cache_write: u64,
    pub cache_read: u64,
    pub output: u64,
    pub cost_usd: f64,
}

impl Usage {
    pub fn add(&mut self, model: &str, u: &StepUsage) {
        self.requests += 1;
        self.input += u.input_tokens;
        self.cache_write += u.cache_creation_input_tokens;
        self.cache_read += u.cache_read_input_tokens;
        self.output += u.output_tokens;
        self.cost_usd += cost_usd(model, u);
    }
    pub fn merge(&mut self, other: &Usage) {
        self.requests += other.requests;
        self.input += other.input;
        self.cache_write += other.cache_write;
        self.cache_read += other.cache_read;
        self.output += other.output;
        self.cost_usd += other.cost_usd;
    }
    pub fn json(&self) -> Value {
        json!({
            "requests": self.requests,
            "input_tokens": self.input,
            "cache_write_tokens": self.cache_write,
            "cache_read_tokens": self.cache_read,
            "output_tokens": self.output,
            "cost_usd": (self.cost_usd * 1e6).round() / 1e6,
        })
    }
}

/// Every request this process made, in micro-dollars - what the budget
/// guard compares against TEXTUS_EVAL_BUDGET_USD.
static SPENT_MICRO_USD: AtomicU64 = AtomicU64::new(0);

/// Records one request's cost against the process-wide total.
pub fn charge(model: &str, u: &StepUsage) {
    let micro = (cost_usd(model, u) * 1e6).round() as u64;
    SPENT_MICRO_USD.fetch_add(micro, Ordering::SeqCst);
}

pub fn spent_usd() -> f64 {
    SPENT_MICRO_USD.load(Ordering::SeqCst) as f64 / 1e6
}

/// TEXTUS_EVAL_BUDGET_USD: once this process has spent that much, cases that
/// haven't started yet are skipped (marked with a failed `budget` check)
/// instead of sent. Cases already running finish, so the overshoot is at
/// most TEXTUS_EVAL_JOBS cases.
pub fn budget_exhausted() -> Option<String> {
    let budget: f64 = std::env::var("TEXTUS_EVAL_BUDGET_USD")
        .ok()
        .and_then(|v| v.parse().ok())?;
    let spent = spent_usd();
    (spent >= budget)
        .then(|| format!("skipped: this run has spent ${spent:.4} of its ${budget:.2} budget"))
}

/// One completion-style reply with its latency and token usage.
pub struct Reply {
    pub text: String,
    pub ms: u128,
    pub usage: StepUsage,
    pub model: String,
}

/// One completion-style call (completion, grammar, style, judge) with
/// retries; every attempt that got an answer is charged.
pub fn complete(
    auth: &AnthropicAuth,
    instructions: &str,
    user_text: &str,
    model: Option<&str>,
) -> Result<Reply, String> {
    let started = Instant::now();
    let effective = model.unwrap_or(anthropic::COMPLETION_MODEL).to_string();
    let (text, usage) = with_retry(|| {
        block_on(anthropic::call_completion_with_usage(
            auth,
            instructions.to_string(),
            user_text.to_string(),
            model,
        ))
    })?;
    charge(&effective, &usage);
    Ok(Reply {
        text,
        ms: started.elapsed().as_millis(),
        usage,
        model: effective,
    })
}

// -------------------------------------------------------------------- agent

/// One user message in a scripted conversation and what the "user" does
/// with the proposals it produces before sending the next message.
#[derive(Clone)]
pub struct UserTurn {
    pub message: String,
    pub caret: Caret,
    pub accept: bool,
    /// Quick Ask on a selection: the message goes out wrapped in the
    /// selection as it reads NOW - the range captured when Quick Ask opened,
    /// mapped through every accepted edit since (useInlineChat's
    /// sendContext + chat-selection-plugin), so "shorter" -> Accept ->
    /// "now more formal" targets the rewritten text.
    pub follow_selection: bool,
}

impl UserTurn {
    pub fn new(message: impl Into<String>) -> UserTurn {
        UserTurn {
            message: message.into(),
            caret: Caret::default(),
            accept: true,
            follow_selection: false,
        }
    }
}

#[derive(Clone, Default)]
pub struct TurnOutcome {
    /// What the user typed (after any /skill expansion).
    pub message: String,
    /// What went out as the user's message: the selection or cursor block,
    /// then the message - what the history keeps.
    pub message_sent: String,
    pub caret: Caret,
    pub focus_heading: Option<String>,
    pub turns: Vec<AgentTurn>,
    pub proposals: Vec<Proposal>,
    /// propose_edit calls the tool rejected (bad anchor, missing field) -
    /// each one cost the user a round trip of waiting.
    pub invalid_proposals: usize,
    pub invalid_errors: Vec<String>,
    pub comments: Vec<(String, String)>,
    pub reply: String,
    pub tools: Vec<String>,
    /// Every tool call in order: name, arguments, and the tool's result.
    pub calls: Vec<Value>,
    pub doc_before: String,
    pub doc_after: String,
    pub apply_error: Option<String>,
    pub latency_ms: u128,
    pub usage: Vec<StepUsage>,
    /// Rules the proposal post-processing applied to this turn's
    /// propose_edit texts (rules::postfix) - a prompt regression shows here
    /// instead of being silently repaired.
    pub postfix: Vec<String>,
}

impl TurnOutcome {
    /// Every tool result of this turn, concatenated - for checks that a
    /// file's content did (or did not) reach the model.
    pub fn tool_results(&self) -> String {
        self.calls
            .iter()
            .filter_map(|c| c["result"].as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// Mirrors user-message.ts's selectedTextBlock.
pub fn selected_text_block(markdown: &str) -> String {
    format!("<selected-text>\n{markdown}\n</selected-text>")
}

/// Maps a byte position through the edit between `before` and `after` the
/// way ProseMirror's mapping does: positions before the change stay, after
/// it shift, and inside it go to the change's start (bias -1) or the end of
/// the inserted text (bias 1).
pub fn map_pos(before: &str, after: &str, pos: usize, bias: i8) -> usize {
    if before == after {
        return pos;
    }
    let (s, e, e2) = checks::changed_span(before, after);
    if pos < s {
        return pos;
    }
    if pos > e {
        return pos + e2 - e;
    }
    // StepMap.map: the edges of a replaced range keep their side; only a
    // pure insertion point (or the inside of a range) follows the bias.
    let side = if e == s {
        bias
    } else if pos == s {
        -1
    } else if pos == e {
        1
    } else {
        bias
    };
    if side < 0 {
        s
    } else {
        e2
    }
}

/// chat-selection-plugin's range mapping: outward bias at both ends, so an
/// accepted rewrite of the selection grows the range over the replacement.
pub fn map_selection(before: &str, after: &str, sel: (usize, usize)) -> Option<(usize, usize)> {
    let from = map_pos(before, after, sel.0, -1);
    let to = map_pos(before, after, sel.1, 1);
    (from < to).then_some((from, to))
}

/// doc-markdown.ts's headingAt: the innermost heading above `pos` - the
/// `focus_heading` the editor sends with each message.
pub fn heading_at(doc: &str, pos: usize) -> Option<String> {
    let mut found = None;
    let mut in_fence = false;
    let mut offset = 0;
    for line in doc.split_inclusive('\n') {
        if offset > pos {
            break;
        }
        let t = line.trim_end();
        if t.trim_start().starts_with("```") {
            in_fence = !in_fence;
        } else if !in_fence {
            let hashes = t.chars().take_while(|&c| c == '#').count();
            if (1..=6).contains(&hashes) && t[hashes..].starts_with(' ') {
                found = Some(t[hashes..].trim().to_string());
            }
        }
        offset += line.len();
    }
    found
}

pub struct Conversation {
    pub outcomes: Vec<TurnOutcome>,
    /// Set when a request failed part-way: the turns before it are kept.
    pub error: Option<String>,
    pub model: String,
}

impl Conversation {
    pub fn latency_ms(&self) -> u128 {
        self.outcomes.iter().map(|o| o.latency_ms).sum()
    }
    pub fn usage(&self) -> Usage {
        let mut total = Usage::default();
        for u in self.outcomes.iter().flat_map(|o| &o.usage) {
            total.add(&self.model, u);
        }
        total
    }
}

pub struct AgentSetup<'a> {
    pub model: &'a str,
    pub mode: AgentMode,
    pub workspace: &'a AgentWorkspace,
    /// None: each turn sends the heading above its selection or cursor, as
    /// the editor does (headingAt); Some overrides it.
    pub focus_heading: Option<&'a str>,
    /// The app's UI language (src/i18n/langs.ts), as the frontend sends it.
    pub ui_language: &'a str,
}

/// Mirrors src/ai/revision/proposal-status.ts's notes for the two decided states.
const ACCEPTED_NOTE: &str =
    "Status: the user accepted this proposed edit - the document text in this request includes it.";
const REJECTED_NOTE: &str =
    "Status: the user rejected this proposed edit - it was not applied. Don't propose it again unless asked.";

/// Longest tool result kept in a case's record (the model saw all of it).
const RECORDED_RESULT_CHARS: usize = 4_000;

/// Whether the app offers images to the provider the eval runs on - the
/// image cases need it, and a provider without would skip them.
pub fn sees_images() -> bool {
    crate::ai::catalog::find("anthropic").is_some_and(|e| e.supports_vision)
}

/// Runs a scripted conversation the way the app does: each message goes out
/// with the current document (request_context), the loop runs the real
/// tools, the stored history keeps the plain message, and before the next
/// message the user accepts or rejects the proposals - accepted ones are
/// applied to the document (as the frontend composes them) and every
/// proposal's tool result gets the status note the frontend adds.
pub fn run_conversation(
    auth: &AnthropicAuth,
    setup: &AgentSetup,
    document: &str,
    script: &[UserTurn],
) -> Conversation {
    let ws = setup.workspace;
    let root = ws.root.as_deref().map(Path::new);
    let tool_set =
        // No remember tool: an eval run writes no memories. Images as the
        // app offers them to the provider the eval runs on (Anthropic).
        tools::builtin_tools(ws.has_usable_skills(), root.is_some(), setup.mode, false, sees_images());
    let specs = tools::tool_specs(&tool_set);
    let mut history: Vec<AgentTurn> = Vec::new();
    let mut doc = document.to_string();
    let mut outcomes = Vec::new();
    let mut error = None;
    // Quick Ask's captured selection, mapped through accepted edits.
    let mut selection = script
        .first()
        .filter(|t| t.follow_selection)
        .and_then(|t| t.caret.selection);

    for user in script {
        let (message_sent, caret) = match (user.follow_selection, selection) {
            (true, Some((s, e))) => (
                format!(
                    "{}\n\n{}",
                    selected_text_block(doc[s..e].trim_end()),
                    user.message
                ),
                Caret {
                    cursor: None,
                    selection: Some((s, e)),
                },
            ),
            _ => (user.message.clone(), user.caret),
        };
        let focus_heading = setup.focus_heading.map(str::to_string).or_else(|| {
            caret
                .selection
                .map(|s| s.0)
                .or(caret.cursor)
                .and_then(|at| heading_at(&doc, at))
        });
        let instructions =
            build_instructions(ws, &doc, true, setup.mode, &message_sent, setup.ui_language);
        // The app's conventions for this workspace (the setting is the
        // default, Automatic): proposals are post-processed as the app does
        // (agent::postfix_step), and what was fixed is recorded.
        let conventions = crate::ai::rules::Conventions {
            setting: None,
            project: ws.conventions.clone(),
        };
        let library = crate::ai::conventions::library_names(ws);
        let ctx = ToolContext {
            document: &doc,
            skills: &ws.skills,
            ui_language: setup.ui_language,
            root,
            sees_images: sees_images(),
            conventions: &conventions,
            library: &library,
            memory: None,
            proposed: Default::default(),
            checks: Default::default(),
        };
        let usage = RefCell::new(Vec::new());
        let postfix = RefCell::new(Vec::new());
        let started = Instant::now();
        let result = block_on(run_agent_loop(
            compact_history(history.clone()),
            AgentTurn::User {
                text: request_user_text(
                    &request_context(ws, &doc, true, &message_sent, focus_heading.as_deref()),
                    &message_sent,
                ),
                images: Vec::new(),
            },
            MAX_STEPS,
            |h: Vec<AgentTurn>| {
                let (instructions, specs, usage, postfix) =
                    (&instructions, &specs, &usage, &postfix);
                let (doc, conventions) = (&doc, &conventions);
                async move {
                    // with_retry's loop, inline: this already runs inside
                    // block_on, which can't be nested.
                    let mut waits = [3u64, 10, 30].into_iter();
                    let (step, used): (StepResult, StepUsage) = loop {
                        match anthropic::agent_step_with_usage(
                            auth,
                            instructions,
                            &h,
                            specs,
                            false,
                            setup.model,
                            &|_| {},
                        )
                        .await
                        {
                            Ok(v) => break v,
                            Err(e) if transient(&e) => match waits.next() {
                                Some(w) => std::thread::sleep(std::time::Duration::from_secs(w)),
                                None => return Err(e),
                            },
                            Err(e) => return Err(e),
                        }
                    };
                    charge(setup.model, &used);
                    usage.borrow_mut().push(used);
                    let (step, applied) = crate::ai::agent::postfix_step(step, doc, conventions);
                    postfix
                        .borrow_mut()
                        .extend(applied.into_iter().map(str::to_string));
                    Ok(step)
                }
            },
            |name, args| tools::execute(&tool_set, &ctx, name, args),
            |_| {},
        ));
        let latency_ms = started.elapsed().as_millis();
        let mut turns = match result {
            Ok(turns) => turns,
            Err(e) => {
                error = Some(format!("turn {}: {e}", outcomes.len() + 1));
                break;
            }
        };

        // What history keeps is the plain message (ai_agent_message_inner).
        if let Some(AgentTurn::User { text, .. }) = turns.first_mut() {
            *text = message_sent.clone();
        }

        let mut outcome = TurnOutcome {
            message: user.message.clone(),
            message_sent: message_sent.clone(),
            caret,
            focus_heading,
            doc_before: doc.clone(),
            latency_ms,
            usage: usage.into_inner(),
            postfix: postfix.into_inner(),
            ..TurnOutcome::default()
        };
        let mut proposal_ids = Vec::new();
        for turn in &turns {
            match turn {
                AgentTurn::ToolCall {
                    call_id,
                    name,
                    arguments,
                } => {
                    outcome.tools.push(name.clone());
                    // A step's results follow all of its calls.
                    let result = turns
                        .iter()
                        .find_map(|t| match t {
                            AgentTurn::ToolResult {
                                call_id: id,
                                output,
                                ..
                            } if id == call_id => Some(output.as_str()),
                            _ => None,
                        })
                        .unwrap_or("");
                    let args: Value = serde_json::from_str(arguments).unwrap_or_default();
                    outcome.calls.push(json!({
                        "name": name,
                        "args": args,
                        "result": clip(result, RECORDED_RESULT_CHARS),
                    }));
                    if name == "propose_edit" {
                        if result.starts_with("Edit proposed") {
                            outcome.proposals.push(Proposal::from_json(&args));
                            proposal_ids.push(call_id.clone());
                        } else {
                            outcome.invalid_proposals += 1;
                            outcome.invalid_errors.push(result.to_string());
                        }
                    }
                    if name == "add_comment" && result.starts_with("Comment added") {
                        let s = |k: &str| args[k].as_str().unwrap_or("").to_string();
                        outcome.comments.push((s("anchor"), s("comment")));
                    }
                }
                AgentTurn::Assistant { text } => outcome.reply = text.clone(),
                _ => {}
            }
        }

        if user.accept && !outcome.proposals.is_empty() {
            match checks::apply_all(&doc, &outcome.proposals, caret) {
                Ok(next) => doc = next,
                Err(e) => outcome.apply_error = Some(e),
            }
        }
        outcome.doc_after = doc.clone();
        if let Some(sel) = selection {
            selection = map_selection(&outcome.doc_before, &doc, sel);
        }

        let note = if user.accept && outcome.apply_error.is_none() {
            ACCEPTED_NOTE
        } else {
            REJECTED_NOTE
        };
        for turn in turns.iter_mut() {
            if let AgentTurn::ToolResult {
                call_id, output, ..
            } = turn
            {
                if proposal_ids.contains(call_id) {
                    *output = format!("{output}\n\n[{note}]");
                }
            }
        }
        history.extend(turns.iter().cloned());
        outcome.turns = turns;
        outcomes.push(outcome);
    }
    Conversation {
        outcomes,
        error,
        model: setup.model.to_string(),
    }
}

// -------------------------------------------------------------------- judge

#[derive(Clone, Debug, Default)]
pub struct Verdict {
    pub scores: BTreeMap<String, Option<f64>>,
    pub reasons: String,
}

impl Verdict {
    pub fn min(&self) -> Option<f64> {
        self.scores.values().flatten().copied().reduce(f64::min)
    }
    pub fn mean(&self) -> Option<f64> {
        let v: Vec<f64> = self.scores.values().flatten().copied().collect();
        (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
    }
}

const JUDGE_INSTRUCTIONS: &str = "You grade the output of the AI features of Textus, a Markdown writing app, for a regression evaluation. Be strict and specific: the bar is a careful professional editor who is fluent in the language of the text.

Score each criterion from 1 to 5: 5 = could not reasonably be improved; 4 = good, minor nits only; 3 = acceptable but with a flaw the user would notice; 2 = poor - the user would have to redo much of it; 1 = wrong, harmful, or ignores the request. Use null when a criterion genuinely does not apply.

Criteria:
- faithfulness: keeps the author's meaning and facts and invents nothing; statements about the document are accurate.
- helpfulness: does what the user actually asked, in the form they wanted - a document edit when they asked for a change, an answer when they asked a question, comments when they asked for a review.
- minimality: changes only what the request needs; untouched text, formatting and Markdown structure stay exactly as they were. For an answer with no edit, judge whether it stayed on point without padding.
- tone: natural, idiomatic writing in the right language and register, matching the author's voice; no machine-written tics (inflated words, filler, needless em dashes or bold).
- correctness: language rules (replies in the language the user wrote in, document text in the document's language unless asked otherwise), valid Markdown, and correct code, math and facts.

Task-specific expectations follow the task; where they conflict with the general criteria, they win.

Respond with ONLY a JSON object, no fences: {\"faithfulness\": n|null, \"helpfulness\": n|null, \"minimality\": n|null, \"tone\": n|null, \"correctness\": n|null, \"reasons\": \"for every score below 5, one short sentence naming the specific flaw\"}";

/// Asks Opus to grade one case. None when judging is switched off
/// (TEXTUS_EVAL_JUDGE=0) or the judge's reply can't be parsed twice over.
pub fn judge(
    auth: &AnthropicAuth,
    task: &str,
    expectations: &str,
    material: &str,
) -> Option<Verdict> {
    if !judge_enabled() {
        return None;
    }
    let user = format!(
        "<task>\n{task}\n</task>\n\n<expectations>\n{expectations}\n</expectations>\n\n{material}"
    );
    for _ in 0..2 {
        let Ok(Reply { text: raw, .. }) =
            complete(auth, JUDGE_INSTRUCTIONS, &user, Some(JUDGE_MODEL))
        else {
            continue;
        };
        let (Some(start), Some(end)) = (raw.find('{'), raw.rfind('}')) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<Value>(&raw[start..=end]) else {
            continue;
        };
        let mut verdict = Verdict {
            reasons: v["reasons"].as_str().unwrap_or("").to_string(),
            ..Verdict::default()
        };
        for key in [
            "faithfulness",
            "helpfulness",
            "minimality",
            "tone",
            "correctness",
        ] {
            verdict.scores.insert(key.into(), v[key].as_f64());
        }
        return Some(verdict);
    }
    None
}

/// The judge's view of an agent conversation: each message, the reply, the
/// comments, and every accepted edit as before/after of the changed span
/// with a little context.
pub fn conversation_material(conv: &Conversation) -> String {
    let mut out = String::new();
    for (i, o) in conv.outcomes.iter().enumerate() {
        if i == 0 {
            out.push_str(&format!(
                "<document-before>\n{}\n</document-before>\n\n",
                clip(&o.doc_before, 9_000)
            ));
        }
        out.push_str(&format!(
            "<user-message turn=\"{}\">\n{}\n</user-message>\n",
            i + 1,
            o.message
        ));
        if o.proposals.is_empty() {
            out.push_str("<edits>none proposed</edits>\n");
        } else if let Some(err) = &o.apply_error {
            out.push_str(&format!(
                "<edits>proposed, but could not be applied: {err}</edits>\n"
            ));
        } else {
            out.push_str(&format!(
                "<edits accepted=\"{}\">\n{}\n</edits>\n",
                o.doc_after != o.doc_before,
                diff_view(&o.doc_before, &o.doc_after)
            ));
        }
        for (anchor, comment) in &o.comments {
            out.push_str(&format!(
                "<comment on=\"{}\">{}</comment>\n",
                clip(anchor, 200),
                comment
            ));
        }
        out.push_str(&format!(
            "<assistant-reply>\n{}\n</assistant-reply>\n\n",
            o.reply
        ));
    }
    out
}

/// Before/after of the changed span plus ~300 bytes either side.
pub fn diff_view(before: &str, after: &str) -> String {
    if before == after {
        return "(document unchanged)".into();
    }
    let (mut s, mut e, mut e2) = checks::changed_span(before, after);
    // Whole words inside the markers ("dachten", not "dach⟫ten"): the
    // common prefix and suffix are the same text in both versions.
    let latin = |c: char| c.is_alphanumeric() && !c.is_ascii_digit() && (c as u32) < 0x2e80;
    while let Some(c) = before[..s].chars().next_back().filter(|&c| latin(c)) {
        if !before[s..].chars().next().is_some_and(latin)
            && !after[s..].chars().next().is_some_and(latin)
        {
            break;
        }
        s -= c.len_utf8();
    }
    while let Some(c) = before[e..].chars().next().filter(|&c| latin(c)) {
        if !before[..e].chars().next_back().is_some_and(latin)
            && !after[..e2].chars().next_back().is_some_and(latin)
        {
            break;
        }
        e += c.len_utf8();
        e2 += c.len_utf8();
    }
    // 300 characters of context either side, marked when cut.
    let back = |text: &str, from: usize| -> (usize, &'static str) {
        match text[..from].char_indices().rev().nth(299) {
            Some((i, _)) => (i, "…"),
            None => (0, ""),
        }
    };
    let ahead = |text: &str, from: usize| -> (usize, &'static str) {
        match text[from..].char_indices().nth(300) {
            Some((i, _)) => (from + i, "…"),
            None => (text.len(), ""),
        }
    };
    let (cs, lead) = back(before, s);
    let (ce, tail) = ahead(before, e);
    let (ce2, tail2) = ahead(after, e2);
    format!(
        "BEFORE (changed part between ⟪ ⟫):\n{lead}{}⟪{}⟫{}{tail}\n\nAFTER:\n{lead}{}⟪{}⟫{}{tail2}",
        &before[cs..s],
        &before[s..e],
        &before[e..ce],
        &after[cs..s],
        &after[s..e2],
        &after[e2..ce2]
    )
}

pub fn clip(text: &str, n: usize) -> String {
    if text.chars().count() <= n {
        text.to_string()
    } else {
        format!(
            "{}…[{} more chars]",
            text.chars().take(n).collect::<String>(),
            text.chars().count() - n
        )
    }
}

// ----------------------------------------------------------------- recorder

#[derive(Clone, Debug)]
pub struct Check {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

/// Collects named pass/fail checks for one case.
#[derive(Default)]
pub struct Checks(pub Vec<Check>);

impl Checks {
    pub fn add(&mut self, name: &str, result: Result<(), String>) {
        let (ok, detail) = match result {
            Ok(()) => (true, String::new()),
            Err(e) => (false, e),
        };
        self.0.push(Check {
            name: name.into(),
            ok,
            detail,
        });
    }
    pub fn expect(&mut self, name: &str, ok: bool, detail: impl FnOnce() -> String) {
        self.add(name, if ok { Ok(()) } else { Err(detail()) });
    }
    pub fn failed(&self) -> Vec<&Check> {
        self.0.iter().filter(|c| !c.ok).collect()
    }
}

pub struct Record {
    pub case: String,
    pub model: String,
    pub lang: String,
    pub latency_ms: u128,
    pub usage: Usage,
    pub checks: Checks,
    pub verdict: Option<Verdict>,
    /// Everything that went in: document, cursor or selection, messages,
    /// settings - enough to judge the case without re-running it.
    pub input: Value,
    pub output: Value,
}

/// The case's group for the index: the first segment of its id
/// ("email/zh/formal" -> "email").
pub fn group_of(id: &str) -> &str {
    id.split('/').next().unwrap_or(id)
}

/// A record for a case that never ran (budget exhausted).
pub fn skipped(case: &str, model: &str, lang: &str, reason: String, input: Value) -> Record {
    let mut checks = Checks::default();
    checks.add("budget", Err(reason));
    Record {
        case: case.to_string(),
        model: model.to_string(),
        lang: lang.to_string(),
        latency_ms: 0,
        usage: Usage::default(),
        checks,
        verdict: None,
        input,
        output: Value::Null,
    }
}

fn run_dir() -> &'static PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = std::env::var("TEXTUS_EVAL_OUT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                std::env::temp_dir()
                    .join("textus-live-eval")
                    .join(stamp.to_string())
            });
        std::fs::create_dir_all(&dir).expect("create eval output dir");
        dir
    })
}

/// Writes `<suite>.jsonl` (every case in full) and `<suite>.md` (the summary
/// table) into the run directory, prints the summary, and returns the hard
/// failures for the test to assert on. Judge scores are reported, not
/// asserted: they are the quality signal to compare run to run, while the
/// automatic checks are the contract.
pub fn finish(suite: &str, records: Vec<Record>) -> Vec<String> {
    let dir = run_dir();
    let mut jsonl = String::new();
    let mut md = format!(
        "## {suite}\n\n| case | model | lang | ms | checks | judge (min/mean) | notes |\n| --- | --- | --- | ---: | --- | --- | --- |\n"
    );
    let mut failures = Vec::new();
    let mut total = Usage::default();
    let mut index: Vec<Value> = Vec::new();
    let (mut passed, mut judged, mut sum_mean, mut low) = (0, 0, 0.0, 0);
    let mut by_criterion: BTreeMap<String, (f64, usize)> = BTreeMap::new();
    for r in &records {
        let failed = r.checks.failed();
        if failed.is_empty() {
            passed += 1;
        }
        for c in &failed {
            failures.push(format!(
                "{} [{}]: {} - {}",
                r.case, r.model, c.name, c.detail
            ));
        }
        let judge_cell = match &r.verdict {
            Some(v) => {
                judged += 1;
                sum_mean += v.mean().unwrap_or(0.0);
                if v.min().unwrap_or(5.0) <= 2.0 {
                    low += 1;
                }
                for (k, s) in &v.scores {
                    if let Some(s) = s {
                        let e = by_criterion.entry(k.clone()).or_default();
                        e.0 += s;
                        e.1 += 1;
                    }
                }
                format!(
                    "{:.0} / {:.1}",
                    v.min().unwrap_or(0.0),
                    v.mean().unwrap_or(0.0)
                )
            }
            None => "-".into(),
        };
        let notes: Vec<String> = failed
            .iter()
            .map(|c| format!("✗ {}: {}", c.name, clip(&c.detail, 120)))
            .chain(
                r.verdict
                    .as_ref()
                    .filter(|v| v.min().unwrap_or(5.0) < 4.0)
                    .map(|v| format!("judge: {}", clip(&v.reasons, 200))),
            )
            .collect();
        md.push_str(&format!(
            "| {} | {} | {} | {} | {}/{} | {} | {} |\n",
            r.case,
            r.model,
            r.lang,
            r.latency_ms,
            r.checks.0.len() - failed.len(),
            r.checks.0.len(),
            judge_cell,
            notes.join("<br>").replace('|', "\\|").replace('\n', " ")
        ));
        total.merge(&r.usage);
        let line = json!({
            "suite": suite,
            "case": r.case,
            "group": group_of(&r.case),
            "model": r.model,
            "lang": r.lang,
            "latency_ms": r.latency_ms as u64,
            "usage": r.usage.json(),
            "checks": r.checks.0.iter().map(|c| json!({"name": c.name, "ok": c.ok, "detail": c.detail})).collect::<Vec<_>>(),
            "judge": r.verdict.as_ref().map(|v| json!({"scores": v.scores, "reasons": v.reasons})),
            "input": r.input,
            "output": r.output,
        });
        jsonl.push_str(&line.to_string());
        jsonl.push('\n');
        index.push(json!({
            "suite": suite,
            "id": r.case,
            "group": group_of(&r.case),
            "model": r.model,
            "lang": r.lang,
            "passed_checks": r.checks.0.iter().filter(|c| c.ok).map(|c| c.name.clone()).collect::<Vec<_>>(),
            "failed_checks": failed.iter().map(|c| format!("{}: {}", c.name, c.detail)).collect::<Vec<_>>(),
        }));
    }
    let n = records.len().max(1);
    let mut latencies: Vec<u128> = records.iter().map(|r| r.latency_ms).collect();
    latencies.sort();
    let median = latencies.get(latencies.len() / 2).copied().unwrap_or(0);
    md.push_str(&format!(
        "\n**{suite}**: {passed}/{} cases pass every check; judge mean {:.2} over {judged} cases, {low} with a score ≤ 2; median latency {median} ms.\n",
        records.len(),
        if judged > 0 { sum_mean / judged as f64 } else { 0.0 },
    ));
    if !by_criterion.is_empty() {
        md.push_str("\nJudge means by criterion: ");
        md.push_str(
            &by_criterion
                .iter()
                .map(|(k, (s, c))| format!("{k} {:.2}", s / *c as f64))
                .collect::<Vec<_>>()
                .join(", "),
        );
        md.push('\n');
    }
    // A spending limit or outage fails every later case the same way; say
    // so, so those rows aren't read as quality results.
    let unreached = records
        .iter()
        .filter(|r| r.checks.0.iter().any(|c| c.name == "request" && !c.ok))
        .count();
    if unreached > 0 {
        md.push_str(&format!(
            "\n**Warning: {unreached} of {n} cases never got an answer from the API** (see their `request` check) - they measure the connection or the key's limits, not the prompts.\n"
        ));
    }
    let skipped = records
        .iter()
        .filter(|r| r.checks.0.iter().any(|c| c.name == "budget" && !c.ok))
        .count();
    if skipped > 0 {
        md.push_str(&format!(
            "\n**Warning: {skipped} of {n} cases were skipped by the budget guard** (TEXTUS_EVAL_BUDGET_USD).\n"
        ));
    }
    md.push_str(&format!(
        "\nTokens: {} requests, {} input, {} cache write, {} cache read, {} output - ${:.4} at list prices.\n",
        total.requests, total.input, total.cache_write, total.cache_read, total.output, total.cost_usd
    ));
    std::fs::write(dir.join(format!("{suite}.jsonl")), jsonl).expect("write jsonl");
    std::fs::write(dir.join(format!("{suite}.md")), &md).expect("write summary");
    std::fs::write(
        dir.join(format!("{suite}.usage.json")),
        serde_json::to_string_pretty(
            &json!({"suite": suite, "cases": records.len(), "usage": total.json()}),
        )
        .unwrap(),
    )
    .expect("write usage");
    write_index(dir, suite, index);
    record_spend(dir, suite, records.len(), &total);
    println!("\n{md}\n[live_eval] full output: {}", dir.display());
    failures
}

/// `cases-index.json` in the run folder: one row per case of every suite
/// run into it (a suite re-run replaces its own rows).
fn write_index(dir: &Path, suite: &str, rows: Vec<Value>) {
    let path = dir.join("cases-index.json");
    let mut all: Vec<Value> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    all.retain(|row| row["suite"] != suite);
    all.extend(rows);
    std::fs::write(&path, serde_json::to_string_pretty(&all).unwrap()).expect("write index");
}

/// TEXTUS_EVAL_SPEND_FILE: a running `{"spent_usd", "runs": [...]}` ledger
/// that each finished suite adds its cost to.
fn record_spend(dir: &Path, suite: &str, cases: usize, total: &Usage) {
    let Ok(path) = std::env::var("TEXTUS_EVAL_SPEND_FILE") else {
        return;
    };
    let mut ledger: Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({"spent_usd": 0.0, "runs": []}));
    let spent = ledger["spent_usd"].as_f64().unwrap_or(0.0) + total.cost_usd;
    ledger["spent_usd"] = json!((spent * 1e6).round() / 1e6);
    let finished = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let mut run = total.json();
    run["suite"] = json!(suite);
    run["cases"] = json!(cases);
    run["out_dir"] = json!(dir.display().to_string());
    run["finished_unix"] = json!(finished);
    match ledger["runs"].as_array_mut() {
        Some(runs) => runs.push(run),
        None => ledger["runs"] = json!([run]),
    }
    if let Some(parent) = Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, serde_json::to_string_pretty(&ledger).unwrap()).expect("write spend");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_diff_view_marks_whole_words_and_cut_context() {
        let view = diff_view(
            "was die Teilnehmenden dachten.",
            "was die Teilnehmenden hielten.",
        );
        assert!(view.contains("⟪dachten⟫"), "{view}");
        assert!(view.contains("⟪hielten⟫"), "{view}");
        let long = format!("{}end", "字".repeat(400));
        let view = diff_view(&long, &long.replace("end", "fin"));
        assert!(view.contains("…字"), "cut context is marked");
        assert!(!view.contains("……"));
    }

    #[test]
    fn a_selection_follows_accepted_edits_like_the_editor() {
        let before = "A one. B two. C three.";
        let sel = (7, 13); // "B two."
                           // The selection itself rewritten: the range grows over the new text.
        let after = "A one. B is the second. C three.";
        let (s, e) = map_selection(before, after, sel).unwrap();
        assert_eq!(&after[s..e], "B is the second.");
        // An edit before it shifts it; one after it leaves it alone.
        let after = "A first one. B two. C three.";
        let (s, e) = map_selection(before, after, sel).unwrap();
        assert_eq!(&after[s..e], "B two.");
        let after = "A one. B two. C three and four.";
        assert_eq!(map_selection(before, after, sel), Some(sel));
        // Deleted outright: nothing left to select.
        assert_eq!(map_selection(before, "A one.  C three.", sel), None);
    }

    #[test]
    fn heading_at_finds_the_section_above() {
        let doc = "# T\n\n## One\n\ntext\n\n```\n# not a heading\n```\n\n## Two\n\nmore";
        assert_eq!(
            heading_at(doc, doc.find("text").unwrap()).as_deref(),
            Some("One")
        );
        assert_eq!(
            heading_at(doc, doc.find("more").unwrap()).as_deref(),
            Some("Two")
        );
        assert_eq!(
            heading_at(doc, doc.find("not a").unwrap()).as_deref(),
            Some("One")
        );
        assert_eq!(heading_at(doc, 0).as_deref(), Some("T"));
    }

    #[test]
    fn usage_is_priced_per_model() {
        let u = StepUsage {
            input_tokens: 1_000_000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 1_000_000,
            output_tokens: 100_000,
        };
        assert!((cost_usd("claude-sonnet-5-5", &u) - 3.2).abs() < 1e-9);
        assert!((cost_usd("claude-haiku-5-5", &u) - 0.16).abs() < 1e-9);
        let mut total = Usage::default();
        total.add("claude-sonnet-5-5", &u);
        total.add("claude-haiku-5-5", &u);
        assert_eq!(total.requests, 2);
        assert!((total.cost_usd - 3.36).abs() < 1e-9);
    }
}
