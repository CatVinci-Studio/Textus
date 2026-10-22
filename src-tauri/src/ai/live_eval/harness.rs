//! Shared machinery for the live evaluation: credentials and model choice,
//! a bounded worker pool, the agent conversation runner (the app's real
//! prompts, tools and loop, plus the frontend's accept/annotate steps), the
//! Opus judge, and the recorder that writes every case's output and scores
//! to disk.

use super::checks::{self, Caret, Proposal};
use crate::ai::agent::{
    build_instructions, compact_history, request_context, request_message, AgentMode, MAX_STEPS,
};
use crate::ai::tools::{self, ToolContext};
use crate::ai::workspace::AgentWorkspace;
use aicompat::agent::{run_agent_loop, AgentTurn, ProviderEvent, StepResult, ToolCall};
use aicompat::capabilities::ThinkingLevel;
use aicompat::providers::anthropic::{self, AnthropicAuth, StepUsage};
use aicompat::providers::{AgentProvider, Endpoint};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

// ------------------------------------------------------------- environment

/// A key for a live run: the environment variable `name`, else the line
/// `name=value` in the one env file every key can live in - TEXTUS_ENV_FILE,
/// or `.env.local` at the repository root (git-ignored). Quotes around the
/// value and `export ` before the name are allowed; `#` starts a comment.
pub fn secret(name: &str) -> Option<String> {
    if let Some(value) = std::env::var(name).ok().filter(|v| !v.trim().is_empty()) {
        return Some(value.trim().to_string());
    }
    let path = std::env::var("TEXTUS_ENV_FILE")
        .unwrap_or_else(|_| format!("{}/../.env.local", env!("CARGO_MANIFEST_DIR")));
    let text = std::fs::read_to_string(path).ok()?;
    env_file_value(&text, name)
}

fn env_file_value(text: &str, name: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let line = line.trim();
        let line = line.strip_prefix("export ").unwrap_or(line);
        let (key, value) = line.split_once('=')?;
        if line.starts_with('#') || key.trim() != name {
            return None;
        }
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);
        (!value.is_empty()).then(|| value.to_string())
    })
}

pub fn auth() -> Option<AnthropicAuth> {
    if let Some(key) = secret("ANTHROPIC_API_KEY") {
        return Some(AnthropicAuth::ApiKey(key));
    }
    // The key file that came before the env file still works.
    let path = std::env::var("TEXTUS_ANTHROPIC_KEY_FILE")
        .unwrap_or_else(|_| format!("{}/../.anthropic-api-key.local", env!("CARGO_MANIFEST_DIR")));
    match std::fs::read_to_string(&path) {
        Ok(key) if !key.trim().is_empty() => Some(AnthropicAuth::ApiKey(key.trim().to_string())),
        _ => {
            eprintln!("live_eval: no ANTHROPIC_API_KEY in the environment or .env.local, and no key at {path} - skipping");
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
        let model = crate::ai::catalog::find(agent_provider_id())
            .and_then(|e| e.agent_default_model)
            .expect("the eval's provider has an agent default");
        // Vertex AI names Google's own models by their publisher.
        if on_vertex() {
            format!("google/{model}")
        } else {
            model.to_string()
        }
    })
}

/// TEXTUS_EVAL_PROVIDER=vertex: Gemini on Vertex AI, with the API key
/// GOOGLE_VERTEX_API_KEY (express mode) and the project
/// TEXTUS_EVAL_VERTEX_PROJECT - its OpenAI-compatible endpoint on
/// aiplatform.googleapis.com, never the Gemini Developer API.
fn on_vertex() -> bool {
    std::env::var("TEXTUS_EVAL_PROVIDER").is_ok_and(|v| v == "vertex")
}

/// TEXTUS_EVAL_PROVIDER=doubao: the agent cases run on Volcengine Ark
/// (VOLCENGINE_ARK_API_KEY) instead of Claude, through the same
/// AgentProvider path - to compare a change on a second provider, or when
/// the Claude key can't be used. The judge stays Claude.
///
/// TEXTUS_EVAL_PROVIDER=deepseek or minimax: on DeepSeek
/// (DEEPSEEK_API_KEY) or MiniMax's China platform (MINIMAX_API_KEY), the
/// same way.
///
/// TEXTUS_EVAL_PROVIDER=chatgpt: on a ChatGPT subscription, as Textus on
/// this machine is signed in (Settings › Textus AI › ChatGPT): its
/// auth-codex.json, read where it is - never copied, printed or refreshed,
/// so the app's sign-in stays as it was. Sign in again there once its
/// token has expired.
pub fn agent_provider_id() -> &'static str {
    match std::env::var("TEXTUS_EVAL_PROVIDER").as_deref() {
        Ok("doubao") => "doubao",
        Ok("deepseek") => "deepseek",
        Ok("minimax") => "minimax",
        Ok("chatgpt") => "openai",
        Ok("vertex") => "google",
        _ => "anthropic",
    }
}

/// The app's ChatGPT sign-in (auth/openai_codex.rs's auth-codex.json):
/// its access token and account.
fn chatgpt_sign_in() -> (String, String) {
    let path = std::env::var_os("HOME")
        .map(PathBuf::from)
        .expect("HOME")
        .join(".config/com.catvinci.textus/auth-codex.json");
    let text = std::fs::read_to_string(&path).expect("Textus signed in to ChatGPT");
    let auth: Value = serde_json::from_str(&text).expect("auth-codex.json");
    let expires = auth["expires"].as_i64().unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    assert!(
        expires > now,
        "the ChatGPT sign-in has expired: sign in again in Textus"
    );
    let field = |name: &str| {
        auth[name]
            .as_str()
            .unwrap_or_else(|| panic!("auth-codex.json has no {name}"))
            .to_string()
    };
    (field("access"), field("account_id"))
}

/// The endpoint the agent cases run on (see agent_provider_id).
fn agent_endpoint(auth: &AnthropicAuth) -> Endpoint {
    match agent_provider_id() {
        "openai" => {
            let (access_token, account_id) = chatgpt_sign_in();
            Endpoint::Codex {
                access_token,
                account_id,
                originator: crate::app_identity::ORIGINATOR.to_string(),
            }
        }
        id @ ("doubao" | "deepseek" | "minimax") => {
            let base_url = crate::ai::catalog::find(id)
                .and_then(|e| e.base_url)
                .expect("the provider has a base_url");
            let key = match id {
                "doubao" => "VOLCENGINE_ARK_API_KEY",
                "deepseek" => "DEEPSEEK_API_KEY",
                _ => "MINIMAX_API_KEY",
            };
            Endpoint::ChatCompletions {
                base_url: base_url.to_string(),
                api_key: Some(secret(key).unwrap_or_else(|| panic!("{key}"))),
                vendor: crate::ai::route::chat_vendor(base_url),
                stream_usage: true,
            }
        }
        "google" => {
            let project = std::env::var("TEXTUS_EVAL_VERTEX_PROJECT")
                .expect("TEXTUS_EVAL_VERTEX_PROJECT: the Vertex AI project");
            Endpoint::ChatCompletions {
                base_url: format!(
                    "https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/endpoints/openapi"
                ),
                api_key: Some(secret("GOOGLE_VERTEX_API_KEY").expect("GOOGLE_VERTEX_API_KEY")),
                vendor: crate::ai::route::chat_vendor("https://aiplatform.googleapis.com"),
                stream_usage: true,
            }
        }
        _ => Endpoint::Anthropic { auth: auth.clone() },
    }
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

/// With TEXTUS_EVAL_TIMELINE=1, what the stream sends and when, printed as
/// it comes: each run of thinking, text or a tool call's arguments with its
/// start, end and size, and every pause of over a second between events -
/// to see where a request keeps the user waiting.
struct Timeline {
    on: bool,
    started: Instant,
    state: Mutex<TimelineState>,
}

#[derive(Default)]
struct TimelineState {
    kind: String,
    since: f64,
    last: f64,
    chars: usize,
    head: String,
}

impl Timeline {
    fn from_env() -> Self {
        Timeline {
            on: std::env::var("TEXTUS_EVAL_TIMELINE").is_ok_and(|v| v == "1"),
            started: Instant::now(),
            state: Mutex::new(TimelineState::default()),
        }
    }

    fn observe(&self, event: &ProviderEvent<'_>) {
        if !self.on {
            return;
        }
        let (kind, text) = match event {
            ProviderEvent::Thinking(t) => ("thinking".to_string(), *t),
            ProviderEvent::Text(t) => ("text".to_string(), *t),
            ProviderEvent::ToolStart { name, .. } => (format!("start {name}"), ""),
            ProviderEvent::ToolArgs { delta, .. } => ("tool args".to_string(), *delta),
            ProviderEvent::Citation { .. } => ("citation".to_string(), ""),
        };
        let now = self.started.elapsed().as_secs_f64();
        let mut s = self.state.lock().unwrap();
        if now - s.last > 1.0 && !s.kind.is_empty() {
            Self::flush(&s);
            eprintln!("  [timeline] {:6.1}s .. {:6.1}s  (nothing)", s.last, now);
            s.kind.clear();
        }
        if s.kind != kind {
            if !s.kind.is_empty() {
                Self::flush(&s);
            }
            *s = TimelineState {
                kind,
                since: now,
                ..Default::default()
            };
        }
        s.last = now;
        s.chars += text.chars().count();
        if s.head.chars().count() < 70 {
            s.head.push_str(text);
        }
    }

    fn flush(s: &TimelineState) {
        let head: String = s.head.chars().take(70).collect();
        eprintln!(
            "  [timeline] {:6.1}s .. {:6.1}s  {} ({} chars) {:?}",
            s.since, s.last, s.kind, s.chars, head
        );
    }
}

impl Drop for Timeline {
    fn drop(&mut self) {
        let s = self.state.lock().unwrap();
        if self.on && !s.kind.is_empty() {
            Self::flush(&s);
        }
    }
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
        // Approximate, from Ark's yuan list prices.
        m if m.starts_with("doubao-") => [0.55, 0.0, 0.11, 2.2],
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
    /// Neither accepts nor rejects: the proposals stay undecided into the
    /// next message, as when the user types on (or queues a message)
    /// before deciding. A later edit quoted from them goes into them, as
    /// the frontend's joinEdit does; a later turn's Accept takes them too.
    pub leave: bool,
}

impl UserTurn {
    pub fn new(message: impl Into<String>) -> UserTurn {
        UserTurn {
            message: message.into(),
            caret: Caret::default(),
            accept: true,
            follow_selection: false,
            leave: false,
        }
    }

    /// This message, its proposals left undecided.
    pub fn leaving(message: impl Into<String>) -> UserTurn {
        UserTurn {
            leave: true,
            ..UserTurn::new(message)
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
    /// Proposals that went into an earlier, undecided one (joinEdit).
    pub joined: usize,
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
    /// Thinking the stream reported: events (Claude sends one per thinking
    /// block even when it shows no text) and characters of readable text.
    pub thinking_events: usize,
    pub thinking_chars: usize,
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
    /// What the composer asks for (Auto unless Deep thinking is on). Every
    /// request also opts into Claude's preserved-thinking check, so a
    /// thinking block replayed after an edit to the history fails the case
    /// instead of passing on an account the check isn't enforced for.
    pub thinking: ThinkingLevel,
    /// generate_image, for the picture cases: None offers no such tool, as
    /// the app does without an image model.
    pub pictures: Option<&'a crate::ai::images::ImageRun>,
    /// The memory pass after each exchange, writing to these folders, and what they hold
    /// sent with each message, read again every turn - as the app does
    /// with Remember automatically on. None: nothing is remembered.
    pub memory: Option<&'a crate::ai::memory::MemoryDirs>,
}

/// Mirrors src/ai/revision/proposal-status.ts's note for a proposal not
/// decided yet.
const PENDING_NOTE: &str = "Status: the user has NOT yet accepted or rejected this proposed edit. It is shown to them as a preview and is NOT in the document text in this request - do not assume it was applied. To change it or go on from it, anchor in its text: the edit goes into this proposal.";

/// Mirrors src/ai/revision/proposal-status.ts's note for an edit that went
/// into another proposal.
const JOINED_NOTE: &str = "Status: this went into the proposed text it changes or goes next to - that proposal now reads with it, and it is accepted or rejected with that proposal.";

/// Mirrors src/ai/revision/proposal-status.ts's notes for the two decided states.
const ACCEPTED_NOTE: &str =
    "Status: the user accepted this proposed edit - the document text in this request includes it.";
const REJECTED_NOTE: &str =
    "Status: the user rejected this proposed edit - it was not applied. Don't propose it again unless asked.";
/// Mirrors src/ai/revision/proposal-status.ts's note for a proposal a later
/// one took the place of.
const REPLACED_NOTE: &str = "Status: a later proposal of yours for the same passage took this one's place before the user decided on it - it was not applied, and the user didn't reject it.";

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
    // What generate_image streams (its start) goes nowhere here.
    let events = tauri::ipc::Channel::new(|_| Ok(()));
    let mut history: Vec<AgentTurn> = Vec::new();
    let mut doc = document.to_string();
    // Proposals left undecided, by call id, as they now read.
    let mut held_back: Vec<(String, Proposal)> = Vec::new();
    let mut outcomes = Vec::new();
    let mut error = None;
    // Quick Ask's captured selection, mapped through accepted edits.
    let mut selection = script
        .first()
        .filter(|t| t.follow_selection)
        .and_then(|t| t.caret.selection);

    for user in script {
        // What is remembered so far, sent with this message.
        let remembering;
        let ws = match setup.memory {
            Some(dirs) => {
                let mut with = setup.workspace.clone();
                with.remember = true;
                with.memories = dirs.load();
                remembering = with;
                &remembering
            }
            None => setup.workspace,
        };
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
        let undecided = crate::ai::images::undecided_edits(&history);
        let ctx = ToolContext {
            document: &doc,
            undecided: &undecided,
            skills: &ws.skills,
            ui_language: setup.ui_language,
            root,
            sees_images: sees_images(),
            conventions: &conventions,
            library: &library,
            proposed: Default::default(),
            checks: Default::default(),
        };
        // Images as the
        // app offers them to the provider the eval runs on (Anthropic), and
        // generate_image when the case gives it one, on this turn's
        // document as the app does per request.
        let mut tool_set = tools::ToolRegistry::builtin(
            ws.has_usable_skills(),
            root.is_some(),
            setup.mode,
            sees_images(),
        );
        if let Some(pictures) = setup.pictures {
            tool_set.add(pictures.tool(
                &doc,
                crate::ai::images::ProposedText {
                    this_request: &ctx.proposed,
                    undecided: &undecided,
                },
                &events,
            ));
        }
        let specs = tool_set.specs();
        let usage = RefCell::new(Vec::new());
        let postfix = RefCell::new(Vec::new());
        let thinking_events = AtomicUsize::new(0);
        let thinking_chars = AtomicUsize::new(0);
        // The app's provider path (route::agent_provider), on Claude unless
        // TEXTUS_EVAL_PROVIDER says otherwise.
        let agent = AgentProvider {
            id: agent_provider_id().to_string(),
            model: setup.model.to_string(),
            endpoint: agent_endpoint(auth),
            thinking: setup.thinking,
            native_search: None,
            enforce_binding: true,
        };
        // Pictures written into the text, begun as the app begins them.
        let inline = setup.pictures.map(|p| p.inline(&ctx.proposed));
        let timeline = Timeline::from_env();
        let sink = |event: ProviderEvent<'_>| {
            timeline.observe(&event);
            if let Some(inline) = &inline {
                inline.observe(&event);
            }
            if let ProviderEvent::Thinking(text) = event {
                thinking_events.fetch_add(1, Ordering::Relaxed);
                thinking_chars.fetch_add(text.chars().count(), Ordering::Relaxed);
            }
        };
        let started = Instant::now();
        let result = block_on(run_agent_loop(
            compact_history(history.clone()),
            AgentTurn::User {
                text: request_message(
                    ws,
                    setup.mode,
                    setup.ui_language,
                    &request_context(ws, &doc, true, &message_sent, focus_heading.as_deref()),
                    &message_sent,
                ),
                images: Vec::new(),
            },
            MAX_STEPS,
            |h: Vec<AgentTurn>| {
                let (instructions, specs, usage, postfix) =
                    (&instructions, &specs, &usage, &postfix);
                let (agent, sink) = (&agent, &sink);
                let (doc, conventions, inline) = (&doc, &conventions, &inline);
                let ledger = &ctx.proposed;
                async move {
                    // with_retry's loop, inline: this already runs inside
                    // block_on, which can't be nested.
                    let mut waits = [3u64, 10, 30].into_iter();
                    let (step, used): (StepResult, StepUsage) = loop {
                        match agent.step(instructions, &h, specs, sink).await {
                            Ok((step, used)) => break (step, used.unwrap_or_default()),
                            Err(e) if transient(&e) => match waits.next() {
                                Some(w) => std::thread::sleep(std::time::Duration::from_secs(w)),
                                None => return Err(e),
                            },
                            Err(e) => return Err(e),
                        }
                    };
                    charge(setup.model, &used);
                    usage.borrow_mut().push(used);
                    let (step, applied) = crate::ai::agent::settle_step(
                        step,
                        doc,
                        conventions,
                        inline.as_ref(),
                        ledger,
                    );
                    postfix
                        .borrow_mut()
                        .extend(applied.into_iter().map(str::to_string));
                    Ok(step)
                }
            },
            |call: ToolCall| tool_set.execute(&ctx, call),
            |name| tool_set.how_to_run(name),
            |_| {},
        ));
        let latency_ms = started.elapsed().as_millis();
        // generate_image held this turn's document; the next turn's may differ.
        drop(tool_set);
        let mut turns = match result {
            Ok(turns) => turns,
            Err(e) => {
                error = Some(format!("turn {}: {e}", outcomes.len() + 1));
                break;
            }
        };

        // What history keeps is the plain message (ai_agent_message_inner),
        // and no step's reasoning (agent::for_history).
        if let Some(AgentTurn::User { text, .. }) = turns.first_mut() {
            *text = message_sent.clone();
        }
        for turn in &mut turns {
            if let AgentTurn::ToolCall { reasoning, .. } = turn {
                *reasoning = None;
            }
        }

        let mut outcome = TurnOutcome {
            message: user.message.clone(),
            message_sent: message_sent.clone(),
            caret,
            focus_heading,
            doc_before: doc.clone(),
            latency_ms,
            usage: usage.into_inner(),
            thinking_events: thinking_events.into_inner(),
            thinking_chars: thinking_chars.into_inner(),
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
                    ..
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
                AgentTurn::Assistant { text, .. } => outcome.reply = text.clone(),
                _ => {}
            }
        }

        // An edit quoted from an undecided proposal goes into it - also one
        // of document text a rewrite replaces (joinInto).
        let mut standing = Vec::new();
        let mut standing_ids = Vec::new();
        let mut joined_ids = Vec::new();
        let ids = std::mem::take(&mut proposal_ids);
        for (proposal, id) in std::mem::take(&mut outcome.proposals).into_iter().zip(ids) {
            let anchor = proposal.anchor.as_str();
            let into = (!anchor.is_empty())
                .then(|| {
                    held_back.iter_mut().find_map(|(_, held)| {
                        let replaces = held.action == "replace" && held.anchor.contains(anchor);
                        (!doc.contains(anchor) || replaces)
                            .then(|| {
                                crate::ai::images::edited_text(
                                    &held.text,
                                    &proposal.action,
                                    anchor,
                                    &proposal.text,
                                )
                            })
                            .flatten()
                            .map(|text| (held, text))
                    })
                })
                .flatten();
            match into {
                Some((held, text)) => {
                    held.text = text;
                    outcome.joined += 1;
                    joined_ids.push(id);
                }
                None => {
                    standing.push(proposal);
                    standing_ids.push(id);
                }
            }
        }
        outcome.proposals = standing;
        let proposal_ids = standing_ids;
        // A new version of a passage an undecided rewrite replaces takes its
        // place: the old one reads as rejected (useEditorProposals's
        // addPreviews).
        held_back.retain(|(id, held)| {
            let superseded = held.action == "replace"
                && outcome
                    .proposals
                    .iter()
                    .any(|p| p.action == "replace" && p.anchor == held.anchor);
            if superseded {
                for turn in history.iter_mut() {
                    if let AgentTurn::ToolResult {
                        call_id, output, ..
                    } = turn
                    {
                        if call_id == id {
                            *output = output.replace(PENDING_NOTE, REPLACED_NOTE);
                        }
                    }
                }
            }
            !superseded
        });
        let decided = !user.leave;
        if user.accept && decided {
            let all: Vec<Proposal> = held_back
                .iter()
                .map(|(_, p)| p.clone())
                .chain(outcome.proposals.iter().cloned())
                .collect();
            if !all.is_empty() {
                match checks::apply_all(&doc, &all, caret) {
                    Ok(next) => doc = next,
                    Err(e) => outcome.apply_error = Some(e),
                }
            }
        }
        outcome.doc_after = doc.clone();
        if let Some(sel) = selection {
            selection = map_selection(&outcome.doc_before, &doc, sel);
        }

        let note = if user.leave {
            PENDING_NOTE
        } else if user.accept && outcome.apply_error.is_none() {
            ACCEPTED_NOTE
        } else {
            REJECTED_NOTE
        };
        if !user.leave {
            // The ones left before are decided with these: their notes in
            // the history say so now.
            for turn in history.iter_mut() {
                if let AgentTurn::ToolResult {
                    call_id, output, ..
                } = turn
                {
                    if held_back.iter().any(|(id, _)| id == call_id) {
                        *output = output.replace(PENDING_NOTE, note);
                    }
                }
            }
            held_back.clear();
        } else {
            let ids: Vec<&String> = proposal_ids.iter().collect();
            held_back.extend(
                outcome
                    .proposals
                    .iter()
                    .zip(ids)
                    .map(|(p, id)| (id.clone(), p.clone())),
            );
        }
        for turn in turns.iter_mut() {
            if let AgentTurn::ToolResult {
                call_id, output, ..
            } = turn
            {
                if proposal_ids.contains(call_id) {
                    *output = format!("{output}\n\n[{note}]");
                } else if joined_ids.contains(call_id) {
                    *output = format!("{output}\n\n[{JOINED_NOTE}]");
                }
            }
        }
        // What to remember, decided after the exchange (memory::pass) by
        // the conversation's model, as the app does; each change recorded
        // as a remember call, as the chips show it.
        if let Some(dirs) = setup.memory {
            let exchange = crate::ai::memory::Exchange {
                messages: outcomes
                    .iter()
                    .map(|o: &TurnOutcome| o.message.clone())
                    .chain(std::iter::once(outcome.message.clone()))
                    .collect(),
                reply: outcome.reply.clone(),
            };
            let agent = &agent;
            // The model's answer too, for the report.
            let said = RefCell::new(String::new());
            let answer = &said;
            let kept = block_on(crate::ai::memory::run_pass(
                dirs,
                &exchange,
                &Default::default(),
                |instructions, input| async move {
                    let turn = [AgentTurn::User {
                        text: input,
                        images: Vec::new(),
                    }];
                    let (step, used) = agent.step(&instructions, &turn, &[], &|_| {}).await?;
                    charge(setup.model, &used.unwrap_or_default());
                    let text = match step {
                        StepResult::Done(text) => text,
                        _ => String::new(),
                    };
                    answer.replace(text.clone());
                    Ok(text)
                },
            ));
            match kept {
                Ok(kept) => {
                    outcome.calls.push(
                        serde_json::json!({"name": "memory_pass", "result": said.into_inner()}),
                    );
                    outcome.calls.extend(
                        kept.iter()
                            .map(|r| serde_json::json!({"name": "remember", "args": r})),
                    );
                }
                Err(e) => eprintln!("live_eval: memory pass failed: {e}"),
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

#[cfg(test)]
mod env_file_tests {
    use super::env_file_value;

    #[test]
    fn reads_one_key_from_an_env_file() {
        let text = "# keys\nexport ANTHROPIC_API_KEY=\"sk-a\"\nVOLCENGINE_ARK_API_KEY = 'ark-b'\n#OTHER=x\nEMPTY=\n";
        assert_eq!(
            env_file_value(text, "ANTHROPIC_API_KEY").as_deref(),
            Some("sk-a")
        );
        assert_eq!(
            env_file_value(text, "VOLCENGINE_ARK_API_KEY").as_deref(),
            Some("ark-b")
        );
        assert_eq!(env_file_value(text, "OTHER"), None);
        assert_eq!(env_file_value(text, "EMPTY"), None);
        assert_eq!(env_file_value(text, "MISSING"), None);
    }
}
